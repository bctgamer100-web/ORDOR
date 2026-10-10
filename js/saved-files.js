/* ===== ข้อมูลที่เก็บในเบราว์เซอร์ (IndexedDB) =====
   1) ไฟล์ ORDER ที่เคยใช้ (หน้า รับORDER): บันทึกอัตโนมัติเมื่อโหลดสำเร็จ เปิดกลับมาใช้/ลบได้
   2) ใบปริ้น (SavedPrints): เมื่อกดปุ่มปริ้นจะเก็บ "รายการที่ปริ้นจริง" + ไฟล์ PDF ไว้ใช้ต่อในหน้า ตรวจใบปริ้น
   3) ยืนยันก่อนสั่ง (SavedConfirms): บันทึกตอนกดยืนยัน
   ทั้ง 3 อย่างเก็บใน IndexedDB ของเครื่องนี้ (cache/ใช้ออฟไลน์) และซิงค์ขึ้น Supabase (ตาราง op_share_items + bucket op-share)
   ให้ทุกเครื่องเห็นร่วมกัน เก็บ 1 วันแล้วล้างตอนเที่ยงคืนไทย (ดู supabase/op_share.sql) — ซิงค์ไม่ได้ก็ใช้ของในเครื่องต่อไป
   ใช้ฟังก์ชัน/ตัวแปรร่วมจาก app.js: loadOrderFile, orderRows, html2pdf */
