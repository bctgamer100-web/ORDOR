/* ===== Sunshine — ระบบจัดออเดอร์และโลเคชั่น (รวมเข้ากับ ORDER Workspace) =====
   ย้ายมาจากไฟล์ script.js เดิมของ Sunshine โดยคงตรรกะการคำนวณ/การอัปโหลดทั้งหมดไว้
   - ห่อทุกอย่างไว้ใน IIFE ไม่ประกาศตัวแปร/ฟังก์ชันระดับ global เพื่อไม่ชนกับ app.js
   - ทุก id ขึ้นต้นด้วย "sun" และทุก class ขึ้นต้นด้วย "sun-" (สไตล์อยู่ใน css/sunshine.css)
   - ไม่ใช้ inline onclick: ใช้ event delegation แทน
   - โหลดข้อมูลจาก Supabase ตอนเปิดแท็บ Sunshine ครั้งแรกเท่านั้น (ไม่ยิงเน็ตตอนเปิดเว็บ) */
(function () {
  'use strict';

  const root = document.getElementById('sunTool');
  if (!root) return;

  // ค่าจาก Supabase > Project Settings > API (ใช้ publishable/anon key เท่านั้น ห้ามใช้ service_role)
  const SUPABASE_URL = 'https://dsekvvygczrvvwnnrkuy.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_boz7aOGbmjTHyPwsKhJl0Q_W41e5RXl';
  let sbClient = null;
  function sb() {
    if (sbClient) return sbClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('โหลดไลบรารี Supabase ไม่สำเร็จ (ต้องเชื่อมต่ออินเทอร์เน็ต)');
    }
    sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    return sbClient;
  }

  const PAGE_SIZE = 1000;    // PostgREST คืนได้ไม่เกิน 1000 แถวต่อคำขอ ต้องแบ่งหน้าอ่าน
  const UPLOAD_CHUNK = 5000; // แบ่งส่งทีละก้อน กัน statement timeout ของ Supabase

  // กรองยอดขาย 3M ให้เหมือนที่ Apps Script เคยทำ
  const HARD_SKIP_STATUS = ['cancelled', 'canceled', 'ยกเลิก'];
  const HISTORY_CANCEL_SKIP_REASONS = ['เหตุผลอื่น', 'เหตุผลเปลี่ยนใจ'];
  const SI_KEEP_TYPE = 'Stock-In / Manual Stock-In';

  const CFG = { HIST_DAYS: 90, LEAD_DAYS: 7, SAFETY_DAYS: 7, CYCLE_DAYS: 14, FRONT_DAYS: 3 };

  // ตำแหน่งที่ไม่มีอยู่จริง/ถูกยกเลิก ไม่นับเป็นสต๊อกเลยไม่ว่าหน้าไหน
  const EXCLUDED_LOCATIONS = ['DELETE', 'ในบ้าน'];

  let CACHE = null;
  let currentMode = 'purchase';
  let uploadPasscode = ''; // รหัสอัปโหลด (จำเฉพาะในหน้านี้)
  let started = false;
  let PENDING_CHECKLIST = { title: '', items: [] };
  let LOAD_TOKEN = 0; // เพิ่มทุกครั้งที่เปลี่ยนหน้า ใช้กันคำขอเก่าเขียนทับคำขอใหม่
  let SEARCH_DEBOUNCE_TIMER = null;

  const MODE_TITLES = {
    purchase: 'ใบสั่งซื้อล่วงหน้า',
    best: 'สินค้าขายดี ABC',
    stockin: 'ประวัติเคลื่อนไหวสต๊อก'
  };

  const $ = id => document.getElementById(id);

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function setStatus(msg) {
    const el = $('sunStatus');
    if (el) el.textContent = msg;
  }

  /* ---------------------------------------------------------------- */
  /* อ่านข้อมูลจาก Supabase                                            */
  /* ---------------------------------------------------------------- */

  // อ่านทุกแถวของตาราง (แบ่งหน้าละ 1000) — ขอหน้าแรกพร้อมนับจำนวน แล้วยิงหน้าที่เหลือพร้อมกัน
  async function fetchAllRows(tableName, columns, orderCol) {
    const client = sb();
    const first = await client.from(tableName).select(columns, { count: 'exact' })
      .order(orderCol).range(0, PAGE_SIZE - 1);
    if (first.error) throw new Error(tableName + ': ' + first.error.message);

    const total = first.count || 0;
    const reqs = [];
    for (let from = PAGE_SIZE; from < total; from += PAGE_SIZE) {
      reqs.push(client.from(tableName).select(columns).order(orderCol).range(from, from + PAGE_SIZE - 1));
    }
    const pages = await Promise.all(reqs);
    let rows = first.data || [];
    pages.forEach(function (p) {
      if (p.error) throw new Error(tableName + ': ' + p.error.message);
      rows = rows.concat(p.data || []);
    });
    return rows;
  }

  // โหลดข้อมูลทั้งหมดแล้วแปลงกลับเป็นรูปแบบเดียวกับชีตเดิม (คีย์ภาษาไทย)
  async function loadAllFromSupabase() {
    const results = await Promise.all([
      fetchAllRows('op_sales', 'sku,qty', 'sku'),
      fetchAllRows('op_stock', 'sku,sku_name,location,qty', 'id'),
      fetchAllRows('op_stock_moves', 'sku,sku_name,moved_at,location,move,type', 'id'),
      // products เป็นตารางกลางที่โปรเจกต์อื่นใช้ด้วย — อ่านอย่างเดียว ถ้าอ่านไม่ได้ก็ยังใช้งานหน้าอื่นต่อได้
      fetchAllRows('products', 'sku_merchant,brand', 'id').catch(function (err) {
        console.warn('อ่านตาราง products ไม่ได้:', err);
        return [];
      })
    ]);

    return {
      '3M': results[0].map(function (r) { return { 'SKU Merchant': r.sku, 'จำนวน': r.qty }; }),
      'ST': results[1].map(function (r) {
        return { 'ชื่อSKU': r.sku, 'ชื่อ SKU': r.sku_name, 'ตำแหน่ง': r.location, 'สต็อกที่มีอยู่ของตำแหน่ง': r.qty };
      }),
      'SI': results[2].map(function (r) {
        return { 'ชื่อSKU': r.sku, 'ชื่อ SKU': r.sku_name, 'เวลา': r.moved_at, 'ตำแหน่ง': r.location, 'เคลื่อนไหว': r.move, 'ประเภท': r.type };
      }),
      'BRAND': results[3]
    };
  }

  /* ---------------------------------------------------------------- */
  /* คำนวณ                                                             */
  /* ---------------------------------------------------------------- */

  function norm(v) { return String(v == null ? '' : v).trim(); }

  function num(v) {
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function zoneOf(loc) {
    const l = norm(loc).toUpperCase();
    if (l.indexOf('FRONT') === 0) return 'F';
    if (l.indexOf('KT-') === 0) return 'K';
    return 'Y';
  }

  function buildStock(st) {
    const m = {};
    st.forEach(function (r) {
      const sku = norm(r['ชื่อSKU']);
      if (!sku) return;
      const loc = norm(r['ตำแหน่ง']) || '-';
      if (EXCLUDED_LOCATIONS.indexOf(loc.toUpperCase()) !== -1) return; // ตำแหน่งที่ถูกยกเลิก/ลบ ไม่นับเป็นสต๊อกที่หยิบได้
      const qty = num(r['สต็อกที่มีอยู่ของตำแหน่ง']);
      const zone = zoneOf(loc);
      if (!m[sku]) m[sku] = { F: 0, K: 0, Y: 0, total: 0, locs: [] };
      m[sku][zone] += qty;
      m[sku].total += qty;
      if (qty > 0) m[sku].locs.push({ loc: loc, qty: qty, zone: zone });
    });

    Object.keys(m).forEach(function (k) {
      m[k].locs.sort(function (a, b) {
        const fa = a.zone === 'F' ? 0 : 1;
        const fb = b.zone === 'F' ? 0 : 1;
        return fa - fb || a.loc.localeCompare(b.loc);
      });
    });
    return m;
  }

  // 3M ถูกสรุปยอดต่อ SKU มาแล้ว (การกรองยกเลิกทำไปแล้วตอนอัปโหลด) ที่นี่แค่รวมเป็น map
  function buildVelocity(hist) {
    const v = {};
    (hist || []).forEach(function (r) {
      const sku = norm(r['SKU Merchant']);
      if (!sku) return;
      v[sku] = (v[sku] || 0) + num(r['จำนวน']);
    });
    return v;
  }

  // ชื่อสินค้าไว้ค้นหา/กรอง: ใช้ชีต ST ก่อน ถ้าไม่มีค่อยเติมจากฐานข้อมูลแบรนด์กลาง (products)
  function buildSkuNameMap(st, brandMap) {
    const map = {};
    (st || []).forEach(function (r) {
      const sku = norm(r['ชื่อSKU']);
      if (!sku || map[sku]) return;
      const name = norm(r['ชื่อ SKU']);
      if (name) map[sku] = name;
    });
    Object.keys(brandMap || {}).forEach(function (sku) {
      if (!map[sku]) map[sku] = brandMap[sku];
    });
    return map;
  }

  function buildBrandMap(brandRows) {
    const map = {};
    (brandRows || []).forEach(function (r) {
      const sku = norm(r.sku_merchant);
      if (!sku) return;
      const brand = norm(r.brand);
      if (brand) map[sku] = brand;
    });
    return map;
  }

  // รวมยอด "เคลื่อนไหว" (สต๊อกรับเข้าล่าสุด) ต่อ SKU จากชีต SI
  function buildMovementMap(si) {
    const map = {};
    (si || []).forEach(function (r) {
      const sku = norm(r['ชื่อSKU']);
      if (!sku) return;
      map[sku] = (map[sku] || 0) + num(r['เคลื่อนไหว']);
    });
    return map;
  }

  function gradeList(list, key) {
    list.sort(function (a, b) { return b[key] - a[key]; });
    const total = list.reduce(function (s, x) { return s + x[key]; }, 0) || 1;
    let acc = 0;
    list.forEach(function (i) {
      acc += i[key];
      i.cum = (acc / total) * 100;
      i.grade = i.cum <= 80 ? 'A' : i.cum <= 95 ? 'B' : 'C';
    });
    return list;
  }

  /* ---------------------------------------------------------------- */
  /* ส่วนประกอบหน้าจอ                                                   */
  /* ---------------------------------------------------------------- */

  function cards(items) {
    let h = '<div class="sun-summary">';
    items.forEach(function (c) {
      h += '<div class="sun-card ' + esc(c.type || '') + '"><div class="sun-card-label">' + esc(c.label) +
        '</div><div class="sun-card-value">' + esc(c.value) + '</div></div>';
    });
    return h + '</div>';
  }

  /* ---- ตารางแบบแบ่งโหลด ----
     ตารางมีได้หลายหมื่นแถว (เช่น 27,000+ SKU) ถ้าสร้างเป็น DOM ทั้งหมดหน้าจะหน่วง
     จึงเก็บข้อมูลทุกแถวในหน่วยความจำ (VIEW.rows) แล้ววาดเฉพาะส่วนที่มองเห็น
     เลื่อนลงถึงท้ายตารางจะโหลดเพิ่มทีละก้อน การกรอง/เรียง/ค้นหา/ส่งออก/พิมพ์ ทำกับข้อมูลทั้งหมด */
  const PAGE_ROWS = 300;
  let VIEW = null; // { head, sortTypes, rows, shown, limit }
  let TABLE_SORT = { col: null, dir: 1 };

  // เซลล์: v = ค่าจริง (ไว้เรียง/ส่งออก), cls = class, h = HTML แทนการแสดงผล (ถ้าไม่ใส่ใช้ v)
  function cell(v, cls, h) { return { v: v, cls: cls || '', h: h }; }

  // แถว: cells = [cell], meta = { cls, brand, grade, rec, search }
  function mkRow(cells, meta) {
    meta = meta || {};
    return { cells: cells, cls: meta.cls || '', brand: meta.brand || '', grade: meta.grade || '', rec: meta.rec || '', search: meta.search || '', urgent: !!meta.urgent, order: meta.order || 0, sku: meta.sku || '' };
  }

  function rowHtml(r) {
    let h = '<tr' + (r.cls ? ' class="' + r.cls + '"' : '') + '>';
    for (let i = 0; i < r.cells.length; i++) {
      const c = r.cells[i];
      h += '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + (c.h !== undefined ? c.h : esc(c.v)) + '</td>';
    }
    return h + '</tr>';
  }

  // sortTypes: array ขนานกับ head เช่น ["text","number",null,...] — null/ไม่ใส่ = คอลัมน์นั้นกดเรียงไม่ได้
  function setView(head, sortTypes, rows) {
    VIEW = { head: head, sortTypes: sortTypes || [], rows: rows, shown: rows, limit: PAGE_ROWS };
    TABLE_SORT = { col: null, dir: 1 };
  }

  function tableShell() {
    const ths = VIEW.head.map(function (h, idx) {
      const type = VIEW.sortTypes[idx];
      if (!type) return '<th>' + esc(h) + '</th>';
      return '<th class="sun-sortable" data-sun-sort="' + idx + '" data-sun-type="' + type + '">' +
        esc(h) + ' <span class="sun-sort-ic" data-sortic="' + idx + '"></span></th>';
    }).join('');
    return '<div class="sun-tablewrap"><table class="sun-table"><thead><tr>' + ths +
      '</tr></thead><tbody id="sunTbody"></tbody></table></div><div class="sun-more" id="sunMore"></div>';
  }

  // วางตารางลงหน้าจอ (ต่อจาก HTML ส่วนหัวที่ส่งมา) แล้ววาดแถวแรก
  function mountView(topHtml) {
    $('sunOutput').innerHTML = topHtml + tableShell();
    const wrap = root.querySelector('.sun-tablewrap');
    if (wrap) wrap.addEventListener('scroll', onTableScroll, { passive: true });
    applyView(true);
  }

  function updateMoreInfo() {
    const el = $('sunMore');
    if (!el || !VIEW) return;
    const total = VIEW.shown.length;
    const shown = Math.min(VIEW.limit, total);
    el.textContent = total === 0
      ? 'ไม่พบรายการ'
      : 'แสดง ' + shown.toLocaleString() + ' จาก ' + total.toLocaleString() + ' รายการ' +
        (shown < total ? ' — เลื่อนลงเพื่อโหลดเพิ่ม' : '');
  }
  function paintRows() {
    const tbody = $('sunTbody');
    if (!tbody || !VIEW) return;
    tbody.innerHTML = VIEW.shown.slice(0, VIEW.limit).map(rowHtml).join('');
    root.querySelectorAll('[data-sortic]').forEach(function (el) { el.textContent = ''; });
    if (TABLE_SORT.col !== null) {
      const ic = root.querySelector('[data-sortic="' + TABLE_SORT.col + '"]');
      if (ic) ic.textContent = TABLE_SORT.dir > 0 ? '▲' : '▼';
    }
    updateMoreInfo();
  }

  function onTableScroll(e) {
    const wrap = e.currentTarget;
    if (!VIEW || VIEW.limit >= VIEW.shown.length) return;
    if (wrap.scrollTop + wrap.clientHeight < wrap.scrollHeight - 240) return;
    const from = VIEW.limit;
    VIEW.limit = Math.min(VIEW.shown.length, VIEW.limit + PAGE_ROWS);
    $('sunTbody').insertAdjacentHTML('beforeend', VIEW.shown.slice(from, VIEW.limit).map(rowHtml).join(''));
    updateMoreInfo();
  }

  function sortKey(cellObj, type) {
    const s = String(cellObj.v == null ? '' : cellObj.v).trim();
    return type === 'number' ? (parseFloat(s.replace(/[^0-9.\-]/g, '')) || 0) : s;
  }

  // กรอง (ค้นหา + แบรนด์ + เกรด + คำแนะนำ) แล้วเรียง จากข้อมูลทั้งหมด จากนั้นวาดเฉพาะก้อนแรก
  function applyView(resetLimit) {
    if (!VIEW) return;
    const searchEl = $('sunSearch');
    const query = searchEl ? searchEl.value.toLowerCase() : '';
    const brands = getMultiselectValues('purchBrand').map(function (b) { return b.toUpperCase(); });
    const grades = getMultiselectValues('purchGrade');
    const recs = getMultiselectValues('purchRec');

    let list = VIEW.rows;
    if (query || brands.length || grades.length || recs.length) {
      list = list.filter(function (r) {
        if (brands.length && !brands.some(function (b) { return r.brand.indexOf(b) > -1; })) return false;
        if (grades.length && grades.indexOf(r.grade) === -1) return false;
        if (recs.length && recs.indexOf(r.rec) === -1) return false;
        return !query || r.search.indexOf(query) > -1;
      });
    }

    if (TABLE_SORT.col !== null) {
      const col = TABLE_SORT.col, dir = TABLE_SORT.dir, type = VIEW.sortTypes[col];
      const keyed = list.map(function (r, i) { return { r: r, i: i, k: sortKey(r.cells[col], type) }; });
      keyed.sort(function (a, b) {
        const d = type === 'number' ? (a.k - b.k) : a.k.localeCompare(b.k, 'th');
        return d * dir || a.i - b.i;
      });
      list = keyed.map(function (x) { return x.r; });
    }

    VIEW.shown = list;
    if (resetLimit) VIEW.limit = PAGE_ROWS;
    paintRows();
    const wrap = root.querySelector('.sun-tablewrap');
    if (wrap && resetLimit) wrap.scrollTop = 0;
  }

  // เรียงลำดับตามคอลัมน์ที่กด (คลิกซ้ำ = สลับ น้อย-มาก / มาก-น้อย)
  function sortTable(colIndex) {
    if (!VIEW) return;
    TABLE_SORT.dir = (TABLE_SORT.col === colIndex) ? -TABLE_SORT.dir : 1;
    TABLE_SORT.col = colIndex;
    applyView(true);
  }

  /* ---------------------------------------------------------------- */
  /* พิมพ์                                                             */
  /* ---------------------------------------------------------------- */

  // เก็บ checklist ที่ "จะพิมพ์" ไว้เฉยๆ รอจนกดปุ่มพิมพ์จริงค่อยสร้างใบ
  function setPendingChecklist(title, items) {
    PENDING_CHECKLIST = { title: title, items: items || [] };
  }

  const PRINT_CSS =
    '@page{margin:12mm}' +
    'body{font-family:"Noto Sans Thai","Prompt","Segoe UI",Tahoma,sans-serif;color:#000;margin:0}' +
    '.print-title{font-size:16px;font-weight:700}.print-meta{font-size:11px;color:#444;margin:2px 0 12px}' +
    '.print-cols{column-count:3;column-gap:22px}' +
    '.print-item{display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #ccc;break-inside:avoid;font-size:11.5px}' +
    '.pc-sku{flex:1;font-weight:600;word-break:break-all}' +
    '.pc-qty{min-width:20px;text-align:center;border:1px solid #333;border-radius:3px;padding:1px 4px;font-weight:700}' +
    '.pc-box{width:35px;height:20px;border:1.5px solid #333;border-radius:3px;flex-shrink:0}' +
    'table{border-collapse:collapse;width:100%;font-size:11px}' +
    'th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}' +
    'th{background:#ddd;color:#000}.sun-num{text-align:right}';

  // สร้าง checklist สำหรับตอนพิมพ์: SKU + จำนวน + ช่องติ๊ก เรียง 3 คอลัมน์
  function buildPrintChecklistHtml(title, items) {
    const totalQty = items.reduce(function (s, it) { return s + it.qty; }, 0);
    const now = new Date().toLocaleString('th-TH', { hour12: false });
    let html = '<div class="print-title">' + esc(title) + '</div>' +
      '<div class="print-meta">พิมพ์เมื่อ ' + esc(now) + ' • ' + items.length + ' SKU • รวม ' + totalQty + ' ชิ้น</div>' +
      '<div class="print-cols">';
    items.forEach(function (it) {
      html += '<div class="print-item"><span class="pc-sku">' + esc(it.sku) + '</span>' +
        '<span class="pc-qty">' + esc(it.qty) + '</span><span class="pc-box"></span></div>';
    });
    return html + '</div>';
  }

  // พิมพ์ผ่าน iframe ซ่อน ไม่ไปยุ่งกับสไตล์การพิมพ์ของหน้าหลัก
  function printHtml(bodyHtml) {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0';
    document.body.appendChild(frame);
    const doc = frame.contentWindow.document;
    doc.open();
    doc.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Sunshine</title><style>' +
      PRINT_CSS + '</style></head><body>' + bodyHtml + '</body></html>');
    doc.close();
    setTimeout(function () {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (e) { console.error(e); }
      setTimeout(function () { frame.remove(); }, 2000);
    }, 250);
  }

  // พิมพ์ตามตัวกรองด้านบน (แบรนด์/เกรด/คำแนะนำ/ค้นหา):
  //  - ใบสั่งซื้อล่วงหน้า = ใบเช็คลิสต์ 3 คอลัมน์ (SKU + จำนวนสั่งเพิ่ม + ช่องติ๊ก) เฉพาะ SKU ที่ถึงจุดสั่งซื้อและสั่งเพิ่มมากกว่า 0
  //  - หน้าอื่น = พิมพ์ตารางตามที่แสดง
  function handlePrint() {
    if (!VIEW || !VIEW.shown.length) { alert('ยังไม่มีข้อมูลให้พิมพ์'); return; }

    if (currentMode === 'purchase') {
      const items = VIEW.shown
        .filter(function (r) { return r.urgent && r.order > 0; })
        .map(function (r) { return { sku: r.sku, qty: r.order }; })
        .sort(function (a, b) { return a.sku.localeCompare(b.sku); });
      if (!items.length) { alert('ไม่มี SKU ที่ต้องสั่งเพิ่มในตัวกรองนี้'); return; }
      printHtml(buildPrintChecklistHtml('ใบสั่งซื้อล่วงหน้า', items));
      return;
    }

    const rows = VIEW.shown;
    if (rows.length > 2000 && !confirm('จะพิมพ์ ' + rows.length.toLocaleString() + ' แถว (ยาวหลายหน้า) ต้องการพิมพ์ต่อไหม?')) return;
    let h = '<table><thead><tr>' + VIEW.head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr>' + r.cells.map(function (c, i) {
        return '<td' + (VIEW.sortTypes[i] === 'number' ? ' class="sun-num"' : '') + '>' + esc(c.v) + '</td>';
      }).join('') + '</tr>';
    });
    const now = new Date().toLocaleString('th-TH', { hour12: false });
    printHtml('<div class="print-title">' + esc(MODE_TITLES[currentMode] || '') + '</div>' +
      '<div class="print-meta">พิมพ์เมื่อ ' + esc(now) + ' • ' + rows.length.toLocaleString() + ' รายการ</div>' + h + '</tbody></table>');
  }
  /* ---------------------------------------------------------------- */
  /* โหลด/สลับหน้า                                                      */
  /* ---------------------------------------------------------------- */

  async function loadData(mode) {
    const token = ++LOAD_TOKEN;
    const out = $('sunOutput');
    out.innerHTML = '<p class="sun-hint">กำลังโหลดข้อมูล...</p>';
    setStatus('กำลังโหลด...');
    try {
      if (!CACHE) {
        const data = await loadAllFromSupabase();
        if (token !== LOAD_TOKEN) return;
        CACHE = data;
      }
      if (token !== LOAD_TOKEN) return;

      const st = CACHE['ST'] || [];
      const hist = CACHE['3M'] || [];
      const brandMap = buildBrandMap(CACHE['BRAND']);
      const skuNames = buildSkuNameMap(st, brandMap);
      const moveMap = buildMovementMap(CACHE['SI']);

      if (mode === 'purchase') renderPurchase(hist, st, skuNames, moveMap);
      else if (mode === 'stockin') renderStockIn(CACHE['SI']);
      else renderBestSellers(hist, skuNames);

      setStatus('อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH'));
    } catch (err) {
      if (token !== LOAD_TOKEN) return;
      out.innerHTML = '<div class="sun-err">เกิดข้อผิดพลาด: ' + esc(err.message) +
        '<br>ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต และว่ารัน supabase/op_setup.sql แล้ว</div>';
      setStatus('ผิดพลาด');
    }
  }

  function refresh() {
    CACHE = null;
    loadData(currentMode);
  }

  function setMode(mode) {
    if (!MODE_TITLES[mode]) mode = 'purchase';
    currentMode = mode;
    started = true;
    const search = $('sunSearch');
    if (search) search.value = '';
    loadData(mode);
  }

  // หน้าใบสั่งซื้อ: true = โชว์ทุก SKU ใน products, false = เฉพาะตัวที่ถึงจุดสั่งซื้อ
  let PURCHASE_SHOW_ALL = true;

  function renderPurchase(hist, st, skuNames, moveMap) {
    const stock = buildStock(st);
    const vel = buildVelocity(hist);
    const th = getBestThresholds(); // ใช้เกณฑ์เดียวกับหน้าสินค้าขายดี ABC ไม่ต้องตั้งซ้ำ

    // SKU ทั้งหมด = ทุกตัวใน products (+ ชื่อจาก ST) รวมกับตัวที่มียอดขาย — ตัวที่ไม่มียอดขายจะได้ยอด 0
    const allSkus = Object.keys(Object.assign({}, skuNames, vel));

    let list = allSkus.map(function (sku) {
      const s = stock[sku] || { F: 0, K: 0, Y: 0, total: 0 };
      const sold = vel[sku] || 0;
      // สต๊อก FRONT ต้องปริ้นใบไปเช็คนับจริงก่อนถึงจะเชื่อได้ ไม่เอามารวมคำนวณสั่งซื้อ
      const verified = s.K + s.Y;
      const ads = sold / CFG.HIST_DAYS;
      const cover = ads > 0 ? verified / ads : 9999;
      const rop = ads * (CFG.LEAD_DAYS + CFG.SAFETY_DAYS);
      return {
        sku: sku, sold: sold, ads: ads, F: s.F, K: s.K, Y: s.Y,
        total: s.total, verified: verified, cover: cover, rop: rop,
        move: (moveMap && moveMap[sku]) || 0,
        order: Math.max(0, sold - verified - ((moveMap && moveMap[sku]) || 0)) // สั่งเพิ่ม = ยอดขาย 3 เดือน - คลัง - เคลื่อนไหว
      };
    });

    list = gradeList(list, 'sold');

    const isUrgent = function (i) { return i.ads > 0 && i.verified <= i.rop; };
    const urgent = list.filter(isUrgent).sort(function (a, b) { return a.cover - b.cover; });

    // โหมด "ทั้งหมด": ตัวที่ต้องสั่งขึ้นก่อน ตามด้วย SKU ที่เหลือทั้งหมดใน products เรียงตามยอดขาย
    const rows = PURCHASE_SHOW_ALL
      ? urgent.concat(list.filter(function (i) { return !isUrgent(i); }))
      : urgent;

    const BRANDS = ['WARRIX', 'GRAND', 'FLY HAWK', 'CADENZA', 'PEGAN', 'BCS', 'IMANE', 'H3', 'EGO'];

    const viewRows = rows.map(function (i) {
      const name = skuNames[i.sku] || '-';
      const rec = bestRecommend(i.sold, th.a, th.b);
      const moveCls = i.move > 0 ? 'sun-good' : (i.move < 0 ? 'sun-warn' : '');
      const moveTxt = (i.move > 0 ? '+' : '') + i.move;
      return mkRow([
        cell(i.grade, 'sun-g' + i.grade),
        cell(i.sku),
        cell(name),
        cell(i.sold, 'sun-num'),
        cell((i.ads * 30).toFixed(1), 'sun-num'),
        cell(i.ads.toFixed(2), 'sun-num'),
        cell(i.verified, 'sun-num', '<b>' + esc(i.verified) + '</b>'),
        cell(moveTxt, 'sun-num ' + moveCls),
        cell(i.order, 'sun-num', '<b>' + esc(i.order) + '</b>'),
        cell(rec.label, 'sun-' + rec.cls)
      ], {
        cls: i.cover <= CFG.LEAD_DAYS ? 'sun-row-warn' : '',
        brand: name.toUpperCase(), grade: i.grade, rec: rec.cls,
        urgent: isUrgent(i), order: i.order, sku: i.sku,
        search: (i.sku + ' ' + name).toLowerCase()
      });
    });

    const filterBarHtml =
      '<div class="sun-thresh-bar">' +
        '<label><input type="checkbox" id="sunPurchShowAll"' + (PURCHASE_SHOW_ALL ? ' checked' : '') +
          '> แสดง SKU ทั้งหมดตาม products (' + rows.length + ' รายการ)</label>' +
        buildMultiselect('purchBrand', 'แบรนด์', BRANDS.map(function (b) { return { value: b, text: b }; })) +
        buildMultiselect('purchGrade', 'เกรด', [
          { value: 'A', text: 'A' }, { value: 'B', text: 'B' }, { value: 'C', text: 'C' }
        ]) +
        buildMultiselect('purchRec', 'คำแนะนำ', [
          { value: 'rec-none', text: 'ขายไม่ดี' },
          { value: 'rec-good', text: 'ขายดี' },
          { value: 'rec-stock', text: 'ควรสต็อก' }
        ]) +
      '</div>';

    setView(['เกรด', 'SKU', 'ชื่อสินค้า', 'ขาย 3 ด.', 'ขาย/เดือน', 'ขาย/วัน', 'คลัง', 'เคลื่อนไหว', 'สั่งเพิ่ม', 'คำแนะนำ'],
      ['text', 'text', 'text', 'number', 'number', 'number', 'number', 'number', 'number', 'text'], viewRows);
    mountView(filterBarHtml);

    const checklistItems = urgent
      .filter(function (i) { return i.order > 0; })
      .map(function (i) { return { sku: i.sku, qty: i.order }; })
      .sort(function (a, b) { return a.sku.localeCompare(b.sku); });
    setPendingChecklist('ใบสั่งซื้อล่วงหน้า', checklistItems);
  }

  /* ---------------------------------------------------------------- */
  /* ตัวกรองแบบ dropdown ติ๊กเลือกหลายตัว                                  */
  /* ---------------------------------------------------------------- */

  // options: [{value, text}]  ไม่ติ๊กอะไรเลย = ถือว่า "ทั้งหมด" ไม่กรองด้วยตัวนี้
  function buildMultiselect(id, label, options) {
    const opts = options.map(function (o) {
      return '<label class="sun-ms-option"><input type="checkbox" value="' + esc(o.value) + '"> ' + esc(o.text) + '</label>';
    }).join('');

    return '<div class="sun-ms" id="sun_' + id + 'Wrap">' +
      '<button type="button" class="sun-ms-btn" id="sun_' + id + 'Btn" data-ms="' + id + '">' +
        esc(label) + ': ทั้งหมด <span class="sun-ms-caret">▾</span>' +
      '</button>' +
      '<div class="sun-ms-panel" id="sun_' + id + 'Panel" data-ms-label="' + esc(label) + '">' + opts + '</div>' +
    '</div>';
  }

  // เปิด/ปิดแผงตัวเลือก ปิดแผงอื่นที่เปิดค้างอยู่ก่อนเสมอ (เปิดได้ทีละอัน)
  function toggleMultiselect(id) {
    const panel = $('sun_' + id + 'Panel');
    if (!panel) return;
    const willOpen = !panel.classList.contains('open');
    root.querySelectorAll('.sun-ms-panel.open').forEach(function (p) { p.classList.remove('open'); });
    if (willOpen) panel.classList.add('open');
  }

  function getMultiselectChecked(id) {
    const panel = $('sun_' + id + 'Panel');
    if (!panel) return [];
    return Array.prototype.filter.call(panel.querySelectorAll('input[type=checkbox]'), function (cb) { return cb.checked; });
  }

  function getMultiselectValues(id) {
    return getMultiselectChecked(id).map(function (cb) { return cb.value; });
  }

  // อัปเดตข้อความบนปุ่มให้โชว์ว่าติ๊กอะไรอยู่บ้าง (ไม่เกิน 2 ชื่อ ถ้าเกินให้โชว์เป็นจำนวนแทน)
  function updateMultiselectLabel(id, label) {
    const checked = getMultiselectChecked(id);
    const btn = $('sun_' + id + 'Btn');
    if (!btn) return;
    const caret = '<span class="sun-ms-caret">▾</span>';
    if (checked.length === 0) {
      btn.innerHTML = esc(label) + ': ทั้งหมด ' + caret;
    } else if (checked.length <= 2) {
      const texts = checked.map(function (cb) { return cb.closest('label').textContent.trim(); });
      btn.innerHTML = esc(label) + ': ' + esc(texts.join(', ')) + ' ' + caret;
    } else {
      btn.innerHTML = esc(label) + ' (' + checked.length + ' รายการ) ' + caret;
    }
  }

  // รวมทุกเงื่อนไข: ช่องค้นหา + แบรนด์ + เกรด + คำแนะนำ ต้องผ่านทุกเงื่อนไขถึงจะโชว์แถวนั้น
  // (ภายในหมวดเดียวกัน เช่นติ๊กหลายแบรนด์ ผ่านแบรนด์ใดแบรนด์หนึ่งพอ)
  function applyAllFilters() {
    applyView(true);
  }

  /* ---------------------------------------------------------------- */
  /* สินค้าขายดี ABC                                                    */
  /* ---------------------------------------------------------------- */

  // อ่าน/บันทึกเกณฑ์ A,B (จำนวนชิ้นที่ขายได้) ไว้ในเบราว์เซอร์ ไม่ต้องกรอกใหม่ทุกครั้ง
  function getBestThresholds() {
    let a = 14, b = 29; // ค่าเริ่มต้น: C = ขายได้ไม่เกิน 14, A = ตั้งแต่ 29 ขึ้นไป, B = 15–28
    try {
      const sa = localStorage.getItem('bestThreshA');
      const sbv = localStorage.getItem('bestThreshB');
      if (sa !== null) a = Number(sa);
      if (sbv !== null) b = Number(sbv);
    } catch (e) { /* ไม่มี localStorage ก็ใช้ค่าเริ่มต้น */ }
    if (isNaN(a) || a < 0) a = 14;
    if (isNaN(b) || b < 0) b = 29;
    return { a: a, b: b };
  }

  function applyBestThresholds() {
    let a = Number($('sunThreshA').value);
    let b = Number($('sunThreshB').value);
    if (isNaN(a) || isNaN(b) || a < 0 || b < 0) {
      alert('กรุณากรอกตัวเลขให้ถูกต้อง');
      return;
    }
    if (a > b) { const t = a; a = b; b = t; } // สลับให้ A น้อยกว่า B เสมอ
    try {
      localStorage.setItem('bestThreshA', String(a));
      localStorage.setItem('bestThreshB', String(b));
    } catch (e) { /* บันทึกไม่ได้ก็ยังใช้งานรอบนี้ได้ปกติ */ }
    loadData('best');
  }

  // ขายไม่ดี (เกรด C) = ไม่เกิน a | ควรสต็อก (เกรด A) = ตั้งแต่ b ขึ้นไป | ขายดี (เกรด B) = ระหว่างนั้น
  function bestRecommend(sold, a, b) {
    if (sold <= a) return { label: 'ขายไม่ดี', cls: 'rec-none' };
    if (sold >= b) return { label: 'ควรสต็อก', cls: 'rec-stock' };
    return { label: 'ขายดี', cls: 'rec-good' };
  }

  function gradeByThreshold(sold, a, b) {
    return sold <= a ? 'C' : (sold >= b ? 'A' : 'B');
  }

  function renderBestSellers(hist, skuNames) {
    const vel = buildVelocity(hist);
    const th = getBestThresholds();
    let list = Object.keys(vel).map(function (sku) { return { sku: sku, sold: vel[sku] }; });
    list = gradeList(list, 'sold'); // ใช้คำนวณ % สะสม
    list.forEach(function (i) { i.grade = gradeByThreshold(i.sold, th.a, th.b); }); // เกรดตามเกณฑ์จำนวนที่ขายได้

    const viewRows = list.map(function (i, idx) {
      const rec = bestRecommend(i.sold, th.a, th.b);
      const name = skuNames[i.sku] || '-';
      return mkRow([
        cell(idx + 1, 'sun-num'),
        cell(i.sku),
        cell(name),
        cell(i.sold, 'sun-num'),
        cell(i.cum.toFixed(1) + '%', 'sun-num'),
        cell(i.grade, 'sun-g' + i.grade),
        cell(rec.label, 'sun-' + rec.cls)
      ], { search: (i.sku + ' ' + name).toLowerCase(), grade: i.grade, rec: rec.cls });
    });
    const noneCount = list.filter(function (i) { return i.grade === 'C'; }).length;
    const goodCount = list.filter(function (i) { return i.grade === 'B'; }).length;
    const stockCount = list.filter(function (i) { return i.grade === 'A'; }).length;

    const threshBar =
      '<div class="sun-thresh-bar">' +
        '<label>เกรด C (ขายไม่ดี) ไม่เกิน <input type="number" id="sunThreshA" min="0" value="' + th.a + '"></label>' +
        '<label>เกรด A (ควรสต็อก) ตั้งแต่ <input type="number" id="sunThreshB" min="0" value="' + th.b + '"></label>' +
        '<span class="sun-hint-inline">เกรด B = ' + (th.a + 1) + '–' + (th.b - 1) + '</span>' +
        '<button type="button" class="sun-thresh-apply" id="sunThreshApply">ใช้งานเกณฑ์นี้</button>' +
        buildMultiselect('purchGrade', 'เกรด', [{ value: 'A', text: 'A' }, { value: 'B', text: 'B' }, { value: 'C', text: 'C' }]) +
      '</div>';

    setView(['อันดับ', 'SKU', 'ชื่อสินค้า', 'ยอดขาย', 'สะสม %', 'เกรด', 'คำแนะนำ'],
      ['number', 'text', 'text', 'number', 'number', 'text', 'text'], viewRows);
    mountView(threshBar +
      cards([
        { label: 'SKU ทั้งหมด', value: list.length },
        { label: 'ขายไม่ดี', value: noneCount },
        { label: 'ขายดี', value: goodCount, type: 'ok' },
        { label: 'ควรสต็อกเพิ่ม', value: stockCount, type: stockCount > 0 ? 'danger' : 'ok' }
      ]));
    setPendingChecklist('', []); // หน้านี้ไม่ใช่ checklist ให้พิมพ์ตารางปกติแทน
  }

  /* ---------------------------------------------------------------- */
  /* ประวัติการเคลื่อนไหวสต๊อก                                            */
  /* ---------------------------------------------------------------- */

  // ข้อมูลใหม่ถูกต่อท้ายเสมอ จึงกลับลำดับให้รายการล่าสุดขึ้นบนสุด
  function renderStockIn(si) {
    const rows = (si || []).slice().reverse();

    const viewRows = rows.map(function (r) {
      const time = norm(r['เวลา']);
      const sku = norm(r['ชื่อSKU']);
      const name = norm(r['ชื่อ SKU']);
      const loc = norm(r['ตำแหน่ง']);
      const move = norm(r['เคลื่อนไหว']);
      const type = norm(r['ประเภท']);
      const moveCls = move.indexOf('+') === 0 ? 'sun-good' : (move.indexOf('-') === 0 ? 'sun-warn' : '');
      return mkRow([
        cell(time), cell(sku), cell(name), cell(loc, 'sun-loc'),
        cell(move, 'sun-num ' + moveCls), cell(type)
      ], { search: (time + ' ' + sku + ' ' + name + ' ' + loc + ' ' + type).toLowerCase() });
    });

    setView(['เวลา', 'SKU', 'ชื่อสินค้า', 'ตำแหน่ง', 'เคลื่อนไหว', 'ประเภท'],
      ['text', 'text', 'text', 'text', 'number', 'text'], viewRows);
    mountView(cards([{ label: 'รายการทั้งหมด', value: rows.length }]));
    setPendingChecklist('', []);
  }

  /* ---------------------------------------------------------------- */
  /* ค้นหา / ส่งออก                                                     */
  /* ---------------------------------------------------------------- */

  function filterTable() {
    clearTimeout(SEARCH_DEBOUNCE_TIMER);
    SEARCH_DEBOUNCE_TIMER = setTimeout(applyAllFilters, 120);
  }

  // ดาวน์โหลดเป็นไฟล์ .xlsx จริงๆ (คอลัมน์ตัวเลขเป็นตัวเลข)
  function exportExcel() {
    if (!VIEW || !VIEW.shown.length) { alert('ยังไม่มีข้อมูลให้ดาวน์โหลด'); return; }
    // หน้าใบสั่งซื้อ: ไม่เอาแถวที่ "สั่งเพิ่ม" เป็น 0
    const orderCol = VIEW.head.indexOf('สั่งเพิ่ม');
    const exportRows = orderCol >= 0
      ? VIEW.shown.filter(function (r) { return sortKey(r.cells[orderCol], 'number') > 0; })
      : VIEW.shown;
    if (!exportRows.length) { alert('ไม่มีแถวที่สั่งเพิ่มมากกว่า 0 ให้ดาวน์โหลด'); return; }
    const aoa = [VIEW.head].concat(exportRows.map(function (r) {
      return r.cells.map(function (c, i) { return VIEW.sortTypes[i] === 'number' ? sortKey(c, 'number') : c.v; });
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Report');
    XLSX.writeFile(wb, 'report_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  }
  /* ---------------------------------------------------------------- */
  /* นำเข้าข้อมูล (อัปโหลดไป Supabase)                                    */
  /* ---------------------------------------------------------------- */

  // ไฟล์ที่ export จากระบบคลัง ระบุขนาดชีตผิดเป็น <dimension ref="A1"/> ทำให้อ่านได้แค่เซลล์ A1
  // — คำนวณขอบเขตจริงใหม่จากเซลล์ที่มีอยู่ทั้งหมด
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

  // sheetName: ถ้าไฟล์มีชีตชื่อนี้ (เช่นไฟล์ที่ export จาก Google Sheet ทั้งไฟล์) ให้อ่านชีตนั้น ไม่มีก็ใช้ชีตแรก
  function readSheetFile(file, sheetName) {
    return new Promise(function (resolve, reject) {
      const fr = new FileReader();
      fr.onload = function (e) {
        try {
          const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
          const name = (sheetName && wb.SheetNames.indexOf(sheetName) !== -1) ? sheetName : wb.SheetNames[0];
          const ws = wb.Sheets[name];
          fixSheetRef(ws);
          resolve(XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false }));
        } catch (err) {
          reject(err);
        }
      };
      fr.onerror = function () { reject(new Error('อ่านไฟล์ไม่สำเร็จ')); };
      fr.readAsArrayBuffer(file);
    });
  }

  // อ่านหลายไฟล์แล้วรวมเป็นชุดเดียว จับคู่คอลัมน์ตาม "ชื่อหัวตาราง" ของแต่ละไฟล์เอง (ไม่ใช้ตำแหน่งคอลัมน์)
  async function readMultipleSheetFiles(files, sheetName) {
    const headerOrder = [];
    const objRows = [];

    for (const file of files) {
      const rows = await readSheetFile(file, sheetName);
      if (!rows || rows.length < 1) continue;

      const header = rows[0].map(function (h) { return String(h == null ? '' : h).trim(); });
      header.forEach(function (h) {
        if (h && headerOrder.indexOf(h) === -1) headerOrder.push(h);
      });

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const obj = {};
        header.forEach(function (h, idx) { if (h) obj[h] = row[idx]; });
        objRows.push(obj);
      }
    }

    if (headerOrder.length === 0) return [];
    const dataRows = objRows.map(function (obj) {
      return headerOrder.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
    });
    return [headerOrder].concat(dataRows);
  }

  function rowsToObjects(tbl) {
    const header = tbl[0];
    return tbl.slice(1).map(function (row) {
      const obj = {};
      header.forEach(function (h, idx) { if (h) obj[h] = row[idx]; });
      return obj;
    });
  }

  function requireHeaders(tbl, headers, label) {
    const missing = headers.filter(function (h) { return tbl[0].indexOf(h) === -1; });
    if (missing.length) throw new Error('ไฟล์ ' + label + ' ไม่มีคอลัมน์: ' + missing.join(', '));
  }

  // 3M: สรุปยอดขายต่อ SKU พร้อมตัดออเดอร์ยกเลิก (st = ตัวนับไว้แสดงในตัวอย่าง)
  function toSalesRows(tbl, st) {
    st = st || {};
    st.cancelled = 0; st.noSku = 0;
    requireHeaders(tbl, ['SKU Merchant', 'จำนวน'], '3M');
    const totals = {};
    rowsToObjects(tbl).forEach(function (r) {
      const sku = norm(r['SKU Merchant']);
      if (!sku) { st.noSku++; return; }
      const status = norm(r['สถานะแพลตฟอร์ม']).toLowerCase();
      if (status === 'cancellation') {
        if (HISTORY_CANCEL_SKIP_REASONS.indexOf(norm(r['สาเหตุยกเลิก'])) !== -1) { st.cancelled++; return; }
      } else if (HARD_SKIP_STATUS.indexOf(status) !== -1) {
        st.cancelled++;
        return;
      }
      totals[sku] = (totals[sku] || 0) + num(r['จำนวน']);
    });
    return Object.keys(totals).map(function (sku) { return { sku: sku, qty: totals[sku] }; });
  }

  // ST: ตัดตำแหน่ง FRONT* / DELETE / ในบ้าน ทิ้ง
  function toStockRows(tbl, st) {
    st = st || {};
    st.excludedLoc = 0; st.noSku = 0;
    // ไฟล์ที่รวมจากหน้า "รวมไฟล์ Excel จาก ZIP" เปลี่ยนชื่อหัวเป็น SKU Merchant / จำนวน จึงแปลงกลับเป็นชื่อหัวแบบไฟล์ ST เดิมก่อน
    const has = function (h) { return tbl[0].indexOf(h) !== -1; };
    if (!has('ชื่อSKU') && has('SKU Merchant')) tbl[0] = tbl[0].map(function (h) { return h === 'SKU Merchant' ? 'ชื่อSKU' : h; });
    if (!has('สต็อกที่มีอยู่ของตำแหน่ง') && has('จำนวน')) tbl[0] = tbl[0].map(function (h) { return h === 'จำนวน' ? 'สต็อกที่มีอยู่ของตำแหน่ง' : h; });
    requireHeaders(tbl, ['ชื่อSKU', 'ตำแหน่ง', 'สต็อกที่มีอยู่ของตำแหน่ง'], 'ST');
    return rowsToObjects(tbl)
      .filter(function (r) {
        const loc = norm(r['ตำแหน่ง']).toUpperCase();
        if (loc === '') return true;
        const keep = loc.indexOf('FRONT') !== 0 && EXCLUDED_LOCATIONS.indexOf(loc) === -1;
        if (!keep) st.excludedLoc++;
        return keep;
      })
      .map(function (r) {
        return {
          sku: norm(r['ชื่อSKU']),
          sku_name: norm(r['ชื่อ SKU']),
          location: norm(r['ตำแหน่ง']),
          qty: num(r['สต็อกที่มีอยู่ของตำแหน่ง'])
        };
      })
      .filter(function (r) { if (!r.sku) st.noSku++; return r.sku; });
  }

  // SI: เก็บเฉพาะประเภท Stock-In / Manual Stock-In
  function toMoveRows(tbl, st) {
    st = st || {};
    st.otherType = 0; st.noSku = 0;
    requireHeaders(tbl, ['ชื่อSKU', 'ประเภท'], 'SI');
    return rowsToObjects(tbl)
      .filter(function (r) {
        const keep = norm(r['ประเภท']) === SI_KEEP_TYPE;
        if (!keep) st.otherType++;
        return keep;
      })
      .map(function (r) {
        return {
          sku: norm(r['ชื่อSKU']),
          sku_name: norm(r['ชื่อ SKU']),
          moved_at: norm(r['เวลา']),
          location: norm(r['ตำแหน่ง']),
          stock_before: norm(r['สต็อกเดิม']),
          move: norm(r['เคลื่อนไหว']),
          stock_after: norm(r['สต็อกล่าสุด']),
          type: norm(r['ประเภท'])
        };
      })
      .filter(function (r) { if (!r.sku) st.noSku++; return r.sku; });
  }

  // เขียนทับตารางใน Supabase ผ่านฟังก์ชัน op_upload (ต้องใส่รหัสอัปโหลด)
  // ก้อนแรกส่ง p_reset=true ให้ล้างตารางก่อน ก้อนถัดไปต่อท้าย — ถ้าพังกลางทาง ให้อัปโหลดใหม่อีกรอบ
  async function replaceTable(target, rows, passcode, onProgress) {
    const client = sb();
    let sent = 0;
    for (let i = 0; i === 0 || i < rows.length; i += UPLOAD_CHUNK) {
      const chunk = rows.slice(i, i + UPLOAD_CHUNK);
      const res = await client.rpc('op_upload', {
        p_passcode: passcode, p_target: target, p_rows: chunk, p_reset: i === 0
      });
      if (res.error) throw new Error(res.error.message);
      sent += chunk.length;
      if (onProgress) onProgress(sent, rows.length);
    }
    return rows.length;
  }

  // payload: [{ target, label, rows }]
  async function submitPayload(payload, logId, resetIds, prepKinds) {
    const log = $(logId);

    if (payload.length === 0) {
      log.innerHTML = '<span class="sun-warn">ยังไม่ได้เลือกไฟล์ หรือไฟล์ไม่มีข้อมูล</span>';
      return false;
    }

    // ไม่มีช่องกรอกรหัสบนหน้าจอ: ถามรหัสตอนกดอัปโหลด และจำไว้ในหน่วยความจำจนกว่าจะปิด/รีเฟรชหน้า (ไม่เก็บลงเบราว์เซอร์)
    if (!uploadPasscode) {
      const typed = window.prompt('ใส่รหัสอัปโหลด');
      uploadPasscode = (typed || '').trim();
    }
    const passcode = uploadPasscode;
    if (!passcode) {
      log.innerHTML = '<span class="sun-warn">ยกเลิก: ต้องใส่รหัสอัปโหลดก่อน</span>';
      return false;
    }

    try {
      let msg = 'อัปโหลดสำเร็จ: ';
      for (const p of payload) {
        const count = await replaceTable(p.target, p.rows, passcode, function (done, total) {
          log.textContent = 'กำลังอัปโหลด ' + p.label + ' ' + done + '/' + total + ' แถว ...';
        });
        msg += p.label + ' ' + count + ' แถว | ';
      }
      msg += new Date().toLocaleTimeString('th-TH');
      log.innerHTML = '<span class="sun-good">' + esc(msg) + '</span>';

      (resetIds || []).forEach(function (id) {
        const el = $(id);
        if (el) el.value = '';
      });

      (prepKinds || []).forEach(function (k) { PREP[k] = null; renderPrep(k, true); });
      CACHE = null;
      if (started) loadData(currentMode);
      return true;
    } catch (err) {
      if (/รหัสอัปโหลด/.test(err.message)) uploadPasscode = ''; // รหัสผิด: ถามใหม่ครั้งหน้า
      log.innerHTML = '<span class="sun-warn">ผิดพลาด: ' + esc(err.message) + '</span>';
      return false;
    }
  }

  /* ---------------------------------------------------------------- */
  /* เตรียมข้อมูลก่อนอัปโหลด + ตัวอย่าง (แสดงที่หน้า "รวมไฟล์ ZIP" ฝั่งซ้าย)   */
  /* ---------------------------------------------------------------- */

  // แต่ละชนิด: ชื่อชีต, ตัวแปลง, ตารางปลายทาง, คอลัมน์ตัวอย่าง, รายละเอียดที่ตัดออก
  const KINDS = {
    m3: {
      eyebrow: '01 / SALES', icon: '3M', title: 'ยอดขายย้อนหลัง → 3M',
      desc: 'เลือกไฟล์ยอดขาย (Excel/CSV หรือ ZIP หลายไฟล์ได้) ระบบแตกไฟล์ รวมยอดต่อ SKU และตัดออเดอร์ยกเลิกให้ก่อน แล้วแสดงตัวอย่าง ตรวจแล้วค่อยกดอัปโหลดทับตาราง op_sales',
      sheet: '3M', build: toSalesRows, target: 'sales', label: '3M (ยอดขายย้อนหลัง)',
      cols: ['SKU Merchant', 'จำนวน'], cells: function (r) { return [r.sku, r.qty]; },
      dropped: function (s) { return 'ตัดออเดอร์ยกเลิก ' + s.cancelled.toLocaleString() + ' แถว · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว · รวมยอดต่อ SKU'; }
    },
    st: {
      eyebrow: '02 / STOCK', icon: 'ST', title: 'สต๊อกและตำแหน่ง → ST',
      desc: 'เลือกไฟล์สต๊อก (Excel/CSV หรือ ZIP หลายไฟล์ได้) ระบบแตกไฟล์ รวม และตัดตำแหน่ง FRONT/DELETE/ในบ้านให้ก่อน แล้วแสดงตัวอย่าง ตรวจแล้วค่อยกดอัปโหลดทับตาราง op_stock',
      sheet: 'ST', build: toStockRows, target: 'stock', label: 'ST (สต๊อกและตำแหน่ง)',
      cols: ['SKU', 'ชื่อ SKU', 'ตำแหน่ง', 'จำนวน'], cells: function (r) { return [r.sku, r.sku_name, r.location, r.qty]; },
      dropped: function (s) { return 'ตัดตำแหน่ง FRONT/DELETE/ในบ้าน ' + s.excludedLoc.toLocaleString() + ' แถว · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว'; }
    },
    si: {
      eyebrow: '03 / STOCK MOVEMENT', icon: 'SI', title: 'ประวัติเคลื่อนไหวสต๊อก → SI',
      desc: 'เลือกไฟล์ SI (Excel/CSV หรือ ZIP หลายไฟล์ได้) ระบบแตกไฟล์ รวม และตัดแถวให้ก่อน แล้วแสดงตัวอย่าง ตรวจแล้วค่อยกดอัปโหลดทับตาราง op_stock_moves',
      sheet: 'SI', build: toMoveRows, target: 'moves', label: 'SI (เคลื่อนไหวสต๊อก)',
      cols: ['เวลา', 'SKU', 'ตำแหน่ง', 'เคลื่อนไหว', 'ประเภท'], cells: function (r) { return [r.moved_at, r.sku, r.location, r.move, r.type]; },
      // หน้ารวมไฟล์ ZIP / หน้าตรวจ Stock: เปลี่ยนหัวคอลัมน์ SKU + เคลื่อนไหว → SKU Merchant + จำนวน (ค่าเป็นตัวเลข เช่น +5 → 5)
      renamed: {
        cols: ['SKU Merchant', 'จำนวน'],
        toRow: function (r) { return { 'SKU Merchant': r.sku, 'จำนวน': num(r.move) }; }
      },
      dropped: function (s) { return 'เก็บเฉพาะ Stock-In / Manual Stock-In (ตัดประเภทอื่น ' + s.otherType.toLocaleString() + ' แถว) · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว'; }
    }
  };
  const KIND_IDS = ['m3', 'st', 'si'];
  const PREP = { m3: null, st: null, si: null };
  const PREP_SEQ = { m3: 0, st: 0, si: 0 };
  // ชุดองค์ประกอบของแต่ละชนิด: "sun…" = หน้านำเข้าข้อมูล, "sunM…" = การ์ด SI ที่หน้ารวมไฟล์ ZIP (ไม่มีปุ่มอัปโหลด)
  const PREFIXES = ['sun', 'sunM'];
  const kid = function (part, kind) { return $('sun' + part + '_' + kind); };
  const kidAll = function (part, kind) {
    return PREFIXES.map(function (p) { return $(p + part + '_' + kind); }).filter(Boolean);
  };

  // สร้างการ์ดนำเข้าของแต่ละชนิดลงหน้า "นำเข้าข้อมูล"
  function buildImportCards() {
    const grid = $('sunImportGrid');
    if (!grid) return;
    grid.innerHTML = KIND_IDS.map(function (k) {
      const c = KINDS[k];
      return '<section class="sun-imp-card" id="sunCard_' + k + '">' +
        '<div class="sun-imp-eyebrow">' + c.eyebrow + '</div>' +
        '<h2>' + esc(c.title) + '</h2><p>' + esc(c.desc) + '</p>' +
        '<div class="sun-imp-drop" id="sunDrop_' + k + '"><div class="sun-imp-badge">' + c.icon + '</div>' +
          '<strong>📁 คลิกเพื่อเลือกไฟล์ ' + c.icon + '</strong>' +
          '<span>หรือลากไฟล์ Excel / CSV / ZIP มาวางที่นี่ (เลือกได้หลายไฟล์)</span>' +
          '<input id="sunIn_' + k + '" type="file" accept=".xlsx,.xls,.csv,.zip" multiple></div>' +
        '<div class="sun-imp-stats"><div><span>ไฟล์ที่อ่าน</span><b id="sunFiles_' + k + '">0</b></div>' +
          '<div><span>แถวที่จะอัปโหลด</span><b id="sunRows_' + k + '">0</b></div></div>' +
        '<div class="sun-imp-progress"><i id="sunBar_' + k + '"></i></div>' +
        '<div class="sun-imp-status" id="sunStatus_' + k + '">ยังไม่ได้เลือกไฟล์</div>' +
        '<div class="sun-imp-actions"><button type="button" class="sun-imp-danger" id="sunClr_' + k + '">ล้างข้อมูลชุดนี้</button></div>' +
        '<h3>ตัวอย่างข้อมูลที่จะอัปโหลด</h3>' +
        '<div class="sun-imp-table" id="sunPrep_' + k + '">ยังไม่มีข้อมูล</div>' +
        '</section>';
    }).join('');
  }

  function fileSig(files) {
    return files.map(function (f) { return f.name + '|' + f.size + '|' + f.lastModified; }).join(';');
  }

  // แตก ZIP → อ่านทุกไฟล์ → รวมเป็นชุดเดียว → ตัดแถวตามกติกา (ยังไม่ส่งอะไรขึ้นฐานข้อมูล)
  async function prepareKind(kind, force) {
    const cfg = KINDS[kind];
    const input = kid('In', kind);
    const raw = input ? Array.from(input.files || []) : [];
    if (!raw.length) { PREP[kind] = null; renderPrep(kind); if (kind === 'si') updateCompareSi(null); return null; }

    const sig = fileSig(raw);
    if (!force && PREP[kind] && PREP[kind].sig === sig) return PREP[kind];

    const seq = ++PREP_SEQ[kind];
    toggleCard(kind, true);
    setStatus(kind, '⏳ กำลังแตก/รวมไฟล์ ' + raw.length + ' ไฟล์ ...', 35);
    let prep;
    try {
      const files = await expandZips(raw);
      const table = await readMultipleSheetFiles(files, cfg.sheet);
      if (table.length < 2) throw new Error('ไม่พบข้อมูลในไฟล์');
      const stats = {};
      const rows = cfg.build(table, stats);
      prep = { sig: sig, kind: kind, target: cfg.target, label: cfg.label, rows: rows, files: files.length, names: raw.map(function (f) { return f.name; }), rawRows: table.length - 1, stats: stats };
    } catch (err) {
      prep = { sig: sig, kind: kind, error: err.message };
    }
    if (seq !== PREP_SEQ[kind]) return null; // มีการเลือกไฟล์ใหม่ระหว่างรอ
    PREP[kind] = prep;
    renderPrep(kind);
    if (kind === 'si') updateCompareSi(prep);
    return prep;
  }

  // แสดงส่วนสถานะ/ปุ่ม/ตัวอย่างของการ์ดเมื่อมีไฟล์แล้วเท่านั้น (ทั้งหน้านำเข้า และการ์ด SI ที่หน้ารวมไฟล์ ZIP)
  function toggleCard(kind, on) {
    kidAll('Card', kind).forEach(function (card) { card.classList.toggle('has-file', !!on); });
  }

  function setStatus(kind, text, pct) {
    kidAll('Status', kind).forEach(function (s) { s.textContent = text; });
    if (pct !== undefined) kidAll('Bar', kind).forEach(function (b) { b.style.width = pct + '%'; });
  }

  function renderPrep(kind, keepStatus) {
    const p = PREP[kind];
    const cfg = KINDS[kind];
    toggleCard(kind, p);

    // ข้อความสถานะ + ความคืบหน้า (ใช้ร่วมกันทุกการ์ดของชนิดนั้น)
    let text = 'ยังไม่ได้เลือกไฟล์', pct = 0;
    if (p && p.error) { text = '❌ อ่านไฟล์ไม่ได้: ' + p.error; }
    else if (p) {
      text = (p.rows.length ? '✅ ' : '⚠️ ') + 'อ่าน ' + p.files.toLocaleString() + ' ไฟล์ / ' + p.rawRows.toLocaleString() + ' แถว → จะอัปโหลดทับ ' +
        p.rows.length.toLocaleString() + ' แถว | ' + cfg.dropped(p.stats);
      pct = 100;
    }
    const ok = !!(p && !p.error);
    const sample = ok ? p.rows.slice(0, 10) : [];

    PREFIXES.forEach(function (pre) {
      const table = $(pre + 'Prep_' + kind);
      if (!table) return;
      const filesEl = $(pre + 'Files_' + kind), rowsEl = $(pre + 'Rows_' + kind), btn = $(pre + 'Go_' + kind);
      const statusEl = $(pre + 'Status_' + kind), barEl = $(pre + 'Bar_' + kind);
      // หลังอัปโหลดสำเร็จ หน้านำเข้าคงข้อความ "อัปโหลดสำเร็จ" ไว้ (keepStatus) ส่วนการ์ดที่หน้ารวมไฟล์ล้างสถานะ
      if (!(keepStatus && pre === 'sun')) {
        if (statusEl) statusEl.textContent = pre === 'sunM' ? text.replace('จะอัปโหลดทับ', 'ผ่านเงื่อนไข') + (ok && cfg.renamed ? ' · เปลี่ยนหัวคอลัมน์เป็น ' + cfg.renamed.cols.join(' + ') : '') : text;
        if (barEl) barEl.style.width = pct + '%';
      }
      filesEl.textContent = ok ? p.files.toLocaleString() : '0';
      rowsEl.textContent = ok ? p.rows.length.toLocaleString() : '0';
      if (btn) btn.disabled = !ok || p.rows.length === 0;
      if (!ok) { table.textContent = 'ยังไม่มีข้อมูล'; return; }
      if (!sample.length) { table.textContent = 'หลังตัดแถวตามกติกาแล้วไม่เหลือข้อมูล'; return; }
      // การ์ดที่หน้ารวมไฟล์ ZIP แสดงหัวคอลัมน์ที่เปลี่ยนชื่อแล้ว (ถ้าชนิดนั้นมี) ส่วนหน้านำเข้าแสดงฟิลด์เดิมที่จะอัปโหลดจริง
      const rn = pre === 'sunM' ? cfg.renamed : null;
      const cols = rn ? rn.cols : cfg.cols;
      const cellsOf = rn ? function (r) { const o = rn.toRow(r); return rn.cols.map(function (c) { return o[c]; }); } : cfg.cells;
      table.innerHTML = '<table><thead><tr>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        sample.map(function (r) { return '<tr>' + cellsOf(r).map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>'; }).join('') +
        '</tbody></table>';
    });
    updateAllBar();
  }

  // ส่ง SI ที่ผ่านเงื่อนไขแล้ว ไปแสดงในหน้า "ตรวจ ORDER กับ Stock" (กล่องไฟล์ที่ 3 ใต้ไฟล์ Stock) อัตโนมัติ
  // เก็บไว้ที่ window.CompareSI = { rows, names } จนกว่าจะกด "เอาออก" / ล้างข้อมูลหน้านั้น / เลือกไฟล์ SI ใหม่
  function updateCompareSi(prep) {
    const nameEl = $('name3'), infoEl = $('info3'), box = $('siDropCompare'), clr = $('siCompareClear');
    if (!nameEl || !infoEl || !box) return;
    // ข้อมูล SI เปลี่ยน → ตรวจ ORDER กับ Stock ใหม่ (ถ้ามีไฟล์ 1 และ 2 ครบอยู่แล้ว) เพื่อให้หักลบไฟล์ที่ 3 ตามข้อมูลล่าสุด
    const recompare = function () {
      setTimeout(function () {
        if (typeof updateCompareReady === 'function' && typeof data1 !== 'undefined' && data1 && typeof data2 !== 'undefined' && data2) updateCompareReady();
      }, 0);
    };
    if (!prep || prep.error || !prep.rows || !prep.rows.length) {
      window.CompareSI = null;
      recompare();
      nameEl.textContent = 'รอไฟล์ SI จากหน้า นำเข้าข้อมูล';
      infoEl.textContent = 'ใส่ให้อัตโนมัติเมื่อเลือกไฟล์ SI (ผ่านเงื่อนไขของหน้านั้นแล้ว)';
      box.classList.remove('has-file');
      if (clr) clr.hidden = true;
      return;
    }
    // rows = เปลี่ยนหัวคอลัมน์เป็น SKU Merchant + จำนวน แล้ว (พร้อมใช้ที่หน้าตรวจ ORDER กับ Stock), sourceRows = ฟิลด์เดิมของ SI
    const rn = KINDS.si.renamed;
    window.CompareSI = { rows: prep.rows.map(rn.toRow), sourceRows: prep.rows, names: prep.names || [] };
    const names = prep.names || [];
    nameEl.textContent = names.length === 1 ? names[0] : (names.length + ' ไฟล์ (SI จากหน้า นำเข้าข้อมูล)');
    infoEl.textContent = prep.rows.length.toLocaleString() + ' แถว | หัวคอลัมน์ SKU Merchant + จำนวน (เฉพาะ Stock-In / Manual Stock-In)';
    box.classList.add('has-file');
    if (clr) clr.hidden = false;
    recompare();
  }

  // ปุ่มบนสุดปุ่มเดียว: สรุปว่าพร้อมอัปโหลดอะไรบ้าง
  function updateAllBar() {
    const btn = $('sunGoAll'), sum = $('sunAllSummary');
    if (!btn || !sum) return;
    const ready = KIND_IDS.filter(function (k) { const p = PREP[k]; return p && !p.error && p.rows.length > 0; });
    btn.disabled = ready.length === 0;
    sum.textContent = ready.length
      ? 'พร้อมอัปโหลดทับ: ' + ready.map(function (k) { return KINDS[k].sheet + ' ' + PREP[k].rows.length.toLocaleString() + ' แถว'; }).join(' · ')
      : 'ยังไม่มีไฟล์ที่พร้อมอัปโหลด (เลือกไฟล์ด้านล่าง อย่างน้อย 1 ชนิด)';
  }

  // อัปโหลดทับทุกชนิดที่มีไฟล์พร้อมด้วยปุ่มเดียว ทีละชนิดตามลำดับ 3M → ST → SI (แต่ละชนิดเขียนทับคนละตารางของตัวเอง)
  async function uploadAll() {
    const st = $('sunAllStatus'), btn = $('sunGoAll');
    if (btn) btn.disabled = true;
    if (st) st.textContent = 'กำลังเตรียมข้อมูล ...';
    const items = [];
    for (const kind of KIND_IDS) {
      const input = kid('In', kind);
      if (!input || !(input.files && input.files.length)) continue;
      const p = await prepareKind(kind, false);
      if (!p) continue;
      if (p.error) { if (st) st.innerHTML = '<span class="sun-warn">อ่านไฟล์ ' + esc(KINDS[kind].sheet) + ' ผิดพลาด: ' + esc(p.error) + ' — ไม่ได้อัปโหลดอะไรเลย</span>'; updateAllBar(); return; }
      if (p.rows.length) items.push({ kind: kind, p: p });
    }
    if (!items.length) { if (st) st.innerHTML = '<span class="sun-warn">ยังไม่มีไฟล์ที่พร้อมอัปโหลด</span>'; updateAllBar(); return; }

    const done = [];
    for (const it of items) {
      const k = it.kind;
      if (st) st.textContent = 'กำลังอัปโหลด ' + KINDS[k].sheet + ' (' + (done.length + 1) + '/' + items.length + ') ...';
      const ok = await submitPayload([{ target: it.p.target, label: KINDS[k].sheet, rows: it.p.rows }],
        'sunStatus_' + k, ['sunIn_' + k, 'sunMIn_' + k], [k]);
      if (!ok) {
        if (st) st.innerHTML = '<span class="sun-warn">หยุดที่ ' + esc(KINDS[k].sheet) + ' — ' + (done.length ? 'อัปโหลดสำเร็จแล้ว: ' + esc(done.join(', ')) : 'ยังไม่มีชนิดไหนถูกอัปโหลด') + ' (ดูรายละเอียดที่การ์ดของชนิดนั้น)</span>';
        updateAllBar();
        return;
      }
      const b = kid('Bar', k);
      if (b) b.style.width = '100%';
      done.push(KINDS[k].sheet + ' ' + it.p.rows.length.toLocaleString() + ' แถว');
    }
    if (st) st.innerHTML = '<span class="sun-good">✅ อัปโหลดทับสำเร็จ ' + esc(done.join(' · ')) + ' | ' + new Date().toLocaleTimeString('th-TH') + '</span>';
    updateAllBar();
  }
  /* ผูกเหตุการณ์                                                       */
  /* ---------------------------------------------------------------- */

  // แท็บด้านขวา (data-sun-mode) — หน้าหลักสลับแท็บให้เองแล้ว ที่นี่แค่สั่งโหลดโหมดที่เลือก
  document.querySelectorAll('.tab[data-sun-mode]').forEach(function (btn) {
    btn.addEventListener('click', function () { setMode(btn.dataset.sunMode); });
  });

  // ช่องเลือกไฟล์ของแต่ละชนิด (หน้านำเข้า "sun…" และการ์ด SI ที่หน้ารวมไฟล์ ZIP "sunM…" ใช้ข้อมูลชุดเดียวกัน)
  // เลือก/ลากไฟล์ที่ช่องไหน อีกช่องจะขึ้นไฟล์เดียวกันด้วย แล้วเตรียมข้อมูลและแสดงตัวอย่างทันที (ก่อนกดอัปโหลด)
  buildImportCards();
  const goAll = $('sunGoAll');
  if (goAll) goAll.addEventListener('click', uploadAll);
  updateAllBar();
  function syncInputs(kind, fromPrefix, files) {
    PREFIXES.forEach(function (pre) {
      if (pre === fromPrefix) return;
      const other = $(pre + 'In_' + kind);
      if (other) setInputFiles(other, files);
    });
  }
  KIND_IDS.forEach(function (k) {
    PREFIXES.forEach(function (pre) {
      const input = $(pre + 'In_' + k), drop = $(pre + 'Drop_' + k);
      if (!input || !drop) return;
      input.addEventListener('change', function () {
        syncInputs(k, pre, Array.from(input.files || []));
        prepareKind(k, true);
      });
      drop.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag-ready'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('drag-ready'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('drag-ready');
        if (e.dataTransfer && e.dataTransfer.files.length) {
          const files = Array.from(e.dataTransfer.files);
          setInputFiles(input, files);
          syncInputs(k, pre, files);
          prepareKind(k, true);
          if (k === 'st') forwardStToMerge(files);
        }
      });
      const clr = $(pre + 'Clr_' + k);
      if (clr) clr.addEventListener('click', function () {
        PREFIXES.forEach(function (p2) { const i2 = $(p2 + 'In_' + k); if (i2) i2.value = ''; });
        PREP[k] = null;
        PREP_SEQ[k]++;
        renderPrep(k);
        if (k === 'si') updateCompareSi(null);
      });
    });
  });

  // กล่อง SI ในหน้าตรวจ ORDER กับ Stock: กดกล่อง = ไปหน้า นำเข้าข้อมูล, ปุ่ม "เอาออก" / "ล้างข้อมูล" ของหน้านั้น = ล้างกล่อง
  const cmpBox = $('siDropCompare');
  if (cmpBox) {
    const goImport = function () { const tab = document.querySelector('.tab[data-tool="sunImportTool"]'); if (tab) tab.click(); };
    cmpBox.addEventListener('click', function (e) { if (e.target.closest('#siCompareClear')) return; goImport(); });
    cmpBox.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goImport(); } });
  }
  const cmpClear = $('siCompareClear');
  if (cmpClear) cmpClear.addEventListener('click', function (e) { e.stopPropagation(); updateCompareSi(null); });
  const clear2 = $('clear2');
  if (clear2) clear2.addEventListener('click', function () { updateCompareSi(null); });

  $('sunRefresh').addEventListener('click', function () { if (started) refresh(); else setMode(currentMode); });
  $('sunXlsx').addEventListener('click', exportExcel);
  $('sunPrint').addEventListener('click', handlePrint);

  // ค้นหาเมื่อกด Enter (ตารางมีหลายหมื่นแถว กรองทุกตัวอักษรที่พิมพ์จะหน่วง)
  $('sunSearch').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(SEARCH_DEBOUNCE_TIMER);
    applyAllFilters();
  });
  // ลบคำค้นจนว่าง (หรือกดปุ่ม x ในช่อง) ให้โชว์ทุกแถวกลับมาทันที
  $('sunSearch').addEventListener('input', function () {
    if ($('sunSearch').value === '') filterTable();
  });

  // คลิกในเนื้อหา: หัวคอลัมน์เรียงลำดับ / เปิดปิด dropdown / ปุ่มเกณฑ์
  root.addEventListener('click', function (e) {
    const th = e.target.closest('th[data-sun-sort]');
    if (th) { sortTable(Number(th.dataset.sunSort)); return; }

    const msBtn = e.target.closest('.sun-ms-btn');
    if (msBtn) { toggleMultiselect(msBtn.dataset.ms); return; }

    if (e.target.closest('#sunThreshApply')) applyBestThresholds();
  });

  root.addEventListener('change', function (e) {
    const t = e.target;
    if (t.id === 'sunPurchShowAll') {
      PURCHASE_SHOW_ALL = t.checked;
      loadData('purchase');
      return;
    }
    const panel = t.closest && t.closest('.sun-ms-panel');
    if (panel) {
      const id = panel.id.replace(/^sun_/, '').replace(/Panel$/, '');
      updateMultiselectLabel(id, panel.dataset.msLabel);
      applyAllFilters();
    }
  });

  // คลิกนอกกล่อง dropdown ที่ไหนก็ได้ ให้ปิดแผงที่เปิดค้างอยู่ทั้งหมด
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.sun-ms')) return;
    root.querySelectorAll('.sun-ms-panel.open').forEach(function (p) { p.classList.remove('open'); });
  });

  /* ---------------------------------------------------------------- */
  /* เชื่อมช่อง ST กับหน้า "รวมไฟล์ Excel จาก ZIP"                        */
  /* ---------------------------------------------------------------- */

  // ไฟล์ ZIP ในช่อง ST → แตกเป็นไฟล์ Excel/CSV ข้างใน (ไฟล์อื่นผ่านตามเดิม)
  async function expandZips(files) {
    const out = [];
    for (const f of files) {
      if (!/\.zip$/i.test(f.name)) { out.push(f); continue; }
      const zip = await JSZip.loadAsync(f);
      const names = Object.keys(zip.files).filter(function (n) { return /\.(xlsx|xls|csv)$/i.test(n) && !zip.files[n].dir; });
      for (const n of names) {
        out.push(new File([await zip.files[n].async('arraybuffer')], n.split('/').pop()));
      }
    }
    return out;
  }

  function setInputFiles(input, files) {
    try {
      const dt = new DataTransfer();
      files.forEach(function (f) { dt.items.add(f); });
      input.files = dt.files; // ตั้งค่าตรงๆ ไม่ยิง change กันวนซ้ำ
    } catch (e) { /* เบราว์เซอร์ไม่รองรับ: ข้ามไป */ }
  }

  // เชื่อมช่อง ST กับหน้า "รวมไฟล์ ZIP" (แยกการทำงานกัน: หน้ารวมไฟล์ลบแถวสต็อก 0 / FRONT / DELETE ส่วนหน้านำเข้าตัดตามกติกาของตัวเอง)
  // เลือก ZIP ที่หน้ารวมไฟล์ → ใส่ ZIP ต้นฉบับ (ยังไม่ผ่านการรวม) ในช่อง ST ของหน้านำเข้าอัตโนมัติ
  document.addEventListener('mergezip:selected', function (e) {
    const file = e.detail && e.detail.file;
    const input = kid('In', 'st');
    if (!file || !input) return;
    setInputFiles(input, [file]);
    prepareKind('st', true);
  });

  // ใส่ไฟล์ในช่อง ST (ZIP ใช้ตรงๆ / Excel-CSV หลายไฟล์ห่อเป็น ZIP ให้) → ส่งเข้าหน้ารวมไฟล์ ZIP ด้วย
  async function forwardStToMerge(files) {
    if (!files.length) return;
    if (typeof setFile !== 'function' || typeof JSZip === 'undefined') return;
    if (typeof mergeProcessing !== 'undefined' && mergeProcessing) return;
    try {
      let zipFile;
      if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
        zipFile = files[0];
      } else {
        const inner = files.filter(function (f) { return /\.(xlsx|xls|csv)$/i.test(f.name); });
        if (!inner.length) return;
        const zip = new JSZip();
        for (const f of inner) zip.file(f.name, await f.arrayBuffer());
        const blob = await zip.generateAsync({ type: 'blob' });
        zipFile = new File([blob], 'สต็อกและตำแหน่ง_จากหน้านำเข้า.zip', { type: 'application/zip' });
      }
      setFile(zipFile);
    } catch (err) {
      console.error('ส่งไฟล์ ST เข้าหน้ารวมไฟล์ไม่สำเร็จ:', err);
    }
  }
  const stInput = kid('In', 'st');
  if (stInput) stInput.addEventListener('change', function () { forwardStToMerge(Array.from(stInput.files || [])); });

  window.Sun = { setMode: setMode, refresh: refresh };
})();
