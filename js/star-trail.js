// หน้า 1 — Star Trail: ลากเมาส์แล้วดาวพ่นออกมา

const canvas = document.getElementById('stage');
const ctx = setupFullscreenCanvas(canvas);
const hint = document.getElementById('hint');

const MAX_PARTICLES = 1500;
const GRAVITY = 0.12;
const EMOJIS = ['🎉', '✨', '🌟', '💫', '🦄', '🍭', '🔥', '🌈'];

// วาดอีโมจิลง canvas เล็กๆ ไว้ครั้งเดียว แล้วใช้ drawImage แทน fillText ทุกเฟรม (fillText อีโมจิช้ามาก)
const SPRITE_SIZE = 96;
const EMOJI_SPRITES = EMOJIS.map(emoji => {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_SIZE;
  const g = c.getContext('2d');
  g.font = `${SPRITE_SIZE * 0.8}px serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, SPRITE_SIZE / 2, SPRITE_SIZE / 2 + SPRITE_SIZE * 0.05);
  return c;
});

const state = {
  shape: 'star',
  color: 'rainbow',
  particles: [],
  pointer: { x: 0, y: 0, down: false, speed: 0 },
  hue: 0,
};

// ---------- particle ----------

function pickColor(speed) {
  if (state.color === 'gold') return `hsl(${40 + Math.random() * 15}, 100%, ${60 + Math.random() * 25}%)`;
  if (state.color === 'speed') return `hsl(${Math.max(0, 220 - speed * 6)}, 100%, 65%)`;
  return `hsl(${(state.hue + Math.random() * 40) % 360}, 100%, 65%)`;
}

function spawn(x, y, vx, vy, speed) {
  if (state.particles.length >= MAX_PARTICLES) state.particles.shift();
  state.particles.push({
    x, y, vx, vy,
    size: 6 + Math.random() * 10 + Math.min(speed, 30) * 0.3,
    rot: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.3,
    life: 1,
    decay: 0.008 + Math.random() * 0.012,
    color: pickColor(speed),
    sprite: EMOJI_SPRITES[(Math.random() * EMOJI_SPRITES.length) | 0],
  });
}

// พ่นดาวตามเส้นทางเมาส์ — จำนวนขึ้นกับความเร็ว
function emitTrail(x, y, dx, dy) {
  const speed = Math.hypot(dx, dy);
  const count = Math.min(2 + Math.floor(speed / 4), 12);
  for (let i = 0; i < count; i++) {
    // กระจายจุดเกิดตามเส้นจากตำแหน่งเก่าไปใหม่ เส้นจะได้ไม่ขาดเป็นช่วงๆ
    const t = i / count;
    const angle = Math.random() * Math.PI * 2;
    const force = 0.5 + Math.random() * (1 + speed * 0.08);
    spawn(
      x - dx * t, y - dy * t,
      Math.cos(angle) * force + dx * 0.15,
      Math.sin(angle) * force + dy * 0.15 - 1,
      speed
    );
  }
}

function burst(x, y) {
  const count = 60;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const force = 4 + Math.random() * 6;
    spawn(x, y, Math.cos(angle) * force, Math.sin(angle) * force, 20);
  }
}

// ---------- เสียง (สังเคราะห์ด้วย Web Audio ไม่ต้องโหลดไฟล์) ----------

// เพนทาโทนิก: กดโน้ตไหนก็ไม่เพี้ยน — ซ้ายเสียงต่ำ ขวาเสียงสูง
const SCALE = [0, 2, 4, 7, 9];
const sound = {
  ctx: null,
  master: null,
  enabled: true,
  lastNoteAt: 0,

  // เบราว์เซอร์ให้เริ่มเสียงได้หลังผู้ใช้คลิก/กดปุ่มเท่านั้น
  unlock() {
    if (!this.ctx) {
      const ac = new (window.AudioContext || window.webkitAudioContext)();
      this.master = ac.createGain();
      this.master.gain.value = 0.5;
      // เสียงสะท้อนเบาๆ ให้ฟังดูวิบวับ
      const delay = ac.createDelay();
      delay.delayTime.value = 0.18;
      const feedback = ac.createGain();
      feedback.gain.value = 0.35;
      this.master.connect(ac.destination);
      this.master.connect(delay);
      delay.connect(feedback);
      feedback.connect(delay);
      delay.connect(ac.destination);
      this.ctx = ac;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },

  get ready() {
    return this.enabled && this.ctx && this.ctx.state === 'running';
  },

  noteFreq(x) {
    const steps = SCALE.length * 3;
    const i = Math.max(0, Math.min(steps - 1, Math.floor((x / window.innerWidth) * steps)));
    const semitone = 12 * Math.floor(i / SCALE.length) + SCALE[i % SCALE.length];
    return 523.25 * Math.pow(2, semitone / 12); // เริ่มจาก C5
  },

  tone(freq, when, volume, duration) {
    const ac = this.ctx;
    const timbre = { star: 'sine', heart: 'triangle', emoji: 'square' }[state.shape];
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = timbre;
    osc.frequency.value = freq;
    if (state.shape === 'emoji') {
      // เสียง "ป๊อป" ไถลขึ้น
      osc.frequency.setValueAtTime(freq * 0.5, when);
      osc.frequency.exponentialRampToValueAtTime(freq, when + 0.05);
      volume *= 0.35;
    }
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(volume, when + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(gain);
    gain.connect(this.master);
    osc.start(when);
    osc.stop(when + duration + 0.05);
  },

  trail(x, speed) {
    if (!this.ready) return;
    const now = performance.now();
    // ลากเร็ว = โน้ตถี่ขึ้น
    const gap = Math.max(45, 160 - speed * 4);
    if (now - this.lastNoteAt < gap) return;
    this.lastNoteAt = now;
    const volume = Math.min(0.08 + speed * 0.006, 0.3);
    this.tone(this.noteFreq(x), this.ctx.currentTime, volume, 0.4);
  },

  burst(x) {
    if (!this.ready) return;
    const ac = this.ctx;
    const t = ac.currentTime;

    // ฟู่ — noise ผ่าน bandpass ที่กวาดความถี่ขึ้น
    const len = ac.sampleRate * 0.6;
    const buf = ac.createBuffer(1, len, ac.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf;
    const filter = ac.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(300, t);
    filter.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
    const ng = ac.createGain();
    ng.gain.setValueAtTime(0.25, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    noise.connect(filter);
    filter.connect(ng);
    ng.connect(this.master);
    noise.start(t);

    // ตามด้วยอาร์เปจจิโอไล่ขึ้น
    const base = this.noteFreq(x) / 2;
    [0, 4, 7, 12, 16, 19].forEach((semi, i) => {
      this.tone(base * Math.pow(2, semi / 12), t + 0.08 + i * 0.06, 0.18, 0.6);
    });
  },
};

// ---------- วาด ----------

function drawStar(r) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
}

function drawHeart(r) {
  const s = r / 16;
  ctx.beginPath();
  ctx.moveTo(0, 5 * s);
  ctx.bezierCurveTo(-16 * s, -6 * s, -8 * s, -18 * s, 0, -9 * s);
  ctx.bezierCurveTo(8 * s, -18 * s, 16 * s, -6 * s, 0, 5 * s);
  ctx.fill();
}

// ใช้ setTransform ตรงๆ แทน save/restore ต่อ particle เพื่อลดงานต่อเฟรม
function drawParticle(p, dpr) {
  const cos = Math.cos(p.rot) * dpr;
  const sin = Math.sin(p.rot) * dpr;
  ctx.setTransform(cos, sin, -sin, cos, p.x * dpr, p.y * dpr);
  ctx.globalAlpha = p.life;
  const r = p.size * (0.4 + p.life * 0.6);
  if (state.shape === 'emoji') {
    ctx.drawImage(p.sprite, -r, -r, r * 2, r * 2);
  } else {
    ctx.fillStyle = p.color;
    if (state.shape === 'heart') drawHeart(r);
    else drawStar(r);
  }
}

function frame() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // ทาพื้นหลังโปร่งแสงทับ ให้เกิดหางเรืองแสงจางๆ
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = 'rgba(5, 5, 15, 0.25)';
  ctx.fillRect(0, 0, w, h);

  // คลิกค้าง = พ่นต่อเนื่องแม้ไม่ขยับ
  if (state.pointer.down) emitTrail(state.pointer.x, state.pointer.y, 0, 0);

  ctx.globalCompositeOperation = state.shape === 'emoji' ? 'source-over' : 'lighter';
  const dpr = window.devicePixelRatio || 1;
  const ps = state.particles;
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.vy += GRAVITY;
    p.vx *= 0.99;
    p.vy *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.spin;
    p.life -= p.decay;
    if (p.life <= 0 || p.y > h + 50) {
      ps.splice(i, 1);
      continue;
    }
    drawParticle(p, dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;

  state.hue = (state.hue + 1) % 360;
  requestAnimationFrame(frame);
}

// ---------- input ----------

let last = null;
let downAt = 0;

canvas.addEventListener('pointermove', e => {
  hint.classList.add('hidden');
  const { clientX: x, clientY: y } = e;
  if (last) {
    emitTrail(x, y, x - last.x, y - last.y);
    sound.trail(x, Math.hypot(x - last.x, y - last.y));
  }
  last = { x, y };
  state.pointer.x = x;
  state.pointer.y = y;
});

canvas.addEventListener('pointerdown', e => {
  hint.classList.add('hidden');
  sound.unlock();
  sound.trail(e.clientX, 10);
  canvas.setPointerCapture(e.pointerId);
  state.pointer.down = true;
  state.pointer.x = e.clientX;
  state.pointer.y = e.clientY;
  last = { x: e.clientX, y: e.clientY };
  downAt = performance.now();
});

function release() {
  // กดค้างนานพอ -> ปล่อยแล้วระเบิด
  if (state.pointer.down && performance.now() - downAt > 300) {
    burst(state.pointer.x, state.pointer.y);
    sound.burst(state.pointer.x);
  }
  state.pointer.down = false;
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('pointerleave', () => { last = null; });

const selectShape = bindChipGroup(document.getElementById('shapes'), v => { state.shape = v; });
const selectColor = bindChipGroup(document.getElementById('colors'), v => { state.color = v; });
const COLOR_ORDER = ['rainbow', 'gold', 'speed'];

const soundBtn = document.getElementById('sound-toggle');
function toggleSound() {
  sound.enabled = !sound.enabled;
  if (sound.enabled) sound.unlock();
  soundBtn.classList.toggle('active', sound.enabled);
  soundBtn.textContent = sound.enabled ? '🔊 เปิด' : '🔇 ปิด';
}
soundBtn.addEventListener('click', toggleSound);

window.addEventListener('keydown', e => {
  sound.unlock();
  if (e.key.toLowerCase() === 'm') toggleSound();
  else if (e.key === '1') selectShape('star');
  else if (e.key === '2') selectShape('heart');
  else if (e.key === '3') selectShape('emoji');
  else if (e.key.toLowerCase() === 'c') {
    selectColor(COLOR_ORDER[(COLOR_ORDER.indexOf(state.color) + 1) % COLOR_ORDER.length]);
  } else if (e.code === 'Space') {
    e.preventDefault();
    state.particles.length = 0;
    ctx.fillStyle = '#05050f';
    ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  }
});

requestAnimationFrame(frame);
