// รันในโลกเดียวกับสคริปต์ของหน้า BigSeller (world: MAIN) ที่ document_start
// แท็บเบื้องหลังจะถูกหยุด requestAnimationFrame และบอกว่า document.hidden = true ทำให้เมนูแบบ hover ของ BigSeller ไม่เด้ง
// จึงหลอกให้หน้าเว็บเห็นว่ากำลังแสดงอยู่ และใช้ setTimeout แทน rAF ตอนแท็บถูกซ่อนจริง
(function () {
  'use strict';
  const realHidden = function () {
    try { return Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get.call(document); } catch (e) { return false; }
  };
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: function () { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: function () { return 'visible'; } });
    document.hasFocus = function () { return true; };
  } catch (e) { /* ข้าม */ }

  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = function (cb) {
    if (!realHidden()) return raf(cb);
    return setTimeout(function () { cb(performance.now()); }, 16);
  };
})();
