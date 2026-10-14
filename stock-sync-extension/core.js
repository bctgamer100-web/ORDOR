// ตรรกะอ่านไฟล์ + กรอง + ตรวจ + อัปโหลด (ไม่แตะ DOM) — โหลดใน background.js ผ่าน importScripts
// กติกาเดียวกับ js/sunshine.js (toStockRows / toFrontSaleRows) ถ้าแก้ที่นั่น ต้องแก้ที่นี่ด้วย
/* global XLSX, JSZip */
(function (G) {
  'use strict';

  const SUPABASE_URL = 'https://yvfqxlgkwaylivopctno.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_xNq2vHHwVe8v_rujH3P_QQ_ep6-g6ol'; // publishable เท่านั้น
  const UPLOAD_CHUNK = 5000;
  const PAGE_SIZE = 1000;
  const EXCLUDED_LOCATIONS = ['DELETE', 'ในบ้าน', 'X001'];

  const norm = function (v) { return String(v == null ? '' : v).trim(); };
  const num = function (v) {
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const fmt = function (n) { return Number(n).toLocaleString('th-TH'); };

  /* ---------- อ่านไฟล์ ---------- */

  // ไฟล์ export อาจระบุ <dimension ref="A1"/> ผิด ทำให้อ่านได้แค่ A1 — คำนวณขอบเขตจริงใหม่
  function fixSheetRef(ws) {
    let maxR = -1, maxC = -1;
    Object.keys(ws).forEach(function (k) {
      if (k.charAt(0) === '!') return;
      const c = XLSX.utils.decode_cell(k);
      if (c.r > maxR) maxR = c.r;
      if (c.c > maxC) maxC = c.c;
    });
    if (maxR >= 0) ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxR, c: maxC } });
  }

  function bytesToRows(bytes) {
    const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
    const name = wb.SheetNames.indexOf('ST') !== -1 ? 'ST' : wb.SheetNames[0];
    const ws = wb.Sheets[name];
    fixSheetRef(ws);
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  }

  // คืน [{ name, bytes }] (แตก zip ให้)
  async function expand(name, bytes) {
    if (/\.zip$/i.test(name) || (bytes[0] === 0x50 && bytes[1] === 0x4b && !/\.(xlsx|xls)$/i.test(name))) {
      const zip = await JSZip.loadAsync(bytes);
      const out = [];
      const names = Object.keys(zip.files).filter(function (n) {
        return !zip.files[n].dir && /\.(xlsx|xls|csv)$/i.test(n) && n.indexOf('__MACOSX') === -1;
      });
      for (const n of names) out.push({ name: n, bytes: await zip.files[n].async('uint8array') });
      return out;
    }
    return [{ name: name, bytes: bytes }];
  }

  function mergeTables(tables) {
    const headerOrder = [];
    const objs = [];
    tables.forEach(function (rows) {
      if (!rows || rows.length < 1) return;
      const header = rows[0].map(norm);
      header.forEach(function (h) { if (h && headerOrder.indexOf(h) === -1) headerOrder.push(h); });
      for (let i = 1; i < rows.length; i++) {
        const o = {};
        header.forEach(function (h, idx) { if (h) o[h] = rows[i][idx]; });
        objs.push(o);
      }
    });
    return { header: headerOrder, objs: objs };
  }

  function buildRows(m, st) {
    st.excludedLoc = 0; st.noSku = 0;
    const has = function (h) { return m.header.indexOf(h) !== -1; };
    const rename = function (from, to) {
      m.header = m.header.map(function (h) { return h === from ? to : h; });
      m.objs.forEach(function (o) { if (from in o) { o[to] = o[from]; delete o[from]; } });
    };
    if (!has('ชื่อSKU') && has('SKU Merchant')) rename('SKU Merchant', 'ชื่อSKU');
    if (!has('สต็อกที่มีอยู่ของตำแหน่ง') && has('จำนวน')) rename('จำนวน', 'สต็อกที่มีอยู่ของตำแหน่ง');
    const missing = ['ชื่อSKU', 'ตำแหน่ง', 'สต็อกที่มีอยู่ของตำแหน่ง'].filter(function (h) { return !has(h); });
    if (missing.length) throw new Error('ไฟล์ไม่มีคอลัมน์: ' + missing.join(', ') + ' (หัวที่พบ: ' + m.header.join(' | ') + ')');

    const stock = m.objs
      .filter(function (r) {
        const loc = norm(r['ตำแหน่ง']).toUpperCase();
        if (loc === '') return true;
        const keep = loc.indexOf('FRONT') !== 0 && EXCLUDED_LOCATIONS.indexOf(loc) === -1;
        if (!keep) st.excludedLoc++;
        return keep;
      })
      .map(function (r) {
        return { sku: norm(r['ชื่อSKU']), sku_name: norm(r['ชื่อ SKU']), location: norm(r['ตำแหน่ง']), qty: num(r['สต็อกที่มีอยู่ของตำแหน่ง']) };
      })
      .filter(function (r) { if (!r.sku) st.noSku++; return r.sku; });

    let front = [];
    if (has('สต็อกพร้อมขายของตำแหน่ง')) {
      const map = {};
      m.objs.forEach(function (r) {
        const loc = norm(r['ตำแหน่ง']).toUpperCase();
        if (loc.indexOf('FRONT') !== 0 && loc !== 'ในบ้าน') return;
        const sku = norm(r['ชื่อSKU']);
        if (!sku) return;
        map[sku] = (map[sku] || 0) + num(r['สต็อกพร้อมขายของตำแหน่ง']);
      });
      front = Object.keys(map).map(function (sku) { return { sku: sku, qty: map[sku] }; });
    }
    return { stock: stock, front: front };
  }

  /* ---------- Supabase REST ---------- */

  function hdr(extra) {
    return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
  }

  async function countStock() {
    const res = await fetch(SUPABASE_URL + '/rest/v1/op_stock?select=id', { headers: hdr({ Prefer: 'count=exact', Range: '0-0' }) });
    if (!res.ok) throw new Error('อ่านจำนวนแถว op_stock ไม่ได้ (' + res.status + ')');
    const m = /\/(\d+)$/.exec(res.headers.get('content-range') || '');
    return m ? Number(m[1]) : 0;
  }

  async function fetchAllStock() {
    const total = await countStock();
    let rows = [];
    for (let from = 0; from < total; from += PAGE_SIZE) {
      const res = await fetch(SUPABASE_URL + '/rest/v1/op_stock?select=sku,sku_name,location,qty&order=id', {
        headers: hdr({ Range: from + '-' + (from + PAGE_SIZE - 1) })
      });
      if (!res.ok) throw new Error('สำรองข้อมูลเดิมไม่สำเร็จ (' + res.status + ')');
      rows = rows.concat(await res.json());
    }
    return rows;
  }

  async function rpcUpload(target, rows, passcode, reset) {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/op_upload', {
      method: 'POST',
      headers: hdr({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ p_passcode: passcode, p_target: target, p_rows: rows, p_reset: reset })
    });
    if (!res.ok) {
      let msg = String(res.status);
      try { msg = (await res.json()).message || msg; } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
  }

  async function replaceTable(target, rows, passcode, label, onProgress) {
    for (let i = 0; i === 0 || i < rows.length; i += UPLOAD_CHUNK) {
      await rpcUpload(target, rows.slice(i, i + UPLOAD_CHUNK), passcode, i === 0);
      onProgress('กำลังอัปโหลด ' + label + ' ' + fmt(Math.min(i + UPLOAD_CHUNK, rows.length)) + '/' + fmt(rows.length) + ' แถว ...');
    }
  }

  /* ---------- เตรียม / ตรวจ ---------- */

  // files: [{ name, bytes:Uint8Array }]
  async function prepare(files) {
    const tables = [];
    for (const f of files) {
      const parts = await expand(f.name, f.bytes);
      parts.forEach(function (p) { tables.push(bytesToRows(p.bytes)); });
    }
    if (!tables.length) throw new Error('ไม่พบไฟล์ข้อมูล (.xlsx / .xls / .csv) ในสิ่งที่เลือก');
    const m = mergeTables(tables);
    const st = { files: tables.length, rowsIn: m.objs.length };
    const built = buildRows(m, st);
    let oldCount = null;
    try { oldCount = await countStock(); } catch (e) { oldCount = null; }
    return { stockRows: built.stock, frontRows: built.front, stats: st, oldCount: oldCount };
  }

  // opts: { maxDrop (%), force }
  function evaluate(prep, opts) {
    const items = [];
    const n = prep.stockRows.length;
    const old = prep.oldCount;
    items.push({ ok: n > 0, text: n > 0 ? 'มีแถวที่จะอัปโหลด ' + fmt(n) + ' แถว' : 'ไม่มีแถวที่อัปโหลดได้' });
    const skus = new Set(prep.stockRows.map(function (r) { return r.sku; })).size;
    items.push({ ok: skus > 0, text: 'จำนวน SKU ไม่ซ้ำ ' + fmt(skus) });
    const allZero = n > 0 && prep.stockRows.every(function (r) { return r.qty === 0; });
    items.push({ ok: !allZero, text: allZero ? 'จำนวนทุกแถวเป็น 0 (ไฟล์น่าจะผิด)' : 'มีแถวที่จำนวนมากกว่า 0' });
    if (old == null) {
      items.push({ ok: !!opts.force, text: 'อ่านจำนวนแถว op_stock เดิมไม่ได้ จึงเทียบไม่ได้ (ติ๊กยืนยันถ้าจะไปต่อ)' });
    } else if (old > 0) {
      const maxDrop = Math.max(0, Number(opts.maxDrop) || 0);
      const dropPct = ((old - n) / old) * 100;
      const okDrop = dropPct <= maxDrop || !!opts.force;
      items.push({
        ok: okDrop,
        text: dropPct > 0
          ? 'แถวลดลง ' + dropPct.toFixed(1) + '% จากเดิม ' + fmt(old) + ' (เกณฑ์ ' + maxDrop + '%)' + (okDrop ? '' : ' — เกินเกณฑ์ อาจเป็นไฟล์ไม่ครบ')
          : 'จำนวนแถวไม่ลดลงจากเดิม ' + fmt(old)
      });
    }
    return { ok: items.every(function (i) { return i.ok; }), items: items };
  }

  function summary(prep, opts) {
    return {
      stats: prep.stats,
      kept: prep.stockRows.length,
      front: prep.frontRows.length,
      oldCount: prep.oldCount,
      checks: evaluate(prep, opts),
      sample: prep.stockRows.slice(0, 8)
    };
  }

  async function upload(prep, opts, onProgress, onBackup) {
    const ev = evaluate(prep, opts);
    if (!ev.ok) throw new Error('ยังไม่ผ่านการตรวจ — ดูรายการตรวจ หรือติ๊กยืนยันถ้าแน่ใจ');
    const pass = opts.passcode || '';
    if (opts.backup && prep.oldCount) {
      onProgress('กำลังสำรอง op_stock เดิม ...');
      await onBackup(JSON.stringify(await fetchAllStock())); // สำรองให้เสร็จก่อนเขียนทับ
    }
    await replaceTable('stock', prep.stockRows, pass, 'op_stock', onProgress);
    let msg = 'อัปโหลดสำเร็จ: op_stock ' + fmt(prep.stockRows.length) + ' แถว';
    if (prep.frontRows.length) {
      await replaceTable('frontsale', prep.frontRows, pass, 'op_front_sale', onProgress);
      msg += ' | ขาย (หน้าร้าน) ' + fmt(prep.frontRows.length) + ' แถว';
    }
    prep.oldCount = prep.stockRows.length;
    return { message: msg };
  }

  G.StockCore = { prepare: prepare, summary: summary, upload: upload };
})(self);
