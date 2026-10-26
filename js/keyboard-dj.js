// หน้า 3 — Keyboard DJ: คีย์บอร์ดเป็นแผงมิกซ์เสียง อัดเสียงลงปุ่ม และวนลูป
//
// เสียงสำเร็จรูปทุกเสียงสังเคราะห์ด้วย OfflineAudioContext ตอนเปิดหน้า (ไม่มีไฟล์เสียง)
// เสียงที่อัดเองเก็บใน IndexedDB ปิดเปิดใหม่ก็ยังอยู่

const statusEl = document.getElementById('status');
function setStatus(text) {
  statusEl.textContent = text;
}

// ---------- เครื่องมือสังเคราะห์เสียง ----------

function env(param, t, attack, peak, dur, sustain = false) {
  param.setValueAtTime(0.0001, t);
  param.linearRampToValueAtTime(peak, t + attack);
  if (sustain) param.setValueAtTime(peak, t + dur - 0.04);
  param.exponentialRampToValueAtTime(0.0001, t + dur);
}

const noiseCache = new WeakMap();
function noiseBuffer(ac) {
  if (!noiseCache.has(ac)) {
    const b = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ac, b);
  }
  return noiseCache.get(ac);
}

function osc(ac, out, { type = 'sine', f0, f1, slide, t = 0, dur, vol = 0.5, attack = 0.005, sustain = false }) {
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + (slide || dur));
  env(g.gain, t, attack, vol, dur, sustain);
  o.connect(g);
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function noise(ac, out, { t = 0, dur, vol = 0.5, type = 'highpass', freq = 1000, q = 1, attack = 0.001 }) {
  const s = ac.createBufferSource();
  s.buffer = noiseBuffer(ac);
  const f = ac.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ac.createGain();
  env(g.gain, t, attack, vol, dur);
  s.connect(f);
  f.connect(g);
  g.connect(out);
  s.start(t, Math.random() * 1.5, dur + 0.02);
  return f;
}

