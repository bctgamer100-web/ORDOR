// ทำงานบนหน้า BigSeller > สินค้าคงคลัง: แผงลอยมุมขวาล่าง กดปุ่มเดียว = ส่งออกทั้งหมด > ดาวน์โหลด > ตรวจ > อัปโหลดเข้า op_stock
(function () {
  'use strict';
  if (window.__stockSyncLoaded) return;
  window.__stockSyncLoaded = true;

  /* ================= ตัวกดปุ่มบนหน้า BigSeller ================= */

  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // หา element ที่ข้อความตรงทั้งหมด (ตัดช่องว่าง) เลือกอันลึกสุดที่มองเห็น
  function findByText(text, selector, includeHidden) {
    const want = text.replace(/\s+/g, '');
    const hits = Array.prototype.slice.call(document.querySelectorAll(selector || 'button, a, li, span, div')).filter(function (el) {
      return (includeHidden || visible(el)) && (el.textContent || '').replace(/\s+/g, '') === want;
    });
    return hits.length ? hits[hits.length - 1] : null;
  }

  async function waitFor(fn, timeoutMs, label) {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const v = fn();
      if (v) return v;
      await sleep(300);
    }
    throw new Error('หมดเวลารอ: ' + label);
  }

  // ข้อความในกล่อง/หน้าต่างป๊อปอัปที่มองเห็นอยู่ตอนนี้ (ใช้ตรวจว่าการส่งออกเริ่มหรือยัง และแสดงให้ผู้ใช้เห็นว่ามันรออะไร)
  function visibleModalText() {
    return Array.prototype.slice.call(document.querySelectorAll('.ant-modal, [role="dialog"], [class*="modal"]'))
      .filter(visible)
      .map(function (el) { return (el.textContent || '').replace(/\s+/g, ' ').trim(); })
      .filter(Boolean)
      .sort(function (a, b) { return a.length - b.length; })[0] || '';
  }

  // รอจน fn() คืนค่าจริง: ตรวจทุกครั้งที่ DOM เปลี่ยน + ทุก 500ms + หมดเวลา (แท็บเบื้องหลังที่ถูกหน่วง timer ก็ยังตรวจจากการเปลี่ยนของหน้า)
  function waitForDom(fn, timeoutMs, label) {
    return new Promise(function (resolve, reject) {
      let done = false;
      let obs = null, iv = null, to = null;
      const finish = function (v, err) {
        if (done) return;
        done = true;
        if (obs) obs.disconnect();
        clearInterval(iv); clearTimeout(to);
        if (err) reject(err); else resolve(v);
      };
      const check = function () { const v = fn(); if (v) finish(v); };
      obs = new MutationObserver(check);
      obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
      iv = setInterval(check, 500);
      to = setTimeout(function () { finish(null, new Error('หมดเวลารอ: ' + label)); }, timeoutMs);
      check();
    });
  }

  function realClick(el) {
    // ลิงก์แบบ href="javascript:..." : การกระทำเริ่มต้นของลิงก์ (รัน javascript: URL) ถูก CSP ของส่วนขยายบล็อกแล้วขึ้น error
    // กันไว้ไม่ให้ทำการกระทำเริ่มต้น แต่ตัวจัดการคลิกของหน้า (Vue) ยังทำงานตามปกติ
    const anchor = el.closest && el.closest('a[href^="javascript"]');
    if (anchor) anchor.addEventListener('click', function (ev) { ev.preventDefault(); }, { once: true });
    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(function (t) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    });
  }

  // เมนูของ BigSeller เด้งตอน "วางเมาส์" (hover) จึงต้องยิงเหตุการณ์เมาส์เข้าไปที่ปุ่ม
  // เมนูส่งออกเป็น ant-design-vue dropdown: ฟัง mouseenter ที่ตัวห่อ SPAN.ant-dropdown-trigger (ไม่ใช่ตัวปุ่มข้างใน)
  // และ mouseenter ไม่ bubble จึงต้องยิงเข้าตัวห่อโดยตรง (ดูโครงสร้างจริงจาก Console: BUTTON < SPAN.ant-dropdown-trigger)
  function hover(el) {
    const targets = [];
    const trigger = el.closest && el.closest('.ant-dropdown-trigger');
    if (trigger) targets.push(trigger);
    targets.push(el);
    targets.forEach(function (t) {
      const r = t.getBoundingClientRect();
      const pos = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'].forEach(function (type) {
        const Ctor = type.indexOf('pointer') === 0 ? PointerEvent : MouseEvent;
        t.dispatchEvent(new Ctor(type, Object.assign({}, pos, { bubbles: type.indexOf('enter') === -1 })));
      });
    });
  }

  // ตั้งค่าบนช่องข้อความแบบที่ Vue (v-model) รับรู้
  function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // หน้า SI (การเคลื่อนไหวสต็อก): ตั้งตัวกรองก่อนส่งออก = ช่วงเวลา "เมื่อวาน" + ค้นหาชื่อตำแหน่ง "FRONT"
  const SI_RANGE_TEXT = 'เมื่อวาน';
  const SI_LOCATION_TEXT = 'FRONT';
  async function applySiFilters() {
    setStatus('SI: ตั้งช่วงเวลา "' + SI_RANGE_TEXT + '" ...');
    const range = await waitFor(function () { return findByText(SI_RANGE_TEXT, 'label, button, span, a, div'); }, 20000, 'ปุ่มช่วงเวลา ' + SI_RANGE_TEXT);
    realClick(range);
    await sleep(800);

    setStatus('SI: ค้นหาชื่อตำแหน่ง "' + SI_LOCATION_TEXT + '" ...');
    // แถว "ค้นหา" = ตัวเลือกชนิดคำค้น + ช่องพิมพ์ + ไอคอนค้นหา
    const label = await waitFor(function () { return findByText('ค้นหา', 'span, label, div'); }, 10000, 'ป้าย ค้นหา');
    let row = label;
    let input = null;
    for (let i = 0; i < 5 && row && !input; i++) {
      row = row.parentElement;
      input = row && Array.prototype.slice.call(row.querySelectorAll('input')).find(function (el) {
        return visible(el) && (el.type === 'text' || el.type === 'search' || !el.type) && !el.readOnly;
      });
    }
    if (!input) throw new Error('ไม่พบช่องพิมพ์คำค้นของหน้า SI');
    if (row.textContent.indexOf('ชื่อตำแหน่ง') === -1) {
      throw new Error('ช่องค้นหาของหน้า SI ไม่ได้ตั้งเป็น "ชื่อตำแหน่ง" — เลือกชนิดคำค้นเป็น ชื่อตำแหน่ง ในหน้า BigSeller ก่อน แล้วลองใหม่');
    }
    setInputValue(input, SI_LOCATION_TEXT);
    ['keydown', 'keypress', 'keyup'].forEach(function (t) {
      input.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    });
    const icon = row.querySelector('.anticon-search, .ant-input-search-icon');
    if (icon) realClick(icon.closest('button, span, i') || icon);
    await sleep(3000); // รอตารางโหลดผลค้นหา
  }

  // หน้าออเดอร์ (3M): หลังกด "ส่งออกทั้งหมด" จะมีกล่อง "ส่งออกคำสั่งซื้อ" ให้เลือกเทมเพลต → เลือก "ยอดขาย 3 เดือน" แล้วกดปุ่ม ส่งออก ในกล่อง
  // คืน true เมื่อกดปุ่มในกล่องแล้ว · false ถ้ากล่องไม่ขึ้น (ให้ผู้เรียกลองกดเมนูใหม่)
  const M3_TEMPLATE = 'ยอดขาย 3 เดือน';
  async function handleOrderExportModal() {
    setStatus('3M: รอกล่อง ส่งออกคำสั่งซื้อ ...');
    const title = await waitFor(function () { return findByText('ส่งออกคำสั่งซื้อ'); }, 8000, '').catch(function () { return null; });
    if (!title) return false;
    const modal = title.closest('.ant-modal') || title.closest('[class*="modal"]') || document.body;
    // ช่องเทมเพลตเป็นคอมโพเนนต์ของ BigSeller เอง (ไม่ใช่ ant-select): ตัวเลือกคือ div.combobox_sel_option[title] อยู่ใน div.combobox_out
    // (ดูจากข้อมูลวินิจฉัยของจริง) จึงหาจากตัวเลือก "ยอดขาย 3 เดือน" แล้วขึ้นไปหา .combobox_out ของมัน ไม่ต้องเดาจากป้ายหรือช่องอื่น
    const optSelector = '.combobox_sel_option';
    const optNode = function () {
      return Array.prototype.slice.call(document.querySelectorAll(optSelector)).find(function (el) {
        return (el.getAttribute('title') || el.textContent || '').replace(/\s+/g, ' ').trim() === M3_TEMPLATE;
      });
    };
    const firstOpt = await waitFor(optNode, 10000, 'ตัวเลือกเทมเพลต ' + M3_TEMPLATE + ' (ไม่พบ .combobox_sel_option)');
    const combo = firstOpt.closest('.combobox_out');
    if (!combo) throw new Error('ไม่พบกรอบ .combobox_out ของช่องเทมเพลต');
    await sleep(1500); // รอกล่องโหลดเสร็จก่อนแตะ
    // ค่าที่แสดงอยู่ในช่อง = ข้อความ/ค่าช่องกรอกในกรอบ ไม่รวมรายการตัวเลือก (.combobox_sel)
    const shownValue = function () {
      const clone = combo.cloneNode(true);
      Array.prototype.slice.call(clone.querySelectorAll('.combobox_sel')).forEach(function (n) { n.remove(); });
      const inputs = Array.prototype.slice.call(combo.querySelectorAll('input')).map(function (i) { return i.value; }).join(' ');
      return ((clone.textContent || '') + ' ' + inputs).replace(/\s+/g, ' ').trim();
    };
    const hasTemplate = function () { return shownValue().indexOf(M3_TEMPLATE) !== -1; };
    const visibleOpt = function () {
      const el = optNode();
      return el && visible(el) ? el : null;
    };
    const chainOf = function (e) { const a = []; for (let i = 0; e && i < 6; i++, e = e.parentElement) a.push(e.tagName + '.' + String(e.className).slice(0, 40)); return a.join('<'); };
    if (!hasTemplate()) {
      // ตัวเปิดรายการ = ลูกในกรอบที่ไม่ใช่รายการ (.combobox_sel) และมองเห็น ลองหลายแบบ จนกว่ารายการจะโผล่
      const triggers = Array.prototype.slice.call(combo.children).filter(function (c) { return !c.classList.contains('combobox_sel') && visible(c); });
      triggers.push(combo);
      const clickSets = [['mouseover', 'mousedown', 'mouseup', 'click'], ['click'], ['mousedown']];
      const dbg = [];
      for (let a = 0; a < clickSets.length && !hasTemplate(); a++) {
        const trig = triggers[Math.min(a, triggers.length - 1)] || combo;
        setStatus('3M: เปิดรายการเทมเพลต แล้วเลือก "' + M3_TEMPLATE + '" (ครั้งที่ ' + (a + 1) + ') ...');
        clickSets[a].forEach(function (t) { trig.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })); });
        const opt = await waitFor(visibleOpt, 2500, '').catch(function () { return null; });
        dbg.push('[ครั้ง ' + (a + 1) + ' ' + clickSets[a].join('+') + ' บน ' + chainOf(trig).split('<')[0] + ' → ' + (opt ? 'รายการเปิดแล้ว' : 'รายการยังไม่เปิด') + ']');
        if (!opt) { await sleep(500); continue; }
        await sleep(800);
        realClick(opt);
        await waitFor(hasTemplate, 3000, '').catch(function () { return null; });
        if (!hasTemplate()) {
          // คลิกจำลองไม่ติด → คลิกซ้ำด้วยเมาส์จริงที่ตำแหน่งรายการ
          const again = visibleOpt();
          if (again) {
            setStatus('3M: คลิกจำลองไม่ติด — ใช้เมาส์จริงคลิก "' + M3_TEMPLATE + '" ...');
            again.scrollIntoView({ block: 'nearest' });
            await sleep(300);
            const r = again.getBoundingClientRect();
            try {
              await chrome.runtime.sendMessage({ type: 'trustedClick', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
            } catch (e) { /* ไม่มีสิทธิ์ดีบักก็ข้าม */ }
            await waitFor(hasTemplate, 3000, '').catch(function () { return null; });
          }
        }
        await sleep(1200);
      }
      if (!hasTemplate()) {
        throw new Error('เลือกเทมเพลต "' + M3_TEMPLATE + '" ไม่สำเร็จ (ช่องยังเป็น "' + shownValue() + '") COMBO: ' +
          combo.outerHTML.replace(/<div[^>]*combobox_sel_option_box[\s\S]*$/, '...').slice(0, 700) + ' | ' + dbg.join(' '));
      }
    }    // กันพลาดครั้งสุดท้าย: ห้ามกดส่งออกถ้าช่องไม่ใช่เทมเพลตที่ต้องการ
    if (!hasTemplate()) throw new Error('ช่องเทมเพลตไม่ใช่ "' + M3_TEMPLATE + '" (เป็น "' + shownValue() + '") — ไม่กดส่งออก');
    setStatus('3M: เลือกเทมเพลต "' + M3_TEMPLATE + '" แล้ว รอสักครู่ก่อนกดส่งออก ...');
    await sleep(1500); // ให้ตารางตัวอย่างเปลี่ยนตามเทมเพลตก่อนกดส่งออก
    const btn = Array.prototype.slice.call(modal.querySelectorAll('button')).find(function (b) {
      return visible(b) && (b.textContent || '').replace(/\s+/g, '') === 'ส่งออก';
    });
    if (!btn) throw new Error('ไม่พบปุ่ม ส่งออก ในกล่องส่งออกคำสั่งซื้อ');
    realClick(btn);
    chrome.runtime.sendMessage({ type: 'trustedRelease' }).catch(function () {}); // เลิกใช้เมาส์จริง (ถ้าใช้)
    return true;
  }

  // กด ส่งออก > ส่งออกทั้งหมด > (รอสร้างไฟล์) > ดาวน์โหลด · kind: 'st' (ตำแหน่งสต็อก) | 'si' (การเคลื่อนไหวสต็อก)
  let currentJobId = null;
  async function runExport(kind, jobId) {
    currentJobId = jobId || null;
    try {
      await runExportSteps(kind, jobId);
    } finally {
      currentJobId = null;
    }
  }
  async function runExportSteps(kind, jobId) {
    if (kind === 'si') await applySiFilters();
    setStatus('ขั้น 1/4: กำลังหาปุ่ม ส่งออก ...');
    const btn = await waitFor(function () { return findByText('ส่งออก', 'button'); }, 8000, 'ปุ่ม ส่งออก');
    setStatus('ขั้น 2/4: เจอปุ่ม ส่งออก กำลังวางเมาส์เพื่อเปิดเมนู ...');
    // ลอง hover ก่อน ถ้าเมนูยังไม่ขึ้นลองคลิกด้วย (กันกรณีเวอร์ชันหน้าเว็บต่างกัน) วนไม่เกิน 3 รอบ
    // หน้า SI อาจตั้งชื่อเมนูไม่เหมือนหน้า ST: ถ้าไม่มี "ส่งออกทั้งหมด" ใช้รายการแรกที่ไม่ใช่ "ส่งออกที่เลือก"
    const menuItem = function () {
      const exact = findByText('ส่งออกทั้งหมด');
      if (exact || kind === 'st') return exact;
      return Array.prototype.slice.call(document.querySelectorAll('.ant-dropdown-menu-item')).find(function (li) {
        return visible(li) && li.textContent.indexOf('ที่เลือก') === -1;
      }) || null;
    };
    const tryWait = function () { return waitFor(menuItem, 2000, '').catch(function () { return null; }); };
    let item = null;
    let how = '';
    // 1) จำลองเมาส์ 2) คลิก 3) เมาส์จริง (ผ่านระบบดีบักของ Chrome เผื่อเมนูใช้ CSS :hover) 4) กดรายการที่ซ่อนอยู่ในหน้าตรงๆ
    hover(btn); item = await tryWait(); how = 'hover';
    if (!item) { realClick(btn); item = await tryWait(); how = 'click'; }
    if (!item) {
      const r = btn.getBoundingClientRect();
      try {
        await chrome.runtime.sendMessage({ type: 'trustedMove', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
      } catch (e) { /* ไม่มีสิทธิ์ก็ข้าม */ }
      item = await tryWait(); how = 'trusted-mouse';
    }
    if (!item) {
      // เมนูอาจอยู่ในหน้าแต่ซ่อนไว้ (display:none) — กดตรงๆ ได้
      const hidden = findByText('ส่งออกทั้งหมด', undefined, true);
      if (hidden) { item = hidden; how = 'hidden-element'; }
    }
    if (!item) {
      const buttons = Array.prototype.slice.call(document.querySelectorAll('button')).filter(function (b) { return /ส่งออก/.test(b.textContent); })
        .map(function (b) { return '[' + b.textContent.trim() + ']'; }).join(' ');
      chrome.runtime.sendMessage({ type: 'trustedRelease' }).catch(function () {});
      throw new Error('หมดเวลารอ: เมนู ส่งออกทั้งหมด (ปุ่มที่เจอ: ' + (buttons || 'ไม่มี') + ' — ลองครบ hover/คลิก/เมาส์จริง แล้วเมนูไม่ขึ้น)');
    }
    // กดเมนูแล้วต้องมีกล่องส่งออกขึ้น ถ้าไม่ขึ้น (กดพลาด/เมนูปิดไปก่อน) เปิดเมนูใหม่แล้วกดซ้ำ สูงสุด 3 ครั้ง
    // กล่องส่งออกของ BigSeller มีข้อความ "สามารถส่งออกได้เฉพาะข้อมูล SKU Merchant ..." และแถบความคืบหน้า (เห็นในภาพหน้าจอ)
    const exportStarted = function () {
      if (findByText('ดาวน์โหลด', 'a, button, span')) return true;
      const bar = document.querySelector('.ant-progress');
      if (bar && visible(bar)) return true; // แถบความคืบหน้าของกล่องส่งออก (หน้า SI ข้อความอาจต่างจากหน้า ST)
      // กล่องผลส่งออกของหน้าออเดอร์ (3M): ข้อความ "เทมเพลตการส่งออก ..." / "ส่งออกข้อมูลสำเร็จ" / "สำเร็จแล้ว:" (แถบความคืบหน้าเป็นแบบทำเอง ไม่ใช่ .ant-progress)
      if (/เทมเพลตการส่งออก|ส่งออกข้อมูลสำเร็จ|สำเร็จแล้ว:|กำลังส่งออก/.test(visibleModalText())) return true;
      return Array.prototype.slice.call(document.querySelectorAll('span, div, p')).some(function (el) {
        return el.children.length <= 2 && /สามารถส่งออกได้เฉพาะ/.test(el.textContent || '') && visible(el);
      });
    };
    let started = false;
    for (let k = 0; k < 3 && !started; k++) {
      setStatus('ขั้น 3/4: เจอเมนู ส่งออกทั้งหมด (วิธี: ' + how + ') กำลังกด ครั้งที่ ' + (k + 1) + ' ...');
      const cur = menuItem() || item;
      // ตัวรับคลิกของเมนูคือ LI.ant-dropdown-menu-item (ข้อความอยู่ใน SPAN ข้างใน)
      realClick(cur.closest('li') || cur);
      if (kind === 'm3') await handleOrderExportModal(); // false = กล่องไม่ขึ้น → ผลลัพธ์ started จะเป็นเท็จแล้ววนกดเมนูใหม่
      started = await waitFor(exportStarted, 4000, '').then(function () { return true; }, function () { return false; });
      if (!started) {
        hover(btn); // เมนูอาจปิดไปแล้ว เปิดใหม่ (เมาส์จำลองไม่เคยออกจากปุ่ม เมนูจึงควรค้างอยู่ แต่กันไว้)
        await sleep(1500);
        item = findByText('ส่งออกทั้งหมด') || findByText('ส่งออกทั้งหมด', undefined, true) || item;
      }
    }
    chrome.runtime.sendMessage({ type: 'trustedRelease' }).catch(function () {});
    if (!started) throw new Error('กด ส่งออกทั้งหมด แล้วกล่องส่งออกไม่ขึ้น (ลองแล้ว 3 ครั้ง)');
    setStatus('ขั้น 4/4: BigSeller กำลังสร้างไฟล์ส่งออก รอลิงก์ ดาวน์โหลด (ไฟล์ใหญ่อาจใช้เวลาหลายนาที) ...');
    // รอด้วย MutationObserver (ตรวจทุกครั้งที่หน้าเปลี่ยน) ไม่พึ่งตัวจับเวลาอย่างเดียว เพราะแท็บเบื้องหลังถูกเบราว์เซอร์หน่วง timer
    // (ยิ่งซ่อนนานยิ่งตรวจช้า) ทำให้ปุ่ม ดาวน์โหลด โผล่แล้วแต่ไม่ถูกกดทันที
    // ระหว่างรอ แสดงข้อความในกล่องของ BigSeller ทุก 5 วินาที (เห็นที่การ์ดด้วย) จะได้รู้ว่ามันรออะไรอยู่
    const waitStart = Date.now();
    const ticker = setInterval(function () {
      setStatus('ขั้น 4/4: รอปุ่ม ดาวน์โหลด (' + Math.round((Date.now() - waitStart) / 1000) + ' วินาที) กล่องที่เห็น: ' + (visibleModalText().slice(0, 160) || '(ไม่เห็นกล่อง)'));
    }, 5000);
    let link;
    try {
      link = await waitForDom(function () { return findByText('ดาวน์โหลด', 'a, button, span'); }, (kind === 'm3' ? 30 : 10) * 60 * 1000, 'ลิงก์ ดาวน์โหลด (ไฟล์ยังสร้างไม่เสร็จ)');
    } finally {
      clearInterval(ticker);
    }
    // หลายแท็บส่งออกพร้อมกันได้ แต่กดดาวน์โหลดผลัดกันทีละแท็บ (background จะบอกว่าไฟล์ที่โหลดเสร็จเป็นของแท็บไหน)
    if (jobId) {
      setStatus('ส่งออกสำเร็จแล้ว รอคิวกดดาวน์โหลด ...');
      await chrome.runtime.sendMessage({ type: 'requestDownloadSlot', jobId: jobId });
    }
    setStatus('ส่งออกสำเร็จแล้ว กำลังกด ดาวน์โหลด ...');
    const dlTarget = findByText('ดาวน์โหลด', 'a, button, span') || link;
    const dlEl = (dlTarget.closest && dlTarget.closest('button, a')) || dlTarget;
    let trusted = false;
    if (kind === 'm3') {
      // ปุ่มดาวน์โหลดของหน้าออเดอร์ไม่ตอบคลิกจำลอง (น่าจะเปิดไฟล์ด้วยคำสั่งที่ต้องมาจากการคลิกของคนจริง) → คลิกด้วยเมาส์จริงผ่านระบบดีบักของ Chrome
      dlEl.scrollIntoView({ block: 'center' });
      await sleep(400);
      const r = dlEl.getBoundingClientRect();
      try {
        const res = await chrome.runtime.sendMessage({ type: 'trustedClick', x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
        trusted = !!(res && res.ok);
      } catch (e) { trusted = false; }
      setStatus(trusted ? 'ส่งออกสำเร็จแล้ว กดดาวน์โหลดด้วยเมาส์จริงแล้ว รอไฟล์โหลด ...' : 'ส่งออกสำเร็จแล้ว กดดาวน์โหลดด้วยเมาส์จริงไม่ได้ ลองคลิกจำลอง ...');
    }
    if (!trusted) realClick(dlEl);
    await sleep(1500);
    chrome.runtime.sendMessage({ type: 'trustedRelease' }).catch(function () {});
    const close = findByText('ปิด', 'button');
    if (close) realClick(close);
  }

  /* ================= แผงควบคุม (Shadow DOM กัน CSS ชนกับ BigSeller) ================= */

  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = [
    '<style>',
    ':host{all:initial}',
    '*{box-sizing:border-box;font:13px/1.45 system-ui,"Segoe UI",Tahoma,sans-serif}',
    '.fab{background:#5b3fd1;color:#fff;border:0;border-radius:999px;padding:10px 16px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}',
    '.panel{display:none;width:340px;max-height:80vh;overflow:auto;background:#fff;color:#1c2230;border:1px solid #d9dce6;border-radius:12px;padding:12px;box-shadow:0 8px 28px rgba(0,0,0,.28)}',
    '.panel.open{display:block}',
    'h3{margin:0 0 8px;font-size:14px;display:flex;justify-content:space-between;align-items:center}',
    'button{cursor:pointer;border:1px solid #d9dce6;background:#fff;color:#1c2230;border-radius:8px;padding:6px 10px}',
    'button.primary{background:#5b3fd1;border-color:#5b3fd1;color:#fff}',
    'button:disabled{opacity:.5;cursor:not-allowed}',
    '.row{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:6px 0}',
    '.stats{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin:6px 0}',
    '.stats div{background:#f3f4f9;border-radius:6px;padding:4px 8px}',
    '.stats span{display:block;color:#6b7385;font-size:11px}',
    '.stats b{font-size:15px}',
    'ul{margin:6px 0;padding-left:18px}',
    '.ok{color:#1a7f45}.bad{color:#b3261e}',
    '#status{white-space:pre-wrap;margin:6px 0}',
    'label{display:flex;gap:4px;align-items:center}',
    'input[type=number],input[type=password]{width:90px;padding:3px 6px;border:1px solid #d9dce6;border-radius:6px}',
    '.hide{display:none!important}',
    '.x{border:0;background:none;font-size:16px;padding:0 4px}',
    '</style>',
    '<button class="fab" id="fab">📦 ส่งสต็อกเข้า ORDER</button>',
    '<div class="panel" id="panel">',
    '  <h3>ส่งสต็อก BigSeller เข้า ORDER <button class="x" id="close">✕</button></h3>',
    '  <div class="row"><button class="primary" id="run">🚀 ส่งออกทั้งหมด แล้วนำเข้า</button></div>',
    '  <div class="row"><button id="pick">📁 หรือเลือกไฟล์เอง</button><input type="file" id="file" class="hide" accept=".xlsx,.xls,.csv,.zip" multiple></div>',
    '  <div id="status">พร้อมใช้งาน</div>',
    '  <div id="result" class="hide">',
    '    <div class="stats">',
    '      <div><span>แถวในไฟล์</span><b id="sIn">0</b></div>',
    '      <div><span>จะอัปโหลด (op_stock)</span><b id="sKept">0</b></div>',
    '      <div><span>op_stock ตอนนี้</span><b id="sOld">0</b></div>',
    '      <div><span>ตัดตำแหน่งที่ไม่นับ</span><b id="sExcl">0</b></div>',
    '    </div>',
    '    <ul id="checks"></ul>',
    '    <div class="row"><label>หยุดถ้าแถวลดเกิน <input type="number" id="maxDrop" min="0" max="100" value="20"> %</label></div>',
    '    <div class="row"><label><input type="checkbox" id="force"> ยืนยันแม้ไม่ผ่านการตรวจ</label></div>',
    '    <div class="row"><label><input type="checkbox" id="auto" checked> อัปโหลดเองถ้าผ่านทุกข้อ</label></div>',
    '    <div class="row"><button class="primary" id="go">⬆ อัปโหลดทับ op_stock</button></div>',
    '  </div>',
    '</div>'
  ].join('');

  const $ = function (id) { return root.getElementById(id); };
  const fmt = function (n) { return Number(n).toLocaleString('th-TH'); };
  let working = false;       // กำลังส่งออก/อ่าน/อัปโหลด
  let waitingDownload = false;

  function setStatus(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.className = cls || '';
    // ถ้างานนี้สั่งมาจากหน้า ORDER (มี jobId) ส่งข้อความทุกขั้นกลับไปแสดงที่การ์ดในหน้านั้นด้วย
    if (currentJobId) chrome.runtime.sendMessage({ type: 'jobProgress', jobId: currentJobId, text: text }).catch(function () {});
  }

  function opts() {
    return {
      backup: false, // ไม่โหลดไฟล์สำรอง
      maxDrop: Number($('maxDrop').value) || 0,
      force: $('force').checked,
      passcode: '' // ฐานข้อมูลตั้งรหัสว่าง (supabase/op_no_passcode.sql) เหมือนหน้านำเข้าข้อมูลของแอป
    };
  }

  function renderSummary(s) {
    $('result').classList.remove('hide');
    $('sIn').textContent = fmt(s.stats.rowsIn);
    $('sKept').textContent = fmt(s.kept);
    $('sOld').textContent = s.oldCount == null ? '?' : fmt(s.oldCount);
    $('sExcl').textContent = fmt(s.stats.excludedLoc);
    const ul = $('checks');
    ul.textContent = '';
    s.checks.items.forEach(function (i) {
      const li = document.createElement('li');
      li.className = i.ok ? 'ok' : 'bad';
      li.textContent = (i.ok ? '✓ ' : '✗ ') + i.text;
      ul.appendChild(li);
    });
  }

  function send(msg) {
    return chrome.runtime.sendMessage(msg).then(function (res) {
      if (!res || !res.ok) throw new Error((res && res.error) || 'ไม่ได้รับคำตอบจากส่วนขยาย (ลองรีเฟรชหน้า)');
      return res;
    });
  }

  async function afterPrepared(res) {
    renderSummary(res.summary);
    setStatus('ตรวจไฟล์เรียบร้อย — ดูผลตรวจแล้วกดอัปโหลด');
    if ($('auto').checked && res.summary.checks.ok) await doUpload();
  }

  async function doUpload() {
    $('go').disabled = true;
    try {
      const res = await send({ type: 'upload', opts: opts() });
      renderSummary(res.summary);
      setStatus(res.message + ' | ' + new Date().toLocaleTimeString('th-TH'), 'ok');
    } catch (err) {
      if (/รหัสอัปโหลด/.test(err.message)) {
        setStatus('ฐานข้อมูลยังตั้งรหัสอัปโหลดไว้ เลยอัปโหลดแบบไม่ใส่รหัสไม่ได้ (ยังไม่มีอะไรถูกเขียน) — ต้องรัน supabase/op_no_passcode.sql ใน Supabase ก่อน', 'bad');
      } else if (/อัปโหลดไปแล้ววันนี้/.test(err.message)) {
        setStatus('ฐานข้อมูลจำกัดอัปโหลด 1 ครั้ง/วัน ต่อชนิด และวันนี้อัปโหลดไปแล้ว — ยังไม่มีอะไรถูกเขียน ลองใหม่หลังเที่ยงคืน', 'bad');
      } else {
        setStatus('ผิดพลาด: ' + err.message + '\nถ้าพังกลางทาง ให้อัปโหลดใหม่ หรือกู้จากไฟล์สำรอง', 'bad');
      }
    } finally {
      $('go').disabled = false;
    }
  }

  $('fab').addEventListener('click', function () { $('panel').classList.toggle('open'); });
  $('close').addEventListener('click', function () { $('panel').classList.remove('open'); });

  $('run').addEventListener('click', async function () {
    if (working) return;
    working = true;
    $('run').disabled = true;
    try {
      waitingDownload = true;
      if (!/warehouseInventory\.htm/.test(location.pathname)) {
        // อยู่หน้าอื่นของ BigSeller: ให้ส่วนขยายเปิดหน้า ตำแหน่งสต็อก ในแท็บเบื้องหลังส่งออกแทน (ผลกลับมาทางสัญญาณ downloaded / panelError)
        setStatus('หน้านี้ไม่ใช่ ตำแหน่งสต็อก — กำลังเปิดหน้านั้นในแท็บเบื้องหลังเพื่อส่งออก ...');
        await send({ type: 'panelExport' });
        return;
      }
      setStatus('กำลังกด ส่งออก > ส่งออกทั้งหมด ...');
      await runExport();
      setStatus('กดดาวน์โหลดแล้ว รอไฟล์โหลดเสร็จ ...');
      // ถ้าสัญญาณไม่มาใน 2 นาที ปลดล็อกให้ลองใหม่
      setTimeout(function () {
        if (waitingDownload) {
          waitingDownload = false; working = false; $('run').disabled = false;
          setStatus('ยังไม่พบไฟล์ที่โหลดเสร็จ — โหลดแล้วให้กด "เลือกไฟล์เอง"', 'bad');
        }
      }, 120000);
    } catch (err) {
      waitingDownload = false; working = false; $('run').disabled = false;
      setStatus('ส่งออกอัตโนมัติไม่สำเร็จ: ' + err.message, 'bad');
    }
  });

  $('pick').addEventListener('click', function () { $('file').click(); });
  $('file').addEventListener('change', async function (e) {
    const files = Array.prototype.slice.call(e.target.files);
    e.target.value = '';
    if (!files.length || working) return;
    working = true;
    try {
      setStatus('กำลังอ่านไฟล์ ...');
      const out = [];
      for (const f of files) {
        const bytes = new Uint8Array(await f.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        out.push({ name: f.name, b64: btoa(bin) });
      }
      await afterPrepared(await send({ type: 'prepareFiles', files: out, opts: opts() }));
    } catch (err) {
      setStatus('ผิดพลาด: ' + err.message, 'bad');
    } finally {
      working = false;
    }
  });

  ['maxDrop', 'force'].forEach(function (id) {
    $(id).addEventListener('change', async function () {
      try {
        const res = await send({ type: 'reevaluate', opts: opts() });
        renderSummary(res.summary);
      } catch (e) { /* ยังไม่มีไฟล์ */ }
    });
  });

  $('go').addEventListener('click', doUpload);

  // จำค่าที่ตั้งไว้
  chrome.storage.local.get(['auto', 'maxDrop'], function (v) {
    if (v.auto != null) $('auto').checked = !!v.auto;
    if (v.maxDrop != null) $('maxDrop').value = v.maxDrop;
  });
  chrome.storage.local.remove('savedPw'); // เคลียร์รหัสที่เคยจำไว้ (ถ้ามี)
  ['auto'].forEach(function (id) {
    $(id).addEventListener('change', function () { chrome.storage.local.set({ [id]: $(id).checked }); });
  });
  $('maxDrop').addEventListener('change', function () { chrome.storage.local.set({ maxDrop: Number($('maxDrop').value) || 0 }); });

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === 'togglePanel') $('panel').classList.toggle('open');
    if (msg.type === 'ping') { sendResponse({ ok: true }); return; }
    if (msg.type === 'panelError') {
      waitingDownload = false; working = false; $('run').disabled = false;
      setStatus('ส่งออกอัตโนมัติไม่สำเร็จ: ' + msg.error, 'bad');
    }
    if (msg.type === 'runExportOnly') {
      // คำสั่งจากหน้า ORDOR (ปุ่มในการ์ด ST): กดส่งออก > ดาวน์โหลด อย่างเดียว ส่วนอ่านไฟล์/ส่งต่อให้ background จัดการ
      runExport(msg.kind || 'st', msg.jobId).then(
        function () { sendResponse({ ok: true }); },
        function (err) { sendResponse({ ok: false, error: err.message }); }
      );
      return true; // ตอบแบบ async
    }
    if (msg.type === 'progress') setStatus(msg.text);
    if (msg.type === 'downloaded' && waitingDownload) {
      waitingDownload = false;
      setStatus('ไฟล์โหลดเสร็จ กำลังอ่าน ...');
      send({ type: 'prepareDownload', download: msg.download, opts: opts() })
        .then(afterPrepared)
        .catch(function (err) { setStatus('ผิดพลาด: ' + err.message, 'bad'); })
        .finally(function () { working = false; $('run').disabled = false; });
    }
  });

  document.documentElement.appendChild(host);
})();
