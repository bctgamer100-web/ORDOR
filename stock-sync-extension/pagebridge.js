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
    // stSyncRequest = การ์ด ST · siSyncRequest = การ์ด SI · m3SyncRequest = การ์ด 3M
    const m = /^(st|si|m3)SyncRequest$/.exec(e.data.type || '');
    if (m) {
      const kind = m[1];
      chrome.runtime.sendMessage({ type: 'bridgeExport', kind: kind }).catch(function (err) {
        window.postMessage({ source: 'stock-sync', type: 'error', kind: kind, error: 'ติดต่อส่วนขยายไม่ได้: ' + err.message }, '*');
      });
    }
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
