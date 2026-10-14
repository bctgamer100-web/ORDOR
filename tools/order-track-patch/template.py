# -*- coding: utf-8 -*-
"""ติดตั้งฟีเจอร์ "กันออเดอร์ซ้ำ + ปริ้นอัตโนมัติ + คัดลอก Win+V" ลงเว็บธีมอื่น (RAYQUAZA, MIKU, ...)

ใช้:   python tools\\apply-order-track.py "C:\\path\\to\\rayquaza"
       python tools\\apply-order-track.py "C:\\path\\to\\rayquaza" --dry-run     (แค่ตรวจ ไม่แก้ไฟล์)

- แทรกเฉพาะส่วนของฟีเจอร์นี้ ส่วนธีม (สี ชื่อ ข้อความเฉพาะธีม) ไม่ถูกแตะ
- สำรองไฟล์เดิมไว้ที่ <โฟลเดอร์>/backup/order-track-<วันเวลา>/ ก่อนแก้
- ถ้ามีจุดไหนหาตำแหน่งไม่เจอ จะไม่แก้ไฟล์ใดเลย (ทั้งหมดหรือไม่มีเลย) แล้วบอกว่าติดตรงไหน
- รันซ้ำได้: ส่วนที่ใส่ไปแล้วจะข้าม
สร้างจาก ORDOR-main (ข้อมูลฝังอยู่ในสคริปต์นี้) — แก้ฟีเจอร์ใน ORDOR แล้วต้องสร้างสคริปต์ใหม่
"""
import base64, io, json, os, re, shutil, sys, time

# ข้อมูลแพตช์ (JSON เข้ารหัส base64 กันปัญหาเครื่องหมายคำพูด)
DATA = json.loads(base64.b64decode('__DATA_B64__').decode('utf-8'))
PATCHES, EXTRA = DATA['patches'], DATA['extra']


def read(path):
    raw = io.open(path, encoding='utf-8', newline='').read()
    return raw.replace('\r\n', '\n'), '\r\n' in raw


def find_lines(lines, sub):
    """ตำแหน่งที่ sub (รายการบรรทัด) อยู่ใน lines แบบทั้งบรรทัด"""
    if not sub:
        return []
    k = len(sub)
    return [i for i in range(len(lines) - k + 1) if lines[i:i + k] == sub]


def apply_hunks(text, hunks, fname, problems):
    lines = text.split('\n')
    for n, h in enumerate(hunks, 1):
        if ''.join(h['new']).strip() and find_lines(lines, h['new']) and not (h['old'] and find_lines(lines, h['old'])):
            continue  # ใส่ไปแล้ว
        done = False
        for ctx in (3, 2, 1, 0):
            before = h['before'][len(h['before']) - ctx:] if ctx else []
            after = h['after'][:ctx]
            block = before + h['old'] + after
            if not h['old'] and not (before or after):
                break  # แทรกล้วนต้องมีบรรทัดยึดอย่างน้อย 1 บรรทัด
            if not ''.join(block).strip():
                continue
            hits = find_lines(lines, block)
            if len(hits) == 1:
                i = hits[0]
                lines[i:i + len(block)] = before + h['new'] + after
                done = True
                break
        if not done:
            near = (h['old'] or h['before'] or h['after'] or [''])[0].strip()
            problems.append('%s: จุดที่ %d หาตำแหน่งไม่เจอ (ใกล้บรรทัด: %s)' % (fname, n, near[:80]))
    return '\n'.join(lines)


