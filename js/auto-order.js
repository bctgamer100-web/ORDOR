/* รับไฟล์ ORDER ที่ส่วนขยาย (stock-sync-extension) ส่งมาให้อัตโนมัติ แล้วใส่เข้าหน้า รับORDER
   ส่วนขยายจับไฟล์ที่โหลดจาก BigSeller ชื่อ Order-SKU-... (ตัวเลขท้ายเปลี่ยนทุกครั้ง) → pagebridge.js → postMessage มาที่นี่
   ไม่มีส่วนขยาย = ไม่มีอะไรเกิดขึ้น ใช้ลากไฟล์/เลือกไฟล์เองได้ตามเดิม
   ใช้ฟังก์ชันร่วมจาก app.js: loadOrderFile */
(function () {
  'use strict';

  const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  function toast(msg, type) {
    if (typeof window.fxToast === 'function') window.fxToast(msg, type || '');
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
    toast('โหลดไฟล์ "' + d.name + '" เข้าหน้า รับORDER อัตโนมัติแล้ว', 'success');
  }

  window.addEventListener('message', function (e) {
    const d = e.data;
    if (e.source !== window || !d || d.source !== 'order-autoload') return;
    if (d.type === 'file' && d.b64 && d.name) {
      receive(d).catch(function (err) { toast('โหลดไฟล์อัตโนมัติไม่สำเร็จ: ' + (err && err.message || err), ''); });
    } else if (d.type === 'error') {
      toast('ส่วนขยายอ่านไฟล์ ' + (d.name || 'ORDER') + ' ไม่ได้: ' + (d.error || ''), '');
    }
  });
})();
