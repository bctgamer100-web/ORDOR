importScripts('lib/xlsx.full.min.js', 'lib/jszip.min.js', 'core.js');

// ผลอ่านไฟล์ล่าสุด: เก็บใน storage ด้วย เพราะ Chrome ปิด service worker เองเมื่อว่าง ตัวแปรในหน่วยความจำจะหาย
let PREP = null;
async function savePrep() {
  await chrome.storage.local.set({ prep: PREP });
}
async function loadPrep() {
  if (!PREP) PREP = (await chrome.storage.local.get('prep')).prep || null;
  return PREP;
}

// กดไอคอนส่วนขยาย = เปิด/ปิดแผงบนหน้า BigSeller
chrome.action.onClicked.addListener(async function (tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' });
  } catch (e) {
    const tabs = await chrome.tabs.query({ url: 'https://*.bigseller.com/web/inventory/*' });
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
  }
});

// รอไฟล์ BigSeller ที่โหลดเสร็จครั้งถัดไป (ต้องเรียกก่อนสั่งส่งออก กันไฟล์โหลดเสร็จก่อนเริ่มรอ)
const downloadWaiters = [];
function waitNextDownload(timeoutMs) {
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { reject(new Error('รอไฟล์ที่โหลดจาก BigSeller นานเกินไป')); }, timeoutMs);
    downloadWaiters.push(function (rec) { clearTimeout(t); resolve(rec); });
  });
}

function bigsellerTabs() {
  return chrome.tabs.query({ url: 'https://*.bigseller.com/*' });
}

// ไฟล์ที่โหลดจาก BigSeller เสร็จ → แจ้งแผงบนหน้า BigSeller
chrome.downloads.onChanged.addListener(async function (delta) {
  if (!delta.state || delta.state.current !== 'complete') return;
  const items = await chrome.downloads.search({ id: delta.id });
  const it = items && items[0];
  if (!it) return;
  if (!/\.(xlsx|xls|csv|zip)$/i.test(it.filename || '')) return;
  if (!/bigseller/i.test([it.url, it.finalUrl, it.referrer].join(' '))) return;
  const rec = { id: it.id, filename: it.filename, url: it.finalUrl || it.url, at: Date.now() };
  await chrome.storage.local.set({ lastDownload: rec });
  downloadWaiters.splice(0).forEach(function (resolve) { resolve(rec); });
  (await bigsellerTabs()).forEach(function (t) {
    chrome.tabs.sendMessage(t.id, { type: 'downloaded', download: rec }).catch(function () { /* แท็บไม่มีตัวกด */ });
  });
});

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// อ่านไฟล์ที่ดาวน์โหลดแล้ว: ดึงจาก URL ก่อน ไม่ได้ค่อยอ่านจากดิสก์ (ต้องเปิด "อนุญาตให้เข้าถึง URL ของไฟล์" ของส่วนขยาย)
async function readDownload(d) {
  const name = d.filename.split(/[\\/]/).pop();
  let host = '';
  try { host = new URL(d.url).host; } catch (e) { /* ignore */ }
  const tries = [
    function () { return fetch(d.url); }, // ลิงก์ที่เซ็นชื่อมาแล้ว (เช่น myqcloud.com) ไม่ต้องใช้คุกกี้
    function () { return fetch(d.url, { credentials: 'include' }); },
    function () { return fetch('file:///' + d.filename.replace(/\\/g, '/')); }
  ];
  let lastErr = null;
  for (const t of tries) {
    try {
      const res = await t();
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return { name: name, bytes: new Uint8Array(await res.arrayBuffer()) };
    } catch (err) { lastErr = err; }
  }
  throw new Error('อ่านไฟล์ ' + name + ' อัตโนมัติไม่ได้ (' + lastErr.message + ', โฮสต์ดาวน์โหลด: ' + host + ')\n' +
    'ทางแก้: chrome://extensions > รายละเอียดส่วนขยายนี้ > เปิด "อนุญาตให้เข้าถึง URL ของไฟล์" หรือเลือกไฟล์เองในแผง');
}

async function handle(msg, sender) {
  const tabId = sender.tab && sender.tab.id;
  const progress = function (text) {
    if (tabId != null) chrome.tabs.sendMessage(tabId, { type: 'progress', text: text }).catch(function () {});
  };

  if (msg.type === 'prepareDownload' || msg.type === 'prepareFiles') {
    const files = msg.type === 'prepareDownload'
      ? [await readDownload(msg.download)]
      : msg.files.map(function (f) { return { name: f.name, bytes: b64ToBytes(f.b64) }; });
    PREP = await StockCore.prepare(files);
    await savePrep();
    return { ok: true, summary: StockCore.summary(PREP, msg.opts) };
  }

  if (msg.type === 'reevaluate') {
    if (!(await loadPrep())) throw new Error('ยังไม่มีไฟล์ที่เตรียมไว้');
    return { ok: true, summary: StockCore.summary(PREP, msg.opts) };
  }

  if (msg.type === 'upload') {
    if (!(await loadPrep())) throw new Error('ยังไม่มีไฟล์ที่เตรียมไว้ — กด "ส่งออกทั้งหมด แล้วนำเข้า" หรือเลือกไฟล์ใหม่');
    const res = await StockCore.upload(PREP, msg.opts, progress, async function (json) {
      const bytes = new TextEncoder().encode(json);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
      await chrome.downloads.download({
        url: 'data:application/json;base64,' + btoa(bin),
        filename: 'op_stock_backup_' + stamp + '.json',
        saveAs: false
      });
    });
    await savePrep(); // oldCount เปลี่ยนหลังอัปโหลด
    return { ok: true, message: res.message, summary: StockCore.summary(PREP, msg.opts) };
  }
  throw new Error('คำสั่งไม่รู้จัก: ' + msg.type);
}