def patch_index(text, stamp, problems):
    if 'id="orderDup"' not in text:
        m = re.search(r'<div class="saved-files-list" id="savedFilesList"></div>\s*\n(\s*)</div>\n', text)
        if not m:
            problems.append('index.html: หา savedFilesList ไม่เจอ')
        else:
            text = text[:m.end()] + m.group(1) + EXTRA['dup_html'] + '\n' + text[m.end():]
    if 'id="orderAutoPrintBox"' not in text:
        m = re.search(r'<span id="orderAutoSchedInfo"[^>]*></span>\n', text)
        if not m:
            problems.append('index.html: หา orderAutoSchedInfo ไม่เจอ')
        else:
            text = text[:m.end()] + EXTRA['autoprint_html'] + '\n' + text[m.end():]
    # เปลี่ยนเลขเวอร์ชันให้เบราว์เซอร์โหลดไฟล์ใหม่
    for f in ('css/style.css', 'js/app.js', 'js/auto-order.js', 'js/sunshine.js'):
        text = re.sub(r'(%s)(\?v=[^"\']*)?(["\'])' % re.escape(f), r'\g<1>?v=' + stamp + r'\g<3>', text)
    return text


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if len(args) != 1 or not os.path.isfile(os.path.join(args[0], 'index.html')):
        print(__doc__)
        print('ระบุโฟลเดอร์เว็บที่มี index.html เช่น  python tools\\apply-order-track.py "C:\\...\\rayquaza"')
        sys.exit(1)
    root = os.path.abspath(args[0])
    stamp = time.strftime('%Y%m%d%H%M')
    problems, out = [], {}

    for fname, hunks in PATCHES.items():
        path = os.path.join(root, fname)
        if not os.path.isfile(path):
            if fname.startswith('stock-sync-extension/'):
                print('ข้าม %s (ไม่มีไฟล์)' % fname)
                continue
            problems.append('%s: ไม่มีไฟล์' % fname)
            continue
        text, crlf = read(path)
        new = apply_hunks(text, hunks, fname, problems)
        if new != text:
            out[fname] = (new, crlf)

    text, crlf = read(os.path.join(root, 'index.html'))
    new = patch_index(text, stamp, problems)
    if new != text:
        out['index.html'] = (new, crlf)

    path = os.path.join(root, 'css', 'style.css')
    if os.path.isfile(path):
        text, crlf = read(path)
        if '#orderTool .order-dup{' not in text:
            out['css/style.css'] = (text.rstrip('\n') + '\n\n' + EXTRA['css'] + '\n', crlf)
    else:
        problems.append('css/style.css: ไม่มีไฟล์')

    path = os.path.join(root, 'stock-sync-extension', 'manifest.json')
    if os.path.isfile(path) and 'stock-sync-extension/background.js' in out:
        text, crlf = read(path)
        new = re.sub(r'("version"\s*:\s*"\d+\.\d+\.)(\d+)(")', lambda m: m.group(1) + str(int(m.group(2)) + 1) + m.group(3), text, 1)
        out['stock-sync-extension/manifest.json'] = (new, crlf)

    if not os.path.isfile(os.path.join(root, 'supabase', 'op_order_track.sql')):
        out['supabase/op_order_track.sql'] = (EXTRA['sql'], True)

    if problems:
        print('❌ ยังไม่ได้แก้ไฟล์ใดเลย เพราะ:')
        for p in problems:
            print('   - ' + p)
        sys.exit(2)
    if not out:
        print('✅ โฟลเดอร์นี้มีฟีเจอร์ครบแล้ว ไม่มีอะไรต้องแก้')
        return
    print('ตรวจแล้ว (dry-run) จะแก้ไฟล์:' if dry else 'แก้ไฟล์:')
    for f in out:
        print('   - ' + f)
    if dry:
        return
    bak = os.path.join(root, 'backup', 'order-track-' + stamp)
    for f, (text, crlf) in out.items():
        path = os.path.join(root, f)
        if os.path.isfile(path):
            os.makedirs(os.path.dirname(os.path.join(bak, f)), exist_ok=True)
            shutil.copy2(path, os.path.join(bak, f))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        io.open(path, 'w', encoding='utf-8', newline='').write(text.replace('\n', '\r\n') if crlf else text)
    print('✅ เสร็จแล้ว · ไฟล์เดิมสำรองไว้ที่ ' + bak)
    print('ต่อไป: อัปโหลดไฟล์ที่แก้ขึ้น GitHub ของเว็บนั้น แล้วรีโหลดส่วนขยายของเว็บนั้นที่ chrome://extensions')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    main()
