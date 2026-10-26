// helper ที่ใช้ร่วมกันทุกหน้า

// ใส่ปุ่มกลับหน้าแรก (ยกเว้นหน้า index)
(function addHomeButton() {
  if (document.body.dataset.page === 'home') return;
  const a = document.createElement('a');
  a.href = 'index.html';
  a.className = 'home-btn';
  a.textContent = '← หน้าแรก';
  document.body.appendChild(a);
})();

// canvas เต็มจอที่คมชัดบนจอ retina
function setupFullscreenCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();
  return ctx;
}

// ขอสิทธิ์กล้อง/ไมค์
async function requestMedia(constraints) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw Object.assign(new Error('getUserMedia not supported'), { name: 'NotSupportedError' });
  }
  return navigator.mediaDevices.getUserMedia(constraints);
}

function describeMediaError(err) {
  switch (err && err.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'ยังไม่ได้รับอนุญาต — กดไอคอนกล้อง/แม่กุญแจที่แถบที่อยู่ เลือก "อนุญาต" แล้วลองใหม่ (ถ้าใช้ Safari แนะนำให้เปิดด้วย Chrome หรือ Firefox)';
    case 'NotFoundError':
      return 'ไม่พบอุปกรณ์ — ตรวจว่าเครื่องมีกล้อง/ไมค์ และเสียบไว้แล้ว';
    case 'NotReadableError':
      return 'อุปกรณ์ถูกโปรแกรมอื่นใช้อยู่ — ปิด Zoom / Meet / แท็บอื่นที่ใช้กล้องแล้วลองใหม่';
    default:
      return 'เบราว์เซอร์นี้ใช้กล้อง/ไมค์จากไฟล์ไม่ได้ — ลองเปิดด้วย Chrome หรือ Firefox';
  }
}

// ปิดกล้อง/ไมค์เมื่อออกจากหน้า
function stopStreamOnLeave(getStream) {
  window.addEventListener('pagehide', () => {
    const s = getStream();
    if (s) s.getTracks().forEach(t => t.stop());
  });
}

// ทำแผงควบคุมให้พับได้บนมือถือ — แถว .pin ยังโชว์ตอนพับ
const isTouch = window.matchMedia('(pointer: coarse)').matches;
document.querySelectorAll('.panel').forEach(panel => {
  const btn = document.createElement('button');
  btn.className = 'chip panel-toggle';
  panel.prepend(btn);
  function set(collapsed) {
    panel.classList.toggle('collapsed', collapsed);
    btn.textContent = collapsed ? '⚙️ ตั้งค่า ▴' : '⚙️ ซ่อน ▾';
  }
  btn.addEventListener('click', () => set(!panel.classList.contains('collapsed')));
  set(window.innerWidth <= 600);
});

// ดาวน์โหลด Blob เป็นไฟล์
function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); // บางเบราว์เซอร์มือถือไม่ยอมคลิกลิงก์ที่ไม่อยู่ในหน้า
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// บันทึกไฟล์: คอมฯ ดาวน์โหลดทันที / มือถือเปิดหน้าต่างพรีวิว + ปุ่มแชร์ (Save to Photos/Files)
// ต้องเปิดหน้าต่างก่อน เพราะ navigator.share ต้องเรียกจากการแตะของผู้ใช้โดยตรง
function saveBlob(blob, filename) {
  if (!isTouch) return downloadBlob(blob, filename);
  const file = new File([blob], filename, { type: blob.type });
  const canShare = navigator.canShare && navigator.canShare({ files: [file] });

  const url = URL.createObjectURL(blob);
  const sheet = document.createElement('div');
  sheet.className = 'save-sheet';
  const isImage = blob.type.startsWith('image/');
  sheet.innerHTML = `
    <div class="save-box">
      ${isImage ? `<img src="${url}" alt="">` : `<audio controls src="${url}"></audio>`}
      ${isImage ? '<div class="save-tip">หรือกดค้างที่รูปแล้วเลือก “บันทึกรูปภาพ”</div>' : ''}
      <div class="save-actions">
        ${canShare ? '<button class="big-btn" data-act="share">📤 บันทึก / แชร์</button>' : ''}
        <button class="chip" data-act="download">⬇️ ดาวน์โหลดไฟล์</button>
        <button class="chip" data-act="close">ปิด</button>
      </div>
    </div>`;
  function close() {
    sheet.remove();
    URL.revokeObjectURL(url);
  }
  sheet.addEventListener('click', async e => {
    const act = e.target.dataset.act;
    if (e.target === sheet || act === 'close') close();
    else if (act === 'download') downloadBlob(blob, filename);
    else if (act === 'share') {
      try {
        await navigator.share({ files: [file], title: filename });
        close();
      } catch (err) {
        if (err.name !== 'AbortError') downloadBlob(blob, filename);
      }
    }
  });
  document.body.appendChild(sheet);
}

// บันทึก canvas เป็นไฟล์ PNG
function downloadCanvas(canvas, filename) {
  canvas.toBlob(blob => saveBlob(blob, filename), 'image/png');
}

// ผูกปุ่ม chip กลุ่มเดียวกันให้เลือกได้ทีละอัน
function bindChipGroup(container, onSelect) {
  const chips = container.querySelectorAll('.chip');
  function select(value) {
    chips.forEach(c => c.classList.toggle('active', c.dataset.value === value));
    onSelect(value);
  }
  chips.forEach(c => c.addEventListener('click', () => select(c.dataset.value)));
  return select;
}
