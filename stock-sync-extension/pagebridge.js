// ทำงานบนหน้าเว็บ ORDER Workspace: เป็นสะพานระหว่างปุ่ม "ดึงจาก BigSeller อัตโนมัติ" ในการ์ด ST กับส่วนขยาย
// หน้าเว็บ --postMessage--> สคริปต์นี้ --runtime--> background --> แท็บ BigSeller (กดส่งออก) --> ไฟล์ zip กลับมาทางเดิม
(function () {
  'use strict';
  if (window.__stockSyncBridge) return;
  window.__stockSyncBridge = true;

  // บอกหน้าเว็บว่าติดตั้งส่วนขยายแล้ว (หน้าเว็บเช็กค่านี้ก่อนยอมให้กดปุ่ม)
  document.documentElement.setAttribute('data-stock-sync', '1');

  window.addEventListener('message', function (e) {
    if (e.source !== window || !e.data || e.data.source !== 'order-workspace') return;
    // ตั้งเวลาโหลดไฟล์ ORDER อัตโนมัติ (ส่วนขยายเป็นตัวเก็บเวลา/ปลุก) ตอบกลับสถานะให้หน้าเว็บแสดง
    if (e.data.type === 'ordScheduleSet' || e.data.type === 'ordScheduleGet') {
      chrome.runtime.sendMessage({ type: e.data.type, enabled: e.data.enabled, mode: e.data.mode, times: e.data.times }).then(function (st) {
        window.postMessage(Object.assign({ source: 'order-autoload', type: 'schedule' }, st || {}), '*');
      }).catch(function (err) {
        window.postMessage({ source: 'order-autoload', type: 'schedule', error: 'ติดต่อส่วนขยายไม่ได้: ' + err.message }, '*');
      });
      return;
    }
    // stSyncRequest = การ์ด ST · siSyncRequest = การ์ด SI · m3SyncRequest = การ์ด 3M · ordSyncRequest = ปุ่มหน้า รับORDER
    // ordSyncRequest = ปุ่มหน้า รับORDER แบบ "ทั้งหมด (เมื่อวาน–วันนี้)" · orduSyncRequest = แบบ "ยังไม่พิมพ์ใบปะหน้า"
    const m = /^(st|si|m3|ordu|ord)SyncRequest$/.exec(e.data.type || '');
    if (m) {
      const kind = m[1];
      chrome.runtime.sendMessage({ type: 'bridgeExport', kind: kind }).catch(function (err) {
        window.postMessage({ source: 'stock-sync', type: 'error', kind: kind, error: 'ติดต่อส่วนขยายไม่ได้: ' + err.message }, '*');
      });
    }
  });

  // ไฟล์ ORDER ที่โหลดจาก BigSeller (ชื่อ Order-SKU-...) ส่งต่อให้หน้าเว็บใส่เข้าช่อง รับORDER เอง (js/auto-order.js)
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== 'ordScheduleStatus') return;
    window.postMessage(Object.assign({ source: 'order-autoload' }, msg, { type: 'schedule' }), '*');
  });
  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || (msg.type !== 'orderFile' && msg.type !== 'orderFileError')) return;
    window.postMessage({
      source: 'order-autoload',
      type: msg.type === 'orderFile' ? 'file' : 'error',
      name: msg.name, b64: msg.b64, error: msg.error
    }, '*');
  });
  // หน้าเว็บโหลดเสร็จแล้ว (สคริปต์หน้าพร้อมรับข้อความ) ค่อยขอไฟล์ที่ค้างรออยู่
  window.addEventListener('load', function () {
    chrome.runtime.sendMessage({ type: 'orderPageReady' }).catch(function () { /* ไม่กระทบ */ });
    chrome.runtime.sendMessage({ type: 'ordScheduleGet' }).then(function (st) {
      window.postMessage(Object.assign({ source: 'order-autoload', type: 'schedule' }, st || {}), '*');
    }).catch(function () { /* ไม่กระทบ */ });
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || ['bridgeProgress', 'bridgeFile', 'bridgeError'].indexOf(msg.type) === -1) return;
    window.postMessage({
      source: 'stock-sync',
      type: msg.type.replace('bridge', '').toLowerCase(), // progress | file | error
      kind: msg.kind || 'st', text: msg.text, error: msg.error, name: msg.name, b64: msg.b64
    }, '*');
  });
})();
