importScripts('lib/xlsx.full.min.js', 'lib/jszip.min.js', 'core.js');

let PREP = null;      // ผลอ่านไฟล์ล่าสุด (อยู่ในหน่วยความจำ ถ้า service worker ถูกปิด ให้เตรียมไฟล์ใหม่)
let LAST_FILES = null;

// กดไอคอนส่วนขยาย = เปิด/ปิดแผงบนหน้า BigSeller
chrome.action.onClicked.addListener(async function (tab) {
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' });
  } catch (e) {
    const tabs = await chrome.tabs.query({ url: 'https://*.bigseller.com/web/inventory/*' });
    if (tabs.length) await chrome.tabs.update(tabs[0].id, { active: true });
  }
});

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

  if (msg.type === 'prepareDownload') {
    LAST_FILES = [await readDownload(msg.download)];
  } else if (msg.type === 'prepareFiles') {
    LAST_FILES = msg.files.map(function (f) { return { name: f.name, bytes: b64ToBytes(f.b64) }; });
  }
  if (msg.type === 'prepareDownload' || msg.type === 'prepareFiles') {
    PREP = await StockCore.prepare(LAST_FILES);
    return { ok: true, summary: StockCore.summary(PREP, msg.opts) };
  }

  if (msg.type === 'reevaluate') {
    if (!PREP) throw new Error('ยังไม่มีไฟล์ที่เตรียมไว้');
    return { ok: true, summary: StockCore.summary(PREP, msg.opts) };
  }

  if (msg.type === 'upload') {
    if (!PREP && LAST_FILES) PREP = await StockCore.prepare(LAST_FILES); // service worker เพิ่งตื่น
    if (!PREP) throw new Error('ยังไม่มีไฟล์ที่เตรียมไว้ — เลือกไฟล์ใหม่');
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
    return { ok: true, message: res.message, summary: StockCore.summary(PREP, msg.opts) };
  }
  throw new Error('คำสั่งไม่รู้จัก: ' + msg.type);
}

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
