/* ===== ข้อมูลที่เก็บในเบราว์เซอร์ (IndexedDB) =====
   1) ไฟล์ ORDER ที่เคยใช้ (หน้า รับORDER): บันทึกอัตโนมัติเมื่อโหลดสำเร็จ เปิดกลับมาใช้/ลบได้
   2) ใบปริ้น (SavedPrints): เมื่อกดปุ่มปริ้นจะเก็บ "รายการที่ปริ้นจริง" + ไฟล์ PDF ไว้ใช้ต่อในหน้า ตรวจใบปริ้น
   ข้อมูลอยู่เฉพาะเบราว์เซอร์/เครื่องนี้ ไม่ถูกส่งไปที่ใด
   ใช้ฟังก์ชัน/ตัวแปรร่วมจาก app.js: loadOrderFile, orderRows, html2pdf */
(function () {
  'use strict';

  const DB_NAME = 'order_ws_v1';
  const DB_VERSION = 2;
  const FILES = 'order_files';
  const PRINTS = 'order_prints';
  const MAX_FILES = 10;
  const MAX_PRINTS = 10;
  const MAX_BYTES = 60 * 1024 * 1024;

  if (!window.indexedDB) return;

  let dbPromise = null;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(FILES)) d.createObjectStore(FILES, { keyPath: 'id' });
          if (!d.objectStoreNames.contains(PRINTS)) d.createObjectStore(PRINTS, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function run(storeName, mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const tx = d.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      const r = fn(store);
      if (r) r.onsuccess = () => { result = r.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  const dbApi = store => ({
    all: () => run(store, 'readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => y.savedAt - x.savedAt)),
    one: id => run(store, 'readonly', s => s.get(id)),
    put: rec => run(store, 'readwrite', s => s.put(rec)),
    del: id => run(store, 'readwrite', s => s.delete(id)),
    clear: () => run(store, 'readwrite', s => s.clear())
  });
  const files = dbApi(FILES);
  const prints = dbApi(PRINTS);

  async function prune(api, max) {
    const all = await api.all();
    for (const rec of all.slice(max)) await api.del(rec.id);
  }

  function toast(msg, type) {
    if (typeof window.fxToast === 'function') window.fxToast(msg, type || '');
  }

  function fmtSize(n) {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    return Math.max(1, Math.round(n / 1024)) + ' KB';
  }

  function fmtDate(ms) {
    try {
      return new Date(ms).toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  /* ------------------------------------------------------------------ */
  /* 1) ไฟล์ ORDER ที่เคยใช้                                              */
  /* ------------------------------------------------------------------ */
  const panel = document.getElementById('savedFiles');
  const listEl = document.getElementById('savedFilesList');
  const clearBtn = document.getElementById('savedFilesClear');

  async function saveFile(file, rows) {
    if (!file || file.size > MAX_BYTES) return;
    const id = `${file.name}|${file.size}|${file.lastModified}`;
    // เปิดไฟล์เดิมซ้ำ: คงเวลาที่บันทึกครั้งแรกไว้
    let first = null;
    try { first = await files.one(id); } catch (e) { first = null; }
    await files.put({
      id,
      name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
      savedAt: first && first.savedAt ? first.savedAt : Date.now(), rows: rows, blob: file
    });
    await prune(files, MAX_FILES);
  }

  async function renderFiles() {
    if (!panel || !listEl) return;
    let all = [];
    try { all = await files.all(); } catch (e) { all = []; }
    listEl.textContent = '';
    panel.hidden = all.length === 0;
    if (!all.length) return;

    const frag = document.createDocumentFragment();
    all.forEach(rec => {
      const row = document.createElement('div');
      row.className = 'saved-file';

      const info = document.createElement('div');
      info.className = 'saved-file-info';
      const name = document.createElement('strong');
      name.textContent = rec.name;
      name.title = rec.name;
      const meta = document.createElement('span');
      const parts = [fmtDate(rec.savedAt), fmtSize(rec.size)];
      if (rec.rows) parts.push(rec.rows.toLocaleString() + ' รายการ');
      meta.textContent = parts.join(' · ');
      info.append(name, meta);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'saved-file-open';
      openBtn.textContent = 'เปิด';
      openBtn.title = 'เปิดไฟล์นี้กลับมาใช้';
      openBtn.addEventListener('click', () => openFile(rec.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'saved-file-del';
      delBtn.textContent = 'ลบ';
      delBtn.title = 'ลบไฟล์นี้ออกจากรายการ';
      delBtn.addEventListener('click', async () => {
        try { await files.del(rec.id); } catch (e) { /* ไม่กระทบ */ }
        renderFiles();
      });

      row.append(info, openBtn, delBtn);
      frag.appendChild(row);
    });
    listEl.appendChild(frag);
  }

  async function openFile(id) {
    let rec = null;
    try { rec = await files.one(id); } catch (e) { rec = null; }
    if (!rec || !rec.blob) {
      toast('ไม่พบไฟล์ที่บันทึกไว้', '');
      renderFiles();
      return;
    }
    const file = new File([rec.blob], rec.name, { type: rec.type || rec.blob.type, lastModified: rec.lastModified });
    await window.loadOrderFile(file);
    toast('เปิดไฟล์ "' + rec.name + '" แล้ว', 'success');
  }

  // ห่อ loadOrderFile: เมื่อโหลดสำเร็จ (มีข้อมูล) ให้บันทึกลงรายการอัตโนมัติ
  if (panel && listEl && typeof window.loadOrderFile === 'function') {
    const original = window.loadOrderFile;
    window.loadOrderFile = async function (file) {
      const result = await original.apply(this, arguments);
      try {
        const rows = (typeof orderRows !== 'undefined' && Array.isArray(orderRows)) ? Math.max(0, orderRows.length - 1) : 0;
        if (file && rows > 0) {
          await saveFile(file, rows);
          renderFiles();
        }
      } catch (e) { /* พื้นที่เต็ม/ไม่รองรับ: ข้ามไป ไม่กระทบการใช้งาน */ }
      return result;
    };
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!confirm('ลบไฟล์ที่บันทึกไว้ทั้งหมด?')) return;
        try { await files.clear(); } catch (e) { /* ไม่กระทบ */ }
        renderFiles();
      });
    }
    renderFiles();
  }

  /* ------------------------------------------------------------------ */
  /* 2) ใบปริ้น (รายการที่ปริ้นจริง + PDF)                                */
  /* ------------------------------------------------------------------ */
  function emitChange() {
    document.dispatchEvent(new CustomEvent('savedprints:changed'));
  }

  // สร้าง PDF ของใบปริ้น: วาดแต่ละหน้าลง canvas ตรงๆ (ตำแหน่งตามเลย์เอาต์เดียวกับหน้าปริ้น)
  // ไม่ใช้การถ่ายภาพหน้าเว็บ จึงไม่เพี้ยนเมื่อหน้าถูกเลื่อน และตัวอักษรไทย (สระ/วรรณยุกต์) ถูกต้อง
  async function buildPdf(rows) {
    if (typeof window.html2pdf !== 'function' || typeof layoutOrderSheetColumns !== 'function') return null;
    const PXMM = 8;                       // ~203 dpi
    const W = 210 * PXMM, H = 296 * PXMM;
    const LEFT = 19.05, TOP = 25.4, COL_W = 79.6, GAP = 12.7, QTY_X = 68.8;

    const cols = layoutOrderSheetColumns(rows);
    const pages = [];
    for (let i = 0; i < cols.length; i += 2) pages.push([cols[i], cols[i + 1] || []]);

    const style = document.createElement('style');
    style.textContent = '.html2pdf__overlay{opacity:0!important;pointer-events:none!important}';
    document.head.appendChild(style);
    try {
      // ขอ jsPDF จาก html2pdf ด้วยองค์ประกอบเล็กๆ แล้วลบหน้าแรกทิ้งภายหลัง
      const tiny = document.createElement('div');
      tiny.style.cssText = 'width:20px;height:20px;background:#fff';
      const opt = { margin: 0, image: { type: 'jpeg', quality: 0.5 }, html2canvas: { scale: 1, logging: false }, jsPDF: { unit: 'mm', format: [210, 296], orientation: 'portrait', compress: true } };
      const pdf = await html2pdf().set(opt).from(tiny).toPdf().get('pdf');

      const fontPx = (10 * 25.4 / 72) * PXMM;   // 10pt
      for (const pageCols of pages) {
        const c = document.createElement('canvas');
        c.width = W; c.height = H;
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);
        g.fillStyle = '#000000';
        g.font = `${fontPx}px Tahoma, "Noto Sans Thai", sans-serif`;
        g.textBaseline = 'middle';
        pageCols.forEach((col, ci) => {
          const x0 = (LEFT + ci * (COL_W + GAP)) * PXMM;
          let y = TOP * PXMM;
          for (const e of col) {
            if (e.spacer) { y += ORDER_SHEET_SPACER_H * PXMM; continue; }
            const cy = y + (ORDER_SHEET_ROW_H * PXMM) / 2;
            g.textAlign = 'left';
            g.fillText(String(e.row?.sku ?? ''), x0, cy);
            g.textAlign = 'right';
            g.fillText(formatPivotNumber(e.row?.qty ?? 0), x0 + QTY_X * PXMM, cy);
            y += ORDER_SHEET_ROW_H * PXMM;
          }
        });
        pdf.addPage([210, 296], 'portrait');
        pdf.addImage(c.toDataURL('image/png'), 'PNG', 0, 0, 210, 296, undefined, 'FAST');
      }
      pdf.deletePage(1);
      return pdf.output('blob');
    } finally {
      style.remove();
    }
  }
  async function saveFromPrint(info) {
    const rows = Array.isArray(info.rows) ? info.rows : [];
    if (!rows.length) return null;
    const orderNameEl = document.getElementById('orderFileName');
    const rec = {
      id: 'p' + Date.now(),
      savedAt: Date.now(),
      count: rows.length,
      title: info.title || '',
      orderFile: orderNameEl ? orderNameEl.textContent.trim() : '',
      rows: rows,
      pdf: null
    };
    await prints.put(rec);
    await prune(prints, MAX_PRINTS);
    emitChange();

    try {
      const blob = await buildPdf(rows);
      if (blob) {
        rec.pdf = blob;
        rec.pdfSize = blob.size;
        await prints.put(rec);
        emitChange();
        toast('บันทึกใบปริ้น (PDF) ไว้ในเว็บแล้ว — ใช้ต่อได้ที่แท็บ "ตรวจใบปริ้น"', 'success');
      }
    } catch (e) {
      console.error('สร้าง PDF ไม่สำเร็จ:', e);
      toast('บันทึกรายการที่ปริ้นแล้ว แต่สร้างไฟล์ PDF ไม่สำเร็จ', '');
    }
    return rec.id;
  }

  window.SavedPrints = {
    saveFromPrint,
    list: () => prints.all(),
    get: id => prints.one(id),
    remove: async id => { await prints.del(id); emitChange(); },
    clear: async () => { await prints.clear(); emitChange(); },
    openPdf: rec => {
      if (!rec || !rec.pdf) return;
      const url = URL.createObjectURL(rec.pdf);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
    },
    downloadPdf: rec => {
      if (!rec || !rec.pdf) return;
      const d = new Date(rec.savedAt);
      const pad = n => String(n).padStart(2, '0');
      const url = URL.createObjectURL(rec.pdf);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ORDER_Pivot_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.pdf`;
      a.style.display = 'none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
    },
    formatDate: fmtDate,
    formatSize: fmtSize
  };

  /* ------------------------------------------------------------------ */
  /* 3) ล้างรายการที่บันทึกไว้ของวันก่อนหน้า ทุก 00:00                       */
  /* ------------------------------------------------------------------ */
  function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  async function purgeOld() {
    const limit = startOfToday();
    let removed = 0;
    for (const store of [files, prints]) {
      let all = [];
      try { all = await store.all(); } catch (e) { all = []; }
      for (const rec of all) {
        if ((rec.savedAt || 0) < limit) {
          try { await store.del(rec.id); removed++; } catch (e) { /* ข้าม */ }
        }
      }
    }
    if (removed) {
      renderFiles();
      emitChange();
    }
    return removed;
  }

  let purgeDay = new Date().toDateString();
  purgeOld();
  setInterval(() => {
    const now = new Date().toDateString();
    if (now !== purgeDay) { purgeDay = now; purgeOld(); }
  }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) purgeOld(); });

  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ไม่กระทบ */ }
})();