// เสียงคนแบบง่าย: sawtooth ผ่าน formant filter
function voice(ac, out, { t = 0, f, dur, vol = 1, formants, formantsEnd, attack = 0.02 }) {
  const o = ac.createOscillator();
  o.type = 'sawtooth';
  o.frequency.setValueAtTime(f, t);
  o.frequency.linearRampToValueAtTime(f * 0.92, t + dur);
  const g = ac.createGain();
  env(g.gain, t, attack, vol, dur);
  formants.forEach((ff, i) => {
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 5;
    bp.frequency.setValueAtTime(ff, t);
    if (formantsEnd) bp.frequency.linearRampToValueAtTime(formantsEnd[i], t + dur);
    o.connect(bp);
    bp.connect(g);
  });
  g.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// ---------- เสียงสำเร็จรูป ----------

const SOUNDS = {
  laugh(ac, out) {
    [[170, 0], [250, 0.06], [320, 0.03]].forEach(([f0, offset]) => {
      for (let i = 0; i < 7; i++) {
        const t = offset + i * 0.16 + Math.random() * 0.02;
        const f = f0 * (1.15 - i * 0.04) * (0.97 + Math.random() * 0.06);
        voice(ac, out, { t, f, dur: 0.12, formants: [750, 1150, 2500] });
        noise(ac, out, { t, dur: 0.04, vol: 0.15, type: 'bandpass', freq: 1800 });
      }
    });
  },
  applause(ac, out) {
    // คนปรบมือหลายคน = noise หลายสาย แต่ละสายตบเป็นจังหวะสุ่มบน gain เดียว
    // (ห้ามสร้าง node ต่อการตบหนึ่งครั้ง — node เยอะๆ ทำให้ OfflineAudioContext ค้าง)
    for (let p = 0; p < 6; p++) {
      const s = ac.createBufferSource();
      s.buffer = noiseBuffer(ac);
      const f = ac.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900 + p * 300;
      f.Q.value = 1.2;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, 0);
      let t = Math.random() * 0.1;
      while (t < 2.5) {
        const fade = t < 1.7 ? 1 : (2.5 - t) / 0.8;
        const dur = 0.02 + Math.random() * 0.03;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime((0.4 + Math.random() * 0.6) * fade + 0.001, t + 0.002);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        t += dur + 0.04 + Math.random() * 0.12;
      }
      s.connect(f);
      f.connect(g);
      g.connect(out);
      s.start(0, 0, 2.8);
    }
  },
  airhorn(ac, out) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    lp.connect(out);
    [[0, 0.15], [0.2, 0.1], [0.33, 0.1], [0.46, 0.7]].forEach(([t, dur]) => {
      [466, 469, 233].forEach(f => {
        osc(ac, lp, { type: 'sawtooth', f0: f * 0.85, f1: f, slide: 0.05, t, dur, vol: 0.3, attack: 0.01, sustain: true });
      });
    });
  },
  scratch(ac, out) {
    const f = noise(ac, out, { dur: 0.5, vol: 0.8, type: 'bandpass', freq: 800, q: 3, attack: 0.01 });
    f.frequency.setValueAtTime(800, 0);
    [400, 2500, 600, 3000, 500, 2000, 300].forEach((v, i) => f.frequency.linearRampToValueAtTime(v, (i + 1) * 0.07));
  },
  laser(ac, out) {
    osc(ac, out, { type: 'square', f0: 1800, f1: 120, dur: 0.3, vol: 0.3 });
    osc(ac, out, { type: 'square', f0: 1800, f1: 120, t: 0.18, dur: 0.3, vol: 0.3 });
  },
  pop(ac, out) {
    [[0, 300], [0.12, 450], [0.2, 380]].forEach(([t, f]) => {
      osc(ac, out, { f0: f, f1: f * 4, t, dur: 0.09, vol: 0.7 });
    });
  },
  boing(ac, out) {
    const o = osc(ac, out, { f0: 90, f1: 400, dur: 0.7, vol: 0.8 });
    const lfo = ac.createOscillator();
    const depth = ac.createGain();
    lfo.frequency.value = 14;
    depth.gain.value = 40;
    lfo.connect(depth);
    depth.connect(o.frequency);
    lfo.start(0);
    lfo.stop(0.75);
  },
  siren(ac, out) {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2500;
    lp.connect(out);
    const o = osc(ac, lp, { type: 'sawtooth', f0: 600, dur: 1.6, vol: 0.4, attack: 0.05, sustain: true });
    for (let i = 0; i < 4; i++) o.frequency.linearRampToValueAtTime(i % 2 ? 600 : 1100, (i + 1) * 0.4);
  },
  wow(ac, out) {
    for (let i = 0; i < 6; i++) {
      voice(ac, out, {
        t: Math.random() * 0.1, f: 140 + Math.random() * 180, dur: 1.4, attack: 0.35,
        formants: [320, 800], formantsEnd: [700, 1150],
      });
    }
  },
  badumtss(ac, out) {
    osc(ac, out, { f0: 260, f1: 150, dur: 0.15, vol: 0.8 });
    osc(ac, out, { f0: 200, f1: 110, t: 0.2, dur: 0.25, vol: 0.8 });
    osc(ac, out, { f0: 150, f1: 40, t: 0.5, dur: 0.4, vol: 0.9 });
    noise(ac, out, { t: 0.5, dur: 1.2, vol: 0.5, freq: 4000 });
  },
  kick(ac, out) {
    osc(ac, out, { f0: 150, f1: 40, dur: 0.5, vol: 1 });
  },
  snare(ac, out) {
    noise(ac, out, { dur: 0.2, vol: 0.6, freq: 1200 });
    osc(ac, out, { type: 'triangle', f0: 200, f1: 120, dur: 0.12, vol: 0.5 });
  },
  hihat(ac, out) {
    noise(ac, out, { dur: 0.06, vol: 0.5, freq: 7000 });
  },
  openhat(ac, out) {
    noise(ac, out, { dur: 0.35, vol: 0.4, freq: 7000 });
  },
  clap(ac, out) {
    for (let i = 0; i < 3; i++) noise(ac, out, { t: i * 0.012, dur: 0.03, vol: 0.7, type: 'bandpass', freq: 1500, q: 1.5 });
    noise(ac, out, { t: 0.036, dur: 0.25, vol: 0.5, type: 'bandpass', freq: 1500, q: 1.5 });
  },
  tom(ac, out) {
    osc(ac, out, { f0: 220, f1: 110, dur: 0.4, vol: 0.9 });
  },
  cowbell(ac, out) {
    osc(ac, out, { type: 'square', f0: 540, dur: 0.3, vol: 0.2 });
    osc(ac, out, { type: 'square', f0: 800, dur: 0.3, vol: 0.2 });
  },
};

