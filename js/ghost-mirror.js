// หน้า 2 — Ghost Mirror: กระจกที่ทิ้งร่างซ้ำไว้ตามทางที่ขยับ
//
// ทุกเฟรม: สร้าง "mask ตัวคน" จากภาพกล้อง (AI หรือจับการขยับ)
//   -> ถ้าท่าทางเปลี่ยนพอ ตัดตัวคนเก็บเป็น "ร่างซ้ำ" (ghost)
//   -> วาด ฉากหลัง + ร่างซ้ำที่ค่อยๆ จาง + ตัวจริงทับบนสุด

const canvas = document.getElementById('stage');
const ctx = setupFullscreenCanvas(canvas);
const video = document.getElementById('video');
const startScreen = document.getElementById('start');
const errorBox = document.getElementById('error');
const statusEl = document.getElementById('status');
const flash = document.getElementById('flash');

// MediaPipe โหลดจาก CDN เฉพาะตอนใช้โหมด AI
const MP_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

const PROC_W = 256; // ความละเอียดที่ใช้คำนวณ mask (เล็ก = เร็ว)
const GHOST_W = 640; // ความละเอียดของร่างซ้ำ
const MIN_GHOST_GAP = 60; // ms
const ECHO_GAP = 120; // ms

const state = {
  mode: 'ai', // ai | motion | echo
  tint: 'rainbow',
  background: 'dark',
  maxGhosts: 15,
  lifetime: 2500,
  ghosts: [],
  pool: [], // canvas ที่ใช้แล้ว เก็บไว้ใช้ซ้ำ ไม่ต้องสร้างใหม่
  hue: 0,
  lastGhostAt: 0,
};

let stream = null;
let segmenter = null;
let segmenterLoading = false;

let procW, procH, ghostW, ghostH;
const proc = document.createElement('canvas');
const pctx = proc.getContext('2d', { willReadFrequently: true });
const maskCanvas = document.createElement('canvas');
const mctx = maskCanvas.getContext('2d');
const person = document.createElement('canvas');
const personCtx = person.getContext('2d');
let maskImage = null;
let curShape = null; // silhouette ปัจจุบัน (0/1)
let lastShape = null; // silhouette ตอนเก็บร่างล่าสุด
let bgModel = null; // ภาพพื้นหลังเฉลี่ย สำหรับโหมดจับการขยับ

function setStatus(text) {
  statusEl.textContent = text;
}

function setupSizes() {
  const aspect = video.videoHeight / video.videoWidth;
  procW = PROC_W;
  procH = Math.round(PROC_W * aspect);
  ghostW = GHOST_W;
  ghostH = Math.round(GHOST_W * aspect);
  proc.width = maskCanvas.width = procW;
  proc.height = maskCanvas.height = procH;
  maskImage = mctx.createImageData(procW, procH);
  maskImage.data.fill(255);
  curShape = new Uint8Array(procW * procH);
  lastShape = new Uint8Array(procW * procH);
  bgModel = null;
}

// วาดภาพกล้องแบบกลับซ้าย-ขวาลง canvas ทั้งแผ่น
function drawMirroredFull(g, w, h) {
  g.setTransform(-1, 0, 0, 1, w, 0);
  g.drawImage(video, 0, 0, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0);
}

// วาดภาพกล้องแบบกลับซ้าย-ขวาลงในกรอบ r (ใช้กับ canvas ที่มี transform dpr อยู่แล้ว)
function drawMirroredRect(g, r) {
  g.save();
  g.translate(r.x + r.w, r.y);
  g.scale(-1, 1);
  g.drawImage(video, 0, 0, r.w, r.h);
  g.restore();
}

// ขยายภาพให้เต็มจอแบบ cover
function coverRect() {
  const sw = window.innerWidth;
  const sh = window.innerHeight;
  const s = Math.max(sw / video.videoWidth, sh / video.videoHeight);
  const w = video.videoWidth * s;
  const h = video.videoHeight * s;
  return { x: (sw - w) / 2, y: (sh - h) / 2, w, h };
}

function effectiveMode() {
  return state.mode === 'ai' && !segmenter ? 'motion' : state.mode;
}

// ---------- AI ตัดตัวคน ----------

