/* โหลดไลบรารีขนาดใหญ่ที่ไม่ต้องใช้ตอนเปิดหน้า (html2pdf, ExcelJS) ทีหลัง
   - เริ่มโหลดเองหลังหน้าเว็บโหลดเสร็จ จึงไม่บล็อกการแสดงผลครั้งแรก
   - ถ้ากดปุ่มก่อนโหลดเสร็จ ให้ await loadLib('html2pdf') / loadLib('exceljs') รอก่อนใช้ */
(function () {
  'use strict';

  const LIBS = {
    html2pdf: { src: 'js/vendor/html2pdf.bundle.min.js', ready: () => typeof window.html2pdf === 'function' },
    exceljs: { src: 'js/vendor/exceljs.min.js', ready: () => typeof window.ExcelJS !== 'undefined' }
  };
  const pending = {};

  window.loadLib = function (name) {
    const lib = LIBS[name];
    if (!lib) return Promise.reject(new Error('ไม่รู้จักไลบรารี ' + name));
    if (lib.ready()) return Promise.resolve();
    if (!pending[name]) {
      pending[name] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = lib.src;
        s.onload = () => resolve();
        s.onerror = () => {
          delete pending[name]; // ให้ลองโหลดใหม่ได้ในครั้งถัดไป
          s.remove();
          reject(new Error('โหลด ' + lib.src + ' ไม่สำเร็จ'));
        };
        document.head.appendChild(s);
      });
    }
    return pending[name];
  };

  function preload() {
    Object.keys(LIBS).forEach((name) => window.loadLib(name).catch((e) => console.warn(e)));
  }
  if (document.readyState === 'complete') setTimeout(preload, 0);
  else window.addEventListener('load', () => setTimeout(preload, 0));
})();