// หน้าของแต่ละชนิดใน BigSeller: st = สินค้าคงคลัง > ตำแหน่งสต็อก · si = Stock Out/In > การเคลื่อนไหวสต็อก
const EXPORT_PAGES = {
  st: { file: 'warehouseInventory.htm', name: 'ตำแหน่งสต็อก' },
  si: { file: 'warehouseInOutRecord.htm', name: 'การเคลื่อนไหวสต็อก' }
};

// รอให้ตัวกดปุ่ม (content.js) ในแท็บพร้อมรับคำสั่ง
async function waitForContentReady(tabId, timeoutMs, pageFile, pageName) {
  const end = Date.now() + timeoutMs;
  let seenLoginHint = 0;
  while (Date.now() < end) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { type: 'ping' });
      if (r && r.ok) return;
    } catch (e) { /* ยังโหลดไม่เสร็จ */ }
    const t = await chrome.tabs.get(tabId);
    // โหลดเสร็จแล้วแต่ไม่ได้อยู่หน้าตำแหน่งสต็อก = น่าจะเด้งไปหน้าล็อกอิน
    if (t.status === 'complete' && (t.url || '').indexOf(pageFile) === -1 && ++seenLoginHint > 3) {
      throw new Error('เปิดหน้า ' + pageName + ' ไม่ได้ (หน้าเด้งไปที่ ' + (t.url || '?') + ') — ล็อกอิน BigSeller ในเบราว์เซอร์นี้ก่อน');
    }
    await new Promise(function (r) { setTimeout(r, 1000); });
  }
  throw new Error('หน้า ' + pageName + ' ของ BigSeller โหลดไม่เสร็จใน ' + Math.round(timeoutMs / 1000) + ' วินาที');
}

// ส่งออกสต็อกจาก BigSeller จากหน้าไหนก็ได้: ใช้แท็บ ตำแหน่งสต็อก ที่เปิดอยู่ ถ้าไม่มีเปิดแท็บเบื้องหลังให้ แล้วปิดเมื่อเสร็จ
// คืนข้อมูลไฟล์ที่ดาวน์โหลด { id, filename, url, at }
async function exportViaTab(progress, kind) {
  const page = EXPORT_PAGES[kind || 'st'] || EXPORT_PAGES.st;
  const existing = await chrome.tabs.query({ url: 'https://*.bigseller.com/web/inventory/' + page.file + '*' });
  let tab = existing[0];
  let created = false;
  try {
    if (!tab) {
      const any = (await bigsellerTabs())[0];
      const origin = any ? new URL(any.url).origin : 'https://www.bigseller.com';
      progress('กำลังเปิดหน้า ' + page.name + ' ของ BigSeller ในแท็บเบื้องหลัง ...');
      tab = await chrome.tabs.create({ url: origin + '/web/inventory/' + page.file, active: false });
      created = true;
      await waitForContentReady(tab.id, 60000, page.file, page.name);
    }
    progress('กำลังสั่ง BigSeller ส่งออกทั้งหมด (ไฟล์ใหญ่อาจใช้เวลาหลายนาที) ...');
    const downloaded = waitNextDownload(12 * 60 * 1000);
    downloaded.catch(function () {}); // กัน error ลอยถ้าขั้นส่งออกพังก่อน
    const runInTab = async function () {
      try {
        return await chrome.tabs.sendMessage(tab.id, { type: 'runExportOnly', kind: kind || 'st' });
      } catch (e) {
        throw new Error('สั่งแท็บ BigSeller ไม่ได้ — รีเฟรชหน้า BigSeller แล้วลองใหม่ (' + e.message + ')');
      }
    };
    let res = await runInTab();
    // แท็บเบื้องหลังเปิดเมนูไม่ขึ้น (เบราว์เซอร์หยุดงานด้านภาพของแท็บที่ไม่ได้ดู) → สลับไปแท็บนั้นชั่วคราว แล้วสลับกลับ
    if ((!res || !res.ok) && /เมนู ส่งออก|ปุ่ม ส่งออก|กล่องส่งออก/.test((res && res.error) || '')) {
      progress('แท็บเบื้องหลังเปิดเมนูไม่ได้ — สลับไปแท็บนั้นชั่วคราวเพื่อกดส่งออก ...');
      const prev = (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0];
      await chrome.tabs.update(tab.id, { active: true });
      await new Promise(function (r) { setTimeout(r, 1500); });
      try {
        res = await runInTab();
      } finally {
        if (prev && prev.id !== tab.id) chrome.tabs.update(prev.id, { active: true }).catch(function () {});
      }
    }
    if (!res || !res.ok) throw new Error('ส่งออกที่ BigSeller ไม่สำเร็จ: ' + ((res && res.error) || 'ไม่ตอบกลับ'));
    return await downloaded;
  } finally {
    if (created && tab) chrome.tabs.remove(tab.id).catch(function () {});
  }
}

