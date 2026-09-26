/* ปุ่มย่อ/ขยายแถบเมนูด้านซ้าย (เมนูหลัก) และด้านขวา (Sunshine) — ย่อแล้วเหลือแต่ไอคอน เริ่มเข้าเว็บ: ซ้ายขยาย ขวาย่อ ใช้ฝั่งไหน อีกฝั่งย่ออัตโนมัติ
   ปุ่มอยู่ในแถบเมนูแต่ละฝั่ง (ซ้าย/ขวา) */
(function () {
  'use strict';

  const body = document.body;
  const sideL = document.getElementById('sideCollapseLeft');
  const sideR = document.getElementById('sideCollapseRight');
  if (!sideL || !sideR) return;

  // เริ่มเข้าเว็บทุกครั้ง: ซ้ายขยาย ขวา (Sunshine) ย่อ (ไม่จำสถานะเดิม)
  let state = { l: false, r: true };

  function setBtn(btn, pressed, title) {
    btn.setAttribute('aria-pressed', String(pressed));
    btn.title = title;
  }

  function apply() {
    body.classList.toggle('collapse-left', state.l);
    body.classList.toggle('collapse-right', state.r);
    const tl = state.l ? 'ขยายเมนูด้านซ้าย' : 'ย่อเมนูด้านซ้าย';
    const tr = state.r ? 'ขยายเมนูด้านขวา (Sunshine)' : 'ย่อเมนูด้านขวา (Sunshine)';
    setBtn(sideL, state.l, tl);
    setBtn(sideR, state.r, tr);
    const tx = (b, open) => { const s = b.querySelector('.side-collapse-text'); if (s) s.textContent = open ? 'ขยายเมนู' : 'ย่อเมนู'; };
    tx(sideL, state.l);
    tx(sideR, state.r);
  }

  // กติกา: "ใช้ฝั่งไหน" (กดขยายปุ่มย่อ หรือกดแท็บของฝั่งนั้น) = ฝั่งนั้นขยาย อีกฝั่งย่ออัตโนมัติ
  //         "กดย่อฝั่งที่ขยายอยู่" = ย่อเฉพาะฝั่งนั้น ไม่กระทบอีกฝั่ง
  const toggleL = function () {
    if (state.l) { state.l = false; state.r = true; } else { state.l = true; }
    apply();
  };
  const toggleR = function () {
    if (state.r) { state.r = false; state.l = true; } else { state.r = true; }
    apply();
  };
  sideL.addEventListener('click', toggleL);
  sideR.addEventListener('click', toggleR);

  document.querySelectorAll('.top:not(.side-right) .tab').forEach(function (t) {
    t.addEventListener('click', function () { state.l = false; state.r = true; apply(); });
  });
  document.querySelectorAll('.side-right .tab').forEach(function (t) {
    t.addEventListener('click', function () { state.r = false; state.l = true; apply(); });
  });
  // ตอนย่อเหลือแต่ไอคอน ให้ชี้เมาส์แล้วเห็นชื่อเมนู
  document.querySelectorAll('.top .tab, .top .sun-nav-btn').forEach(function (t) {
    if (!t.title) t.title = t.textContent.replace(/\s+/g, ' ').trim();
  });

  apply();
})();