// synth แบบดีด สำหรับแถวกลาง
function pluck(f) {
  return (ac, out) => {
    const lp = ac.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(4000, 0);
    lp.frequency.exponentialRampToValueAtTime(250, 0.5);
    lp.connect(out);
    osc(ac, lp, { type: 'sawtooth', f0: f, dur: 0.6, vol: 0.5 });
    osc(ac, lp, { type: 'sawtooth', f0: f * 1.007, dur: 0.6, vol: 0.5 });
    osc(ac, out, { type: 'square', f0: f / 2, dur: 0.4, vol: 0.15 });
  };
}

// ---------- ผังปุ่ม ----------

const NOTE_NAMES = ['C', 'D#', 'F', 'G', 'A#', 'C', 'D#', 'F', 'G'];
const NOTE_STEPS = [0, 3, 5, 7, 10, 12, 15, 17, 19]; // C minor pentatonic

const LAYOUT = [
  [
    ['KeyQ', '😂', 'หัวเราะ', SOUNDS.laugh, 1.4],
    ['KeyW', '👏', 'ปรบมือ', SOUNDS.applause, 2.8],
    ['KeyE', '📯', 'แตร', SOUNDS.airhorn, 1.3],
    ['KeyR', '💿', 'สแครช', SOUNDS.scratch, 0.6],
    ['KeyT', '🔫', 'เลเซอร์', SOUNDS.laser, 0.55],
    ['KeyY', '🫧', 'ป๊อป', SOUNDS.pop, 0.35],
    ['KeyU', '🌀', 'ดึ๋ง', SOUNDS.boing, 0.8],
    ['KeyI', '🚨', 'ไซเรน', SOUNDS.siren, 1.7],
    ['KeyO', '😮', 'ว้าว', SOUNDS.wow, 1.6],
    ['KeyP', '🥁', 'บาดุมชึ่ง', SOUNDS.badumtss, 1.8],
  ],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL'].map((code, i) => [
    code, '🎹', NOTE_NAMES[i], pluck(130.81 * Math.pow(2, NOTE_STEPS[i] / 12)), 0.7,
  ]),
  [
    ['KeyZ', '🦵', 'Kick', SOUNDS.kick, 0.55],
    ['KeyX', '🥁', 'Snare', SOUNDS.snare, 0.25],
    ['KeyC', '🎩', 'Hi-hat', SOUNDS.hihat, 0.1],
    ['KeyV', '🎩', 'Open hat', SOUNDS.openhat, 0.4],
    ['KeyB', '👋', 'Clap', SOUNDS.clap, 0.3],
    ['KeyN', '🪘', 'Tom', SOUNDS.tom, 0.45],
    ['KeyM', '🔔', 'Cowbell', SOUNDS.cowbell, 0.35],
  ],
];

const pads = {}; // code -> pad

// ---------- เสียงหลัก ----------

const ac = new (window.AudioContext || window.webkitAudioContext)();
const master = ac.createGain();
master.gain.value = 0.8;
const analyser = ac.createAnalyser();
analyser.fftSize = 1024;
master.connect(analyser);
analyser.connect(ac.destination);

const echoIn = ac.createDelay(1);
echoIn.delayTime.value = 0.28;
const echoFeedback = ac.createGain();
echoFeedback.gain.value = 0.45;
echoIn.connect(echoFeedback);
echoFeedback.connect(echoIn);
echoIn.connect(master);

const EFFECTS = {
  normal: { rate: 1 },
  chipmunk: { rate: 1.6 },
  giant: { rate: 0.6 },
  echo: { rate: 1, echo: true },
  reverse: { rate: 1, reverse: true },
};

const state = { effect: 'normal', recArm: false, eraseArm: false };

