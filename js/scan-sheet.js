/* ===== ตรวจใบปริ้น: อ่านเครื่องหมายลายมือ (✗ / ○) จากรูปถ่ายใบปริ้น ORDER Pivot =====
   - ส่วนที่ 1: ประมวลผลภาพ (ไม่พึ่งไลบรารีภายนอก)
   - ส่วนที่ 2: หน้าจอ (ตรวจแก้ผล, ส่งไปตรวจกับ Stock)
   ใช้ตัวแปร/ฟังก์ชันร่วมจาก app.js: orderPivotRows, layoutOrderSheetColumns, formatPivotNumber,
   loadOrderCompareFile, XLSX */
(function () {
  'use strict';

  const MAX_DIM = 2200;

  /* ------------------------------------------------------------------ */
  /* 1) ประมวลผลภาพ                                                       */
  /* ------------------------------------------------------------------ */
  function median(arr) {
    if (!arr.length) return 0;
    const s = [...arr].sort((a, b) => a - b);
    return s[(s.length / 2) | 0];
  }

  function makeInk(canvas) {
    const w = canvas.width, h = canvas.height;
    const rgb = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    const gray = new Uint8Array(w * h);
    for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgb[j] * 0.299 + rgb[j + 1] * 0.587 + rgb[j + 2] * 0.114) | 0;

    // เทียบกับค่าเฉลี่ยพื้นที่รอบข้าง (integral image) เพื่อรับมือแสงไม่สม่ำเสมอ
    const s = Math.max(w, h) / 2000;
    const radius = Math.max(12, Math.round(28 * s));
    const thr = 26;
    const W1 = w + 1;
    const I = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += gray[y * w + x];
        I[(y + 1) * W1 + x + 1] = I[y * W1 + x + 1] + row;
      }
    }
    const data = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - radius), y1 = Math.min(h, y + radius + 1);
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(w, x + radius + 1);
        const area = (x1 - x0) * (y1 - y0);
        const sum = I[y1 * W1 + x1] - I[y0 * W1 + x1] - I[y1 * W1 + x0] + I[y0 * W1 + x0];
        if (gray[y * w + x] < sum / area - thr) data[y * w + x] = 1;
      }
    }
    stripLongRuns(data, w, h, s);
    // สีเจือของกระดาษ (แสง/ white balance ทำให้ทั้งภาพออกฟ้า) เอาไปหักออกตอนวัดความเป็นสีน้ำเงินของหมึก
    let pb = 0, pn = 0;
    for (let i = 0; i < w * h; i += 7) {
      if (data[i]) continue;
      const j = i * 4;
      pb += rgb[j + 2] - (rgb[j] + rgb[j + 1]) / 2; pn++;
    }
    return { w, h, data, rgb, s, paperBlue: pn ? pb / pn : 0 };
  }

  // ลบเส้นตรงยาว (ขีดคั่นกลุ่ม/ขอบกระดาษ/เงา) ทั้งแนวนอนและแนวตั้ง: ตัวอักษรไม่มีเส้นตรงต่อเนื่องยาวขนาดนี้
  function stripLongRuns(data, w, h, s) {
    const L = Math.max(24, Math.round(45 * s));
    const kill = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let x = 0;
      while (x < w) {
        if (data[base + x]) {
          let x1 = x;
          while (x1 < w && data[base + x1]) x1++;
          if (x1 - x >= L) kill.fill(1, base + x, base + x1);
          x = x1;
        } else x++;
      }
    }
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        if (data[y * w + x]) {
          let y1 = y;
          while (y1 < h && data[y1 * w + x]) y1++;
          if (y1 - y >= L) for (let k = y; k < y1; k++) kill[k * w + x] = 1;
          y = y1;
        } else y++;
      }
    }
    // ขยายบริเวณที่ลบออกอีกเล็กน้อยเพื่อลบขอบเส้นที่เหลือ
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) {
        if (kill[base + x]) { const x0 = Math.max(0, x - 2), x1 = Math.min(w - 1, x + 2); for (let k = x0; k <= x1; k++) tmp[base + k] = 1; }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        if (tmp[y * w + x]) { const y0 = Math.max(0, y - 2), y1 = Math.min(h - 1, y + 2); for (let k = y0; k <= y1; k++) kill[k * w + x] = 1; }
      }
    }
    for (let i = 0; i < data.length; i++) if (kill[i]) data[i] = 0;
  }

  function smooth1d(a, r) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let sum = 0, n = 0;
      for (let k = -r; k <= r; k++) {
        const j = i + k;
        if (j >= 0 && j < a.length) { sum += a[j]; n++; }
      }
      out[i] = sum / n;
    }
    return out;
  }

  // หาบล็อกข้อความแนวตั้ง (SKU / จำนวน) แล้วจับคู่ SKU ↔ จำนวน (จำนวนอยู่ทางขวาของ SKU)
  function findColumnPairs(ink) {
    const { w, h, data, s } = ink;
    const vp = new Float64Array(w);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      for (let x = 0; x < w; x++) if (data[base + x]) vp[x]++;
    }
    const sm = smooth1d(vp, Math.max(2, Math.round(4 * s)));
    // เกณฑ์ตามความหนาแน่นของข้อความ (กันจุดรบกวน/ริ้วรอยกระดาษที่ทำให้บล็อกติดกัน)
    let maxSm = 0;
    for (let i = 0; i < sm.length; i++) if (sm[i] > maxSm) maxSm = sm[i];
    const thr = Math.max(1.5 * (h / 2000), 0.035 * maxSm);
    const segs = [];
    let st = -1;
    for (let x = 0; x < w; x++) {
      const on = sm[x] > thr;
      if (on && st < 0) st = x;
      if (!on && st >= 0) { segs.push([st, x - 1]); st = -1; }
    }
    if (st >= 0) segs.push([st, w - 1]);

    const gap = 40 * s;
    const merged = [];
    for (const sg of segs) {
      const last = merged[merged.length - 1];
      if (last && sg[0] - last[1] < gap) last[1] = sg[1];
      else merged.push([sg[0], sg[1]]);
    }
    const blocks = merged.filter(b => b[1] - b[0] > 15 * s).map(b => {
      let ink2 = 0;
      for (let x = b[0]; x <= b[1]; x++) ink2 += vp[x];
      return { x0: b[0], x1: b[1], width: b[1] - b[0] + 1, ink: ink2 };
    }).filter(b => b.ink > 400 * s * s)
      // เศษเงา/ขอบกระดาษที่ริมภาพ: บล็อกแคบที่ติดขอบ
      .filter(b => !((b.x0 <= 0.02 * w || b.x1 >= 0.98 * w) && b.width < 0.08 * w));
    if (blocks.length < 2) return [];

    const wideMax = Math.max(...blocks.map(b => b.width));
    blocks.forEach(b => { b.kind = b.width >= wideMax * 0.45 ? 'sku' : 'qty'; });

    const pairs = [];
    for (let i = 0; i < blocks.length - 1; i++) {
      if (blocks[i].kind === 'sku' && blocks[i + 1].kind === 'qty' && blocks[i + 1].x0 - blocks[i].x1 < w * 0.6) {
        pairs.push({ sku: blocks[i], qty: blocks[i + 1] });
        i++;
      }
    }
    // วิธีสำรอง: SKU สั้นจนกว้างพอๆ กับตัวเลข → จับคู่ตามลำดับ (SKU, จำนวน, SKU, จำนวน) เมื่อจำนวนบล็อกเป็นเลขคู่
    if (!pairs.length && blocks.length % 2 === 0) {
      const alt = [];
      for (let i = 0; i < blocks.length; i += 2) {
        if (blocks[i].width >= blocks[i + 1].width * 0.8) alt.push({ sku: blocks[i], qty: blocks[i + 1] });
        else return [];
      }
      return withAlign(alt);
    }
    return withAlign(pairs);

    // SKU ชิดซ้าย + ตัวเลขชิดขวา = ภาพตั้งตรง (ใช้แยกภาพกลับหัว)
    function withAlign(list) {
      const edge = (b, right) => {
        let sum = 0;
        const n = Math.max(3, Math.round(6 * s));
        for (let k = 0; k < n; k++) sum += vp[right ? b.x1 - k : b.x0 + k] || 0;
        return sum / n;
      };
      list.forEach(pr => {
        const sl = edge(pr.sku, false), sr = edge(pr.sku, true);
        const ql = edge(pr.qty, false), qr = edge(pr.qty, true);
        pr.align = ((sl - sr) / (sl + sr + 1) + (qr - ql) / (qr + ql + 1)) / 2;
      });
      return list;
    }
  }

  // แถบบรรทัดของบล็อก SKU
  function rowBands(ink, x0, x1) {
    const { w, h, data, s } = ink;
    const width = x1 - x0 + 1;
    const p = new Float64Array(h);
    for (let y = 0; y < h; y++) {
      let sum = 0;
      const base = y * w;
      for (let x = x0; x <= x1; x++) sum += data[base + x];
      p[y] = sum;
    }
    const sm = smooth1d(p, 2);
    const thr = Math.max(2, width * 0.009);
    let bands = [];
    let st = -1;
    for (let y = 0; y < h; y++) {
      const on = sm[y] > thr;
      if (on && st < 0) st = y;
      if (!on && st >= 0) {
        if (y - st >= 8 * s) bands.push({ y0: st, y1: y - 1 });
        st = -1;
      }
    }
    bands.forEach(b => {
      b.cy = (b.y0 + b.y1) / 2;
      let ink2 = 0;
      for (let y = b.y0; y <= b.y1; y++) ink2 += p[y];
      b.ink = ink2;
    });
    if (bands.length < 2) return bands;
    // ตัดแถบที่ไม่ใช่ข้อความ (เศษเงา/เศษเส้นดินสอ): หมึกน้อยหรือเตี้ยกว่าแถบทั่วไปมาก
    const medInk = median(bands.map(b => b.ink));
    const medH = median(bands.map(b => b.y1 - b.y0 + 1));
    bands = bands.filter(b => b.ink >= medInk * 0.2 && (b.y1 - b.y0 + 1) >= medH * 0.62);
    if (bands.length < 2) return bands;

    // แถบที่โดดเดี่ยวห่างจากแถบอื่นมาก (เกิน ~4.5 บรรทัด) ที่หัว/ท้าย = เศษเงาริมภาพ ไม่ใช่บรรทัดจริง
    {
      const d0 = [];
      for (let i = 1; i < bands.length; i++) d0.push(bands[i].cy - bands[i - 1].cy);
      const pit = median(d0);
      while (bands.length > 2 && bands[1].cy - bands[0].cy > pit * 4.5) bands.shift();
      while (bands.length > 2 && bands[bands.length - 1].cy - bands[bands.length - 2].cy > pit * 4.5) bands.pop();
    }

    // แถบที่สูงกว่าปกติมาก = หลายบรรทัดที่เกือบติดกัน (ช่องว่างระหว่างบรรทัดแคบ) ให้แบ่งเท่าๆ กัน
    {
      const hs = bands.map(b => b.y1 - b.y0 + 1);
      const medH2 = median(hs);
      const dd = [];
      for (let i = 1; i < bands.length; i++) dd.push(bands[i].cy - bands[i - 1].cy);
      const pit2 = median(dd) || medH2 * 1.5;
      const split = [];
      bands.forEach(b => {
        const hh = b.y1 - b.y0 + 1;
        const n = Math.round(hh / pit2);
        if (hh >= medH2 * 1.7 && n >= 2 && n <= 4) {
          const step = hh / n;
          for (let k = 0; k < n; k++) {
            const y0 = Math.round(b.y0 + k * step), y1 = Math.round(b.y0 + (k + 1) * step) - 1;
            split.push({ y0, y1, cy: (y0 + y1) / 2, ink: b.ink / n });
          }
        } else split.push(b);
      });
      bands = split;
    }

    // รวมแถบที่ใกล้กันเกินไป (เช่น สระ/วรรณยุกต์ที่ทำให้บรรทัดเดียวถูกแบ่งเป็น 2)
    const diffs = [];
    for (let i = 1; i < bands.length; i++) diffs.push(bands[i].cy - bands[i - 1].cy);
    const pitch = median(diffs);
    const out = [bands[0]];
    for (let i = 1; i < bands.length; i++) {
      const last = out[out.length - 1];
      if (bands[i].cy - last.cy < pitch * 0.6) {
        last.y1 = bands[i].y1;
        last.cy = (last.y0 + last.y1) / 2;
      } else out.push(bands[i]);
    }
    return out;
  }

  function labelComponents(ink, x0, x1, y0, y1, minArea) {
    const { w, data, rgb } = ink;
    const paperBlue = ink.paperBlue || 0;
    const lab = new Int32Array(w * ink.h);
    const stack = new Int32Array(Math.max(1024, (w * ink.h) >> 2));
    const comps = [];
    let id = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const p = y * w + x;
        if (!data[p] || lab[p]) continue;
        id++;
        let sp = 0;
        stack[sp++] = p;
        lab[p] = id;
        let minx = x, maxx = x, miny = y, maxy = y, area = 0, sx = 0, sy = 0, be = 0;
        while (sp > 0) {
          const q = stack[--sp];
          const qy = (q / w) | 0, qx = q - qy * w;
          area++; sx += qx; sy += qy;
          if (qx < minx) minx = qx; if (qx > maxx) maxx = qx;
          if (qy < miny) miny = qy; if (qy > maxy) maxy = qy;
          const j = q * 4;
          be += rgb[j + 2] - (rgb[j] + rgb[j + 1]) / 2 - paperBlue;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              const nx = qx + dx, ny = qy + dy;
              if (nx < x0 || nx > x1 || ny < y0 || ny >= y1) continue;
              const np = ny * w + nx;
              if (data[np] && !lab[np]) { lab[np] = id; stack[sp++] = np; }
            }
          }
        }
        if (area >= minArea) {
          comps.push({ id, minx, maxx, miny, maxy, w: maxx - minx + 1, h: maxy - miny + 1, area, cx: sx / area, cy: sy / area, blue: be / area });
        }
      }
    }
    return { comps, lab };
  }

  // พื้นที่ปิดล้อม (รู) ภายในก้อนเส้น ใช้แยกวงกลมออกจากกากบาท
  function findHoles(ink, comp, lab) {
    const { w } = ink;
    const bw = comp.w + 2, bh = comp.h + 2;
    const mask = new Uint8Array(bw * bh);
    for (let y = 0; y < comp.h; y++) {
      for (let x = 0; x < comp.w; x++) {
        if (lab[(comp.miny + y) * w + comp.minx + x] === comp.id) mask[(y + 1) * bw + x + 1] = 1;
      }
    }
    const seen = new Uint8Array(bw * bh);
    const stack = [];
    const fill = (sx, sy) => {
      stack.push(sy * bw + sx);
      seen[sy * bw + sx] = 1;
      let cnt = 0, cxs = 0, cys = 0;
      while (stack.length) {
        const q = stack.pop();
        const qy = (q / bw) | 0, qx = q - qy * bw;
        cnt++; cxs += qx; cys += qy;
        const nbs = [[qx + 1, qy], [qx - 1, qy], [qx, qy + 1], [qx, qy - 1]];
        for (const [nx, ny] of nbs) {
          if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
          const np = ny * bw + nx;
          if (!mask[np] && !seen[np]) { seen[np] = 1; stack.push(np); }
        }
      }
      return { cnt, cx: cxs / cnt, cy: cys / cnt };
    };
    fill(0, 0);
    const holes = [];
    for (let y = 0; y < bh; y++) {
      for (let x = 0; x < bw; x++) {
        const q = y * bw + x;
        if (!mask[q] && !seen[q]) {
          const r = fill(x, y);
          holes.push({ area: r.cnt, cx: comp.minx - 1 + r.cx, cy: comp.miny - 1 + r.cy });
        }
      }
    }
    return holes;
  }

  // ตัดสินเครื่องหมายของแต่ละบรรทัดในคอลัมน์จำนวน
  function classifyColumn(ink, skuBands, qx0, qx1) {
    const { w, h } = ink;
    const diffs = [];
    for (let i = 1; i < skuBands.length; i++) diffs.push(skuBands[i].cy - skuBands[i - 1].cy);
    const pitch = median(diffs) || 34;
    const p2 = pitch * pitch;

    const { comps, lab } = labelComponents(ink, qx0, qx1, 0, h - 1, Math.max(6, 0.005 * p2));
    // ตัวเลขที่พิมพ์: ก้อนเล็ก สีเทา/ดำ (ไม่ใช่สีน้ำเงินของปากกา)
    // ตัวเลขที่พิมพ์: ชิดขวาที่ตำแหน่งเดียวกันทุกบรรทัด (หาจากค่าขอบขวาที่พบบ่อยที่สุดของก้อนขนาดเท่าตัวเลข)
    const digitLike = comps.filter(c => c.blue < 6.5 && c.h <= pitch * 0.7 && c.h >= pitch * 0.33 && c.w <= pitch * 1.3 && c.area < p2 * 0.3);
    const bin = Math.max(2, Math.round(pitch * 0.12));
    const votes = new Map();
    digitLike.forEach(c => { const k = Math.round(c.maxx / bin); votes.set(k, (votes.get(k) || 0) + 1); });
    let bestK = null, bestV = 0;
    votes.forEach((v, k) => { const vv = v + (votes.get(k - 1) || 0) + (votes.get(k + 1) || 0); if (vv > bestV) { bestV = vv; bestK = k; } });
    let digits;
    if (bestK !== null && bestV >= 3) {
      const edge = bestK * bin;
      digits = digitLike.filter(c => Math.abs(c.maxx - edge) <= pitch * 0.2).sort((a, b) => a.cy - b.cy);
    } else {
      digits = comps.filter(c => c.blue < 6.5 && c.h <= pitch * 0.66 && c.h >= pitch * 0.33 && c.w <= pitch * 0.42 && c.area < p2 * 0.11).sort((a, b) => a.cy - b.cy);
    }
    const anchors = [];
    for (const d of digits) {
      const l = anchors[anchors.length - 1];
      if (l && d.cy - l.cy < pitch * 0.45) l.n++;
      else anchors.push({ cy: d.cy, n: 1 });
    }

    const digitLeft = digits.length >= 3 ? median(digits.map(d => d.minx)) : null;
    const digitRight = digits.length >= 3 ? median(digits.map(d => d.maxx)) : null;

    // จับคู่ตำแหน่งตัวเลขกับบรรทัด SKU ด้วยโมเดลเยื้องแบบเส้นตรง (รับมือภาพเอียงเล็กน้อย)
    const ymid = (skuBands[0].cy + skuBands[skuBands.length - 1].cy) / 2;
    let best = { s: Infinity, o0: 0, o1: 0 };
    if (anchors.length >= 3) {
      const cap = (pitch * 0.5) ** 2;
      for (let o1 = -0.04; o1 <= 0.0401; o1 += 0.005) {
        for (let o0 = -pitch * 0.8; o0 <= pitch * 0.8; o0 += 1) {
          let sc = 0;
          for (const a of anchors) {
            let m = Infinity;
            for (const r of skuBands) {
              const d = Math.abs(a.cy - (r.cy + o0 + o1 * (r.cy - ymid)));
              if (d < m) m = d;
            }
            sc += Math.min(m * m, cap);
          }
          if (sc < best.s) best = { s: sc, o0, o1 };
        }
      }
    } else best = { s: 0, o0: 0, o1: 0 };

    const rows = skuBands.map((b, i) => ({
      index: i, sy: b.cy,
      qy: b.cy + best.o0 + best.o1 * (b.cy - ymid),
      ring: 0, cross: 0, check: false, parts: []
    }));
    const digitIds = new Set(digits.map(d => d.id));
    const dwSingle = median(digits.map(d => d.w)) || pitch * 0.35;
    const digitEdge = digits.length ? median(digits.map(d => d.maxx)) : null;
    // ความกว้างของตัวเลขที่พิมพ์ต่อบรรทัด (หน่วย = ความกว้างตัวเลข 1 หลัก) ใช้ตรวจหมึกที่เขียนติดกับตัวเลข
    const digitsOfRow = rows.map(() => []);
    const nearestIdx = y => {
      let bi = 0, bd = Infinity;
      rows.forEach((r, i) => { const d = Math.abs(y - r.qy); if (d < bd) { bd = d; bi = i; } });
      return bd < pitch * 0.55 ? bi : -1;
    };
    digits.forEach(d => { const k = nearestIdx(d.cy); if (k >= 0) digitsOfRow[k].push(d); });
    digitsOfRow.forEach((list, k) => {
      if (!list.length) return;
      const l = Math.min(...list.map(d => d.minx)), r = Math.max(...list.map(d => d.maxx));
      rows[k].digitRatio = (r - l + 1) / dwSingle;
    });
    const nearest = y => {
      let bi = 0, bd = Infinity;
      rows.forEach((r, i) => { const d = Math.abs(y - r.qy); if (d < bd) { bd = d; bi = i; } });
      return bi;
    };
    // ส่วนของก้อนเส้นที่อยู่ในแถบของบรรทัดนั้น (ใช้กับก้อนที่ติดกันหลายบรรทัด)
    const partInBand = (c, row) => {
      const y0 = Math.round(row.qy - pitch / 2), y1 = Math.round(row.qy + pitch / 2);
      let n = 0, minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
      for (let y = Math.max(c.miny, y0); y <= Math.min(c.maxy, y1); y++) {
        for (let x = c.minx; x <= c.maxx; x++) {
          if (lab[y * w + x] !== c.id) continue;
          n++;
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
      return { n, w: n ? maxx - minx + 1 : 0, h: n ? maxy - miny + 1 : 0 };
    };

    // หมึกที่เขียนติดกับตัวเลขที่พิมพ์ (ก้อนเดียวกว้างผิดปกติ) ให้ผู้ใช้ตรวจ
    digits.forEach(d => {
      if (d.w > dwSingle * 1.7 && d.h <= pitch * 0.9) {
        const k = nearestIdx(d.cy);
        if (k >= 0) { rows[k].cross++; rows[k].check = true; rows[k].parts.push('digitMerge ' + d.w); }
      }
    });
    for (const c of comps) {
      if (digitIds.has(c.id)) continue;
      if (c.h < pitch * 0.22 && c.w > pitch * 0.8) continue; // เศษเส้นขีดคั่นกลุ่มที่เหลือ
      // ตัวเลขที่พิมพ์อยู่ในวงกลมแยกเป็นก้อนเล็กอยู่ภายในกรอบของวงกลม (ขอบตัวเลขเยื้องตามภาพเอียงจึงไม่ถูกจับเป็นตัวเลข)
      if (c.h <= pitch * 0.7 && c.w <= pitch * 0.45 && comps.some(o => o !== c && o.area > c.area * 2.5 &&
        o.minx <= c.minx && o.maxx >= c.maxx && o.miny <= c.miny && o.maxy >= c.maxy)) continue;
      const smallMark = digitEdge !== null && c.cx > digitEdge + pitch * 0.12 && Math.min(c.w, c.h) >= pitch * 0.3 && c.area >= p2 * 0.02;
      if (c.area < p2 * 0.04 && !smallMark) continue;
      const holes = findHoles(ink, c, lab);
      const big = holes.filter(hh => hh.area >= p2 * 0.17);
      const holeSum = holes.filter(hh => hh.area >= p2 * 0.026).reduce((sum, hh) => sum + hh.area, 0);
      const filled = (c.area + holeSum) / (c.w * c.h);
      const spanned = rows.filter(r => r.qy >= c.miny + pitch * 0.15 && r.qy <= c.maxy - pitch * 0.15);

      if (big.length) {
        // วงกลมล้อมตัวเลข (อาจติดกันหลายบรรทัด) — วงที่ไม่ปิดสนิทถือเป็นวงกลมด้วยถ้าก้อนกว้างพอ
        const got = new Set();
        for (const hh of big) { const r = rows[nearest(hh.cy)]; r.ring++; got.add(r.index); }
        for (const r of spanned) {
          if (!got.has(r.index) && c.w >= pitch * 0.82) { r.ring++; r.check = true; }
        }
        continue;
      }
      if (spanned.length <= 1) {
        const r = rows[nearest(c.cy)];
        // วงกลมที่ไม่ปิดสนิท แต่ล้อมตัวเลขที่พิมพ์ไว้ครบทุกด้าน
        const enclosesDigit = digits.some(d =>
          Math.abs(d.cy - c.cy) < pitch * 0.6 &&
          c.minx <= d.minx - 2 && c.maxx >= d.maxx + 2 && c.miny <= d.miny - 1 && c.maxy >= d.maxy + 1);
        if (enclosesDigit) { r.ring++; r.parts.push('encl'); continue; }
        // ก้อนที่คลุมช่วงตัวเลขทั้งคอลัมน์ในแนวนอน (วงกลมที่ติดกับตัวเลข) ไม่ใช่กากบาทที่เขียนต่อท้ายตัวเลข
        if (digitLeft !== null && c.minx <= digitLeft - 7 && c.maxx >= digitRight + pitch * 0.12 && c.w >= pitch * 0.5 && c.h >= pitch * 0.5) { r.ring++; r.check = true; r.parts.push('spanDigit ' + c.minx + '-' + c.maxx + ' dl' + Math.round(digitLeft) + ' dr' + Math.round(digitRight)); continue; }
        if (holeSum >= p2 * 0.035 && filled >= 0.56 && c.h <= pitch * 1.3) { r.ring++; r.check = true; r.parts.push('ring2 f' + filled.toFixed(2)); continue; }
        // ก้อนกว้างและสูงเท่าวงกลม (เช่น เขียนเลขใหม่ในวง ③) ไม่ใช่กากบาท
        if (c.w >= pitch * 0.76 && c.h >= pitch * 0.66 && c.h <= pitch * 1.3) { r.ring++; r.check = true; r.parts.push('wide ' + c.w + 'x' + c.h); continue; }
        if (c.blue >= 7 || c.h >= pitch * 0.66 || c.w >= pitch * 0.5 || smallMark) {
          r.cross++; r.parts.push('x ' + c.w + 'x' + c.h + ' f' + filled.toFixed(2));
          if (holeSum > 0 || filled >= 0.36) r.check = true;
        }
        continue;
      }
      // ก้อนสูงหลายบรรทัดที่ติดกัน (เช่น กากบาทติดกับวงกลมข้างล่าง)
      for (const r of spanned) {
        const part = partInBand(c, r);
        if (part.n < p2 * 0.04) continue;
        // ส่วนที่กว้าง/สูงเท่าวงกลม = วงกลม (เช่น ③) ส่วนอื่นถือเป็นกากบาทที่ควรตรวจ
        if (part.w >= pitch * 0.76 && part.h >= pitch * 0.6) r.ring++;
        else r.cross++;
        r.check = true;
      }
    }
    return { rows, pitch, fit: best, anchors: anchors.length };
  }

  function analyzeInk(ink) {
    const pairs = findColumnPairs(ink);
    const columns = [];
    for (const pr of pairs) {
      const bands = rowBands(ink, pr.sku.x0, pr.sku.x1);
      if (bands.length < 1) continue;
      columns.push({ pair: pr, bands });
    }
    return columns;
  }

  function rotateCanvas(src, deg) {
    deg = ((deg % 360) + 360) % 360;
    if (deg === 0) return src;
    const swap = deg % 180 !== 0;
    const c = document.createElement('canvas');
    c.width = swap ? src.height : src.width;
    c.height = swap ? src.width : src.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.translate(c.width / 2, c.height / 2);
    g.rotate(deg * Math.PI / 180);
    g.drawImage(src, -src.width / 2, -src.height / 2);
    return c;
  }

  // มุมเอียงเล็กน้อย (องศา) ที่ทำให้บรรทัดข้อความคมที่สุด ใช้หมึกทั้งภาพ (เลี่ยง aliasing ด้วยถังกว้าง 2 พิกเซล)
  function estimateSkew(ink) {
    const pts = [];
    for (let y = 0; y < ink.h; y += 2) {
      const base = y * ink.w;
      for (let x = 0; x < ink.w; x += 2) if (ink.data[base + x]) pts.push(x, y);
    }
    if (pts.length < 400) return 0;
    const off = ink.w * 0.5;
    const size = Math.ceil((ink.h + ink.w) / 2) + 200;
    const score = deg => {
      const a = deg * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a);
      const bins = new Float64Array(size);
      for (let i = 0; i < pts.length; i += 2) {
        const yy = ((pts[i + 1] * cs - pts[i] * sn + off) / 2) | 0;
        if (yy >= 0 && yy < size) bins[yy]++;
      }
      let sc = 0;
      for (let i = 0; i < size; i++) sc += bins[i] * bins[i];
      return sc;
    };
    let bestA = 0, bestS = -1;
    for (let a = -6; a <= 6.001; a += 0.25) { const sc = score(a); if (sc > bestS) { bestS = sc; bestA = a; } }
    const center = bestA;
    for (let a = center - 0.25; a <= center + 0.2501; a += 0.05) { const sc = score(a); if (sc > bestS) { bestS = sc; bestA = a; } }
    return Math.abs(bestA) < 0.15 ? 0 : bestA;
  }

  function paperColor(canvas) {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(canvas, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  }

  // ปรับภาพให้บรรทัดอยู่แนวนอนพอดี
  function deskew(canvas) {
    let ink = makeInk(canvas);
    const deg = estimateSkew(ink);
    if (!deg) return { canvas, ink, skew: 0 };
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    const g = c2.getContext('2d', { willReadFrequently: true });
    g.fillStyle = paperColor(canvas);
    g.fillRect(0, 0, c2.width, c2.height);
    g.translate(c2.width / 2, c2.height / 2);
    g.rotate(-deg * Math.PI / 180);
    g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    return { canvas: c2, ink: makeInk(c2), skew: deg };
  }

  function downscale(canvas, maxDim) {
    const k = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
    if (k >= 1) return canvas;
    const c = document.createElement('canvas');
    c.width = Math.round(canvas.width * k); c.height = Math.round(canvas.height * k);
    c.getContext('2d', { willReadFrequently: true }).drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  // วิเคราะห์ภาพที่ตั้งตรงทิศแล้ว
  function analyzeUpright(canvas) {
    const dk = deskew(canvas);
    const cv = dk.canvas, ink = dk.ink;
    const columns = analyzeInk(ink);
    if (!columns.length) return { ok: false, reason: 'ไม่พบคอลัมน์ SKU/จำนวนในรูป', canvas: cv, rows: [] };

    const rows = [];
    columns.forEach((col, ci) => {
      const cls = classifyColumn(ink, col.bands, col.pair.qty.x0, col.pair.qty.x1);
      cls.rows.forEach(r => {
        rows.push({
          col: ci, indexInCol: r.index,
          sy: r.sy, qy: r.qy, pitch: cls.pitch,
          skuX0: col.pair.sku.x0, skuX1: col.pair.sku.x1,
          qtyX0: col.pair.qty.x0, qtyX1: col.pair.qty.x1,
          mark: r.cross ? 'cross' : (r.ring ? 'ring' : 'none'),
          both: !!(r.cross && r.ring),
          check: r.check, parts: r.parts
        });
      });
    });
    return { ok: true, canvas: cv, rows, skew: dk.skew, columns: columns.length };
  }

  // เลือกทิศของรูป: ลองทั้ง 4 ทิศ (ภาพย่อ + ปรับให้ตรง) แล้วเลือกทิศที่พบบรรทัดในคอลัมน์ที่จับคู่ได้มากที่สุด
  function pickRotation(sourceCanvas) {
    pickRotation.last = {};
    const small = downscale(sourceCanvas, 1100);
    let bestDeg = 0, bestScore = -1;
    for (const deg of [0, 90, 180, 270]) {
      const dk = deskew(rotateCanvas(small, deg));
      const cols = analyzeInk(dk.ink);
      const rowsFound = cols.reduce((sum, c) => sum + c.bands.length, 0);
      const align = cols.length ? cols.reduce((sum, c) => sum + (c.pair.align || 0), 0) / cols.length : 0;
      const sc = align < -0.15 ? rowsFound * 0.5 : rowsFound;
      pickRotation.last = pickRotation.last || {};
      pickRotation.last[deg] = { rows: rowsFound, align: Math.round(align * 100) / 100, cols: cols.length, score: sc };
      if (sc > bestScore) { bestScore = sc; bestDeg = deg; }
    }
    return bestDeg;
  }

  function analyzeImage(sourceCanvas, rotation) {
    const rot = rotation === 'auto' ? pickRotation(sourceCanvas) : rotation;
    const res = analyzeUpright(rotateCanvas(sourceCanvas, rot));
    res.rotation = rot;
    return res;
  }
  async function fileToCanvas(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { bmp = null; }
    let srcW, srcH, drawable;
    if (bmp) { srcW = bmp.width; srcH = bmp.height; drawable = bmp; }
    else {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      srcW = img.naturalWidth; srcH = img.naturalHeight; drawable = img;
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    const k = Math.min(1, MAX_DIM / Math.max(srcW, srcH));
    const c = document.createElement('canvas');
    c.width = Math.round(srcW * k); c.height = Math.round(srcH * k);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(drawable, 0, 0, c.width, c.height);
    if (bmp && bmp.close) bmp.close();
    return c;
  }

  window.ScanSheet = { analyzeImage, fileToCanvas, rotateCanvas };

  /* ------------------------------------------------------------------ */
  /* 2) หน้าจอ                                                            */
  /* ------------------------------------------------------------------ */
  const $ = id => document.getElementById(id);
  const tool = $('scanTool');
  if (!tool) return;

  // qty: จำนวนที่ผู้ใช้แก้ไขเอง (คีย์ = ลำดับรายการใน Pivot)
  const st = { source: null, fileName: '', result: null, rotation: 'auto', marks: [], start: 1, filter: 'all', hover: -1, qty: new Map(), ref: null, refId: '', refTouched: false, prints: [], pages: [], cur: -1, startUser: false, undo: [], redo: [], sel: -1 };

  function currentPivot() { return typeof orderPivotRows !== 'undefined' && Array.isArray(orderPivotRows) ? orderPivotRows : []; }
  // รายการอ้างอิง: ใบปริ้นที่บันทึกไว้ (ถ้าเลือก) หรือ Pivot ปัจจุบันจากหน้า รับORDER
  function pivot() { return st.ref ? st.ref.rows : currentPivot(); }
  function pivotItem(i, start = st.start) { return pivot()[start - 1 + i] || null; }
  function qtyOf(i, start = st.start) {
    const it = pivotItem(i, start);
    if (!it) return null;
    const key = start - 1 + i;
    return st.qty.has(key) ? st.qty.get(key) : it.qty;
  }

  /* หลายรูป: st.* คือข้อมูลของรูป (หน้า) ที่กำลังดูอยู่ ส่วน st.pages เก็บทุกรูป */
  function syncOut() {
    const p = st.pages[st.cur];
    if (p) Object.assign(p, { name: st.fileName, source: st.source, rotation: st.rotation, result: st.result, marks: st.marks, start: st.start, startUser: st.startUser });
  }
  function livePages() {
    syncOut();
    return st.pages.filter(p => p.result && p.result.ok);
  }
  function loadPage(i) {
    syncOut();
    const p = st.pages[i];
    if (!p) return;
    st.cur = i; st.fileName = p.name; st.source = p.source; st.rotation = p.rotation;
    st.result = p.result; st.marks = p.marks || []; st.start = p.start; st.startUser = !!p.startUser;
    st.hover = -1; st.sel = -1;
    $('scanStart').value = String(st.start);
    if (st.result) renderAll(false); else showFailed();
    renderPages();
    updateNeed();
  }
  function showFailed() {
    const cv = $('scanCanvas');
    if (st.source && cv) {
      const src = ScanSheet.rotateCanvas(st.source, typeof st.rotation === 'number' ? st.rotation : 0);
      const k = Math.min(1, 1000 / src.width);
      cv.width = Math.round(src.width * k);
      cv.height = Math.round(src.height * k);
      cv.getContext('2d').drawImage(src, 0, 0, cv.width, cv.height);
    }
    $('scanRows').textContent = '';
    renderStats();
  }
  function removePage(i) {
    syncOut();
    st.pages.splice(i, 1);
    if (!st.pages.length) { reset(); return; }
    st.cur = -1;
    loadPage(Math.min(i, st.pages.length - 1));
  }
  function renderPages() {
    const box = $('scanPages');
    if (!box) return;
    box.textContent = '';
    st.pages.forEach((p, i) => {
      const chip = document.createElement('span');
      chip.className = 'scan-page-chip' + (i === st.cur ? ' is-active' : '') + (p.result && p.result.ok ? '' : ' is-fail');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'scan-page-pick';
      const rows = p.result && p.result.ok ? ` · ${p.result.rows.length} บรรทัด` : ' · อ่านไม่ได้';
      b.textContent = `${i + 1}. ${p.name}${rows}`;
      b.title = p.name;
      b.addEventListener('click', () => loadPage(i));
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'scan-page-del';
      x.textContent = '×';
      x.title = 'เอารูปนี้ออก';
      x.addEventListener('click', () => removePage(i));
      chip.append(b, x);
      box.appendChild(chip);
    });
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'scan-page-add';
    add.textContent = '＋ เพิ่มรูป';
    add.addEventListener('click', () => $('scanFile').click());
    box.appendChild(add);
  }

  function setMsg(el, text, show) {
    el.textContent = text || '';
    el.style.display = show ? '' : 'none';
  }

  function updateNeed() {
    const has = pivot().length > 0 || st.prints.length > 0;
    tool.classList.toggle('scan-no-pivot', !has);
    tool.classList.toggle('scan-has-image', st.pages.length > 0);
  }

  // เดาตำแหน่งเริ่มต้นจากจำนวนบรรทัดที่พบ เทียบกับการแบ่งหน้าของใบปริ้นปัจจุบัน
  // taken = เลขเริ่มของรูปอื่นที่ใช้ไปแล้ว: เลือกหน้าของใบปริ้นที่จำนวนบรรทัดใกล้เคียงที่สุดและยังไม่ถูกใช้
  function guessStart(count, taken = []) {
    const total = pivot().length;
    if (count === total && !taken.length) return 1;
    if (typeof layoutOrderSheetColumns !== 'function') return 1;
    const cols = layoutOrderSheetColumns(pivot()).map(col => col.filter(e => !e.spacer).length);
    const pages = [];
    let acc = 0;
    for (let i = 0; i < cols.length; i += 2) {
      const cnt = cols[i] + (cols[i + 1] || 0);
      pages.push({ start: acc + 1, cnt });
      acc += cnt;
    }
    const free = pages.filter(p => !taken.some(t => t >= p.start && t < p.start + p.cnt));
    let best = null;
    free.forEach(p => {
      const d = Math.abs(p.cnt - count);
      if (!best || d < best.d) best = { d, start: p.start };
    });
    if (best && best.d <= Math.max(4, Math.round(count * 0.12))) return best.start;
    if (taken.length) {
      const next = Math.max(...taken.map(t => t)) ;
      const nx = pages.find(p => p.start > next);
      if (nx) return nx.start;
    }
    return 1;
  }

  function initMarks() {
    st.marks = st.result.rows.map(r => r.mark);
  }

  function counts() {
    let cross = 0, ring = 0, check = 0, crossQty = 0, rows = 0;
    livePages().forEach(p => {
      rows += p.result.rows.length;
      p.result.rows.forEach((r, i) => {
        if (p.marks[i] === 'cross') {
          cross++;
          const q = qtyOf(i, p.start);
          if (q !== null) crossQty += Number(q) || 0;
        }
        if (p.marks[i] === 'ring') ring++;
        if (r.check && p.marks[i] === r.mark && r.mark !== 'none') check++;
      });
    });
    return { cross, ring, check, crossQty, rows };
  }

  function drawOverlay() {
    const cv = $('scanCanvas');
    if (!cv || !st.result) return;
    const src = st.result.canvas;
    const maxW = 1000;
    const k = Math.min(1, maxW / src.width);
    cv.width = Math.round(src.width * k);
    cv.height = Math.round(src.height * k);
    const g = cv.getContext('2d');
    g.drawImage(src, 0, 0, cv.width, cv.height);
    st.result.rows.forEach((r, i) => {
      const m = st.marks[i];
      const x = (r.qtyX0 - 6) * k, y = (r.qy - r.pitch * 0.47) * k;
      const wd = (r.qtyX1 - r.qtyX0 + 12) * k, ht = r.pitch * 0.94 * k;
      if (m === 'cross' || m === 'ring') {
        g.fillStyle = m === 'cross' ? 'rgba(239,68,68,.20)' : 'rgba(59,130,246,.16)';
        g.strokeStyle = m === 'cross' ? 'rgba(239,68,68,.9)' : 'rgba(59,130,246,.85)';
        g.lineWidth = 1.5;
        g.fillRect(x, y, wd, ht);
        g.strokeRect(x, y, wd, ht);
      }
      if (i === st.hover) {
        g.strokeStyle = '#f59e0b';
        g.lineWidth = 3;
        g.strokeRect((r.skuX0 - 6) * k, y, (r.qtyX1 - r.skuX0 + 12) * k, ht);
      }
    });
  }

  function renderStats() {
    const c = counts();
    $('scanStatRows').textContent = c.rows.toLocaleString();
    $('scanStatCross').textContent = c.cross.toLocaleString();
    $('scanStatRing').textContent = c.ring.toLocaleString();
    $('scanStatCheck').textContent = c.check.toLocaleString();
    $('scanCrossSummary').textContent = c.cross
      ? `รายการที่มี ✗ : ${c.cross.toLocaleString()} รายการ | จำนวนรวม ${c.crossQty.toLocaleString()}`
      : 'ยังไม่มีรายการที่มี ✗';
    $('scanSend').disabled = c.cross === 0;
    $('scanCopy').disabled = c.cross === 0;

    const warn = [];
    const total = pivot().length;
    if (st.result) {
      const n = st.result.rows.length;
      if (st.start - 1 + n > total) warn.push(`⚠️ พบ ${n} บรรทัดในรูป แต่เริ่มที่รายการ #${st.start} แล้วเหลือรายการไม่พอ (มีทั้งหมด ${total} รายการ) — ตรวจ "เริ่มที่รายการ #" หรือหมุนรูปให้ถูกทิศ`);
      else if (n !== total && st.start === 1 && st.pages.length < 2) warn.push(`ℹ️ รูปนี้มี ${n} บรรทัด จากรายการทั้งหมด ${total} รายการ ถ้าเป็นเพียงบางหน้าของใบปริ้น ให้ตั้ง "เริ่มที่รายการ #" ให้ตรงกับหน้านั้น`);
    } else if (st.source) warn.push('⚠️ อ่านรูปนี้ไม่ได้ ลองกดหมุนรูป (↺ ↻) จนตัวหนังสือตั้งตรง หรือกดปุ่ม × เอารูปออก');
    const live = livePages();
    const overlap = live.some((a, i) => live.some((b, j) => j > i && a.start < b.start + b.result.rows.length && b.start < a.start + a.result.rows.length));
    if (overlap) warn.push('⚠️ มีรูปที่เลขรายการซ้อนทับกัน ตรวจ "เริ่มที่รายการ #" ของแต่ละรูป (รายการที่ซ้ำจะถูกนับสองครั้ง)');
    if (c.check) warn.push(`🔍 มี ${c.check} รายการที่ระบบไม่มั่นใจ (แสดงเป็นสีส้มในตาราง) กรุณาเทียบกับรูปก่อนส่ง`);
    setMsg($('scanWarn'), warn.join('\n'), warn.length > 0);
  }

  function renderTable() {
    const box = $('scanRows');
    box.textContent = '';
    const frag = document.createDocumentFragment();
    st.result.rows.forEach((r, i) => {
      const m = st.marks[i];
      const isCheck = r.check && m === r.mark && m !== 'none';
      if (st.filter === 'cross' && m !== 'cross') return;
      if (st.filter === 'check' && !isCheck) return;

      const it = pivotItem(i);
      const tr = document.createElement('div');
      tr.className = 'scan-row' + (m === 'cross' ? ' is-cross' : '') + (m === 'ring' ? ' is-ring' : '') + (isCheck ? ' is-check' : '') + (i === st.sel ? ' is-sel' : '');
      tr.dataset.idx = String(i);

      const num = document.createElement('span');
      num.className = 'scan-n';
      num.textContent = String(st.start + i);
      const sku = document.createElement('span');
      sku.className = 'scan-sku';
      sku.textContent = it ? it.sku : '(ไม่มีรายการ)';
      sku.title = sku.textContent;
      const qty = document.createElement('span');
      qty.className = 'scan-qty';
      if (it) {
        const cur = qtyOf(i);
        const edited = cur !== it.qty;
        qty.textContent = formatPivotNumber(cur);
        qty.classList.add('is-editable');
        if (edited) {
          qty.classList.add('is-edited');
          qty.title = `แก้ไขแล้ว (เดิม ${formatPivotNumber(it.qty)}) — คลิกเพื่อแก้ไข`;
        } else qty.title = 'คลิกเพื่อแก้ไขจำนวน';
        qty.addEventListener('click', () => editQty(qty, i));
      } else qty.textContent = '-';

      const seg = document.createElement('span');
      seg.className = 'scan-seg';
      [['none', '—'], ['cross', '✗'], ['ring', '○']].forEach(([val, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.dataset.mark = val;
        b.setAttribute('aria-pressed', String(m === val));
        b.title = val === 'none' ? 'ไม่มีเครื่องหมาย' : (val === 'cross' ? 'กากบาท' : 'วงกลม');
        b.addEventListener('click', e => {
          e.stopPropagation();
          if (st.marks[i] !== val) pushUndo({ type: 'mark', page: st.pages[st.cur], i, from: st.marks[i], to: val });
          st.marks[i] = val;
          st.sel = i;
          renderAll(true);
        });
        seg.appendChild(b);
      });

      tr.append(num, sku, qty, seg);
      tr.addEventListener('mouseenter', () => { st.hover = i; drawOverlay(); });
      tr.addEventListener('mouseleave', () => { st.hover = -1; drawOverlay(); });
      frag.appendChild(tr);
    });
    if (!frag.childNodes.length) {
      const e = document.createElement('div');
      e.className = 'scan-empty';
      e.textContent = 'ไม่มีรายการที่ตรงกับตัวกรอง';
      frag.appendChild(e);
    }
    box.appendChild(frag);
  }

  // คลิกที่จำนวนเพื่อแก้ไข (Enter/คลิกที่อื่น = บันทึก, Esc = ยกเลิก, เว้นว่าง = กลับเป็นค่าเดิม)
  function editQty(cell, i) {
    const it = pivotItem(i);
    if (!it || cell.querySelector('input')) return;
    const key = st.start - 1 + i;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = 'any';
    input.min = '0';
    input.className = 'scan-qty-input';
    input.value = String(qtyOf(i));
    input.setAttribute('aria-label', 'แก้ไขจำนวน');
    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      if (save) {
        const before = st.qty.has(key) ? st.qty.get(key) : undefined;
        const raw = input.value.trim();
        if (raw === '') st.qty.delete(key);
        else {
          const v = Number(raw);
          if (Number.isFinite(v) && v >= 0) {
            if (v === it.qty) st.qty.delete(key);
            else st.qty.set(key, v);
          }
        }
        const after = st.qty.has(key) ? st.qty.get(key) : undefined;
        if (after !== before) pushUndo({ type: 'qty', key, from: before, to: after });
      }
      renderAll(true);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', e => e.stopPropagation());
  }

  /* ย้อนกลับ / ทำซ้ำ (แก้เครื่องหมายและจำนวน) */
  function updateUndoBtns() {
    const u = $('scanUndo'), r = $('scanRedo');
    if (u) u.disabled = !st.undo.length;
    if (r) r.disabled = !st.redo.length;
  }
  function pushUndo(a) {
    st.undo.push(a);
    if (st.undo.length > 300) st.undo.shift();
    st.redo = [];
    updateUndoBtns();
  }
  function applyAction(a, useFrom) {
    const v = useFrom ? a.from : a.to;
    if (a.type === 'mark') {
      const pi = st.pages.indexOf(a.page);
      if (pi < 0) return;
      syncOut();
      a.page.marks[a.i] = v;
      if (pi !== st.cur) loadPage(pi);
      st.sel = a.i;
      renderAll(true);
    } else if (a.type === 'qty') {
      if (v === undefined) st.qty.delete(a.key); else st.qty.set(a.key, v);
      renderAll(true);
    }
  }
  function undoAction() {
    const a = st.undo.pop();
    if (!a) return;
    applyAction(a, true);
    st.redo.push(a);
    updateUndoBtns();
  }
  function redoAction() {
    const a = st.redo.pop();
    if (!a) return;
    applyAction(a, false);
    st.undo.push(a);
    updateUndoBtns();
  }

  function renderAll(keepScroll) {
    if (!st.result || !st.result.ok) return;
    const list = $('scanRows');
    const top = list.scrollTop;
    renderStats();
    renderTable();
    drawOverlay();
    updateUndoBtns();
    if (keepScroll) list.scrollTop = top;
    updateNeed();
  }

  async function run() {
    if (!st.source) return;
    const status = $('scanStatus');
    setMsg(status, '⏳ กำลังอ่านรูป...', true);
    await new Promise(r => setTimeout(r, 30));
    let res;
    try {
      res = ScanSheet.analyzeImage(st.source, st.rotation);
    } catch (e) {
      console.error(e);
      setMsg(status, '❌ อ่านรูปไม่สำเร็จ กรุณาลองรูปอื่น หรือถ่ายให้เห็นทั้งแผ่น', true);
      st.result = null;
      showFailed(); renderPages(); updateNeed();
      return;
    }
    if (!res.ok || !res.rows.length) {
      st.result = null;
      setMsg(status, `❌ ${res.reason || 'ไม่พบรายการในรูป'} ลองหมุนรูป (↺ ↻) หรือถ่ายให้ตรงและเห็นทั้งแผ่น`, true);
      showFailed(); renderPages(); updateNeed();
      return;
    }
    st.result = res;
    st.rotation = res.rotation;
    if (!st.startUser) {
      // รูปถัดไปเริ่มต่อจากรูปก่อนหน้า ถ้ายังไม่ชัดเจนให้เดาจากจำนวนบรรทัด
      const others = livePages().filter((p, i) => st.pages.indexOf(p) !== st.cur);
      st.start = guessStart(res.rows.length, others.map(p => p.start));
    }
    $('scanStart').value = String(st.start);
    initMarks();
    setMsg(status, `✅ อ่านรูป "${st.fileName}" แล้ว | พบ ${res.rows.length.toLocaleString()} บรรทัด ใน ${res.columns} คอลัมน์`, true);
    renderAll(false);
    renderPages();
  }

  async function addFile(file) {
    if (!/^image\//i.test(file.type) && !/\.(jpe?g|png|webp|bmp)$/i.test(file.name)) {
      setMsg($('scanStatus'), `❌ ${file.name}: รองรับเฉพาะไฟล์รูปภาพ (JPG / PNG / WEBP)`, true);
      return;
    }
    setMsg($('scanStatus'), `⏳ กำลังโหลดรูป ${file.name}...`, true);
    let source;
    try {
      source = await ScanSheet.fileToCanvas(file);
    } catch (e) {
      console.error(e);
      setMsg($('scanStatus'), `❌ เปิดรูป ${file.name} ไม่ได้ (บางเครื่องไม่รองรับไฟล์ HEIC) ลองบันทึกเป็น JPG`, true);
      return;
    }
    syncOut();
    st.pages.push({ name: file.name, source, rotation: 'auto', result: null, marks: [], start: 1, startUser: false });
    st.cur = st.pages.length - 1;
    st.fileName = file.name; st.source = source; st.rotation = 'auto';
    st.result = null; st.marks = []; st.startUser = false; st.start = 1; st.hover = -1;
    updateNeed();
    await run();
  }

  async function onFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    if (!pivot().length) {
      setMsg($('scanStatus'), '⚠️ กรุณาเลือกไฟล์ที่หน้า 📥 รับORDER ก่อน (ใช้รายการเดียวกับที่ปริ้น)', true);
      return;
    }
    list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    for (const f of list) await addFile(f);
    if (list.length > 1) {
      const n = livePages().length;
      setMsg($('scanStatus'), `✅ อ่านรูปแล้ว ${n} จาก ${list.length} รูป`, true);
    }
  }

  function rotate(delta) {
    if (!st.source) return;
    const base = typeof st.rotation === 'number' ? st.rotation : 0;
    st.rotation = (base + delta + 360) % 360;
    run();
  }

  function buildSelected() {
    const out = [];
    livePages().forEach(p => {
      p.result.rows.forEach((r, i) => {
        if (p.marks[i] !== 'cross') return;
        const it = pivotItem(i, p.start);
        if (it) out.push({ sku: it.sku, qty: qtyOf(i, p.start), merchantNames: (it.merchantNames && it.merchantNames.length) ? it.merchantNames : (it.groupName ? [String(it.groupName).toUpperCase()] : []) });
      });
    });
    return out;
  }

  async function sendToCompare() {
    if (!livePages().length) return;
    const rows = buildSelected();
    if (!rows.length) return;
    if (!window.XLSX || typeof loadOrderCompareFile !== 'function') {
      alert('ไม่พบไลบรารีที่จำเป็น');
      return;
    }
    // ส่งข้อมูลยี่ห้อไปด้วย เพื่อให้ตัวเลือกยี่ห้อในหน้าตรวจ Stock ใช้ได้
    window.scanBrandMap = new Map(rows.map(r => [typeof normalizeOrderSku === 'function' ? normalizeOrderSku(r.sku) : r.sku, r.merchantNames]));
    const data = [['SKU Merchant', 'จำนวน'], ...rows.map(r => [r.sku ?? '', r.qty ?? 0])];
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ใบปริ้น');
    const pad = n => String(n).padStart(2, '0');
    const now = new Date();
    const fileName = `ORDER_ใบปริ้น_กากบาท_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;
    const file = new File([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], fileName, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const f1 = $('file1');
    if (f1 && typeof DataTransfer !== 'undefined') {
      try { const dt = new DataTransfer(); dt.items.add(file); f1.files = dt.files; } catch (e) { /* ไม่กระทบ */ }
    }
    await loadOrderCompareFile(file);
    const compareTab = document.querySelector('.tab[data-tool="compareTool"]');
    if (compareTab) compareTab.click();
    if (typeof window.workHistoryLog === 'function') {
      window.workHistoryLog('process', 'scanTool', `ส่ง ${rows.length.toLocaleString()} รายการที่มี ✗ จากใบปริ้น → ไฟล์ที่ 1 — ORDER`, fileName);
    }
  }

  async function copySelected() {
    if (!livePages().length) return;
    const rows = buildSelected();
    if (!rows.length) return;
    const text = rows.map(r => `${String(r.sku ?? '').replace(/[\t\r\n]+/g, ' ').trim()}\t${formatPivotNumber(r.qty ?? 0)}`).join('\n');
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.left = '-9999px';
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
    }
    const msg = ok ? `คัดลอก ${rows.length.toLocaleString()} รายการที่มี ✗ แล้ว` : 'คัดลอกไม่สำเร็จ';
    if (typeof window.fxToast === 'function') window.fxToast(msg, ok ? 'success' : '');
  }

  function reset() {
    st.qty.clear(); st.source = null; st.result = null; st.marks = []; st.fileName = ''; st.rotation = 'auto'; st.filter = 'all'; st.hover = -1;
    st.pages = []; st.cur = -1; st.startUser = false; st.start = 1; st.undo = []; st.redo = []; st.sel = -1;
    updateUndoBtns();
    $('scanFile').value = '';
    $('scanFileName').textContent = '';
    renderPages();
    setMsg($('scanStatus'), '', false);
    setMsg($('scanWarn'), '', false);
    $('scanRows').textContent = '';
    $('scanFilter').value = 'all';
    updateNeed();
  }

  /* ------------------------------------------------------------------ */
  /* อ้างอิงรายการจากใบปริ้นที่บันทึกไว้ (PDF) หรือ Pivot ปัจจุบัน            */
  /* ------------------------------------------------------------------ */
  const refBox = $('scanRef');
  const refList = $('scanRefList');

  function refMeta(rec) {
    const sp = window.SavedPrints;
    const bits = [`${rec.count.toLocaleString()} รายการ`];
    bits.push(rec.pdf ? `PDF ${sp.formatSize(rec.pdf.size)}` : 'กำลังสร้าง PDF...');
    return bits.join(' · ');
  }

  function pdfNameFor(rec) {
    const d = new Date(rec.savedAt);
    const pad = n => String(n).padStart(2, '0');
    return `ORDER_Pivot_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}.pdf`;
  }

  function openPdf(rec) {
    if (!rec || !rec.pdf) return;
    const url = URL.createObjectURL(rec.pdf);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
  }

  function downloadPdf(rec) {
    if (!rec || !rec.pdf) return;
    const url = URL.createObjectURL(rec.pdf);
    const a = document.createElement('a');
    a.href = url; a.download = pdfNameFor(rec); a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
  }

  function mkBtn(cls, text, title, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  }

  // รายการอ้างอิง: แถวเดียวกับที่ใช้ใน "ไฟล์ที่เคยใช้" ของหน้า รับORDER
  function renderRefList() {
    if (!refList) return;
    refList.textContent = '';
    const frag = document.createDocumentFragment();
    const addRow = (id, title, meta, rec) => {
      const row = document.createElement('div');
      row.className = 'saved-file' + (st.refId === id ? ' is-current' : '');
      const info = document.createElement('div');
      info.className = 'saved-file-info';
      const strong = document.createElement('strong');
      strong.textContent = title;
      strong.title = title;
      const span = document.createElement('span');
      span.textContent = meta;
      info.append(strong, span);

      const actions = document.createElement('div');
      actions.className = 'saved-file-actions';
      const use = mkBtn('saved-file-open', st.refId === id ? '✓ ใช้อยู่' : 'ใช้อ้างอิง', 'ใช้รายการนี้ตรวจกับรูปที่ถ่าย', () => applyRef(id, true));
      use.setAttribute('aria-pressed', String(st.refId === id));
      actions.appendChild(use);
      if (rec) {
        const hasPdf = !!rec.pdf;
        const pdf = mkBtn('saved-file-alt', '📄 PDF', 'เปิด PDF ในแท็บใหม่', () => openPdf(rec));
        const dl = mkBtn('saved-file-alt', '⬇', 'ดาวน์โหลด PDF', () => downloadPdf(rec));
        pdf.disabled = dl.disabled = !hasPdf;
        const del = mkBtn('saved-file-del', 'ลบ', 'ลบใบปริ้นนี้ออกจากรายการ', async () => {
          if (st.refId === rec.id) st.refTouched = false;
          try { await window.SavedPrints.remove(rec.id); } catch (e) { /* ไม่กระทบ */ }
        });
        actions.append(pdf, dl, del);
      }
      row.append(info, actions);
      frag.appendChild(row);
    };
    const cur = currentPivot().length;
    if (cur > 0) addRow('current', 'รายการจากหน้า รับORDER ตอนนี้', `${cur.toLocaleString()} รายการ`, null);
    st.prints.forEach(rec => addRow(rec.id, `ใบปริ้น ${window.SavedPrints.formatDate(rec.savedAt)}`, refMeta(rec), rec));
    refList.appendChild(frag);
  }

  function applyRef(id, touched) {
    st.refId = id;
    if (touched) st.refTouched = true;
    const rec = st.prints.find(r => r.id === id);
    st.ref = rec ? { id: rec.id, rows: rec.rows } : null;
    st.qty.clear(); st.undo = []; st.redo = [];
    renderRefList();
    if (st.result) {
      if (st.pages.length < 2) st.start = guessStart(st.result.rows.length);
      $('scanStart').value = String(st.start);
      renderAll(false);
    }
    updateNeed();
  }

  async function refreshRefs() {
    if (!window.SavedPrints) return;
    let list = [];
    try { list = await window.SavedPrints.list(); } catch (e) { list = []; }
    st.prints = list.filter(r => Array.isArray(r.rows) && r.rows.length);
    refBox.hidden = st.prints.length === 0;

    const hasCurrent = currentPivot().length > 0;
    // ค่าเริ่มต้น: ใบปริ้นล่าสุด (ถ้าผู้ใช้ยังไม่ได้เลือกเอง) ไม่งั้นคงค่าที่เลือกไว้
    let target = st.refId;
    const exists = id => id === 'current' ? hasCurrent : st.prints.some(r => r.id === id);
    if (!st.refTouched && st.prints.length) target = st.prints[0].id;
    else if (!target || !exists(target)) target = st.prints.length ? st.prints[0].id : (hasCurrent ? 'current' : '');
    if (target === '') {
      st.ref = null; st.refId = '';
      renderRefList();
      if (st.pages.length) reset();
      updateNeed();
      return;
    }
    applyRef(target, false);
  }

  $('scanRefClear').addEventListener('click', async () => {
    if (!confirm('ลบใบปริ้นที่บันทึกไว้ทั้งหมด (รวมไฟล์ PDF)?')) return;
    st.refTouched = false;
    try { await window.SavedPrints.clear(); } catch (e) { /* ไม่กระทบ */ }
  });

  document.addEventListener('savedprints:changed', () => refreshRefs());
  // events
  const drop = $('scanDrop');
  const fileInput = $('scanFile');
  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('click', e => e.stopPropagation());
  fileInput.addEventListener('change', async e => { const files = Array.from(e.target.files || []); await onFiles(files); fileInput.value = ''; });
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag-ready'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag-ready'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag-ready'); onFiles(e.dataTransfer.files); });

  $('scanRotL').addEventListener('click', () => rotate(-90));
  $('scanRotR').addEventListener('click', () => rotate(90));
  $('scanStart').addEventListener('change', e => {
    const v = Math.max(1, parseInt(e.target.value, 10) || 1);
    st.start = v;
    st.startUser = true;
    e.target.value = String(v);
    renderAll(true);
  });
  $('scanFilter').addEventListener('change', e => { st.filter = e.target.value; if (st.result) renderTable(); });
  $('scanSend').addEventListener('click', sendToCompare);
  $('scanCopy').addEventListener('click', copySelected);
  $('scanClear').addEventListener('click', reset);
  $('scanUndo').addEventListener('click', undoAction);
  $('scanRedo').addEventListener('click', redoAction);
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || tool.offsetParent === null) return;
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redoAction(); }
  });

  // คลิกที่รูปเพื่อไฮไลต์บรรทัด
  $('scanCanvas').addEventListener('click', e => {
    if (!st.result) return;
    const cv = e.currentTarget;
    const rect = cv.getBoundingClientRect();
    const k = cv.width / st.result.canvas.width;
    const px = (e.clientX - rect.left) * (cv.width / rect.width) / k;
    const py = (e.clientY - rect.top) * (cv.height / rect.height) / k;
    let bi = -1, bd = Infinity;
    st.result.rows.forEach((r, i) => {
      if (px < r.skuX0 - 20 || px > r.qtyX1 + 20) return;
      const d = Math.abs(py - r.qy);
      if (d < bd && d < r.pitch) { bd = d; bi = i; }
    });
    if (bi < 0) return;
    st.hover = bi;
    drawOverlay();
    const rowEl = $('scanRows').querySelector(`.scan-row[data-idx="${bi}"]`);
    if (rowEl) rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
  });

  // เปิดแท็บนี้: ตรวจว่ามีรายการจากหน้า รับORDER หรือยัง
  document.querySelectorAll('.tab[data-tool="scanTool"]').forEach(t => t.addEventListener('click', () => setTimeout(() => { refreshRefs(); updateNeed(); }, 0)));
  updateNeed();
  refreshRefs();
})();
