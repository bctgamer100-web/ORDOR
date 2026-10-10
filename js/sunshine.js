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
  const SUPABASE_URL = 'https://yvfqxlgkwaylivopctno.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_xNq2vHHwVe8v_rujH3P_QQ_ep6-g6ol';
  let sbClient = null;
  function sb() {
    if (sbClient) return sbClient;
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('โหลดไลบรารี Supabase ไม่สำเร็จ (ไม่พบไฟล์ js/vendor/supabase.min.js) ลองรีเฟรชหน้าเว็บ');
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

  // ตำแหน่งที่ไม่มีอยู่จริง/ถูกยกเลิก/วางสินค้าชำรุด (X001) ไม่นับเป็นสต๊อกเลยไม่ว่าหน้าไหน
  const EXCLUDED_LOCATIONS = ['DELETE', 'ในบ้าน', 'X001'];

  let CACHE = null;
  let currentMode = 'purchase';
  let uploadPasscode = ''; // รหัสอัปโหลด (จำเฉพาะในหน้านี้)
  // อัปโหลดโดยไม่ต้องใส่รหัส: ฐานข้อมูลตั้งรหัสเป็นค่าว่าง (op_settings.upload_passcode_hash = crypt('', ...))
  // จึงส่งรหัสว่างไปได้เลย ถ้าฐานข้อมูลยังตั้งรหัสอยู่ (ตอบว่ารหัสผิด) ค่อยถามรหัสตอนกดครั้งถัดไป
  let needUploadPasscode = false;
  function askUploadPasscode() {
    if (!needUploadPasscode || uploadPasscode) return true;
    const typed = window.prompt('ใส่รหัสอัปโหลด');
    uploadPasscode = (typed || '').trim();
    return !!uploadPasscode;
  }
  let started = false;
  let PENDING_CHECKLIST = { title: '', items: [] };
  let LOAD_TOKEN = 0; // เพิ่มทุกครั้งที่เปลี่ยนหน้า ใช้กันคำขอเก่าเขียนทับคำขอใหม่
  let SEARCH_DEBOUNCE_TIMER = null;

  // รายชื่อแบรนด์ (ใช้ทั้งตัวกรองแบรนด์ และตั้งชื่อชีตตอนดาวน์โหลด Excel)
  const BRANDS = ['WARRIX', 'GRAND', 'FLY HAWK', 'CADENZA', 'PEGAN', 'BCS', 'IMANE', 'H3', 'EGO'];
  function brandOf(name) {
    const up = String(name == null ? '' : name).toUpperCase();
    for (let i = 0; i < BRANDS.length; i++) if (up.indexOf(BRANDS[i]) > -1) return BRANDS[i];
    return 'อื่นๆ';
  }

  const MODE_TITLES = {
    purchase: 'ใบสั่งซื้อล่วงหน้า',
    best: 'สินค้าขายดี ABC',
    stockin: 'ประวัติเคลื่อนไหวสต๊อก',
    idle: 'ตำแหน่งไม่เคลื่อนไหว'
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
  let comReadError = '';
  async function loadAllFromSupabase() {
    comReadError = '';
    const results = await Promise.all([
      fetchAllRows('op_sales', 'sku,qty', 'sku'),
      fetchAllRows('op_stock', 'sku,sku_name,location,qty', 'id'),
      fetchAllRows('op_stock_moves', 'sku,sku_name,moved_at,location,move,type', 'id'),
      // products เป็นตารางกลางที่โปรเจกต์อื่นใช้ด้วย — อ่านอย่างเดียว ถ้าอ่านไม่ได้ก็ยังใช้งานหน้าอื่นต่อได้
      fetchAllRows('products', 'sku_merchant,brand', 'id').catch(function (err) {
        console.warn('อ่านตาราง products ไม่ได้:', err);
        return [];
      }),
      // op_com = ยอด "สั่งเป้า" ต่อ SKU (เพิ่มต่อท้ายจากหน้า นำเข้าข้อมูล) ถ้าอ่านไม่ได้ (ยังไม่เปิดสิทธิ์อ่าน) ก็ใช้งานต่อได้ โดยสั่งเป้าเป็น 0
      fetchAllRows('op_com', 'sku,qty', 'id').catch(function (err) {
        console.warn('อ่านตาราง op_com ไม่ได้:', err);
        comReadError = err && err.message ? err.message : String(err);
        return [];
      }),
      // op_front_sale = ยอด "ขาย" (หน้าร้าน) ต่อ SKU แยกจาก op_stock — ถ้ายังไม่ได้รัน supabase/op_front_sale.sql ก็ใช้งานต่อได้ โดยขายเป็น 0
      fetchAllRows('op_front_sale', 'sku,qty', 'sku').catch(function (err) {
        console.warn('อ่านตาราง op_front_sale ไม่ได้:', err);
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
      'BRAND': results[3],
      'COM': results[4],
      'COMERR': comReadError,
      'FRONTSALE': results[5]
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

  // แยกคำค้น SKU จากข้อความที่วาง/พิมพ์มา: แต่ละรายการคั่นด้วยจุลภาค/เซมิโคลอน/ขึ้นบรรทัดใหม่
  // ถ้าในรายการเดียวมีจำนวนติดมาด้วย (คั่นด้วยแท็บ เช่นคัดลอกจาก Excel 2 คอลัมน์ SKU-จำนวน หรือคั่นด้วยเว้นวรรค) ตัดส่วนจำนวนทิ้ง เหลือแค่ SKU
  function sunSkuTerms(text) {
    return String(text || '').split(/[\n\r,;]+/).map(function (s) {
      return s.trim().split('\t')[0].trim().replace(/\s+\d+$/, '').trim();
    }).filter(Boolean);
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
      h += '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + ' title="' + esc(c.v) + '">' + (c.h !== undefined ? c.h : esc(c.v)) + '</td>';
    }
    return h + '</tr>';
  }

  // sortTypes: array ขนานกับ head เช่น ["text","number",null,...] — null/ไม่ใส่ = คอลัมน์นั้นกดเรียงไม่ได้
  function setView(head, sortTypes, rows) {
    VIEW = { head: head, sortTypes: sortTypes || [], rows: rows, shown: rows, limit: PAGE_ROWS };
    TABLE_SORT = { col: null, dir: 1 };
  }

  // น้ำหนักความกว้างคอลัมน์ คงที่ตามชนิด/หัวข้อ ไม่อิงความยาวข้อมูลจริง กันตารางขยาย/โผล่แถบเลื่อนแนวนอนตอนเรียงสลับแถว
  // (เมื่อก่อนใช้ auto layout แล้ว white-space:nowrap เลยยืดตามแถวที่โชว์อยู่ พอเรียงสลับแถวที่ยาวกว่าขึ้นมา ตารางก็โตเกินจอ)
  function sunColWeight(head, type) {
    if (type === 'number') return 1.1;
    if (head === 'SKU') return 2.4;
    if (head.indexOf('ชื่อ') === 0) return 2.6;
    if (!type) return 1.3; // คอลัมน์เรียงไม่ได้ (เช่น เกรด/ป้าย) มักสั้น
    return 1.8;
  }

  function tableShell() {
    const weights = VIEW.head.map(function (h, idx) { return sunColWeight(h, VIEW.sortTypes[idx]); });
    const totalWeight = weights.reduce(function (a, b) { return a + b; }, 0);
    const ths = VIEW.head.map(function (h, idx) {
      const type = VIEW.sortTypes[idx];
      const widthStyle = ' style="width:' + (weights[idx] / totalWeight * 100).toFixed(2) + '%"';
      if (!type) return '<th' + widthStyle + '>' + esc(h) + '</th>';
      return '<th class="sun-sortable" data-sun-sort="' + idx + '" data-sun-type="' + type + '"' + widthStyle + '>' +
        esc(h) + ' <span class="sun-sort-ic" data-sortic="' + idx + '"></span></th>';
    }).join('');
    return '<div class="sun-tablewrap"><table class="sun-table sun-table-fixed"><thead><tr>' + ths +
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
    // ค้นหาหลาย SKU พร้อมกันได้: คั่นด้วยจุลภาค/เซมิโคลอน/ขึ้นบรรทัดใหม่ (วาง/พิมพ์ก็ได้) เจอคำไหนคำหนึ่งก็ถือว่าผ่าน
    // ถ้าแต่ละคำมีจำนวนติดมาด้วย (เช่น วางมาจากไฟล์ "SKU จำนวน" คนละคอลัมน์ติดกัน) ตัดจำนวนทิ้ง เหลือแค่ SKU ไว้ค้นหา
    const queryTerms = searchEl ? sunSkuTerms(searchEl.value.toLowerCase()) : [];
    const brands = getMultiselectValues('purchBrand').map(function (b) { return b.toUpperCase(); });
    const grades = getMultiselectValues('purchGrade');
    const recs = getMultiselectValues('purchRec');

    let list = VIEW.rows;
    if (queryTerms.length || brands.length || grades.length || recs.length) {
      list = list.filter(function (r) {
        if (brands.length && !brands.some(function (b) { return r.brand.indexOf(b) > -1; })) return false;
        if (grades.length && grades.indexOf(r.grade) === -1) return false;
        if (recs.length && recs.indexOf(r.rec) === -1) return false;
        return !queryTerms.length || queryTerms.some(function (q) { return r.search.indexOf(q) > -1; });
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
    doc.write('<!doctype html><html lang="th"><head><meta charset="utf-8"><title>Plan Order</title><style>' +
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

      if (mode === 'purchase') renderPurchase(hist, st, skuNames, moveMap, buildComMap(CACHE['COM']), buildComMap(CACHE['FRONTSALE']));
      else if (mode === 'stockin') renderStockIn(CACHE['SI']);
      else if (mode === 'idle') renderIdleLocations(hist, st);
      else renderBestSellers(hist, skuNames);

      let comNote = '';
      if (mode === 'purchase') {
        if (CACHE['COMERR']) comNote = ' | ⚠️ อ่านตาราง op_com ไม่ได้ (' + CACHE['COMERR'] + ') สั่งเป้าจึงเป็น 0';
        else if (!(CACHE['COM'] || []).length) comNote = ' | op_com อ่านได้ 0 แถว สั่งเป้าจึงเป็น 0 (ถ้าในตารางมีข้อมูลอยู่ แปลว่ายังไม่เปิดสิทธิ์อ่าน ให้รัน supabase/op_com_read.sql)';
        else comNote = ' | สั่งเป้าจาก op_com ' + CACHE['COM'].length.toLocaleString() + ' แถว';
      }
      setStatus('อัปเดตล่าสุด ' + new Date().toLocaleTimeString('th-TH') + comNote);
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
    // แถบปุ่ม (รีเฟรช/ดาวน์โหลด/นำเข้า/พิมพ์) ใช้ได้แค่หน้าใบสั่งซื้อล่วงหน้า หน้าอื่นซ่อนไปเลยกันสับสน
    const actions = root.querySelector('.sun-actions');
    if (actions) actions.hidden = (mode !== 'purchase');
    // ไม่ล้างคำค้นตอนสลับแท็บ/สลับหน้า — ให้ค้างไว้จนกว่าจะกดรีเฟรชหน้าเว็บจริงๆ (applyView อ่านคำค้นปัจจุบันเองอยู่แล้วตอนโหลดเสร็จ)
    loadData(mode);
  }

  // หน้าใบสั่งซื้อ: true = โชว์ทุก SKU ใน products, false = เฉพาะตัวที่ถึงจุดสั่งซื้อ
  let PURCHASE_SHOW_ALL = true;

  let TARGET_EXPORT = []; // [sku, สั่งเป้าที่เหลือ] ของ SKU ที่ยังเหลือ > 0 (ใช้ดาวน์โหลดไฟล์สั่งเป้า)

  // รวมยอด "สั่งเป้า" (op_com.qty) ต่อ SKU — qty หักเคลื่อนไหวมาแล้วจากฝั่งฐานข้อมูล (op_com_recalc) ไม่ต้องหักซ้ำฝั่งนี้
  function buildComMap(rows) {
    const m = {};
    (rows || []).forEach(function (r) {
      const sku = norm(r.sku);
      if (!sku) return;
      m[sku] = (m[sku] || 0) + num(r.qty);
    });
    return m;
  }

  // รหัสที่ใช้แทนกันได้: ใช้ชื่อรวม (เช่น 010223/010234-ดำ-XL) เป็นตัวตั้ง แล้วรวมรหัสเดี่ยว (010223-ดำ-XL, 010234-ดำ-XL) เข้าหา
  // กลุ่มรหัสมาจาก (1) SKU ที่ตั้งชื่อรวมด้วย "/" ในข้อมูลจริง (2) คู่รหัสใน js/move-rules.js เช่น 001478-001520
  // รหัสตัวเลขเทียบแบบไม่สน 0 นำหน้า · ชื่อรวมต้องเป็นรหัสตัวเลข 4 หลักขึ้นไปทุกตัว (กันชื่อสินค้าอย่าง SA306/1 ถูกนับเป็นกลุ่ม)
  function buildCanonSku(allSkuLists) {
    const strip = function (c) { return String(c).trim().replace(/^0+/, ''); };
    const isGroup = function (parts) { return parts.length > 1 && parts.every(function (p) { return /^\d{4,}$/.test(p.trim()); }); };
    const parent = {};
    const find = function (x) { while (parent[x] && parent[x] !== x) x = parent[x]; return x; };
    const union = function (codes) {
      codes.forEach(function (c) { if (!parent[c]) parent[c] = c; });
      const r = find(codes[0]);
      codes.slice(1).forEach(function (c) { const rc = find(c); if (rc !== r) parent[rc] = r; });
    };
    const named = {}; // root → ชื่อรวมที่พบในข้อมูล (เลือกตัวที่มีรหัสมากสุด)
    const ruleName = {}; // root → ชื่อรวมจากคู่รหัสใน move-rules (ใช้เมื่อไม่มีชื่อรวมในข้อมูล)
    allSkuLists.forEach(function (list) {
      list.forEach(function (sku) {
        const s = String(sku), i = s.indexOf('-');
        if (i < 1) return;
        const parts = s.slice(0, i).split('/');
        if (isGroup(parts)) union(parts.map(strip));
      });
    });
    const rules = window.MOVE_BUFFER_RULES || {};
    Object.keys(rules).forEach(function (brand) {
      Object.keys(rules[brand]).forEach(function (code) {
        const parts = String(code).split('-');
        if (isGroup(parts)) union(parts.map(strip));
      });
    });
    allSkuLists.forEach(function (list) {
      list.forEach(function (sku) {
        const s = String(sku), i = s.indexOf('-');
        if (i < 1) return;
        const seg = s.slice(0, i), parts = seg.split('/');
        if (!isGroup(parts)) return;
        const r = find(strip(parts[0]));
        if (!named[r] || named[r].split('/').length < parts.length) named[r] = seg;
      });
    });
    Object.keys(rules).forEach(function (brand) {
      Object.keys(rules[brand]).forEach(function (code) {
        const parts = String(code).split('-');
        if (!isGroup(parts)) return;
        const r = find(strip(parts[0]));
        if (!ruleName[r]) ruleName[r] = parts.map(function (p) { return /^\d{6,}$/.test(p) ? p : ('000000' + p).slice(-6); }).join('/');
      });
    });
    return function (sku) {
      const s = String(sku), i = s.indexOf('-');
      if (i < 1) return s;
      const parts = s.slice(0, i).split('/');
      const first = strip(parts[0]);
      if (!(parts.length === 1 ? /^\d{4,}$/.test(parts[0].trim()) : isGroup(parts))) return s;
      if (!parent[first]) return s;
      const r = find(first);
      const head = named[r] || ruleName[r];
      return head ? head + s.slice(i) : s;
    };
  }

  // รวมค่าในแผนที่ {sku: ตัวเลข} เข้าหาชื่อรวม
  function mergeNumMap(map, canon) {
    const out = {};
    Object.keys(map || {}).forEach(function (k) { const c = canon(k); out[c] = (out[c] || 0) + (Number(map[k]) || 0); });
    return out;
  }

  function renderPurchase(hist, st, skuNames, moveMap, comMap, frontSaleMap) {
    const rawStock = buildStock(st);
    const rawVel = buildVelocity(hist);
    const canon = buildCanonSku([Object.keys(skuNames), Object.keys(rawVel), Object.keys(rawStock), Object.keys(comMap || {}), Object.keys(frontSaleMap || {})]);
    const vel = mergeNumMap(rawVel, canon);
    const stock = {};
    Object.keys(rawStock).forEach(function (k) {
      const c = canon(k), s = rawStock[k];
      if (!stock[c]) stock[c] = { F: 0, K: 0, Y: 0, total: 0, locs: [] };
      stock[c].F += s.F; stock[c].K += s.K; stock[c].Y += s.Y; stock[c].total += s.total;
      stock[c].locs = stock[c].locs.concat(s.locs || []);
    });
    moveMap = mergeNumMap(moveMap, canon);
    comMap = mergeNumMap(comMap, canon);
    frontSaleMap = mergeNumMap(frontSaleMap, canon);
    const names = {};
    Object.keys(skuNames).forEach(function (k) { const c = canon(k); if (!names[c] || names[c] === '-') names[c] = skuNames[k]; });
    skuNames = names;
    // ค้นหาด้วยรหัสเดี่ยวเดิมก็ยังเจอแถวชื่อรวม (เช่น ค้น 012283-ดำ เจอ 012106/012283/012586-ดำ-…)
    const aliasSearch = {};
    [Object.keys(rawVel), Object.keys(rawStock), Object.keys(names)].forEach(function (keys) {
      keys.forEach(function (k) { const c = canon(k); if (c !== k) aliasSearch[c] = (aliasSearch[c] || '') + ' ' + k.toLowerCase(); });
    });
    const th = getBestThresholds(); // ใช้เกณฑ์เดียวกับหน้าสินค้าขายดี ABC ไม่ต้องตั้งซ้ำ

    // SKU ทั้งหมด = ทุกตัวใน products (+ ชื่อจาก ST) รวมกับตัวที่มียอดขาย — ตัวที่ไม่มียอดขายจะได้ยอด 0
    const allSkus = Object.keys(Object.assign({}, skuNames, vel));

    let list = allSkus.map(function (sku) {
      const s = stock[sku] || { F: 0, K: 0, Y: 0, total: 0 };
      const sold = vel[sku] || 0;
      // สต๊อก FRONT ต้องปริ้นใบไปเช็คนับจริงก่อนถึงจะเชื่อได้ ไม่เอามารวมคำนวณสั่งซื้อ
      const verified = s.K + s.Y;
      // สั่งเป้า (op_com.qty) หักเคลื่อนไหวมาแล้วจากฝั่งฐานข้อมูล (ดู op_com_recalc ใน supabase/op_com_recalc.sql) ใช้ค่าตรงๆ ได้เลย
      // ไม่มีผลกับ "สั่งเพิ่ม" (ยังเป็นสูตรเดิม: ขาย 3 ด. − คลัง − เคลื่อนไหว) และไม่มีผลกับเกณฑ์ถึงจุดสั่งซื้อ
      const moveQty = (moveMap && moveMap[sku]) || 0;
      const target = (comMap && comMap[sku]) || 0;                                     // สั่งเป้าที่เหลือ (แสดงในตาราง)
      const ads = sold / CFG.HIST_DAYS;
      const cover = ads > 0 ? verified / ads : 9999;
      const rop = ads * (CFG.LEAD_DAYS + CFG.SAFETY_DAYS);
      return {
        sku: sku, sold: sold, ads: ads, F: s.F, K: s.K, Y: s.Y,
        total: s.total, verified: verified, target: target, cover: cover, rop: rop,
        move: (moveMap && moveMap[sku]) || 0,
        order: Math.max(0, sold - verified - moveQty) // สั่งเพิ่ม = ยอดขาย 3 เดือน - คลัง - เคลื่อนไหว (สูตรเดิม)
      };
    });

    list = gradeList(list, 'sold');
    TARGET_EXPORT = list.filter(function (i) { return i.target > 0; }).map(function (i) { return [i.sku, i.target]; });
    // SKU ที่อยู่ใน op_com แต่ไม่มียอดขาย/ไม่อยู่ใน products: ใส่ในไฟล์ด้วย (qty หักเคลื่อนไหวมาแล้วจาก DB)
    Object.keys(comMap || {}).forEach(function (sku) {
      if (list.some(function (i) { return i.sku === sku; })) return;
      const t = comMap[sku];
      if (t > 0) TARGET_EXPORT.push([sku, t]);
    });

    const isUrgent = function (i) { return i.ads > 0 && i.verified <= i.rop; };
    const urgent = list.filter(isUrgent).sort(function (a, b) { return a.cover - b.cover; });

    // โหมด "ทั้งหมด": ตัวที่ต้องสั่งขึ้นก่อน ตามด้วย SKU ที่เหลือทั้งหมดใน products เรียงตามยอดขาย
    const rows = PURCHASE_SHOW_ALL
      ? urgent.concat(list.filter(function (i) { return !isUrgent(i); }))
      : urgent;


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
        cell((frontSaleMap && frontSaleMap[i.sku]) || 0, 'sun-num'), // ขาย (หน้าร้าน) — จาก op_front_sale (FRONT/ในบ้าน) แยกจาก "คลัง" เดิม
        cell(i.target, 'sun-num'),
        cell(moveTxt, 'sun-num ' + moveCls),
        cell(i.order, 'sun-num', '<b>' + esc(i.order) + '</b>'),
        cell(rec.label, 'sun-' + rec.cls)
      ], {
        cls: i.cover <= CFG.LEAD_DAYS ? 'sun-row-warn' : '',
        brand: name.toUpperCase(), grade: i.grade, rec: rec.cls,
        urgent: isUrgent(i), order: i.order, sku: i.sku,
        search: (i.sku + ' ' + name).toLowerCase() + (aliasSearch[i.sku] || '')
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

    setView(['เกรด', 'SKU', 'ชื่อสินค้า', 'ขาย 3 ด.', 'ขาย/เดือน', 'ขาย/วัน', 'คลัง', 'ขาย', 'สั่งเป้า', 'เคลื่อนไหว', 'สั่งเพิ่ม', 'คำแนะนำ'],
      ['text', 'text', 'text', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'number', 'text'], viewRows);
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

  // ตำแหน่งไม่เคลื่อนไหว: ตำแหน่งที่ไม่ใช่ลัง H เรียงจากยอดขาย 3 เดือนของ SKU ในตำแหน่งนั้น น้อย → มาก
  // ใช้หาตำแหน่งที่ของไม่ค่อยถูกเบิก จะได้ย้ายของจากลัง H มาสลับแทน
  // (ประมาณจากยอดขายต่อ SKU เพราะฐานข้อมูลไม่มีประวัติเบิกออกแยกตามตำแหน่ง)
  const IDLE_LOW_SOLD = 5; // ขาย 3 เดือนรวมไม่เกินนี้ = "เบิกน้อย" (0 = "ไม่เคลื่อนไหว")
  function renderIdleLocations(hist, st) {
    const sold = {};
    (hist || []).forEach(function (r) {
      const sku = norm(r['SKU Merchant']).toUpperCase();
      if (sku) sold[sku] = (sold[sku] || 0) + num(r['จำนวน']);
    });
    // ยอดขายของ SKU: ชื่อรวมรหัสในสต็อก (เช่น 010223/010234-กรม-XL) ยอดขายบันทึกแยกตามรหัสเดี่ยว ต้องรวมของทุกรหัส
    // เทียบรหัสตัวเลขแบบไม่สน 0 นำหน้า (072083 = 72083)
    const soldByCode = {};
    Object.keys(sold).forEach(function (k) {
      const i = k.indexOf('-');
      if (i < 1) return;
      const c = k.slice(0, i), key = (/^\d+$/.test(c) ? c.replace(/^0+/, '') : c) + k.slice(i);
      soldByCode[key] = (soldByCode[key] || 0) + sold[k];
    });
    function soldOf(sku) {
      const s = sku.toUpperCase();
      const i = s.indexOf('-');
      if (i < 1 || s.slice(0, i).indexOf('/') === -1) return sold[s] || 0;
      const rest = s.slice(i);
      return s.slice(0, i).split('/').reduce(function (sum, c) {
        c = c.trim();
        return sum + (soldByCode[(/^\d+$/.test(c) ? c.replace(/^0+/, '') : c) + rest] || 0);
      }, 0) + (sold[s] || 0);
    }

    const locs = {};
    (st || []).forEach(function (r) {
      const loc = norm(r['ตำแหน่ง']);
      const up = loc.toUpperCase();
      const qty = num(r['สต็อกที่มีอยู่ของตำแหน่ง']);
      const sku = norm(r['ชื่อSKU']);
      if (!loc || !sku || qty <= 0) return;
      if (/^H-/.test(up)) return; // ลัง H ไม่นับ (เป็นที่มาของของที่จะสลับเข้า)
      if (EXCLUDED_LOCATIONS.indexOf(up) !== -1 || up.indexOf('FRONT') === 0) return;
      if (!locs[loc]) locs[loc] = { loc: loc, group: up.split('-')[0], qty: 0, skus: {}, sold: 0 };
      const L = locs[loc];
      L.qty += qty;
      if (!L.skus[sku]) { L.skus[sku] = 0; L.sold += soldOf(sku); }
      L.skus[sku] += qty;
    });
    const list = Object.keys(locs).map(function (k) { return locs[k]; })
      .sort(function (a, b) { return a.sold - b.sold || b.qty - a.qty || a.loc.localeCompare(b.loc, 'th', { numeric: true }); });

    let idle = 0, low = 0;
    const viewRows = list.map(function (L) {
      const skuNames = Object.keys(L.skus);
      const status = L.sold === 0 ? 'ไม่เคลื่อนไหว' : L.sold <= IDLE_LOW_SOLD ? 'เบิกน้อย' : 'ปกติ';
      if (status === 'ไม่เคลื่อนไหว') idle++; else if (status === 'เบิกน้อย') low++;
      const stCls = status === 'ไม่เคลื่อนไหว' ? 'sun-warn' : status === 'เบิกน้อย' ? '' : 'sun-good';
      const skuText = skuNames.map(function (s) { return s + ' (' + L.skus[s] + ')'; }).join(', ');
      return mkRow([
        cell(L.loc, 'sun-loc sun-copy'), cell(L.group), cell(skuNames.length, 'sun-num'), cell(L.qty, 'sun-num'),
        cell(L.sold, 'sun-num'), cell((L.sold / 3).toFixed(1), 'sun-num'),
        cell(status, stCls, '<b>' + esc(status) + '</b>'), cell(skuText)
      ], { search: (L.loc + ' ' + skuNames.join(' ')).toLowerCase() });
    });

    setView(['ตำแหน่ง', 'กลุ่ม', 'จำนวน SKU', 'ของในตำแหน่ง', 'ขาย 3 ด.', 'ขาย/เดือน', 'สถานะ', 'SKU ในตำแหน่ง (จำนวน)'],
      ['text', 'text', 'number', 'number', 'number', 'number', 'text', 'text'], viewRows);
    mountView(
      cards([
        { label: 'ตำแหน่งทั้งหมด (ไม่รวมลัง H)', value: list.length.toLocaleString() },
        { label: 'ไม่เคลื่อนไหว (ขาย 3 ด. = 0)', value: idle.toLocaleString(), type: 'warn' },
        { label: 'เบิกน้อย (ขาย 3 ด. 1–' + IDLE_LOW_SOLD + ')', value: low.toLocaleString() }
      ]) +
      '<div class="sun-idle-bar"><span class="sun-hint">เรียงจากขายน้อยสุด · ค้นหาด้วยชื่อตำแหน่ง (เช่น C-G) หรือ SKU ได้ที่ช่องค้นหาด้านบน · ยอดขายประมาณจาก SKU ในตำแหน่ง (ถ้า SKU อยู่หลายตำแหน่ง นับให้ทุกตำแหน่ง)</span>' +
      '<button type="button" class="sun-primary" data-sun-idle-xlsx>⬇ ดาวน์โหลด Excel</button></div>'
    );
    setPendingChecklist('', []);
  }
  root.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    if (e.target.closest('[data-sun-idle-xlsx]')) { exportExcel(); return; }
    // กดชื่อตำแหน่ง = คัดลอกทันที
    const td = e.target.closest('td.sun-copy');
    if (!td) return;
    const text = td.textContent.trim();
    if (!text) return;
    const done = function () {
      if (typeof window.fxToast === 'function') window.fxToast('คัดลอก ' + text + ' แล้ว', 'success');
      td.classList.add('is-copied');
      setTimeout(function () { td.classList.remove('is-copied'); }, 700);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(function () { fallbackCopy(text); done(); });
    } else { fallbackCopy(text); done(); }
  });
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (err) { /* ไม่กระทบ */ }
    ta.remove();
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
    // หน้าใบสั่งซื้อ: เอาทุกแถวที่แสดงอยู่ รวมแถวที่ "สั่งเพิ่ม" เป็น 0 ด้วย
    const orderCol = VIEW.head.indexOf('สั่งเพิ่ม');
    const exportRows = VIEW.shown;
    // หน้าใบสั่งซื้อล่วงหน้า: ไฟล์ Excel เหลือเฉพาะคอลัมน์ SKU, ขาย 3 ด., คลัง, ขาย (หน้าร้าน), สั่งเป้า, เคลื่อนไหว, สั่งเพิ่ม
    // (เกรด/ชื่อสินค้ายังใช้แยกชีตอยู่ แต่ไม่ต้องใส่ในชีต เพราะอยู่ในชื่อชีตแล้ว)
    const EXPORT_KEEP = ['SKU', 'ขาย 3 ด.', 'คลัง', 'ขาย', 'สั่งเป้า', 'เคลื่อนไหว', 'สั่งเพิ่ม'];
    let keep = VIEW.head.map(function (h, i) { return i; });
    if (orderCol >= 0) {
      const idx = EXPORT_KEEP.map(function (h) { return VIEW.head.indexOf(h); }).filter(function (i) { return i >= 0; });
      if (idx.length) keep = idx;
    }
    const outHead = keep.map(function (i) { return VIEW.head[i]; });
    const toRow = function (r) {
      return keep.map(function (i) { const c = r.cells[i]; return VIEW.sortTypes[i] === 'number' ? sortKey(c, 'number') : c.v; });
    };
    const wb = XLSX.utils.book_new();
    const nameCol = VIEW.head.indexOf('ชื่อสินค้า'), gradeCol = VIEW.head.indexOf('เกรด');

    if (nameCol >= 0 && gradeCol >= 0) {
      // แยกชีตตาม "แบรนด์ + เกรด" เช่น WARRIX A, WARRIX B (แบรนด์ตามรายการในตัวกรองแบรนด์) — ข้อมูลในแต่ละชีตตรงกับชื่อชีตเท่านั้น
      const groups = new Map();
      exportRows.forEach(function (r) {
        const name = brandOf(r.cells[nameCol].v);
        const grade = String(r.cells[gradeCol].v == null ? '' : r.cells[gradeCol].v).trim() || '-';
        const key = name + '\u0000' + grade;
        if (!groups.has(key)) groups.set(key, { name: name, grade: grade, rows: [] });
        groups.get(key).rows.push(r);
      });
      // เรียงตามลำดับแบรนด์ในตัวกรอง (อื่นๆ ไว้ท้ายสุด) แล้วตามเกรด A, B, C
      const rank = function (n) { const i = BRANDS.indexOf(n); return i < 0 ? BRANDS.length : i; };
      const list = Array.from(groups.values()).sort(function (a, b) {
        return rank(a.name) - rank(b.name) || a.grade.localeCompare(b.grade);
      });
      const used = new Set();
      list.forEach(function (g) {
        // ชื่อชีต Excel: ไม่เกิน 31 ตัวอักษร ห้ามมี \ / ? * [ ] : และห้ามซ้ำ
        const grade = ' ' + g.grade;
        let base = g.name.replace(/[\\\/\?\*\[\]:]/g, '-').trim().slice(0, 31 - grade.length).trim() + grade;
        let nm = base, n = 2;
        while (used.has(nm.toLowerCase())) { const suf = ' (' + n++ + ')'; nm = base.slice(0, 31 - suf.length) + suf; }
        used.add(nm.toLowerCase());
        // เรียงแถวในแต่ละชีตตามตัวอักษรของ SKU (A→Z, ตัวเลขเรียงตามค่า เช่น 2 ก่อน 10)
        const skuCol = VIEW.head.indexOf('SKU');
        if (skuCol >= 0) {
          g.rows.sort(function (a, b) {
            return String(a.cells[skuCol].v).localeCompare(String(b.cells[skuCol].v), 'th', { numeric: true, sensitivity: 'base' });
          });
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([outHead].concat(g.rows.map(toRow))), nm);
      });
    } else {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([outHead].concat(exportRows.map(toRow))), 'Report');
    }
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

  // ST: ตัดตำแหน่ง FRONT* / DELETE / ในบ้าน / X001 (ชำรุด) ทิ้ง
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

  // ขาย (หน้าร้าน) — อ่านไฟล์ ST ชุดเดียวกับ toStockRows แต่กลับด้าน: เอาเฉพาะแถว FRONT/ในบ้าน (ที่ toStockRows ตัดทิ้งไปตอนคิด "คลัง")
  // และอ่านคอลัมน์ "สต็อกพร้อมขายของตำแหน่ง" แทน — ไปเก็บตาราง op_front_sale แยกต่างหาก ไม่แตะ op_stock/การคำนวณ "คลัง" เดิมเลย
  // ถ้าไฟล์ไม่มีคอลัมน์นี้ (ไฟล์เก่า/รูปแบบอื่น) ข้ามไปเงียบๆ ไม่ให้กระทบการอัปโหลด ST หลัก
  function toFrontSaleRows(tbl) {
    const has = function (h) { return tbl[0].indexOf(h) !== -1; };
    if (!has('ชื่อSKU') || !has('ตำแหน่ง') || !has('สต็อกพร้อมขายของตำแหน่ง')) return [];
    const map = {};
    rowsToObjects(tbl).forEach(function (r) {
      const loc = norm(r['ตำแหน่ง']).toUpperCase();
      if (loc.indexOf('FRONT') !== 0 && loc !== 'ในบ้าน') return;
      const sku = norm(r['ชื่อSKU']);
      if (!sku) return;
      map[sku] = (map[sku] || 0) + num(r['สต็อกพร้อมขายของตำแหน่ง']);
    });
    return Object.keys(map).map(function (sku) { return { sku: sku, qty: map[sku] }; });
  }

  // COM: เพิ่มต่อท้ายตาราง op_com (คอลัมน์ sku, qty) — แปลงหัวคอลัมน์ของไฟล์ให้เป็น sku / qty อัตโนมัติ
  //   sku ← SKU Merchant, SKU, ชื่อSKU (หรือ sku)   |   qty ← จำนวน, สต็อกที่มีอยู่ของตำแหน่ง, qty, quantity
  const COM_SKU_HEADS = ['sku merchant', 'sku', 'ชื่อsku', 'sku_merchant'];
  const COM_QTY_HEADS = ['จำนวน', 'qty', 'quantity', 'สต็อกที่มีอยู่ของตำแหน่ง'];
  function toComRows(tbl, st) {
    st = st || {};
    st.emptyRows = 0; st.noSku = 0;
    const heads = tbl[0].map(function (h) { return norm(h).toLowerCase(); });
    const findCol = function (names) {
      for (let k = 0; k < names.length; k++) { const i = heads.indexOf(names[k]); if (i >= 0) return i; }
      return -1;
    };
    const si = findCol(COM_SKU_HEADS), qi = findCol(COM_QTY_HEADS);
    if (si < 0 || qi < 0) {
      throw new Error('ไม่พบหัวคอลัมน์ SKU (SKU Merchant / SKU / sku) และ จำนวน (จำนวน / qty) ในไฟล์');
    }
    st.cols = ['sku', 'qty'];
    st.mapped = norm(tbl[0][si]) + ' → sku, ' + norm(tbl[0][qi]) + ' → qty';
    const out = [];
    tbl.slice(1).forEach(function (row) {
      const sku = norm(row[si]);
      const rawQty = row[qi] == null ? '' : String(row[qi]).replace(/,/g, '').trim();
      if (!sku && rawQty === '') { st.emptyRows++; return; }
      if (!sku) { st.noSku++; return; }
      out.push({ sku: sku, qty: rawQty === '' ? 0 : num(rawQty) });
    });
    return out;
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
  async function replaceTable(target, rows, passcode, onProgress, fn) {
    const client = sb();
    let sent = 0;
    for (let i = 0; i === 0 || i < rows.length; i += UPLOAD_CHUNK) {
      const chunk = rows.slice(i, i + UPLOAD_CHUNK);
      const res = fn === 'op_append'
        ? await client.rpc('op_append', { p_passcode: passcode, p_target: target, p_rows: chunk, p_reset: i === 0 })
        : await client.rpc('op_upload', { p_passcode: passcode, p_target: target, p_rows: chunk, p_reset: i === 0 });
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

    // ไม่ต้องใส่รหัส: ส่งรหัสว่างไป (ฐานข้อมูลตั้งรหัสเป็นค่าว่างแล้ว ดู askUploadPasscode)
    // ถ้าฐานข้อมูลยังตั้งรหัสไว้ จะถามรหัสตอนกดอัปโหลดครั้งถัดไปแทน
    if (!askUploadPasscode()) {
      log.innerHTML = '<span class="sun-warn">ยกเลิก: ต้องใส่รหัสอัปโหลดก่อน</span>';
      return false;
    }
    const passcode = uploadPasscode;

    try {
      let msg = 'อัปโหลดสำเร็จ: ';
      for (const p of payload) {
        const count = await replaceTable(p.target, p.rows, passcode, function (done, total) {
          log.textContent = (p.append ? 'กำลังเพิ่มต่อท้าย ' : 'กำลังอัปโหลด ') + p.label + ' ' + done + '/' + total + ' แถว ...';
        }, p.fn);
        msg += (p.append ? 'เพิ่มต่อท้าย ' : '') + p.label + ' ' + count + ' แถว | ';
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
      if (/รหัสอัปโหลด/.test(err.message)) {
        // ฐานข้อมูลยังต้องการรหัส (หรือรหัสผิด): ครั้งหน้าถามรหัส ไม่มีอะไรถูกเขียนลงตาราง เพราะเช็กรหัสก่อนเขียน
        uploadPasscode = '';
        needUploadPasscode = true;
        log.innerHTML = '<span class="sun-warn">ฐานข้อมูลยังตั้งรหัสอัปโหลดไว้ กดอัปโหลดอีกครั้งเพื่อใส่รหัส</span>';
        return false;
      }
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
      eyebrow: '01 / SALES', icon: '3M', title: 'ยอดขายย้อนหลัง → 3M', zipOnly: true,
      desc: 'เลือกไฟล์ ZIP ยอดขาย (รับเฉพาะ .zip เท่านั้น หลายไฟล์ได้) ระบบแตกไฟล์ รวมยอดต่อ SKU และตัดออเดอร์ยกเลิกให้ก่อน แล้วแสดงตัวอย่าง ตรวจแล้วค่อยกดอัปโหลดทับตาราง op_sales',
      sheet: '3M', build: toSalesRows, target: 'sales', label: '3M (ยอดขายย้อนหลัง)',
      cols: ['SKU Merchant', 'จำนวน'], cells: function (r) { return [r.sku, r.qty]; },
      dropped: function (s) { return 'ตัดออเดอร์ยกเลิก ' + s.cancelled.toLocaleString() + ' แถว · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว · รวมยอดต่อ SKU'; }
    },
    st: {
      eyebrow: '02 / STOCK', icon: 'ST', title: 'สต๊อกและตำแหน่ง → ST', zipOnly: true,
      desc: 'เลือกไฟล์ ZIP สต๊อก (รับเฉพาะ .zip เท่านั้น หลายไฟล์ได้) ระบบแตกไฟล์ รวม และตัดตำแหน่ง FRONT/DELETE/ในบ้าน/X001 (ชำรุด) ให้ก่อน แล้วแสดงตัวอย่าง ตรวจแล้วค่อยกดอัปโหลดทับตาราง op_stock',
      sheet: 'ST', build: toStockRows, target: 'stock', label: 'ST (สต๊อกและตำแหน่ง)',
      cols: ['SKU', 'ชื่อ SKU', 'ตำแหน่ง', 'จำนวน'], cells: function (r) { return [r.sku, r.sku_name, r.location, r.qty]; },
      dropped: function (s) { return 'ตัดตำแหน่ง FRONT/DELETE/ในบ้าน/X001 ' + s.excludedLoc.toLocaleString() + ' แถว · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว'; }
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
    },
    com: {
      eyebrow: '04 / TARGET', icon: 'COM', title: 'สั่งเป้า → op_com', fn: 'op_append',
      desc: 'เลือกไฟล์ (Excel/CSV หรือ ZIP หลายไฟล์ได้) ระบบแตกไฟล์และรวมให้ แล้วเปลี่ยนหัวคอลัมน์เป็น sku + qty ให้เอง (จาก SKU Merchant / SKU และ จำนวน) แสดงตัวอย่าง ตรวจแล้วกดอัปโหลดเพื่อเขียนทับตาราง op_com (ข้อมูลเดิมถูกแทนที่ทั้งหมดด้วยไฟล์ใหม่)',
      sheet: null, build: toComRows, target: 'com', label: 'COM (เพิ่มต่อท้าย)',
      cols: null, cells: null,
      dropped: function (s) { return 'เปลี่ยนหัวคอลัมน์: ' + s.mapped + ' · ข้ามแถวว่าง ' + s.emptyRows.toLocaleString() + ' แถว · ไม่มี SKU ' + s.noSku.toLocaleString() + ' แถว · เขียนทับข้อมูลเดิมทั้งหมด'; }
    }
  };
  const KIND_IDS = ['m3', 'st', 'si', 'com'];
  const PREP = { m3: null, st: null, si: null, com: null };
  const PREP_SEQ = { m3: 0, st: 0, si: 0, com: 0 };
  // ชุดองค์ประกอบของแต่ละชนิด: "sun…" = หน้านำเข้าข้อมูล (เดิมมี "sunM…" ของการ์ด SI ที่หน้ารวมไฟล์ ZIP ด้วย แต่หน้านั้นถูกเอาออกแล้ว)
  const PREFIXES = ['sun'];
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
      const accept = c.zipOnly ? '.zip' : '.xlsx,.xls,.csv,.zip';
      const hint = c.zipOnly ? 'รับเฉพาะไฟล์ ZIP เท่านั้น (เลือกได้หลายไฟล์)' : 'หรือลากไฟล์ Excel / CSV / ZIP มาวางที่นี่ (เลือกได้หลายไฟล์)';
      return '<section class="sun-imp-card" id="sunCard_' + k + '">' +
        '<div class="sun-imp-eyebrow">' + c.eyebrow + '</div>' +
        '<h2>' + esc(c.title) + '</h2>' +
        // ST เท่านั้น: ดึงไฟล์จาก BigSeller อัตโนมัติผ่านส่วนขยาย (stock-sync-extension) แล้วใส่ช่องไฟล์ให้ จากนั้นเป็นขั้นตอนปกติ
        // SI: ส่วนขยายตั้งช่วงเวลา "เมื่อวาน" + ค้นหาชื่อตำแหน่ง FRONT ที่หน้าการเคลื่อนไหวสต็อกให้เองก่อนส่งออก
        (k === 'st' || k === 'si' || k === 'm3' ? '<div class="sun-imp-auto"><button type="button" class="sun-imp-auto-btn" id="sunAuto_' + k + '" title="ต้องติดตั้งส่วนขยาย ส่งสต็อก BigSeller เข้า ORDER และล็อกอิน BigSeller ไว้ในเบราว์เซอร์นี้">🤖 ดึงจาก BigSeller อัตโนมัติ' + (k === 'si' ? ' (เมื่อวาน · FRONT)' : '') + (k === 'm3' ? ' (ใช้เวลานานกว่า)' : '') + '</button></div>' : '') +
        '<div class="sun-imp-drop" id="sunDrop_' + k + '"><div class="sun-imp-badge">' + c.icon + '</div>' +
          '<strong>📁 คลิกเพื่อเลือกไฟล์ ' + c.icon + '</strong>' +
          '<span>' + hint + '</span>' +
          '<input id="sunIn_' + k + '" type="file" accept="' + accept + '" multiple></div>' +
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

    // ชนิดที่จำกัดแค่ ZIP (3M/ST): เผื่อลากไฟล์วางซึ่งไม่เช็ค accept ของ input ให้ด้วย กันหลุดเป็น Excel/CSV ตรงๆ
    if (cfg.zipOnly && raw.some(function (f) { return !/\.zip$/i.test(f.name); })) {
      PREP[kind] = { sig: fileSig(raw), kind: kind, error: 'การ์ดนี้รับเฉพาะไฟล์ ZIP เท่านั้น กรุณาบีบอัดไฟล์เป็น .zip ก่อนแล้วค่อยเลือกใหม่' };
      renderPrep(kind);
      return null;
    }

    const sig = fileSig(raw);
    if (!force && PREP[kind] && PREP[kind].sig === sig) return PREP[kind];

    const seq = ++PREP_SEQ[kind];
    toggleCard(kind, true);
    setCardStatus(kind, '⏳ กำลังแตก/รวมไฟล์ ' + raw.length + ' ไฟล์ ...', 35);
    let prep;
    try {
      const files = await expandZips(raw);
      const table = await readMultipleSheetFiles(files, cfg.sheet);
      if (table.length < 2) throw new Error('ไม่พบข้อมูลในไฟล์');
      const stats = {};
      const rows = cfg.build(table, stats);
      // ST เท่านั้น: อ่านช่อง "ขาย" (FRONT/ในบ้าน) จากไฟล์ชุดเดียวกันไปด้วยในตัว ไม่ต้องอัปโหลดซ้ำสองรอบ (ดู toFrontSaleRows)
      const frontSaleRows = kind === 'st' ? toFrontSaleRows(table) : null;
      prep = { sig: sig, kind: kind, target: cfg.target, label: cfg.label, rows: rows, files: files.length, names: raw.map(function (f) { return f.name; }), rawRows: table.length - 1, stats: stats, cols: stats.cols ? stats.cols.slice(0, 8) : null, frontSaleRows: frontSaleRows };
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

  function setCardStatus(kind, text, pct) {
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
      if (cfg.append) text = text.replace('จะอัปโหลดทับ', 'จะเพิ่มต่อท้าย');
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
      const cols = rn ? rn.cols : (p.cols || cfg.cols);
      const cellsOf = rn ? function (r) { const o = rn.toRow(r); return rn.cols.map(function (c) { return o[c]; }); } : (p.cols ? function (r) { return p.cols.map(function (c) { return r[c]; }); } : cfg.cells);
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

  // เช็กโควตาอัปโหลด 1 ครั้ง/วันต่อชนิด (จากฐานข้อมูล จึงบล็อกข้ามเครื่อง/ข้ามเบราว์เซอร์ได้จริง ไม่ใช่แค่กันในเครื่องเดียว)
  // เรียกตอนสร้างการ์ด และหลังอัปโหลดเสร็จ/ถูกบล็อก เพื่อให้การ์ดที่อัปโหลดไปแล้ววันนี้ถูกล็อกไว้ทันที
  async function refreshUploadLocks() {
    let rows;
    try {
      const res = await sb().rpc('op_upload_status');
      if (res.error) throw new Error(res.error.message);
      rows = res.data || [];
    } catch (err) {
      console.warn('เช็กสถานะโควตาอัปโหลดไม่สำเร็จ:', err);
      return;
    }
    const lockedByTarget = {};
    rows.forEach(function (r) { lockedByTarget[r.kind] = !!r.locked; });
    KIND_IDS.forEach(function (k) {
      const isLocked = !!lockedByTarget[KINDS[k].target];
      const wasLocked = kidAll('Card', k).some(function (card) { return card.classList.contains('sun-imp-locked'); });
      kidAll('Card', k).forEach(function (card) { card.classList.toggle('sun-imp-locked', isLocked); });
      if (wasLocked && !isLocked) setCardStatus(k, '🔓 ปลดล็อกแล้ว อัปโหลดได้อีกครั้ง', 0);
      const input = kid('In', k);
      if (input) input.disabled = isLocked;
      if (isLocked) {
        setCardStatus(k, k === 'st'
          ? '🔒 ST อัปโหลดไปแล้วในรอบนี้ (จำกัด 1 ครั้ง/รอบ) รีเซ็ตหลังเที่ยงวัน 12:00 และหลังเที่ยงคืน'
          : '🔒 ชนิดนี้อัปโหลดไปแล้ววันนี้ (จำกัด 1 ครั้ง/วัน) รีเซ็ตหลังเที่ยงคืน', 100);
      }
    });
  }
  // เปิดหน้าค้างข้ามเวลารีเซ็ต (เที่ยงวัน/เที่ยงคืน) การ์ดต้องปลดล็อกเอง: เช็กโควตาซ้ำทุก 5 นาทีตอนหน้าอยู่หน้าจอ
  setInterval(function () { if (!document.hidden) refreshUploadLocks(); }, 5 * 60 * 1000);

  // ปุ่มบนสุดปุ่มเดียว: สรุปว่าพร้อมอัปโหลดอะไรบ้าง
  function updateAllBar() {
    const btn = $('sunGoAll'), sum = $('sunAllSummary');
    if (!btn || !sum) return;
    const ready = KIND_IDS.filter(function (k) { const p = PREP[k]; return p && !p.error && p.rows.length > 0; });
    btn.disabled = ready.length === 0;
    sum.textContent = ready.length
      ? 'พร้อมอัปโหลด: ' + ready.map(function (k) { return (KINDS[k].append ? 'เพิ่มต่อท้าย ' : 'ทับ ') + (KINDS[k].sheet || KINDS[k].icon) + ' ' + PREP[k].rows.length.toLocaleString() + ' แถว'; }).join(' · ')
      : 'ยังไม่มีไฟล์ที่พร้อมอัปโหลด (เลือกไฟล์ด้านล่าง อย่างน้อย 1 ชนิด)';
  }

  // อัปโหลดทับทุกชนิดที่มีไฟล์พร้อมด้วยปุ่มเดียว ทีละชนิดตามลำดับ 3M → ST → SI (แต่ละชนิดเขียนทับคนละตารางของตัวเอง)
  // only: (ไม่บังคับ) รายชื่อชนิดที่จะอัปโหลด เช่น ['st'] — ใช้กับปุ่ม "ดึงจาก BigSeller อัตโนมัติ" ให้อัปโหลดเฉพาะชนิดที่เพิ่งดึงมา ไม่ไปแตะชนิดอื่นที่เลือกค้างไว้
  async function uploadAll(only) {
    const st = $('sunAllStatus'), btn = $('sunGoAll');
    if (btn) btn.disabled = true;
    if (st) st.textContent = 'กำลังเตรียมข้อมูล ...';
    const items = [];
    for (const kind of KIND_IDS) {
      if (only && only.indexOf(kind) === -1) continue;
      const input = kid('In', kind);
      if (!input || !(input.files && input.files.length)) continue;
      const p = await prepareKind(kind, false);
      if (!p) continue;
      if (p.error) { if (st) st.innerHTML = '<span class="sun-warn">อ่านไฟล์ ' + esc(KINDS[kind].sheet || KINDS[kind].icon) + ' ผิดพลาด: ' + esc(p.error) + ' — ไม่ได้อัปโหลดอะไรเลย</span>'; updateAllBar(); return; }
      if (p.rows.length) items.push({ kind: kind, p: p });
    }
    if (!items.length) { if (st) st.innerHTML = '<span class="sun-warn">ยังไม่มีไฟล์ที่พร้อมอัปโหลด</span>'; updateAllBar(); return; }

    const done = [];
    for (const it of items) {
      const k = it.kind;
      if (st) st.textContent = 'กำลังอัปโหลด ' + (KINDS[k].sheet || KINDS[k].icon) + ' (' + (done.length + 1) + '/' + items.length + ') ...';
      const payload = [{ target: it.p.target, label: KINDS[k].sheet || KINDS[k].icon, rows: it.p.rows, fn: KINDS[k].fn }];
      // ST: ถ้าไฟล์นี้มีช่อง "ขาย" (FRONT/ในบ้าน) ด้วย ส่งขึ้น op_front_sale พร้อมกันในการอัปโหลดครั้งเดียวกัน
      if (it.p.frontSaleRows && it.p.frontSaleRows.length) {
        payload.push({ target: 'frontsale', label: 'ขาย (หน้าร้าน)', rows: it.p.frontSaleRows });
      }
      const ok = await submitPayload(payload,
        'sunStatus_' + k, ['sunIn_' + k, 'sunMIn_' + k], [k]);
      if (!ok) {
        if (st) st.innerHTML = '<span class="sun-warn">หยุดที่ ' + esc(KINDS[k].sheet || KINDS[k].icon) + ' — ' + (done.length ? 'อัปโหลดสำเร็จแล้ว: ' + esc(done.join(', ')) : 'ยังไม่มีชนิดไหนถูกอัปโหลด') + ' (ดูรายละเอียดที่การ์ดของชนิดนั้น)</span>';
        updateAllBar();
        refreshUploadLocks();
        return;
      }
      const b = kid('Bar', k);
      if (b) b.style.width = '100%';
      done.push((KINDS[k].append ? 'เพิ่มต่อท้าย ' : '') + (KINDS[k].sheet || KINDS[k].icon) + ' ' + it.p.rows.length.toLocaleString() + ' แถว');
    }
    if (st) st.innerHTML = '<span class="sun-good">✅ อัปโหลดทับสำเร็จ ' + esc(done.join(' · ')) + ' | ' + new Date().toLocaleTimeString('th-TH') + '</span>';
    updateAllBar();
    refreshUploadLocks();
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
  if (goAll) goAll.addEventListener('click', function () { uploadAll(); });
  updateAllBar();
  refreshUploadLocks();
  function syncInputs(kind, fromPrefix, files) {
    PREFIXES.forEach(function (pre) {
      if (pre === fromPrefix) return;
      const other = $(pre + 'In_' + kind);
      if (other) setInputFiles(other, files);
    });
  }
  // ปุ่ม "ดึงจาก BigSeller อัตโนมัติ" (การ์ด ST): ส่วนขยายกดส่งออกที่แท็บ BigSeller แล้วส่งไฟล์ ZIP กลับมาใส่ช่องไฟล์ ST
  // หลังจากนั้นเป็นขั้นตอนเดิมทุกอย่าง (แตกไฟล์ ตัดตำแหน่ง แสดงตัวอย่าง) และยังต้องกด "อัปโหลดทั้งหมด" เอง
  // หลังดึงไฟล์จาก BigSeller มาใส่การ์ดแล้ว: เตรียมข้อมูล ตรวจความปลอดภัย แล้วอัปโหลดชนิดนั้นให้เองเลย
  // ไม่อัปโหลดเอง (ทิ้งไว้ให้กดอัปโหลดทั้งหมดเอง) ถ้าอ่านไฟล์ไม่ได้ ไม่มีแถว หรือ ST มีแถวลดลงจากข้อมูลเดิมเกิน 20% (กันไฟล์ไม่ครบ)
  // ฐานข้อมูลจำกัดวันละครั้งต่อชนิด จึงไม่อัปโหลดซ้ำ ถ้าพลาดแก้ไม่ได้จนพ้นเที่ยงคืน
  const AUTO_UPLOAD_MAX_DROP = 0.2;
  async function autoUploadAfterPull(k) {
    const p = await prepareKind(k, true);
    if (!p || p.error || !p.rows || !p.rows.length) { setCardStatus(k, '⚠️ ไม่อัปโหลดอัตโนมัติ: ไฟล์อ่านไม่ได้หรือหลังกรองไม่เหลือแถว ตรวจตัวอย่างแล้วกด "อัปโหลดทั้งหมด" เองได้', 100); return; }
    if (k === 'st') {
      try {
        const res = await sb().from('op_stock').select('id', { count: 'exact', head: true });
        const old = res.count || 0;
        if (old > 0 && p.rows.length < old * (1 - AUTO_UPLOAD_MAX_DROP)) {
          setCardStatus(k, '⚠️ ไม่อัปโหลดอัตโนมัติ: แถวใหม่ ' + p.rows.length.toLocaleString() + ' ลดลงจากเดิม ' + old.toLocaleString() + ' เกิน ' + (AUTO_UPLOAD_MAX_DROP * 100) + '% (ไฟล์อาจไม่ครบ) ตรวจแล้วกด "อัปโหลดทั้งหมด" เอง', 100);
          return;
        }
      } catch (err) { /* เช็กจำนวนเดิมไม่ได้: ไปต่อ เพราะไฟล์ผ่านการอ่านและกรองแล้ว */ }
    }
    await uploadAll([k]);
  }

  // SI ทำเหมือนกัน (ส่วนขยายตั้งช่วงเวลา "เมื่อวาน" + ค้นชื่อตำแหน่ง FRONT ที่หน้า BigSeller ให้เอง) แต่รับไฟล์ได้ทั้ง Excel/CSV/ZIP
  // 3M (ยอดขายย้อนหลัง): ส่งออกจากหน้าคำสั่งซื้อของ BigSeller ในแท็บแยกของตัวเอง ใช้เวลานานกว่า (รอได้ 30 นาที)
  ['st', 'si', 'm3'].forEach(function (k) {
    const autoBtn = $('sunAuto_' + k);
    if (!autoBtn) return;
    autoBtn.addEventListener('click', function () {
      toggleCard(k, true);
      if (document.documentElement.getAttribute('data-stock-sync') !== '1') {
        setCardStatus(k, '⚠️ ไม่พบส่วนขยาย "ส่งสต็อก BigSeller เข้า ORDER" — ติดตั้ง/รีโหลดส่วนขยายแล้วรีเฟรชหน้านี้ (F5)', 0);
        return;
      }
      autoBtn.disabled = true;
      setCardStatus(k, '⏳ กำลังเรียกส่วนขยาย ...', 10);
      window.postMessage({ source: 'order-workspace', type: k + 'SyncRequest' }, '*');
    });
    window.addEventListener('message', function (e) {
      const d = e.data;
      if (e.source !== window || !d || d.source !== 'stock-sync' || (d.kind || 'st') !== k) return;
      if (d.type === 'progress') { setCardStatus(k, d.text, 40); return; }
      autoBtn.disabled = false;
      if (d.type === 'error') { toggleCard(k, true); setCardStatus(k, '❌ ดึงจาก BigSeller ไม่สำเร็จ: ' + d.error, 0); return; }
      if (d.type === 'file') {
        const input = kid('In', k);
        if (!input || input.disabled) { setCardStatus(k, '🔒 ชนิดนี้อัปโหลดไปแล้ววันนี้ — ดึงข้อมูลมาไม่ได้', 100); return; }
        const bin = atob(d.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const mime = /\.zip$/i.test(d.name) ? 'application/zip' : (/\.csv$/i.test(d.name) ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        const file = new File([bytes], d.name, { type: mime, lastModified: Date.now() });
        setInputFiles(input, [file]);
        syncInputs(k, 'sun', [file]);
        autoUploadAfterPull(k);
      }
    });
  });

  // ===== ดึง ST และ SI จาก BigSeller อัตโนมัติเมื่อเปิดหน้า (ต้องมีส่วนขยาย) =====
  // กดปุ่ม "ดึงจาก BigSeller อัตโนมัติ" ของการ์ด ST แล้วตามด้วย SI ให้เองตามลำดับ ขั้นตอนหลังจากนั้นเป็นของเดิมทั้งหมด
  // (ตรวจไฟล์ แล้วอัปโหลดให้เอง ถ้าผ่านเงื่อนไขความปลอดภัยเดิม) · ชนิดที่อัปโหลดไปแล้ววันนี้ (ล็อก 1 ครั้ง/วัน) จะข้าม
  // กันยิงซ้ำตอนรีเฟรชถี่ๆ: ชนิดเดิมเว้นอย่างน้อย 5 นาที · ปิดได้ด้วยช่องติ๊กบนหน้า (จำค่าในเบราว์เซอร์นี้)
  (function startupAutoPull() {
    const chk = $('sunAutoStartup');
    const info = $('sunAutoStartupInfo');
    const KEY = 'sun_auto_startup_v1';
    const LAST_PREFIX = 'sun_auto_startup_last_';
    const COOLDOWN_MS = 5 * 60 * 1000;
    let enabled = true;
    try { enabled = localStorage.getItem(KEY) !== '0'; } catch (e) { enabled = true; }
    if (chk) {
      chk.checked = enabled;
      chk.addEventListener('change', function () {
        try { localStorage.setItem(KEY, chk.checked ? '1' : '0'); } catch (e) { /* ไม่กระทบ */ }
        if (info) info.textContent = chk.checked ? '(จะทำงานตอนเปิดหน้า/รีเฟรชครั้งถัดไป)' : '(ปิดอยู่)';
      });
    }
    const say = function (t) { if (info) info.textContent = t; };
    const lastOf = function (k) { try { return Number(localStorage.getItem(LAST_PREFIX + k)) || 0; } catch (e) { return 0; } };
    const markRun = function (k) { try { localStorage.setItem(LAST_PREFIX + k, String(Date.now())); } catch (e) { /* ไม่กระทบ */ } };
    const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

    // รอจนปุ่มของชนิดนั้นกลับมากดได้ (ดึงไฟล์เสร็จหรือผิดพลาด) แล้วรอให้ขั้นอัปโหลดอัตโนมัติจบอีกพักหนึ่ง
    async function waitPullDone(btn) {
      const end = Date.now() + 35 * 60 * 1000;
      while (btn.disabled && Date.now() < end) await sleep(1000);
      await sleep(1500);
      const st = $('sunAllStatus');
      const endUp = Date.now() + 5 * 60 * 1000;
      while (Date.now() < endUp) {
        const t = st ? st.textContent : '';
        if (!/กำลัง/.test(t)) break; // กำลังเตรียมข้อมูล / กำลังอัปโหลด ... ยังไม่จบ
        await sleep(1000);
      }
    }

    async function run() {
      if (chk ? !chk.checked : !enabled) return;
      if (document.documentElement.getAttribute('data-stock-sync') !== '1') { say('(ไม่พบส่วนขยาย จึงไม่ดึงอัตโนมัติ)'); return; }
      await refreshUploadLocks(); // รู้ก่อนว่าชนิดไหนอัปโหลดไปแล้ววันนี้
      for (const k of ['st', 'si']) {
        const btn = $('sunAuto_' + k);
        const input = kid('In', k);
        if (!btn || !input) continue;
        if (input.disabled) { say('(' + k.toUpperCase() + ' อัปโหลดไปแล้ววันนี้ ข้าม)'); continue; }
        if (Date.now() - lastOf(k) < COOLDOWN_MS) { say('(' + k.toUpperCase() + ' เพิ่งดึงไปไม่ถึง 5 นาที ข้าม)'); continue; }
        markRun(k);
        say('(กำลังดึง ' + k.toUpperCase() + ' อัตโนมัติ ...)');
        btn.click();
        await sleep(500);
        await waitPullDone(btn);
      }
      say('(ดึงอัตโนมัติตอนเปิดหน้าเสร็จแล้ว ' + new Date().toLocaleTimeString('th-TH') + ')');
    }
    // รอให้ส่วนขยายฝังสะพานและเช็กโควตาก่อนเริ่ม
    setTimeout(function () { run().catch(function (e) { say('(ดึงอัตโนมัติผิดพลาด: ' + (e && e.message || e) + ')'); }); }, 3000);
  })();

  KIND_IDS.forEach(function (k) {
    PREFIXES.forEach(function (pre) {
      const input = $(pre + 'In_' + k), drop = $(pre + 'Drop_' + k);
      if (!input || !drop) return;
      input.addEventListener('change', function () {
        syncInputs(k, pre, Array.from(input.files || []));
        prepareKind(k, true);
      });
      drop.addEventListener('click', function (e) { if (!input.disabled && e.target !== input) input.click(); });
      drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('drag-ready'); });
      drop.addEventListener('dragleave', function () { drop.classList.remove('drag-ready'); });
      drop.addEventListener('drop', function (e) {
        e.preventDefault();
        drop.classList.remove('drag-ready');
        if (input.disabled) return; // ชนิดนี้อัปโหลดไปแล้ววันนี้ (ดู refreshUploadLocks)
        if (e.dataTransfer && e.dataTransfer.files.length) {
          const files = Array.from(e.dataTransfer.files);
          setInputFiles(input, files);
          syncInputs(k, pre, files);
          prepareKind(k, true);
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
    const goImport = function () { const tab = document.querySelector('.tab[data-tool="mergeTool"]'); if (tab) tab.click(); };
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
  $('sunTargetXlsx').addEventListener('click', function () {
    if (!TARGET_EXPORT.length) { alert('ยังไม่มีข้อมูลสั่งเป้า — เปิดหน้า "ใบสั่งซื้อล่วงหน้า" ให้โหลดข้อมูลก่อน'); return; }
    const rows = TARGET_EXPORT.slice().sort(function (a, b) {
      return String(a[0]).localeCompare(String(b[0]), 'th', { numeric: true, sensitivity: 'base' });
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['SKU', 'จำนวน']].concat(rows)), 'เป้า');
    XLSX.writeFile(wb, 'เป้า_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  });
  // ตารางสี/ไซซ์ (เอาจำนวน "สั่งเพิ่ม" มาใส่) ตามแถวที่กำลังแสดงอยู่ (ตามคำค้น/ตัวกรองปัจจุบัน) ของหน้าใบสั่งซื้อล่วงหน้า
  // แยกโค้ด SKU แบบ "รหัส-สี-ไซซ์" (เช่น 002187-ดำ-2XL) — ส่วนแรกสุดคือรหัสสินค้า ส่วนท้ายสุดคือไซซ์ ตรงกลางทั้งหมด (ต่อกลับด้วย "-") คือชื่อสี
  // ตรงกลางมีได้มากกว่า 1 ส่วน เพราะบางสีเป็นสีคู่/สองโทน เช่น "012585-กรม-ฟ้า-XL" -> สี "กรม-ฟ้า" (ถ้าตัดแค่ 2 ส่วนสุดท้ายแบบเดิม จะพลาดตัด "กรม" ไปปนกับรหัสสินค้าแทน)
  // ไฟล์เดียวแยกได้หลายรหัสสินค้า: รหัสละ 1 ชีต แต่ละชีตมีตาราง สี (แถว) x ไซซ์ (คอลัมน์) พร้อมแถว/คอลัมน์ "รวม"
  const SUN_SIZE_ORDER = ['XXS', 'XS', 'SS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
  function sunSizeRank(sz) {
    const i = SUN_SIZE_ORDER.indexOf(String(sz).toUpperCase());
    return i < 0 ? SUN_SIZE_ORDER.length : i;
  }
  // WARRIX: รหัสสินค้าเป็น 2 ท่อนแรกตายตัว (เช่น "WA-221PLACL30") เพราะ SKU ขึ้นต้นด้วยรหัสแบรนด์แยกขีดต่างหาก สียังเหลือแค่ท่อนเดียว
  // H3: รหัสสินค้าไม่เท่ากันทุกตัว (เช่น "SH-ECO", "SH-HTCL-01", "SH-VEST-JR2" ยาวสั้นไม่เท่ากัน) แต่ "สี" ของแบรนด์นี้เป็นรหัส 2 ตัวอักษรท่อนเดียวเสมอ (AA/DD/GG ฯลฯ)
  //   เลยนับท่อนรหัสสินค้าจากท้ายแทน: เอาท่อนสุดท้ายเป็นไซซ์ ท่อนก่อนหน้าเป็นสี ที่เหลือข้างหน้าทั้งหมดเป็นรหัสสินค้า
  // แบรนด์อื่น: รหัสสินค้าเป็นท่อนแรกท่อนเดียว (เช่น "012585") ส่วนสีอาจมีหลายท่อน (เช่น "กรม-ฟ้า" สองโทนสี) เลยรวมทุกท่อนตรงกลางเป็นสี
  function sunSplitColorSizeSku(sku, brand) {
    const parts = String(sku || '').trim().split('-').filter(function (s) { return s !== ''; });
    let codeSegs;
    if (brand === 'WARRIX' && parts.length >= 4) codeSegs = 2;
    else if (brand === 'H3' && parts.length >= 3) codeSegs = parts.length - 2;
    else codeSegs = 1;
    if (parts.length < codeSegs + 2) return null;
    return { code: parts.slice(0, codeSegs).join('-'), color: parts.slice(codeSegs, -1).join('-'), size: parts[parts.length - 1] };
  }
  $('sunMatrixXlsx').addEventListener('click', async function () {
    if (!VIEW || !VIEW.shown.length) { alert('ยังไม่มีข้อมูลให้ดาวน์โหลด'); return; }
    const skuCol = VIEW.head.indexOf('SKU'), orderCol = VIEW.head.indexOf('สั่งเพิ่ม'), nameCol = VIEW.head.indexOf('ชื่อสินค้า');
    if (skuCol < 0 || orderCol < 0) { alert('ใช้ได้เฉพาะหน้า "ใบสั่งซื้อล่วงหน้า" เท่านั้น'); return; }

    const codes = new Map(); // code -> Map(color -> Map(size -> qty))
    VIEW.shown.forEach(function (r) {
      const brand = nameCol >= 0 ? brandOf(r.cells[nameCol].v) : '';
      const parsed = sunSplitColorSizeSku(r.cells[skuCol].v, brand);
      if (!parsed) return;
      const qty = sortKey(r.cells[orderCol], 'number');
      if (!codes.has(parsed.code)) codes.set(parsed.code, new Map());
      const byColor = codes.get(parsed.code);
      if (!byColor.has(parsed.color)) byColor.set(parsed.color, new Map());
      byColor.get(parsed.color).set(parsed.size, (byColor.get(parsed.color).get(parsed.size) || 0) + qty);
    });
    if (!codes.size) { alert('ไม่พบ SKU ที่แยกรูปแบบ "รหัส-สี-ไซซ์" ได้ในรายการที่แสดงอยู่'); return; }
    // ป้องกันดาวน์โหลดไฟล์ใหญ่เกินจำเป็นเวลาลืมค้นหาก่อนกด (ไม่ได้กรองอะไรเลย = สร้างทีเดียวหลายร้อยรหัสสินค้า)
    if (codes.size > 30 && !confirm('พบ ' + codes.size.toLocaleString() + ' รหัสสินค้าในรายการที่แสดงอยู่ (จะได้ไฟล์ ' + codes.size.toLocaleString() + ' ชีต)\nลองค้นหา SKU ให้แคบลงก่อนไหม? กด "ตกลง" เพื่อดาวน์โหลดทั้งหมดต่อ')) return;

    const sortedCodes = [...codes.keys()].sort(function (a, b) { return String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' }); });
    const dateStr = new Date().toISOString().slice(0, 10);

    // เตรียมข้อมูลตาราง (สี x ไซซ์ + รวม) ของแต่ละรหัสสินค้าไว้ก่อน ใช้ร่วมกันได้ทั้ง 2 แบบด้านล่าง
    const prepared = sortedCodes.map(function (code) {
      const byColor = codes.get(code);
      const sizes = [...new Set([].concat(...[...byColor.values()].map(function (m) { return [...m.keys()]; })))]
        .sort(function (a, b) { return sunSizeRank(a) - sunSizeRank(b) || String(a).localeCompare(String(b), 'th', { numeric: true }); });
      const colors = [...byColor.keys()].sort(function (a, b) { return String(a).localeCompare(String(b), 'th', { sensitivity: 'base' }); });
      const colTotals = sizes.map(function () { return 0; });
      let grand = 0;
      const rows = colors.map(function (color) {
        const bySize = byColor.get(color);
        let rowTotal = 0;
        const cells = sizes.map(function (sz, i) {
          const v = bySize.get(sz) || 0;
          colTotals[i] += v; rowTotal += v;
          return v;
        });
        grand += rowTotal;
        return { color: color, cells: cells, total: rowTotal };
      });
      return { code: code, sizes: sizes, rows: rows, colTotals: colTotals, grand: grand };
    });

    try { await window.loadLib('exceljs'); } catch (e) { console.warn(e); }
    if (typeof ExcelJS === 'undefined') { alert('โหลดไลบรารีสร้างไฟล์ Excel ไม่สำเร็จ ลองรีเฟรชหน้าเว็บแล้วลองใหม่'); return; }

    // ใช้ ExcelJS สร้างไฟล์ .xlsx จริง เพราะไลบรารี XLSX (community build) ที่ใช้ที่อื่นในเว็บนี้เขียนสไตล์เซลล์ลงไฟล์จริงไม่ได้
    // (ทดสอบแล้ว: เซฟสไตล์แล้วเปิดกลับมาหาย) ส่วนวิธี HTML-table หลอก Excel ก็ลองแล้วแยกชีตไม่เสถียร (ข้อมูลไปกองชีตแรกหมด)
    // ExcelJS เขียนได้ทั้งสไตล์และหลายชีตจริงพร้อมกัน จึงใช้ตัวนี้แทนทั้งสองกรณี (รหัสเดียว/หลายรหัส)
    const HEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE5F1' } };
    const TOTAL_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    const THIN_BORDER = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };

    const wb = new ExcelJS.Workbook();
    const usedNames = new Set();
    prepared.forEach(function (p) {
      let base = String(p.code).replace(/[\\\/\?\*\[\]:]/g, '-').trim().slice(0, 31) || 'sheet';
      let nm = base, n = 2;
      while (usedNames.has(nm.toLowerCase())) { const suf = ' (' + n++ + ')'; nm = base.slice(0, 31 - suf.length) + suf; }
      usedNames.add(nm.toLowerCase());

      const colCount = p.sizes.length + 2; // คอลัมน์ป้ายสี + ไซซ์ทุกอัน + รวม
      const ws = wb.addWorksheet(nm);

      // แถวหัวเรื่อง (รหัสสินค้า) คร่อมทุกคอลัมน์ ตัวหนา 20px — ตั้งเป็นข้อความชัดเจน กันเลข 0 นำหน้าหาย
      ws.mergeCells(1, 1, 1, colCount);
      const titleCell = ws.getCell(1, 1);
      titleCell.value = String(p.code);
      titleCell.font = { bold: true, size: 20 };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      titleCell.border = THIN_BORDER;
      for (let c = 2; c <= colCount; c++) ws.getCell(1, c).border = THIN_BORDER;

      // แถวหัวตาราง (สี/ไซซ์, ไซซ์ต่างๆ, รวม) ตัวหนา 20px พื้นฟ้าอ่อน
      const headerRow = ws.addRow(['สี/ไซซ์'].concat(p.sizes, ['รวม']));
      headerRow.eachCell(function (cell) {
        cell.font = { bold: true, size: 20 };
        cell.fill = HEAD_FILL;
        cell.alignment = { horizontal: 'center' };
        cell.border = THIN_BORDER;
      });

      // แถวข้อมูลแต่ละสี
      p.rows.forEach(function (r) {
        const row = ws.addRow([r.color].concat(r.cells, [r.total]));
        row.eachCell(function (cell, colNumber) {
          cell.border = THIN_BORDER;
          if (colNumber === 1) { cell.font = { bold: true }; }
          else if (colNumber === colCount) { cell.font = { bold: true }; cell.fill = TOTAL_FILL; cell.alignment = { horizontal: 'right' }; }
          else { cell.alignment = { horizontal: 'right' }; }
        });
      });

      // แถวรวม (ล่างสุด) ตัวหนา พื้นเทาอ่อน ทั้งแถว
      const totalRow = ws.addRow(['รวม'].concat(p.colTotals, [p.grand]));
      totalRow.eachCell(function (cell, colNumber) {
        cell.border = THIN_BORDER;
        cell.font = { bold: true };
        cell.fill = TOTAL_FILL;
        if (colNumber > 1) cell.alignment = { horizontal: 'right' };
      });

      ws.getColumn(1).width = 12;
      for (let c = 2; c <= colCount; c++) ws.getColumn(c).width = 8;
      ws.views = [{ showGridLines: true }];
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const single = prepared.length === 1 ? String(prepared[0].code).replace(/[\\\/\?\*\[\]:]/g, '-') : null;
    const filename = (single ? single + '_' : '') + 'สั่งเพิ่ม-' + dateStr + '.xlsx';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
  });

  // นำไฟล์ตารางสี/ไซซ์ (ที่ดาวน์โหลดจากปุ่มด้านบน) กลับเข้ามาใหม่ — "บวกเพิ่ม" เข้ากับสั่งเป้า (op_com) ของ SKU นั้นๆ
  // ไม่เขียนทับทั้งตาราง op_com เหมือนการ์ด "สั่งเป้า" ในหน้านำเข้าข้อมูล (นั่นคือเขียนทับทั้งหมด ส่วนนี้แค่บวกเพิ่มเฉพาะ SKU ในไฟล์)
  // อ่านทุกชีตในไฟล์: แถว 1 = รหัสสินค้า, แถว 2 = หัวตาราง (สี/ไซซ์ + ไซซ์ต่างๆ + รวม), แถวสุดท้าย = รวม (ข้าม), ที่เหลือคือแถวสี
  function sunParseMatrixWorkbook(wb) {
    const rows = [];
    wb.SheetNames.forEach(function (name) {
      const ws = wb.Sheets[name];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (aoa.length < 4) return; // ต้องมีอย่างน้อย หัวเรื่อง + หัวตาราง + สี 1 แถว + แถวรวม
      const code = String(aoa[0][0] || '').trim();
      if (!code) return;
      const header = aoa[1] || [];
      const sizes = header.slice(1, header.length - 1).map(function (s) { return String(s).trim(); });
      if (!sizes.length) return;
      for (let i = 2; i < aoa.length - 1; i++) { // ข้ามแถวสุดท้าย (รวม)
        const row = aoa[i] || [];
        const color = String(row[0] || '').trim();
        if (!color || color === 'รวม') continue;
        sizes.forEach(function (sz, idx) {
          if (!sz) return;
          const qty = Number(row[idx + 1]);
          if (!Number.isFinite(qty) || qty === 0) return;
          rows.push({ sku: code + '-' + color + '-' + sz, qty: qty });
        });
      }
    });
    return rows;
  }
  $('sunMatrixImportFile').addEventListener('change', async function (e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const rows = sunParseMatrixWorkbook(wb);
      if (!rows.length) { alert('อ่านไฟล์นี้ไม่ได้ หรือไม่พบข้อมูลในรูปแบบตารางสี/ไซซ์ (ต้องเป็นไฟล์ที่ดาวน์โหลดจากปุ่ม "ดาวน์โหลดตารางสี/ไซซ์" เท่านั้น)'); return; }

      const totalQty = rows.reduce(function (s, r) { return s + r.qty; }, 0);
      const skuCount = new Set(rows.map(function (r) { return r.sku; })).size;
      if (!confirm('พบ ' + skuCount.toLocaleString() + ' SKU รวม ' + totalQty.toLocaleString() + ' ชิ้น จากไฟล์ "' + file.name + '"\n\nจะ "บวกเพิ่ม" เข้ากับสั่งเป้า (op_com) ของ SKU เหล่านี้ (ไม่เขียนทับของเดิม)\nกด "ตกลง" เพื่อดำเนินการต่อ')) return;

      if (!askUploadPasscode()) { alert('ยกเลิก: ต้องใส่รหัสอัปโหลดก่อน'); return; }

      const res = await sb().rpc('op_com_increment', { p_passcode: uploadPasscode, p_rows: rows });
      if (res.error) {
        if (/รหัสอัปโหลด/.test(res.error.message)) {
          uploadPasscode = '';
          needUploadPasscode = true;
          alert('ฐานข้อมูลยังตั้งรหัสอัปโหลดไว้ กดนำเข้าอีกครั้งเพื่อใส่รหัส');
          return;
        }
        alert('นำเข้าไม่สำเร็จ: ' + res.error.message);
        return;
      }
      alert('บวกเพิ่มสั่งเป้าสำเร็จ: ' + skuCount.toLocaleString() + ' SKU | รวม ' + totalQty.toLocaleString() + ' ชิ้น');
      CACHE = null;
      if (started) loadData(currentMode);
    } catch (err) {
      console.error(err);
      alert('นำเข้าไฟล์ไม่สำเร็จ: ' + (err && err.message ? err.message : err));
    }
  });
  $('sunMatrixImport').addEventListener('click', function (e) {
    if (e.target.closest('input')) return;
    $('sunMatrixImportFile').click();
  });

  // ค้นหาแบบพิมพ์แล้วขึ้นผลทันที (หน่วงสั้นๆ 120ms กันหน่วงตอนพิมพ์เร็ว กับตารางหลายหมื่นแถว)
  $('sunSearch').addEventListener('input', filterTable);
  // วางรายการ SKU ที่คัดลอกมาจาก Excel (หลายบรรทัด/แท็บ) เข้าช่องค้นหา: แปลงเป็นคั่นด้วยจุลภาคให้อัตโนมัติ
  $('sunSearch').addEventListener('paste', function (e) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || text.indexOf('\n') === -1 && text.indexOf('\t') === -1) return; // บรรทัดเดียว ปล่อยให้วางปกติ
    e.preventDefault();
    const terms = sunSkuTerms(text);
    e.target.value = terms.join(', ');
    filterTable();
  });
  // กด Enter ให้ตัดหน่วงแล้วกรองทันที (เผื่ออยากดูผลไวๆ ไม่ต้องรอ)
  $('sunSearch').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(SEARCH_DEBOUNCE_TIMER);
    applyAllFilters();
  });

  // รวมคำค้นจากกล่องวางหลาย SKU ใส่ช่องค้นหาหลักแล้วกรองทันที (closePanel = ปิดกล่องด้วยมั้ย)
  function applyBulkSearch(closePanel) {
    const terms = sunSkuTerms($('sunBulkSearchText').value);
    $('sunSearch').value = terms.join(', ');
    if (closePanel) {
      $('sunBulkSearchPanel').classList.remove('open');
      $('sunBulkSearchBtn').classList.remove('active');
    }
    clearTimeout(SEARCH_DEBOUNCE_TIMER);
    applyAllFilters();
  }

  // วางรายการ SKU ลงกล่องนี้แล้วค้นหาให้ทันทีอัตโนมัติ (ไม่ต้องกด "ค้นหา" เอง) แต่เปิดกล่องค้างไว้เผื่อแก้ต่อ
  $('sunBulkSearchText').addEventListener('paste', function () {
    setTimeout(function () { applyBulkSearch(false); }, 0);
  });
  // แก้ไข/ลบบรรทัดในกล่องเองก็ให้ค้นหาใหม่ตามด้วย (หน่วงสั้นๆ กันหน่วงตอนพิมพ์/ลบเร็ว) ไม่ต้องรอวางหรือกดปุ่ม
  $('sunBulkSearchText').addEventListener('input', function () {
    clearTimeout(SEARCH_DEBOUNCE_TIMER);
    SEARCH_DEBOUNCE_TIMER = setTimeout(function () { applyBulkSearch(false); }, 120);
  });

  // คลิกในเนื้อหา: หัวคอลัมน์เรียงลำดับ / เปิดปิด dropdown / ปุ่มเกณฑ์
  root.addEventListener('click', function (e) {
    const th = e.target.closest('th[data-sun-sort]');
    if (th) { sortTable(Number(th.dataset.sunSort)); return; }

    const msBtn = e.target.closest('.sun-ms-btn');
    if (msBtn) { toggleMultiselect(msBtn.dataset.ms); return; }

    if (e.target.closest('#sunThreshApply')) applyBestThresholds();

    if (e.target.closest('#sunBulkSearchBtn')) {
      const panel = $('sunBulkSearchPanel');
      const opening = !panel.classList.contains('open');
      panel.classList.toggle('open', opening);
      $('sunBulkSearchBtn').classList.toggle('active', opening);
      if (opening) {
        // เอาคำค้นปัจจุบัน (ถ้ามีหลายรายการ) มาใส่ในกล่องให้แก้ต่อได้ แยกบรรทัดให้อ่านง่าย
        $('sunBulkSearchText').value = $('sunSearch').value.split(/[,;]+/).map(function (s) { return s.trim(); }).filter(Boolean).join('\n');
        $('sunBulkSearchText').focus();
      }
      return;
    }
    if (e.target.closest('#sunBulkSearchApply')) {
      applyBulkSearch(true);
      return;
    }
    if (e.target.closest('#sunBulkSearchClear')) {
      $('sunBulkSearchText').value = '';
      $('sunSearch').value = '';
      clearTimeout(SEARCH_DEBOUNCE_TIMER);
      applyAllFilters();
      return;
    }
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

    if (!(e.target.closest && e.target.closest('.sun-search'))) {
      const bulkPanel = $('sunBulkSearchPanel');
      if (bulkPanel) bulkPanel.classList.remove('open');
      const bulkBtn = $('sunBulkSearchBtn');
      if (bulkBtn) bulkBtn.classList.remove('active');
    }
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

  window.Sun = { setMode: setMode, refresh: refresh };

  // ให้หน้าอื่น (เช่น หน้าตรวจ ORDER กับ Stock, หน้ารับORDER) ดึง/บันทึกข้อมูลจากฐานข้อมูลเดียวกันนี้ได้
  // โดยไม่ต้องเปิดแท็บ Sunshine ก่อน — คืนแถวดิบ [{sku, sku_name, location, qty}, ...]
  window.SunStock = {
    fetchStock: function () { return fetchAllRows('op_stock', 'sku,sku_name,location,qty', 'id'); },
    fetchMoves: function () { return fetchAllRows('op_stock_moves', 'sku,sku_name,moved_at,location,move,type', 'id'); },
    // ประวัติ SKU ที่ส่งออกใบย้ายวันนี้ (ใช้ร่วมกันทุกเครื่อง) — ต้องรัน supabase/op_pick_log.sql ก่อน
    // pickToday → [{ sku_key, sku, n, qty, last_at }] · recordPicks(rows: [{ sku_key, sku, qty }]) บันทึกการส่งออก 1 ครั้ง
    pickToday: async function () {
      const res = await sb().rpc('op_pick_today');
      if (res.error) throw new Error(res.error.message);
      return res.data || [];
    },
    recordPicks: async function (rows) {
      const res = await sb().rpc('op_pick_record', { p_rows: rows });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    }
  };
})();
