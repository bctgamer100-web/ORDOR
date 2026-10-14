# สร้าง tools/apply-order-track.py ใหม่ (รันเมื่อแก้ฟีเจอร์กันซ้ำ/ออโต้ปริ้นใน ORDOR แล้ว)
# ใช้ (รันที่โฟลเดอร์ ORDOR-main):
#   python tools/order-track-patch/make.py "<โฟลเดอร์เว็บธีมที่ยังไม่มีฟีเจอร์>" . tools/order-track-patch/template.py tools/apply-order-track.py
#   โฟลเดอร์เว็บธีมที่ยังไม่มีฟีเจอร์ = เช่น rayquaza/backup/order-track-<วันเวลา> (ไฟล์เดิมที่สคริปต์สำรองไว้) ต้องมี index.html, js/, css/, stock-sync-extension/
# เก็บเฉพาะ hunk ของฟีเจอร์นี้ (มีคำใน MARKERS หรือเป็นการแทรกล้วน) + HTML/CSS/SQL ที่ต้องเพิ่ม
import base64, difflib, io, json, re, sys

base_root, ours_root, template, out = sys.argv[1:5]
FILES = ['js/app.js', 'js/auto-order.js', 'js/sunshine.js',
         'stock-sync-extension/background.js', 'stock-sync-extension/pagebridge.js']
MARKERS = ['orderDup', 'orderAutoPrint', 'op_track', 'trackCheck', 'trackRecord', 'buildOrderTrackRows',
           'recordOrderPrint', 'passRows', 'dupCols', 'orderClip', 'fromButton', 'scheduled', 'runAutoPrint',
           'getOrderBrandsInFile', 'orderCopy', 'ปริ้นอัตโนมัติ', 'กันออเดอร์ซ้ำ', 'orderTrackBatch']
CTX = 3


def text_of(p):
    return io.open(p, encoding='utf-8').read().replace('\r\n', '\n')


patches = {}
for f in FILES:
    a, b = text_of(base_root + '/' + f).split('\n'), text_of(ours_root + '/' + f).split('\n')
    hunks = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag in ('equal', 'delete'):
            continue  # delete = ของธีม (ฝั่ง ours ไม่มี) ไม่แตะ
        new = b[j1:j2]
        if tag == 'replace' and not any(m in '\n'.join(new) for m in MARKERS):
            continue  # ข้อความเฉพาะธีม
        hunks.append({'before': a[max(0, i1 - CTX):i1], 'old': a[i1:i2], 'after': a[i2:i2 + CTX], 'new': new})
    patches[f] = hunks
    print(f, len(hunks), 'hunks')

idx = text_of(ours_root + '/index.html')
dup_html = re.search(r'^[ \t]*<div class="order-dup" id="orderDup" hidden></div>', idx, re.M).group(0).strip()
autoprint_html = re.search(r'^([ \t]*)<div class="order-autoprint" id="orderAutoPrintBox">.*?^\1</div>', idx, re.M | re.S).group(0)
css = text_of(ours_root + '/css/style.css')
css = css[css.index('/* ===== กันออเดอร์ซ้ำ (#orderDup)'):].rstrip('\n')
sql = text_of(ours_root + '/supabase/op_order_track.sql')
extra = {'dup_html': dup_html, 'autoprint_html': autoprint_html, 'css': css, 'sql': sql}

data = base64.b64encode(json.dumps({'patches': patches, 'extra': extra}, ensure_ascii=False).encode('utf-8')).decode('ascii')
src = text_of(template).replace('__DATA_B64__', data)
io.open(out, 'w', encoding='utf-8', newline='\n').write(src)
print('wrote', out, len(src), 'bytes')