// ปุ่ม 🚀 ในแผงบนหน้า BigSeller อื่นที่ไม่ใช่ ตำแหน่งสต็อก: ให้ background เปิดหน้านั้นเบื้องหลังส่งออกแทน แล้วแจ้งผลกลับด้วยสัญญาณ 'downloaded' เดิม
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'panelExport') return;
  const tabId = sender.tab && sender.tab.id;
  sendResponse({ ok: true });
  const keepAlive = setInterval(function () { chrome.runtime.getPlatformInfo(function () {}); }, 20000);
  exportViaTab(function (text) { chrome.tabs.sendMessage(tabId, { type: 'progress', text: text }).catch(function () {}); })
    .then(function (rec) { chrome.tabs.sendMessage(tabId, { type: 'downloaded', download: rec }).catch(function () {}); })
    .catch(function (err) { chrome.tabs.sendMessage(tabId, { type: 'panelError', error: err.message }).catch(function () {}); })
    .finally(function () { clearInterval(keepAlive); });
});

// ปุ่ม "ดึงจาก BigSeller อัตโนมัติ" ในการ์ด ST ของหน้า ORDER: สั่งแท็บ BigSeller ส่งออก แล้วส่งไฟล์ zip กลับไปให้หน้านั้น
// ไฟล์เข้าช่อง ST ของหน้านำเข้าข้อมูล แล้วผ่านขั้นตัวอย่าง/กรองตามเงื่อนไขเดิมของหน้านั้น (ไม่อัปโหลดเอง)
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.type !== 'bridgeExport') return;
  const tabId = sender.tab && sender.tab.id;
  const kind = msg.kind === 'si' ? 'si' : 'st';
  const say = function (type, payload) {
    if (tabId != null) chrome.tabs.sendMessage(tabId, Object.assign({ type: type }, payload)).catch(function () {});
  };
  sendResponse({ ok: true });
  // service worker ถูกปิดเองเมื่อว่าง ระหว่างรอ BigSeller สร้างไฟล์ (อาจหลายนาที) จึงเรียก API เป็นระยะให้ตื่นอยู่
  const keepAlive = setInterval(function () { chrome.runtime.getPlatformInfo(function () {}); }, 20000);
  (async function () {
    const rec = await exportViaTab(function (text) { say('bridgeProgress', { text: '⏳ ' + text, kind: kind }); }, kind);
    say('bridgeProgress', { text: '⏳ BigSeller โหลดไฟล์แล้ว กำลังอ่านไฟล์ ...', kind: kind });
    const f = await readDownload(rec);
    let bin = '';
    for (let i = 0; i < f.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 0x8000));
    say('bridgeFile', { name: f.name, b64: btoa(bin), kind: kind });
  })().catch(function (err) {
    say('bridgeError', { error: err.message, kind: kind });
  }).finally(function () { clearInterval(keepAlive); });
});

// เมาส์จริง (trusted) ผ่าน chrome.debugger: ย้ายเมาส์ไปที่พิกัด เพื่อให้เมนูแบบ hover เด้ง (ปล่อยตอนกดเมนูเสร็จ)
const ATTACHED = new Set();
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || (msg.type !== 'trustedMove' && msg.type !== 'trustedRelease')) return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) { sendResponse({ ok: false }); return; }
  (async function () {
    const target = { tabId: tabId };
    if (msg.type === 'trustedMove') {
      if (!ATTACHED.has(tabId)) { await chrome.debugger.attach(target, '1.3'); ATTACHED.add(tabId); }
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: msg.x - 8, y: msg.y, button: 'none' });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: msg.x, y: msg.y, button: 'none' });
    } else if (ATTACHED.has(tabId)) {
      await chrome.debugger.detach(target);
      ATTACHED.delete(tabId);
    }
    sendResponse({ ok: true });
  })().catch(function (err) { ATTACHED.delete(tabId); sendResponse({ ok: false, error: err.message }); });
  return true;
});
chrome.debugger.onDetach.addListener(function (source) { ATTACHED.delete(source.tabId); });

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || ['prepareDownload', 'prepareFiles', 'reevaluate', 'upload'].indexOf(msg.type) === -1) return;
  handle(msg, sender).then(sendResponse, function (err) { sendResponse({ ok: false, error: err.message }); });
  return true;
});
