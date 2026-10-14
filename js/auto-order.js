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

  // แบบที่เลือกไว้: จำไว้ในเบราว์เซอร์นี้
  const modeSel = document.getElementById('orderAutoMode');
  const MODE_KEY = 'order_auto_mode_v1';
  function currentMode() {
    return modeSel && modeSel.value === 'ordu' ? 'ordu' : 'ord';
  }
  if (modeSel) {
    try { const saved = localStorage.getItem(MODE_KEY); if (saved === 'ord' || saved === 'ordu') modeSel.value = saved; } catch (e) { /* ไม่กระทบ */ }
    modeSel.addEventListener('change', function () {
      try { localStorage.setItem(MODE_KEY, modeSel.value); } catch (e) { /* ไม่กระทบ */ }
    });
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
      // ord = ทั้งหมด (เมื่อวาน–วันนี้) · ordu = ยังไม่พิมพ์ใบปะหน้า
      window.postMessage({ source: 'order-workspace', type: currentMode() + 'SyncRequest' }, '*');
    });
  }

  /* ----- ตั้งเวลาโหลดเอง (ส่วนขยายเป็นตัวปลุก ตั้งแยกตามเครื่อง/เบราว์เซอร์) ----- */
  // แต่ละแถว = เวลา + แบบ (ทั้งหมด เมื่อวาน–วันนี้ / ยังไม่พิมพ์ใบปะหน้า) เช่น 09:00 ทั้งหมด · 11:00 ยังไม่พิมพ์ · 12:00 ทั้งหมด
  const schedChk = document.getElementById('orderAutoSched');
  const schedList = document.getElementById('orderAutoTimes');
  const schedAdd = document.getElementById('orderAutoAdd');
  const schedInfo = document.getElementById('orderAutoSchedInfo');
  const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;
  const BOX_STYLE = 'padding:4px 8px;border-radius:8px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;font-size:13px';

  function hhmm(ms) {
    try { return new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; }
  }

  function modeLabel(m) { return m === 'ordu' ? 'ยังไม่พิมพ์ใบปะหน้า' : 'ทั้งหมด'; }

  function addRow(time, mode) {
    if (!schedList) return;
    const row = document.createElement('div');
    row.className = 'order-auto-row';
    row.style.cssText = 'display:flex;gap:6px;align-items:center';
    const t = document.createElement('input');
    t.type = 'time';
    t.value = time || '';
    t.style.cssText = BOX_STYLE;
    const s = document.createElement('select');
    s.style.cssText = BOX_STYLE;
    [['ord', 'ทั้งหมด (เมื่อวาน–วันนี้)'], ['ordu', 'ยังไม่พิมพ์ใบปะหน้า']].forEach(function (o) {
      const op = document.createElement('option');
      op.value = o[0]; op.textContent = o[1];
      s.appendChild(op);
    });
    s.value = mode === 'ordu' ? 'ordu' : 'ord';
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = '✕';
    del.title = 'ลบเวลานี้';
    del.style.cssText = BOX_STYLE + ';cursor:pointer';
    t.addEventListener('change', sendSchedule);
    s.addEventListener('change', sendSchedule);
    del.addEventListener('click', function () { row.remove(); sendSchedule(); });
    row.append(t, s, del);
    schedList.appendChild(row);
  }

  function readRows() {
    if (!schedList) return [];
    return Array.prototype.slice.call(schedList.querySelectorAll('.order-auto-row')).map(function (row) {
      return { time: row.querySelector('input').value, mode: row.querySelector('select').value };
    });
  }

  function renderRows(items) {
    if (!schedList) return;
    schedList.textContent = '';
    (items || []).forEach(function (it) { addRow(it.time, it.mode); });
  }

  function showSchedule(st) {
    if (!schedInfo || !schedChk || !schedList) return;
    if (st.error) { schedInfo.textContent = '⚠️ ' + st.error; return; }
    schedChk.checked = !!st.enabled;
    // กำลังแก้ไขอยู่ (โฟกัสในรายการ หรือมีแถวที่ยังไม่ใส่เวลา) ไม่วาดทับ
    const editing = schedList.contains(document.activeElement) || readRows().some(function (r) { return !r.time; });
    if (!editing) renderRows(st.items || []);
    const bits = [];
    if (st.running) bits.push('⏳ กำลังโหลด...');
    else if (st.enabled && st.nextAt) bits.push('⏰ ครั้งถัดไป ' + hhmm(st.nextAt) + ' น.' + (st.nextModes && st.nextModes.length ? ' (' + st.nextModes.map(modeLabel).join(' + ') + ')' : ''));
    else if (st.enabled) bits.push('ยังไม่ได้ใส่เวลา');
    if (st.lastAt) bits.push((st.lastOk ? '✅ ' : '❌ ') + 'ล่าสุด ' + hhmm(st.lastAt) + ' น. — ' + (st.lastMsg || ''));
    schedInfo.textContent = bits.join(' · ');
  }

  function sendSchedule() {
    if (!schedChk || !schedList) return;
    const items = readRows().filter(function (r) { return r.time; });
    const bad = items.filter(function (r) { return !TIME_RE.test(r.time); });
    if (bad.length) { if (schedInfo) schedInfo.textContent = '⚠️ เวลาไม่ถูกต้อง: ' + bad.map(function (r) { return r.time; }).join(', '); return; }
    if (document.documentElement.getAttribute('data-stock-sync') !== '1') {
      schedChk.checked = false;
      if (schedInfo) schedInfo.textContent = '⚠️ ไม่พบส่วนขยาย "ส่งสต็อก BigSeller เข้า ORDER" — ติดตั้ง/รีโหลดส่วนขยายแล้วรีเฟรชหน้านี้ (F5)';
      return;
    }
    if (schedChk.checked && !items.length) { if (schedInfo) schedInfo.textContent = 'กด + เพิ่มเวลา แล้วใส่เวลา เช่น 09:00'; return; }
    window.postMessage({ source: 'order-workspace', type: 'ordScheduleSet', enabled: schedChk.checked, items: items }, '*');
  }
  if (schedChk) schedChk.addEventListener('change', sendSchedule);
  if (schedAdd) schedAdd.addEventListener('click', function () { addRow('', currentMode()); });
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
    if (d.source === 'stock-sync' && (d.kind === 'ord' || d.kind === 'ordu')) {
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