async function loadSegmenter() {
  if (segmenter || segmenterLoading) return;
  segmenterLoading = true;
  setStatus('🧠 กำลังโหลด AI ตัดตัวคน… ระหว่างนี้ใช้โหมดจับการขยับไปก่อน');
  try {
    const vision = await import(`${MP_BASE}/vision_bundle.mjs`);
    const fileset = await vision.FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const create = delegate => vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MP_MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
    segmenter = await create('GPU').catch(() => create('CPU'));
    setStatus('');
  } catch (err) {
    console.error(err);
    setStatus('⚠️ โหลด AI ไม่สำเร็จ (ต้องต่ออินเทอร์เน็ต) — ใช้โหมดจับการขยับแทน');
  } finally {
    segmenterLoading = false;
  }
}

// ---------- mask ----------

// สร้าง mask ลง maskCanvas คืนค่า { area, changed } สำหรับตัดสินใจว่าจะเก็บร่างไหม
function updateMask(mode, now) {
  drawMirroredFull(pctx, procW, procH);
  const d = maskImage.data;
  const n = procW * procH;
  let area = 0;
  let changed = 0;

  if (mode === 'ai') {
    const result = segmenter.segmentForVideo(proc, now);
    const conf = result.confidenceMasks[0].getAsFloat32Array();
    for (let i = 0; i < n; i++) {
      // ขอบนุ่มๆ ระหว่างความมั่นใจ 0.3–0.7
      const a = Math.min(1, Math.max(0, (conf[i] - 0.3) / 0.4));
      d[i * 4 + 3] = a * 255;
      const on = a > 0.5 ? 1 : 0;
      curShape[i] = on;
      area += on;
      if (on !== lastShape[i]) changed++;
    }
    result.confidenceMasks.forEach(m => m.close());
  } else {
    // จับการขยับ: เทียบกับภาพพื้นหลังเฉลี่ยที่ค่อยๆ ปรับตัว
    const px = pctx.getImageData(0, 0, procW, procH).data;
    if (!bgModel) {
      bgModel = new Float32Array(n);
      for (let i = 0; i < n; i++) bgModel[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    }
    for (let i = 0; i < n; i++) {
      const g = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
      const diff = Math.abs(g - bgModel[i]);
      bgModel[i] += (g - bgModel[i]) * 0.05;
      const a = Math.min(1, Math.max(0, (diff - 12) / 20));
      d[i * 4 + 3] = a * 255;
      if (a > 0.5) area++;
    }
    changed = area;
  }

  mctx.putImageData(maskImage, 0, 0);
  return { area, changed };
}

function shouldCapture(mode, info, now) {
  const gap = now - state.lastGhostAt;
  if (mode === 'echo') return gap >= ECHO_GAP;
  const minArea = procW * procH * 0.01;
  if (info.area < minArea || gap < MIN_GHOST_GAP) return false;
  // AI: เก็บร่างเมื่อท่าทางเปลี่ยนไปพอสมควร — ยืนนิ่งก็ไม่เพิ่มร่าง ร่างเก่าจะค่อยๆ จางหาย
  if (mode === 'ai') return info.changed > info.area * 0.12;
  return gap >= MIN_GHOST_GAP * 1.5;
}

// ---------- ร่างซ้ำ ----------

function nextTint() {
  if (state.tint === 'rainbow') {
    state.hue = (state.hue + 23) % 360;
    return `hsla(${state.hue}, 100%, 60%, 0.6)`;
  }
  if (state.tint === 'ghost') return 'rgba(160, 220, 255, 0.7)';
  return null;
}

function captureGhost(mode, now) {
  const c = state.pool.pop() || document.createElement('canvas');
  c.width = ghostW; // ตั้งขนาดใหม่ = ล้างภาพเก่าไปในตัว
  c.height = ghostH;
  const g = c.getContext('2d');
  drawMirroredFull(g, ghostW, ghostH);
  if (mode !== 'echo') {
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(maskCanvas, 0, 0, ghostW, ghostH);
  }
  const tint = nextTint();
  if (tint) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = tint;
    g.fillRect(0, 0, ghostW, ghostH);
  }
  state.ghosts.push({ canvas: c, born: now });
  while (state.ghosts.length > state.maxGhosts) state.pool.push(state.ghosts.shift().canvas);
  if (mode === 'ai') lastShape.set(curShape);
}

// ---------- วาด ----------

