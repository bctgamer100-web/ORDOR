/* โหลดไฟล์ ORDER เข้าหน้า รับORDER อัตโนมัติผ่านส่วนขยาย (stock-sync-extension)
   1) ปุ่ม "โหลดจาก BigSeller": สั่งส่วนขยายให้แท็บ BigSeller > คำสั่งซื้อ ส่งออกไฟล์ → ไฟล์กลับมาใส่หน้านี้เอง
   2) ไฟล์ที่โหลดจาก BigSeller เองชื่อ Order-SKU-... (ตัวเลขท้ายเปลี่ยนทุกครั้ง) ส่วนขยายจับแล้วส่งมาใส่ให้เอง
   ไม่มีส่วนขยาย = ไม่มีอะไรเกิดขึ้น ใช้ลากไฟล์/เลือกไฟล์เองได้ตามเดิม
   ใช้ฟังก์ชันร่วมจาก app.js: loadOrderFile */
(function () {
  'use strict';

  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const btn = document.getElementById('orderAutoBtn');
  const statusEl = document.getElementById('orderAutoStatus');

  function toast(msg, type) {
    if (typeof window.fxToast === 'function') window.fxToast(msg, type || '');
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || '';
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // ไปที่แท็บ รับORDER ให้เห็นผลเลย (ถ้าหาแท็บไม่เจอ ก็โหลดไฟล์ไว้เฉยๆ)
  function showOrderTab() {
    const tab = document.querySelector('.tab[data-tool="orderTool"]');
    if (tab) tab.click();
  }

  let lastKey = '';
  async function receive(d) {
    if (typeof window.loadOrderFile !== 'function') return;
    const bytes = b64ToBytes(d.b64);
    const key = d.name + '|' + bytes.length;
    if (key === lastKey) return; // ข้อความซ้ำ (เช่น ส่งถึงสองครั้ง)
    lastKey = key;
    const type = /\.csv$/i.test(d.name) ? 'text/csv' : XLSX_TYPE;
    const file = new File([bytes], d.name, { type, lastModified: Date.now() });
    showOrderTab();
    await window.loadOrderFile(file);
    setStatus('✅ โหลด "' + d.name + '" แล้ว');
    toast('โหลดไฟล์ "' + d.name + '" เข้าหน้า รับORDER อัตโนมัติแล้ว', 'success');
  }

  function finish() {
    if (btn) btn.disabled = false;
  }

  // ปุ่ม: สั่งส่วนขยายส่งออกจาก BigSeller
  if (btn) {
    btn.addEventListener('click', function () {
      if (document.documentElement.getAttribute('data-stock-sync') !== '1') {
        setStatus('⚠️ ไม่พบส่วนขยาย "ส่งสต็อก BigSeller เข้า ORDER" — ติดตั้ง/รีโหลดส่วนขยายแล้วรีเฟรชหน้านี้ (F5)');
        return;
      }
      btn.disabled = true;
      setStatus('⏳ กำลังเรียกส่วนขยาย ...');
      window.postMessage({ source: 'order-workspace', type: 'ordSyncRequest' }, '*');
    });
  }

  /* ----- ตั้งเวลาโหลดเอง (ส่วนขยายเป็นตัวปลุก ตั้งแยกตามเครื่อง/เบราว์เซอร์) ----- */
  const schedChk = document.getElementById('orderAutoSched');
  const schedTimes = document.getElementById('orderAutoTimes');
  const schedInfo = document.getElementById('orderAutoSchedInfo');
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

  function parseTimes(text) {
    return String(text || '').split(/[,\s;]+/).map(function (t) { return t.trim(); }).filter(Boolean);
  }

  function hhmm(ms) {
    try { return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function showSchedule(st) {
    if (!schedInfo || !schedChk || !schedTimes) return;
    if (st.error) { schedInfo.textContent = '⚠️ ' + st.error; return; }
    schedChk.checked = !!st.enabled;
    if (document.activeElement !== schedTimes) schedTimes.value = (st.times || []).join(', ');
    const bits = [];
    if (st.running) bits.push('⏳ กำลังโหลด...');
    else if (st.enabled && st.nextAt) bits.push('⏰ ครั้งถัดไป ' + hhmm(st.nextAt) + ' น.');
    else if (st.enabled) bits.push('ยังไม่ได้ใส่เวลา');
    if (st.lastAt) bits.push((st.lastOk ? '✅ ' : '❌ ') + 'ล่าสุด ' + hhmm(st.lastAt) + ' น. — ' + (st.lastMsg || ''));
    schedInfo.textContent = bits.join(' · ');
  }

  function sendSchedule() {
    if (!schedChk || !schedTimes) return;
    const times = parseTimes(schedTimes.value);
    const bad = times.filter(function (t) { return !TIME_RE.test(t); });
    if (bad.length) { if (schedInfo) schedInfo.textContent = '⚠️ เวลาไม่ถูกต้อง: ' + bad.join(', ') + ' (ใช้รูปแบบ 09:00, 13:30)'; return; }
    if (document.documentElement.getAttribute('data-stock-sync') !== '1') {
      schedChk.checked = false;
      if (schedInfo) schedInfo.textContent = '⚠️ ไม่พบส่วนขยาย "ส่งสต็อก BigSeller เข้า ORDER" — ติดตั้ง/รีโหลดส่วนขยายแล้วรีเฟรชหน้านี้ (F5)';
      return;
    }
    if (schedChk.checked && !times.length) { if (schedInfo) schedInfo.textContent = 'ใส่เวลาก่อน เช่น 09:00, 13:30'; return; }
    window.postMessage({ source: 'order-workspace', type: 'ordScheduleSet', enabled: schedChk.checked, times: times }, '*');
  }
  if (schedChk) schedChk.addEventListener('change', sendSchedule);
  if (schedTimes) {
    schedTimes.addEventListener('change', sendSchedule);
    schedTimes.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); sendSchedule(); } });
  }
  // ขอสถานะปัจจุบันจากส่วนขยาย (ถ้ามี) ตอนเปิดหน้า
  setTimeout(function () {
    if (document.documentElement.getAttribute('data-stock-sync') === '1') {
      window.postMessage({ source: 'order-workspace', type: 'ordScheduleGet' }, '*');
    }
  }, 600);

  window.addEventListener('message', function (e) {
    const d = e.data;
    if (e.source !== window || !d) return;

    if (d.source === 'order-autoload' && d.type === 'schedule') { showSchedule(d); return; }

    // ตอบกลับของปุ่ม (kind = ord)
    if (d.source === 'stock-sync' && d.kind === 'ord') {
      if (d.type === 'progress') { setStatus(d.text); return; }
      if (d.type === 'error') { finish(); setStatus('❌ ' + d.error); return; }
      if (d.type === 'file' && d.b64 && d.name) {
        finish();
        receive(d).catch(function (err) { setStatus('❌ โหลดไฟล์ไม่สำเร็จ: ' + (err && err.message || err)); });
      }
      return;
    }

    // ไฟล์ที่ส่วนขยายจับได้เองจากการโหลดปกติ
    if (d.source === 'order-autoload') {
      if (d.type === 'file' && d.b64 && d.name) {
        receive(d).catch(function (err) { toast('โหลดไฟล์อัตโนมัติไม่สำเร็จ: ' + (err && err.message || err), ''); });
      } else if (d.type === 'error') {
        toast('ส่วนขยายอ่านไฟล์ ' + (d.name || 'ORDER') + ' ไม่ได้: ' + (d.error || ''), '');
      }
    }
  });
})();