// เบราว์เซอร์ให้เริ่มเสียงได้หลังผู้ใช้คลิก/กดปุ่มเท่านั้น
function unlock() {
  if (ac.state === 'suspended') ac.resume();
}

async function renderPreset(build, dur) {
  const sr = 44100;
  const oac = new OfflineAudioContext(1, Math.ceil(sr * dur), sr);
  build(oac, oac.destination);
  const buf = await oac.startRendering();
  // ปรับความดังทุกเสียงให้เท่ากัน
  const d = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.9 / peak;
  return buf;
}

const reversedCache = new WeakMap();
function reversed(buf) {
  if (!reversedCache.has(buf)) {
    const r = ac.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      r.getChannelData(c).set(buf.getChannelData(c).slice().reverse());
    }
    reversedCache.set(buf, r);
  }
  return reversedCache.get(buf);
}

function play(code, when = 0, effect = state.effect) {
  const pad = pads[code];
  const buf = pad.custom || pad.buffer;
  if (!buf) return;
  const fx = EFFECTS[effect];
  const src = ac.createBufferSource();
  src.buffer = fx.reverse ? reversed(buf) : buf;
  src.playbackRate.value = fx.rate;
  const g = ac.createGain();
  g.gain.value = pad.volume;
  src.connect(g);
  g.connect(master);
  if (fx.echo) g.connect(echoIn);
  src.start(when);
  const delay = Math.max(0, (when - ac.currentTime) * 1000);
  setTimeout(() => flashPad(pad), delay);
}

function hit(code) {
  play(code);
  recordLoopEvent(code);
}

// ---------- ปุ่มบนจอ ----------

let volumes = {};
try { volumes = JSON.parse(localStorage.getItem('keyboard-dj-volumes')) || {}; } catch (e) { /* ใช้ค่าเริ่มต้น */ }

function saveVolumes() {
  const v = {};
  Object.values(pads).forEach(p => { v[p.code] = p.volume; });
  try { localStorage.setItem('keyboard-dj-volumes', JSON.stringify(v)); } catch (e) { /* ไม่เป็นไร */ }
}

function renderPad(pad) {
  const custom = !!pad.custom;
  pad.el.classList.toggle('custom', custom);
  pad.el.querySelector('.emoji').textContent = custom ? '🎤' : pad.emoji;
  pad.el.querySelector('.name').textContent = custom ? 'อัดเอง' : pad.label;
  pad.el.querySelector('.vol').style.width = `${(pad.volume / 1.5) * 100}%`;
}

function flashPad(pad) {
  pad.el.animate(
    [{ transform: 'scale(0.9)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'brightness(1)' }],
    { duration: 220, easing: 'ease-out' }
  );
}

function buildPads() {
  const container = document.getElementById('pads');
  LAYOUT.forEach((row, r) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'pad-row';
    row.forEach(([code, emoji, label, build, dur]) => {
      const el = document.createElement('div');
      el.className = 'pad';
      el.dataset.row = r;
      el.innerHTML = '<span class="key"></span><span class="emoji"></span><span class="name"></span><span class="vol"></span>';
      el.querySelector('.key').textContent = code.replace('Key', '');
      const pad = { code, emoji, label, build, dur, el, buffer: null, custom: null, volume: volumes[code] ?? 1 };
      pads[code] = pad;
      renderPad(pad);
      rowEl.appendChild(el);

      let pointerType = 'mouse';
      el.addEventListener('pointerdown', e => {
        pointerType = e.pointerType;
        if (e.button !== 0) return;
        unlock();
        if (state.eraseArm) {
          clearCustom(code);
        } else if (state.recArm || e.shiftKey) {
          el.setPointerCapture(e.pointerId);
          startPadRecording(code);
        } else {
          hit(code);
        }
      });
      el.addEventListener('pointerup', () => stopPadRecording(code));
      el.addEventListener('pointercancel', () => stopPadRecording(code));
      // คลิกขวา = ลบเสียงที่อัด แต่บนมือถือการกดค้างก็ยิง contextmenu ด้วย — ต้องไม่ลบ
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        if (pointerType === 'mouse') clearCustom(code);
      });
      el.addEventListener('wheel', e => {
        e.preventDefault();
        pad.volume = Math.round(Math.min(1.5, Math.max(0, pad.volume - Math.sign(e.deltaY) * 0.1)) * 10) / 10;
        renderPad(pad);
        saveVolumes();
        setStatus(`🔈 ความดังปุ่ม ${code.replace('Key', '')}: ${Math.round(pad.volume * 100)}%`);
      }, { passive: false });
    });
    container.appendChild(rowEl);
  });
}