function render(mode, now) {
  const r = coverRect();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;
  const dark = mode === 'ai' && state.background === 'dark';

  // ฉากหลัง
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  if (dark) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
  } else {
    drawMirroredRect(ctx, r);
    if (mode === 'ai') {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ร่างซ้ำ — เก่าสุดก่อน จางตามอายุ
  while (state.ghosts.length && now - state.ghosts[0].born > state.lifetime) {
    state.pool.push(state.ghosts.shift().canvas);
  }
  if (dark && state.tint !== 'real') ctx.globalCompositeOperation = 'lighter'; // เรืองแสงแบบนีออน
  const base = mode === 'echo' ? 0.45 : 0.85;
  for (const ghost of state.ghosts) {
    ctx.globalAlpha = (1 - (now - ghost.born) / state.lifetime) * base;
    ctx.drawImage(ghost.canvas, r.x, r.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  // ตัวจริงทับบนสุด — ใช้ภาพกล้องความละเอียดเต็ม + mask ที่ขยายขึ้น (ขอบจะนุ่มเอง)
  if (mode !== 'echo') {
    if (person.width !== canvas.width || person.height !== canvas.height) {
      person.width = canvas.width;
      person.height = canvas.height;
    }
    personCtx.setTransform(1, 0, 0, 1, 0, 0);
    personCtx.globalCompositeOperation = 'source-over';
    personCtx.clearRect(0, 0, person.width, person.height);
    personCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawMirroredRect(personCtx, r);
    personCtx.globalCompositeOperation = 'destination-in';
    personCtx.drawImage(maskCanvas, r.x, r.y, r.w, r.h);
    ctx.drawImage(person, 0, 0, w, h);
  }
}

function frame() {
  if (video.readyState >= 2) {
    const now = performance.now();
    let mode = effectiveMode();
    let info = null;
    if (mode !== 'echo') {
      try {
        info = updateMask(mode, now);
      } catch (err) {
        // AI พังกลางทาง (เช่น GPU มีปัญหา) -> ถอยไปโหมดจับการขยับ
        console.error(err);
        segmenter = null;
        setStatus('⚠️ AI ทำงานไม่ได้บนเครื่องนี้ — ใช้โหมดจับการขยับแทน');
        mode = 'motion';
        info = updateMask(mode, now);
      }
    }
    if (shouldCapture(mode, info, now)) {
      captureGhost(mode, now);
      state.lastGhostAt = now;
    }
    render(mode, now);
  }
  requestAnimationFrame(frame);
}

// ---------- เริ่มกล้อง ----------

document.getElementById('start-btn').addEventListener('click', async () => {
  errorBox.textContent = '';
  try {
    stream = await requestMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
    setupSizes();
    startScreen.classList.add('hidden');
    document.body.classList.add('started');
    if (state.mode === 'ai') loadSegmenter();
    requestAnimationFrame(frame);
  } catch (err) {
    console.error(err);
    errorBox.textContent = describeMediaError(err);
  }
});

stopStreamOnLeave(() => stream);

// ---------- controls ----------

const selectMode = bindChipGroup(document.getElementById('modes'), v => {
  state.mode = v;
  state.ghosts.forEach(g => state.pool.push(g.canvas));
  state.ghosts.length = 0;
  if (v === 'ai' && stream) loadSegmenter();
});
const selectTint = bindChipGroup(document.getElementById('tints'), v => { state.tint = v; });
const selectBackground = bindChipGroup(document.getElementById('backgrounds'), v => { state.background = v; });

document.getElementById('count').addEventListener('input', e => { state.maxGhosts = +e.target.value; });
document.getElementById('lifetime').addEventListener('input', e => { state.lifetime = +e.target.value; });

function snapshot() {
  flash.classList.add('on');
  setTimeout(() => flash.classList.remove('on'), 60);
  downloadCanvas(canvas, `ghost-mirror-${Date.now()}.png`);
}
document.getElementById('snap').addEventListener('click', snapshot);

const TINT_ORDER = ['rainbow', 'ghost', 'real'];
window.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (key === '1') selectMode('ai');
  else if (key === '2') selectMode('motion');
  else if (key === '3') selectMode('echo');
  else if (key === 'c') selectTint(TINT_ORDER[(TINT_ORDER.indexOf(state.tint) + 1) % TINT_ORDER.length]);
  else if (key === 'b') selectBackground(state.background === 'dark' ? 'room' : 'dark');
  else if (key === 's') snapshot();
});
