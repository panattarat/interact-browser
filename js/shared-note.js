// หน้า 4 — Shared Note: โน้ตกลางที่ทุกคนในห้องเดียวกันแก้ได้พร้อมกัน
//
// ส่งข้อความทั้งก้อนไปที่ Durable Object ผ่าน WebSocket (ใครส่งล่าสุดชนะ)
// ตอนรับข้อความจากคนอื่น ขยับเคอร์เซอร์ตามจุดที่เปลี่ยน ไม่ให้กระโดดไปท้ายสุด

const note = document.getElementById('note');
const statusEl = document.getElementById('status');

const SEND_DELAY = 150; // ms — รอให้พิมพ์จบคำค่อยส่ง ไม่ยิงทุกตัวอักษร

const params = new URLSearchParams(location.search);
const room = (params.get('room') || 'main').toLowerCase().replace(/[^\w-]/g, '').slice(0, 40) || 'main';
document.getElementById('room').textContent = room;
document.title = `Shared Note · ${room}`;

let ws = null;
let sendTimer = null;
let retryDelay = 1000;
let online = 0;

function setStatus(connected) {
  statusEl.classList.toggle('online', connected);
  statusEl.classList.toggle('offline', !connected);
  statusEl.textContent = connected ? `ออนไลน์ ${online} คน` : 'หลุดการเชื่อมต่อ — กำลังต่อใหม่…';
}

function connect() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/api/note/${room}`);
  ws.addEventListener('open', () => {
    retryDelay = 1000;
  });
  ws.addEventListener('message', e => {
    const msg = JSON.parse(e.data);
    if (msg.online) online = msg.online;
    if (msg.type === 'text') {
      applyRemote(msg.text);
      note.disabled = false;
    }
    setStatus(true);
  });
  ws.addEventListener('close', () => {
    setStatus(false);
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 15000);
  });
}

// แทนข้อความด้วยของคนอื่น แต่รักษาตำแหน่งเคอร์เซอร์/ที่เลือกไว้
function applyRemote(text) {
  const old = note.value;
  if (text === old) return;
  if (sendTimer) return; // เรากำลังจะส่งของตัวเองทับอยู่แล้ว

  let prefix = 0;
  const maxPrefix = Math.min(old.length, text.length);
  while (prefix < maxPrefix && old[prefix] === text[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (suffix < maxSuffix && old[old.length - 1 - suffix] === text[text.length - 1 - suffix]) suffix++;

  const shift = pos => {
    if (pos <= prefix) return pos;
    if (pos >= old.length - suffix) return pos + text.length - old.length;
    return text.length - suffix; // เคอร์เซอร์อยู่ในช่วงที่โดนแก้ ย้ายไปท้ายช่วงนั้น
  };
  const focused = document.activeElement === note;
  const start = shift(note.selectionStart);
  const end = shift(note.selectionEnd);
  note.value = text;
  if (focused) note.setSelectionRange(start, end);
}

function sendNow() {
  clearTimeout(sendTimer);
  sendTimer = null;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'text', text: note.value }));
  }
}

note.addEventListener('input', () => {
  clearTimeout(sendTimer);
  sendTimer = setTimeout(sendNow, SEND_DELAY);
});
window.addEventListener('pagehide', sendNow);

document.getElementById('copy-link').addEventListener('click', async e => {
  const link = `${location.origin}${location.pathname}?room=${room}`;
  try {
    await navigator.clipboard.writeText(link);
    e.target.textContent = '✅ คัดลอกแล้ว';
  } catch {
    prompt('คัดลอกลิงก์นี้', link);
  }
  setTimeout(() => (e.target.textContent = '🔗 คัดลอกลิงก์'), 1500);
});

document.getElementById('change-room').addEventListener('click', () => {
  const name = prompt('ชื่อห้อง (a-z, 0-9, - หรือ _)', room);
  if (name) location.search = `?room=${encodeURIComponent(name)}`;
});

connect();