// ---------- อัดเสียงลงปุ่ม ----------

const MAX_REC_MS = 10000;
const MIN_REC_MS = 300; // แตะพลาดสั้นๆ ไม่นับ จะได้ไม่ทับเสียงเดิม
let mic = null;
let padRec = null; // { code, recorder?, timer? }

async function startPadRecording(code) {
  if (padRec) return;
  const pad = pads[code];
  padRec = { code };
  pad.el.classList.add('rec');
  if (!mic) {
    try {
      mic = await requestMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
    } catch (err) {
      console.error(err);
      padRec = null;
      pad.el.classList.remove('rec');
      setStatus('🎤 ' + describeMediaError(err));
      return;
    }
  }
  // ปล่อยปุ่มไปแล้วระหว่างรอสิทธิ์ไมค์ (ครั้งแรกจะมี popup ถาม)
  if (!padRec || padRec.code !== code) {
    setStatus('🎤 ไมค์พร้อมแล้ว! กด Shift ค้าง + ปุ่ม เพื่ออัดอีกครั้ง');
    return;
  }
  const recorder = new MediaRecorder(mic);
  const chunks = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const startedAt = performance.now();
  recorder.onstop = () => {
    if (performance.now() - startedAt < MIN_REC_MS) {
      setStatus('🎙️ อัดสั้นไป — กดค้างไว้แล้วพูด ปล่อยเมื่อเสร็จ (เสียงเดิมยังอยู่)');
      return;
    }
    finishPadRecording(code, new Blob(chunks, { type: recorder.mimeType }));
  };
  recorder.start();
  padRec = { code, recorder, timer: setTimeout(() => stopPadRecording(code), MAX_REC_MS) };
  setStatus(`🔴 กำลังอัดเสียงลงปุ่ม ${code.replace('Key', '')} — ปล่อยเพื่อหยุด`);
}

function stopPadRecording(code) {
  if (!padRec || padRec.code !== code) return;
  const r = padRec;
  padRec = null;
  pads[code].el.classList.remove('rec');
  if (r.recorder) {
    clearTimeout(r.timer);
    r.recorder.stop();
  }
}

async function finishPadRecording(code, blob) {
  if (!blob.size) return;
  try {
    pads[code].custom = await ac.decodeAudioData(await blob.arrayBuffer());
  } catch (err) {
    console.error(err);
    setStatus('⚠️ อัดเสียงไม่สำเร็จ ลองใหม่อีกครั้ง');
    return;
  }
  renderPad(pads[code]);
  play(code, 0, 'normal');
  setStatus(`✅ บันทึกเสียงลงปุ่ม ${code.replace('Key', '')} แล้ว`);
  store.put(code, blob).catch(() => setStatus('⚠️ บันทึกถาวรไม่ได้ — เสียงนี้จะหายเมื่อปิดหน้า'));
}

function clearCustom(code) {
  const pad = pads[code];
  if (!pad.custom) return;
  pad.custom = null;
  renderPad(pad);
  store.remove(code).catch(() => {});
  setStatus(`🧽 ลบเสียงที่อัดในปุ่ม ${code.replace('Key', '')} แล้ว`);
}