(function () {
  'use strict';

  const DB_NAME = 'order_ws_v1';
  const DB_VERSION = 3;
  const FILES = 'order_files';
  const PRINTS = 'order_prints';
  const CONFIRMS = 'order_confirms'; // รายการที่กดยืนยันจากหน้า ก่อนสั่ง (ใช้ซ้ำที่หน้า ตรวจ ORDER กับ Stock)
  const MAX_FILES = 10;
  const MAX_PRINTS = 10;
  const MAX_CONFIRMS = 20;
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
          if (!d.objectStoreNames.contains(CONFIRMS)) d.createObjectStore(CONFIRMS, { keyPath: 'id' });
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
  const confirms = dbApi(CONFIRMS);

  async function prune(api, max) {
    const all = await api.all();
    for (const rec of all.slice(max)) await api.del(rec.id);
  }

  /* ------------------------------------------------------------------ */
  /* ซิงค์ขึ้น Supabase (ใช้ร่วมกันทุกเครื่อง)                              */
  /* ------------------------------------------------------------------ */
  const SUPABASE_URL = 'https://yvfqxlgkwaylivopctno.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_xNq2vHHwVe8v_rujH3P_QQ_ep6-g6ol'; // publishable key เท่านั้น
  const BUCKET = 'op-share';
  const MAX_REMOTE_BYTES = 50 * 1024 * 1024;   // เท่ากับ file_size_limit ของ bucket

  let sbClient = null;
  function sb() {
    if (sbClient) return sbClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') return null; // ไลบรารีโหลดทีหลัง: เรียกซ้ำภายหลังได้
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    return sbClient;
  }

  async function rpc(name, args) {
    const c = sb();
    if (!c) throw new Error('supabase ไม่พร้อม');
    const res = await c.rpc(name, args || {});
    if (res.error) throw res.error;
    return res.data;
  }

  function bkkDay(ms) {
    try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }); }
    catch (e) { return new Date(ms).toISOString().slice(0, 10); }
  }

  function extOf(name, fallback) {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(name || '');
    return (m ? m[1] : fallback).toLowerCase();
  }

  function hashId(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + s.length.toString(36);
  }

  // รายการจากเซิร์ฟเวอร์ (ของวันนี้) แคชสั้นๆ กันยิงซ้ำ; คืน null ถ้าเรียกไม่สำเร็จ (ออฟไลน์/ยังไม่ได้รัน op_share.sql)
  const remoteCache = {};
  const remoteInflight = {};
  function invalidate(kind) {
    if (kind) delete remoteCache[kind]; else Object.keys(remoteCache).forEach(k => delete remoteCache[k]);
  }
  function rList(kind) {
    const c = remoteCache[kind];
    if (c && Date.now() - c.t < 4000) return Promise.resolve(c.list);
    if (remoteInflight[kind]) return remoteInflight[kind];
    const p = rpc('op_share_list', { p_kind: kind, p_with_data: kind !== 'file' })
      .then(list => {
        list = Array.isArray(list) ? list : [];
        remoteCache[kind] = { t: Date.now(), list };
        return list;
      })
      .catch(() => null)
      .finally(() => { delete remoteInflight[kind]; });
    remoteInflight[kind] = p;
    return p;
  }

  async function uploadBlob(path, blob, mime) {
    const c = sb();
    if (!c) throw new Error('supabase ไม่พร้อม');
    const res = await c.storage.from(BUCKET).upload(path, blob, { contentType: mime || 'application/octet-stream', upsert: false });
    const err = res.error;
    if (err && !/exist|duplicate/i.test(err.message || '') && String(err.statusCode) !== '409') throw err;
  }

  async function downloadBlob(path) {
    const c = sb();
    if (!c) throw new Error('supabase ไม่พร้อม');
    const res = await c.storage.from(BUCKET).download(path);
    if (res.error) throw res.error;
    return res.data;
  }

  function removeObjects(paths) {
    const c = sb();
    const list = (paths || []).filter(Boolean);
    if (!c || !list.length) return Promise.resolve();
    return c.storage.from(BUCKET).remove(list).catch(() => { /* ไฟล์ค้างไม่กระทบการใช้งาน */ });
  }

  function rSave(kind, id, o) {
    return rpc('op_share_save', {
      p_kind: kind, p_id: id,
      p_name: o.name || '', p_count: o.count || 0, p_qty: o.qty || 0,
      p_data: o.data == null ? null : o.data,
      p_meta: o.meta == null ? null : o.meta,
      p_file_path: o.path || null,
      p_file_size: o.size == null ? null : o.size,
      p_mime: o.mime || null
    }).then(() => invalidate(kind));
  }

  async function rDelete(kind, id) {
    try { removeObjects([await rpc('op_share_delete', { p_kind: kind, p_id: id })]); } catch (e) { /* ไม่กระทบ */ }
    invalidate(kind);
  }

  async function rClear(kind) {
    try { removeObjects(await rpc('op_share_clear', { p_kind: kind })); } catch (e) { /* ไม่กระทบ */ }
    invalidate(kind);
  }

  async function rPurge() {
    try { removeObjects(await rpc('op_share_purge')); } catch (e) { /* ไม่กระทบ */ }
  }

  // เครื่องนี้เคยอัปขึ้นเซิร์ฟเวอร์แล้ว (synced) แต่ไม่อยู่ในรายการ = ถูกลบจากเครื่องอื่น → ลบของในเครื่องตาม
  // ยังไม่เคยอัป → อัปขึ้น (ครั้งเดียวต่อ session)
  const pushTried = new Set();
  async function markSynced(api, id) {
    try {
      const cur = await api.one(id);
      if (cur && !cur.synced) { cur.synced = true; await api.put(cur); }
    } catch (e) { /* ไม่กระทบ */ }
  }
  async function reconcile(kind, api, localRecs, remoteList, push) {
    if (remoteList === null) return localRecs;
    const ids = new Set(remoteList.map(r => r.id));
    const keep = [];
    for (const l of localRecs) {
      if (ids.has(l.id)) {
        if (!l.synced) { l.synced = true; markSynced(api, l.id); }
        keep.push(l);
        continue;
      }
      if (l.synced) { try { await api.del(l.id); } catch (e) { /* ข้าม */ } continue; }
      keep.push(l);
      const k = kind + ':' + l.id;
      if (!pushTried.has(k)) {
        pushTried.add(k);
        push(l).then(() => markSynced(api, l.id)).catch(() => { /* ลองใหม่เมื่อรีเฟรชหน้า */ });
      }
    }
    return keep;
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
    const rec = {
      id,
      name: file.name, size: file.size, type: file.type, lastModified: file.lastModified,
      savedAt: first && first.savedAt ? first.savedAt : Date.now(), rows: rows, blob: file,
      synced: !!(first && first.synced)
    };
    await files.put(rec);
    await prune(files, MAX_FILES);
    if (!rec.synced) pushFile(rec).then(() => markSynced(files, id)).catch(() => { /* ซิงค์ไม่ได้: ใช้ของในเครื่องต่อ */ });
  }

  async function pushFile(rec) {
    if (!rec.blob || rec.size > MAX_REMOTE_BYTES) return;
    if (!sb()) throw new Error('supabase ไม่พร้อม');
    const existing = await rList('file');
    if (existing && existing.some(r => r.id === rec.id)) return;
    const path = `file/${bkkDay(rec.savedAt)}/${hashId(rec.id)}.${extOf(rec.name, 'xlsx')}`;
    const mime = rec.type || 'application/octet-stream';
    await uploadBlob(path, rec.blob, mime);
    await rSave('file', rec.id, {
      name: rec.name, count: rec.rows || 0, meta: { lastModified: rec.lastModified },
      path, size: rec.size, mime
    });
  }

  // ไฟล์ที่เคยใช้: ของในเครื่อง + ของเครื่องอื่น (ผ่านเซิร์ฟเวอร์)
  async function listFiles() {
    let local = [];
    try { local = await files.all(); } catch (e) { local = []; }
    const remote = await rList('file');
    local = await reconcile('file', files, local, remote, pushFile);
    if (remote) {
      const have = new Set(local.map(r => r.id));
      remote.forEach(r => {
        if (have.has(r.id)) return;
        const t = Date.parse(r.saved_at) || Date.now();
        local.push({
          id: r.id, name: r.name, size: Number(r.file_size) || 0, type: r.mime || '',
          lastModified: (r.meta && r.meta.lastModified) || t, savedAt: t, rows: r.count, remotePath: r.file_path
        });
      });
    }
    return local.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function renderFiles() {
    if (!panel || !listEl) return;
    let all = [];
    try { all = await listFiles(); } catch (e) { all = []; }
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
        await rDelete('file', rec.id);
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
      // ไฟล์จากเครื่องอื่น: ดาวน์โหลดจากเซิร์ฟเวอร์
      let r = null;
      try { r = (await listFiles()).find(x => x.id === id) || null; } catch (e) { r = null; }
      if (r && r.remotePath) {
        try { r.blob = await downloadBlob(r.remotePath); rec = r; } catch (e) { rec = null; }
      }
    }
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
        await rClear('file');
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
    try { await window.loadLib('html2pdf'); } catch (e) { console.warn(e); }
    if (typeof window.html2pdf !== 'function' || typeof layoutOrderSheetColumns !== 'function') return null;
    const PXMM = 8;                       // ~203 dpi
    const W = 210 * PXMM, H = 296 * PXMM;
    const LEFT = 19.05, TOP = 25.4;

    // เลย์เอาต์เดียวกับตอนปริ้น (2 คอลัมน์ หรือ 3 คอลัมน์เมื่อรายการเกิน 2 หน้า)
    const cols = layoutOrderSheetColumns(rows);
    const L = cols.layout;
    const pages = orderSheetPages(cols);

    const style = document.createElement('style');
    style.textContent = '.html2pdf__overlay{opacity:0!important;pointer-events:none!important}';
    document.head.appendChild(style);
    try {
      // ขอ jsPDF จาก html2pdf ด้วยองค์ประกอบเล็กๆ แล้วลบหน้าแรกทิ้งภายหลัง
      const tiny = document.createElement('div');
      tiny.style.cssText = 'width:20px;height:20px;background:#fff';
      const opt = { margin: 0, image: { type: 'jpeg', quality: 0.5 }, html2canvas: { scale: 1, logging: false }, jsPDF: { unit: 'mm', format: [210, 296], orientation: 'portrait', compress: true } };
      const pdf = await html2pdf().set(opt).from(tiny).toPdf().get('pdf');

      const fontPx = (L.fontPt * 25.4 / 72) * PXMM;
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
          const x0 = (LEFT + ci * (L.colW + L.gap)) * PXMM;
          let y = TOP * PXMM;
          for (const e of col) {
            if (e.spacer) { y += L.spacerH * PXMM; continue; }
            const cy = y + (L.rowH * PXMM) / 2;
            g.textAlign = 'left';
            g.fillText(String(e.row?.sku ?? ''), x0, cy);
            g.textAlign = 'right';
            g.fillText(formatPivotNumber(e.row?.qty ?? 0), x0 + L.qtyX * PXMM, cy);
            y += L.rowH * PXMM;
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
    // ส่งขึ้นเซิร์ฟเวอร์ให้เครื่องอื่นเห็น (ไม่สำเร็จ = ลองใหม่เองตอนซิงค์รอบถัดไป)
    pushTried.add('print:' + rec.id);
    pushPrint(rec).then(() => markSynced(prints, rec.id)).then(emitChange).catch(() => { /* ใช้ของในเครื่องต่อ */ });
    return rec.id;
  }

  async function pushPrint(rec) {
    if (!sb()) throw new Error('supabase ไม่พร้อม');
    let path = null, size = null;
    if (rec.pdf instanceof Blob && rec.pdf.size <= MAX_REMOTE_BYTES) {
      path = `print/${bkkDay(rec.savedAt)}/${rec.id}.pdf`;
      size = rec.pdf.size;
      await uploadBlob(path, rec.pdf, 'application/pdf');
    }
    await rSave('print', rec.id, {
      name: rec.title || '', count: rec.count || (rec.rows || []).length, data: rec.rows,
      meta: { title: rec.title || '', orderFile: rec.orderFile || '' },
      path, size, mime: path ? 'application/pdf' : null
    });
  }

  // ใบปริ้น: ของในเครื่อง + ของเครื่องอื่น (pdf ของเครื่องอื่นเป็นตัวแทน {size, remote} ดึงจริงตอนกดเปิด/ดาวน์โหลด)
  async function listPrints() {
    let local = [];
    try { local = await prints.all(); } catch (e) { local = []; }
    const remote = await rList('print');
    local = await reconcile('print', prints, local, remote, pushPrint);
    if (remote) {
      const byId = new Map(remote.map(r => [r.id, r]));
      local.forEach(l => {
        const r = byId.get(l.id);
        if (!r || !r.file_path) return;
        l.remotePath = r.file_path;
        if (!l.pdf) l.pdf = { size: Number(r.file_size) || 0, remote: true };
      });
      const have = new Set(local.map(r => r.id));
      remote.forEach(r => {
        if (have.has(r.id)) return;
        local.push({
          id: r.id, savedAt: Date.parse(r.saved_at) || Date.now(), count: r.count,
          title: r.name || '', orderFile: (r.meta && r.meta.orderFile) || '',
          rows: Array.isArray(r.data) ? r.data : [],
          pdf: r.file_path ? { size: Number(r.file_size) || 0, remote: true } : null,
          pdfSize: Number(r.file_size) || 0, remotePath: r.file_path
        });
      });
    }
    return local.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function pdfBlobOf(rec) {
    if (rec.pdf instanceof Blob) return rec.pdf;
    if (rec.remotePath) return downloadBlob(rec.remotePath);
    return null;
  }

  window.SavedPrints = {
    saveFromPrint,
    list: listPrints,
    get: id => prints.one(id),
    remove: async id => {
      try { await prints.del(id); } catch (e) { /* ไม่กระทบ */ }
      await rDelete('print', id);
      emitChange();
    },
    clear: async () => {
      try { await prints.clear(); } catch (e) { /* ไม่กระทบ */ }
      await rClear('print');
      emitChange();
    },
    openPdf: async rec => {
      if (!rec || !rec.pdf) return;
      if (rec.pdf instanceof Blob) {
        const url = URL.createObjectURL(rec.pdf);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
        return;
      }
      const w = window.open('', '_blank'); // เปิดหน้าต่างก่อนดึงไฟล์ ไม่ให้ถูกบล็อกป็อปอัป
      try {
        const url = URL.createObjectURL(await pdfBlobOf(rec));
        if (w) w.location.href = url; else window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
      } catch (e) {
        if (w) w.close();
        toast('เปิดไฟล์ PDF ไม่สำเร็จ ลองใหม่อีกครั้ง', '');
      }
    },
    downloadPdf: async rec => {
      if (!rec || !rec.pdf) return;
      let blob = null;
      try { blob = await pdfBlobOf(rec); } catch (e) { blob = null; }
      if (!blob) { toast('ดาวน์โหลด PDF ไม่สำเร็จ ลองใหม่อีกครั้ง', ''); return; }
      const d = new Date(rec.savedAt);
      const pad = n => String(n).padStart(2, '0');
      const url = URL.createObjectURL(blob);
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
  /* 2.5) รายการที่ยืนยันจากหน้า ก่อนสั่ง (แสดงที่หน้า ตรวจ ORDER กับ Stock)  */
  /*      บันทึกตอนกดยืนยัน เวลาที่แสดง = เวลาที่กดยืนยัน (ไม่เปลี่ยนตอนเปิดซ้ำ) */
  /* ------------------------------------------------------------------ */
  const confPanel = document.getElementById('confirmRef');
  const confList = document.getElementById('confirmRefList');
  const confClear = document.getElementById('confirmRefClear');
  let confCurrentId = null;

  async function saveConfirm(info) {
    if (!info || !info.file || !Array.isArray(info.rows) || !info.rows.length) return null;
    const now = Date.now();
    const rec = {
      id: 'c' + now,
      savedAt: now,
      name: info.file.name,
      type: info.file.type,
      blob: info.file,
      count: info.rows.length,
      qty: info.rows.reduce((s, r) => s + (Number(r.qty) || 0), 0),
      brandMap: info.brandMap || []
    };
    try {
      await confirms.put(rec);
      await prune(confirms, MAX_CONFIRMS);
    } catch (e) { return null; }
    confCurrentId = rec.id;
    pushTried.add('confirm:' + rec.id);
    pushConfirm(rec).then(() => markSynced(confirms, rec.id)).then(renderConfirms).catch(() => { /* ใช้ของในเครื่องต่อ */ });
    renderConfirms();
    return rec.id;
  }

  async function pushConfirm(rec) {
    if (!sb()) throw new Error('supabase ไม่พร้อม');
    let path = null, size = null;
    const mime = rec.type || 'application/octet-stream';
    if (rec.blob && rec.blob.size <= MAX_REMOTE_BYTES) {
      path = `confirm/${bkkDay(rec.savedAt)}/${rec.id}.${extOf(rec.name, 'xlsx')}`;
      size = rec.blob.size;
      await uploadBlob(path, rec.blob, mime);
    }
    await rSave('confirm', rec.id, {
      name: rec.name, count: rec.count, qty: rec.qty, data: rec.brandMap || [],
      path, size, mime: path ? mime : null
    });
  }

  // รายการที่ยืนยัน: ของในเครื่อง + ของเครื่องอื่น (ไฟล์ของเครื่องอื่นดึงจริงตอนกดเปิด)
  async function listConfirms() {
    let local = [];
    try { local = await confirms.all(); } catch (e) { local = []; }
    const remote = await rList('confirm');
    local = await reconcile('confirm', confirms, local, remote, pushConfirm);
    if (remote) {
      const have = new Set(local.map(r => r.id));
      remote.forEach(r => {
        if (have.has(r.id)) return;
        local.push({
          id: r.id, savedAt: Date.parse(r.saved_at) || Date.now(), name: r.name,
          type: r.mime || '', count: r.count, qty: Number(r.qty) || 0,
          brandMap: Array.isArray(r.data) ? r.data : [], remotePath: r.file_path
        });
      });
    }
    return local.sort((a, b) => b.savedAt - a.savedAt);
  }

  async function openConfirm(id) {
    let rec = null;
    try { rec = await confirms.one(id); } catch (e) { rec = null; }
    if (!rec || !rec.blob) {
      // รายการจากเครื่องอื่น: ดาวน์โหลดไฟล์จากเซิร์ฟเวอร์
      let r = null;
      try { r = (await listConfirms()).find(x => x.id === id) || null; } catch (e) { r = null; }
      if (r && r.remotePath) {
        try { r.blob = await downloadBlob(r.remotePath); rec = r; } catch (e) { rec = null; }
      }
    }
    if (!rec || !rec.blob) { toast('ไม่พบรายการที่บันทึกไว้', ''); renderConfirms(); return; }
    window.scanBrandMap = new Map(rec.brandMap || []);
    const file = new File([rec.blob], rec.name, { type: rec.type || rec.blob.type });
    await window.loadOrderCompareFile(file);
    confCurrentId = rec.id;
    renderConfirms();
    toast('เปิดรายการที่ยืนยันเมื่อ ' + fmtDate(rec.savedAt) + ' แล้ว', 'success');
  }

  async function renderConfirms() {
    if (!confPanel || !confList) return;
    let all = [];
    try { all = await listConfirms(); } catch (e) { all = []; }
    confList.textContent = '';
    confPanel.hidden = all.length === 0;
    if (!all.length) return;
    const frag = document.createDocumentFragment();
    all.forEach(rec => {
      const row = document.createElement('div');
      row.className = 'saved-file' + (rec.id === confCurrentId ? ' is-current' : '');
      const info = document.createElement('div');
      info.className = 'saved-file-info';
      const name = document.createElement('strong');
      name.textContent = 'ยืนยัน ' + fmtDate(rec.savedAt);
      name.title = rec.name;
      const meta = document.createElement('span');
      meta.textContent = rec.count.toLocaleString() + ' รายการ · รวม ' + (rec.qty || 0).toLocaleString() + ' ชิ้น';
      info.append(name, meta);

      const openBtn = document.createElement('button');
      openBtn.type = 'button';
      openBtn.className = 'saved-file-open';
      openBtn.textContent = rec.id === confCurrentId ? '✓ ใช้อยู่' : 'เปิด';
      openBtn.title = 'ใช้รายการนี้เป็น ไฟล์ที่ 1 — ORDER';
      openBtn.addEventListener('click', () => openConfirm(rec.id));

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'saved-file-del';
      delBtn.textContent = 'ลบ';
      delBtn.title = 'ลบรายการนี้';
      delBtn.addEventListener('click', async () => {
        try { await confirms.del(rec.id); } catch (e) { /* ไม่กระทบ */ }
        await rDelete('confirm', rec.id);
        if (confCurrentId === rec.id) confCurrentId = null;
        renderConfirms();
      });

      row.append(info, openBtn, delBtn);
      frag.appendChild(row);
    });
    confList.appendChild(frag);
  }

  if (confClear) {
    confClear.addEventListener('click', async () => {
      if (!confirm('ลบรายการที่ยืนยันไว้ทั้งหมด?')) return;
      try { await confirms.clear(); } catch (e) { /* ไม่กระทบ */ }
      await rClear('confirm');
      confCurrentId = null;
      renderConfirms();
    });
  }
  window.SavedConfirms = { save: saveConfirm, render: renderConfirms };
  renderConfirms();

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

  /* ------------------------------------------------------------------ */
  /* 4) ซิงค์กับเครื่องอื่น: ตอนโหลดหน้า / กลับมาที่แท็บ / ทุก 60 วินาที       */
  /*    แจ้ง savedprints:changed เฉพาะเมื่อรายการใบปริ้นเปลี่ยนจริง           */
  /*    (หน้า ตรวจใบปริ้น รีเซ็ตยอดที่นับไว้ทุกครั้งที่ได้รับเหตุการณ์นี้)       */
  /* ------------------------------------------------------------------ */
  let printSig = null;
  let syncing = false;
  async function syncRemote() {
    if (syncing || !sb()) return;
    syncing = true;
    try {
      await rPurge();
      invalidate();
      await Promise.all([renderFiles(), renderConfirms()]);
      const list = await listPrints();
      const sig = list.map(r => r.id + ':' + (r.pdf ? 1 : 0)).join('|');
      if (sig !== printSig) {
        const first = printSig === null;
        printSig = sig;
        if (!first || list.length) emitChange();
      }
    } catch (e) { /* ซิงค์ไม่ได้: ใช้ของในเครื่องต่อ */ }
    syncing = false;
  }
  window.addEventListener('load', () => setTimeout(syncRemote, 300));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncRemote(); });
  setInterval(() => { if (!document.hidden) syncRemote(); }, 60000);

  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ไม่กระทบ */ }
})();