// IndexedDB เก็บเสียงที่อัดไว้ (key = code ของปุ่ม, value = Blob)
const store = {
  db: null,
  open() {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        // บางเบราว์เซอร์บน file:// ไม่ตอบกลับเลย — ตั้งเวลาไว้ไม่ให้รอค้าง
        setTimeout(() => reject(new Error('IndexedDB timeout')), 3000);
        const req = indexedDB.open('keyboard-dj', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('pads');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.db;
  },
  async write(fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('pads', 'readwrite');
      fn(tx.objectStore('pads'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  put(code, blob) { return this.write(s => s.put(blob, code)); },
  remove(code) { return this.write(s => s.delete(code)); },
  async all() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const s = db.transaction('pads').objectStore('pads');
      const keys = s.getAllKeys();
      const values = s.getAll();
      values.onsuccess = () => resolve(keys.result.map((k, i) => [k, values.result[i]]));
      values.onerror = () => reject(values.error);
    });
  },
};

// ---------- ลูป ----------
// เวลาในลูปนับเป็น "บีต" เพื่อให้เปลี่ยน BPM ระหว่างเล่นได้โดยจังหวะไม่หลุด

const LOOP_BEATS = 8; // 2 ห้อง 4/4
const looper = {
  playing: false,
  recording: false,
  events: [], // { code, pos (บีตในลูป), effect, layer, skipBefore }
  layer: 0,
  bpm: 110,
  anchorTime: 0,
  anchorBeat: 0,
  scheduledBeat: 0,
  metronome: true,
  quantize: true,
  timer: null,
};

const beatLen = () => 60 / looper.bpm;
const beatAt = t => looper.anchorBeat + (t - looper.anchorTime) / beatLen();
const timeAt = b => looper.anchorTime + (b - looper.anchorBeat) * beatLen();

function click(t, accent) {
  // เมโทรนอมต่อตรงไปลำโพง ไม่เข้า visualizer และไม่ติดไปในไฟล์ที่อัด
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1000;
  env(g.gain, t, 0.001, 0.15, 0.04);
  o.connect(g);
  g.connect(ac.destination);
  o.start(t);
  o.stop(t + 0.05);
}

// ตั้งเวลาเล่นล่วงหน้าเล็กน้อย (lookahead) เพื่อให้จังหวะแม่นแม้ setInterval จะไม่ตรงเป๊ะ
function schedule() {
  const from = looper.scheduledBeat;
  const end = beatAt(ac.currentTime + 0.12);
  if (end <= from) return;
  if (looper.metronome && looper.recording) {
    for (let b = Math.ceil(from); b < end; b++) click(timeAt(b), b % 4 === 0);
  }
  for (const ev of looper.events) {
    const first = Math.floor((from - ev.pos) / LOOP_BEATS) * LOOP_BEATS + ev.pos;
    for (let occ = first; occ < end; occ += LOOP_BEATS) {
      if (occ >= from && occ >= ev.skipBefore) play(ev.code, timeAt(occ), ev.effect);
    }
  }
  looper.scheduledBeat = end;
}

function looperStart() {
  looper.playing = true;
  looper.anchorTime = ac.currentTime + 0.05;
  looper.anchorBeat = 0;
  looper.scheduledBeat = 0;
  looper.timer = setInterval(schedule, 25);
  schedule();
}

function looperStop() {
  looper.playing = false;
  looper.recording = false;
  clearInterval(looper.timer);
}

function looperRecordToggle() {
  unlock();
  if (!looper.playing) {
    looperStart();
    looper.recording = true;
    looper.layer++;
  } else if (looper.recording) {
    looper.recording = false;
  } else {
    looper.recording = true;
    looper.layer++;
  }
}

function looperPlayToggle() {
  unlock();
  if (looper.playing) looperStop();
  else looperStart();
}

function looperClear() {
  looperStop();
  looper.events = [];
  looper.layer = 0;
  setStatus('🗑 ล้างลูปแล้ว');
}

function looperUndo() {
  const top = Math.max(0, ...looper.events.map(e => e.layer));
  if (!top) return;
  looper.events = looper.events.filter(e => e.layer !== top);
  setStatus('↩️ ลบเลเยอร์ล่าสุดแล้ว');
}

function recordLoopEvent(code) {
  if (!looper.playing || !looper.recording) return;
  const b = beatAt(ac.currentTime);
  let pos = ((b % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
  if (looper.quantize) pos = (Math.round(pos * 4) / 4) % LOOP_BEATS; // ตรงโน้ตตัวที่ 16
  // รอบนี้เล่นสดไปแล้ว ไม่ต้องให้ลูปเล่นซ้ำที่จุดใกล้ๆ อีก
  let occ = Math.floor(b / LOOP_BEATS) * LOOP_BEATS + pos;
  if (occ < b - LOOP_BEATS / 2) occ += LOOP_BEATS;
  looper.events.push({ code, pos, effect: state.effect, layer: looper.layer, skipBefore: occ + 0.01 });
}

function setBpm(v) {
  if (looper.playing) {
    const now = ac.currentTime;
    looper.anchorBeat = beatAt(now);
    looper.anchorTime = now;
  }
  looper.bpm = v;
}

// ---------- อัดการแสดงเป็นไฟล์ ----------

let exportDest = null;
let exportRec = null;
const exportBtn = document.getElementById('export');

function toggleExport() {
  unlock();
  if (exportRec) {
    exportRec.stop();
    return;
  }
  if (!exportDest) {
    exportDest = ac.createMediaStreamDestination();
    master.connect(exportDest);
  }
  const chunks = [];
  const rec = new MediaRecorder(exportDest.stream);
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  rec.onstop = () => {
    const type = rec.mimeType || 'audio/webm';
    const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
    saveBlob(new Blob(chunks, { type }), `keyboard-dj-${Date.now()}.${ext}`);
    exportRec = null;
    exportBtn.classList.remove('rec');
    exportBtn.textContent = '⏺ อัดการแสดง';
    setStatus('💾 ไฟล์เสียงพร้อมบันทึกแล้ว');
  };
  rec.start();
  exportRec = rec;
  exportBtn.classList.add('rec');
  exportBtn.textContent = '⏹ หยุดและดาวน์โหลด';
  setStatus('🔴 กำลังอัดการแสดงทั้งหมด…');
}

// ---------- visualizer + สถานะลูป ----------

const viz = document.getElementById('viz');
const vctx = setupFullscreenCanvas(viz);
const freq = new Uint8Array(analyser.frequencyBinCount);
const beatsEl = document.getElementById('beats');
const loopStateEl = document.getElementById('loop-state');
const loopRecBtn = document.getElementById('loop-rec');
const loopPlayBtn = document.getElementById('loop-play');
const beatCells = [];
for (let i = 0; i < LOOP_BEATS; i++) {
  const cell = document.createElement('div');
  cell.className = 'beat' + (i % 4 === 0 ? ' bar-start' : '');
  beatsEl.appendChild(cell);
  beatCells.push(cell);
}

let hueShift = 0;
function drawFrame() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  vctx.fillStyle = 'rgba(7, 7, 15, 0.35)';
  vctx.fillRect(0, 0, w, h);

  analyser.getByteFrequencyData(freq);
  const bars = 64;
  const bw = w / bars;
  hueShift = (hueShift + 0.3) % 360;
  for (let i = 0; i < bars; i++) {
    const v = freq[Math.floor((i / bars) * freq.length * 0.6)] / 255;
    const bh = v * h * 0.55;
    vctx.fillStyle = `hsla(${(hueShift + i * 5) % 360}, 100%, 60%, ${0.15 + v * 0.5})`;
    vctx.fillRect(i * bw + 1, h - bh, bw - 2, bh);
  }

  // สถานะลูป
  const current = looper.playing ? Math.floor((((beatAt(ac.currentTime) % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS)) : -1;
  beatCells.forEach((c, i) => c.classList.toggle('now', i === current));
  const label = looper.recording ? '🔴 กำลังอัด' : looper.playing ? '▶ กำลังเล่นลูป' : '⏹ หยุดอยู่';
  const count = looper.events.length ? ` · ${looper.events.length} โน้ต` : '';
  loopStateEl.textContent = label + count;
  loopStateEl.className = 'looper-state' + (looper.recording ? ' recording' : looper.playing ? ' playing' : '');
  loopRecBtn.classList.toggle('rec', looper.recording);
  loopPlayBtn.textContent = looper.playing ? '⏹ หยุด' : '▶ เล่น';

  requestAnimationFrame(drawFrame);
}

// ---------- controls ----------

const selectEffect = bindChipGroup(document.getElementById('effects'), v => { state.effect = v; });
const EFFECT_KEYS = { Digit1: 'normal', Digit2: 'chipmunk', Digit3: 'giant', Digit4: 'echo', Digit5: 'reverse' };

document.getElementById('master').addEventListener('input', e => { master.gain.value = +e.target.value; });
exportBtn.addEventListener('click', toggleExport);

const recArmBtn = document.getElementById('rec-arm');
const eraseArmBtn = document.getElementById('erase-arm');
function setArm(rec, erase) {
  state.recArm = rec;
  state.eraseArm = erase;
  recArmBtn.classList.toggle('rec', rec);
  eraseArmBtn.classList.toggle('rec', erase);
}
recArmBtn.addEventListener('click', () => {
  setArm(!state.recArm, false);
  setStatus(state.recArm ? '🎙️ โหมดอัด: กดค้างที่ปุ่มไหนก็ได้เพื่ออัดเสียงลงปุ่มนั้น' : '🎶 กลับมาโหมดเล่นแล้ว');
});
eraseArmBtn.addEventListener('click', () => {
  setArm(false, !state.eraseArm);
  setStatus(state.eraseArm ? '🧽 โหมดลบ: แตะปุ่มที่อยากลบเสียงที่อัดไว้' : '🎶 กลับมาโหมดเล่นแล้ว');
});

loopRecBtn.addEventListener('click', looperRecordToggle);
loopPlayBtn.addEventListener('click', looperPlayToggle);
document.getElementById('loop-undo').addEventListener('click', looperUndo);
document.getElementById('loop-clear').addEventListener('click', looperClear);

const bpmValue = document.getElementById('bpm-value');
document.getElementById('bpm').addEventListener('input', e => {
  setBpm(+e.target.value);
  bpmValue.textContent = e.target.value;
});

function bindToggle(id, key) {
  const btn = document.getElementById(id);
  btn.addEventListener('click', () => {
    looper[key] = !looper[key];
    btn.classList.toggle('active', looper[key]);
  });
}
bindToggle('metronome', 'metronome');
bindToggle('quantize', 'quantize');

// ปุ่มบนจอที่ถูกคลิกจะไม่ค้าง focus ไว้ ไม่งั้น Space/Enter จะไปกดปุ่มนั้นซ้ำ
document.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (btn) btn.blur();
});

window.addEventListener('keydown', e => {
  const code = e.code;
  if ((e.metaKey || e.ctrlKey) && code === 'KeyZ') {
    e.preventDefault();
    looperUndo();
    return;
  }
  if (e.metaKey || e.ctrlKey) return;
  unlock();

  if (EFFECT_KEYS[code]) {
    selectEffect(EFFECT_KEYS[code]);
  } else if (code === 'Space') {
    e.preventDefault();
    if (!e.repeat) looperRecordToggle();
  } else if (code === 'Enter') {
    e.preventDefault();
    if (!e.repeat) looperPlayToggle();
  } else if (code === 'Backspace') {
    e.preventDefault();
    looperClear();
  } else if (pads[code]) {
    e.preventDefault();
    if (e.repeat) return;
    if (e.altKey) clearCustom(code);
    else if (e.shiftKey || state.recArm) startPadRecording(code);
    else hit(code);
  }
});

window.addEventListener('keyup', e => stopPadRecording(e.code));

stopStreamOnLeave(() => mic);

// ---------- เริ่ม ----------

async function init() {
  buildPads();
  requestAnimationFrame(drawFrame);

  await Promise.all(Object.values(pads).map(async pad => {
    pad.buffer = await renderPreset(pad.build, pad.dur);
  }));
  setStatus('🎶 กดปุ่มบนคีย์บอร์ดเพื่อเริ่มเล่นได้เลย!');

  // ขอให้เบราว์เซอร์ไม่ล้างข้อมูลเองเมื่อพื้นที่เหลือน้อย (Safari ล้างทิ้งถ้าไม่ได้เปิดนานๆ)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  try {
    const saved = await store.all();
    await Promise.all(saved.map(async ([code, blob]) => {
      if (!pads[code]) return;
      try {
        pads[code].custom = await ac.decodeAudioData(await blob.arrayBuffer());
        renderPad(pads[code]);
      } catch (err) {
        console.error('decode saved sound failed', code, err);
      }
    }));
  } catch (err) {
    console.error(err);
    setStatus('⚠️ เบราว์เซอร์นี้เก็บเสียงที่อัดถาวรไม่ได้ — เล่นได้ปกติแต่เสียงที่อัดจะหายเมื่อปิดหน้า');
  }
}

init();
