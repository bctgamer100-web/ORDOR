/* ===== Original inline script 1 ===== */
// ===== WORK ACTIVITY HISTORY =====
(function(){
  const STORAGE_KEY = 'excel_order_work_history_v1';
  const MAX_HISTORY = 2000;
  let summaryMode = 'today';
  let summaryDate = todayKey(new Date());
  const tabNames = {
    mergeTool: '📦 รวมไฟล์ ZIP',
    compareTool: '🔎 ตรวจ ORDER กับ Stock',
    orderTool: '📥 รับORDER',
    summaryTool: '📋 สรุปงาน',
    beforeOrderTool: '🛒 ก่อนสั่ง'
  };
  const actionNames = {
    open: 'เปิดแท็บ',
    file: 'เลือกไฟล์',
    process: 'ประมวลผลข้อมูล',
    download: 'ดาวน์โหลดไฟล์',
    filter: 'กรองข้อมูล',
    clear: 'ล้างข้อมูล',
    refresh: 'เปิด/รีเฟรชเว็บ'
  };

  function getHistory(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch(e){ return []; }
  }
  function saveHistory(items){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_HISTORY)));
  }
  function todayKey(d){
    const x = d || new Date();
    return x.getFullYear() + '-' + String(x.getMonth()+1).padStart(2,'0') + '-' + String(x.getDate()).padStart(2,'0');
  }
  function fmtDate(iso){
    const d = new Date(iso);
    return d.toLocaleDateString('th-TH',{year:'numeric',month:'2-digit',day:'2-digit'});
  }
  function fmtTime(iso){
    return new Date(iso).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  function log(action, tabId, detail, fileName){
    const item = {
      id: Date.now() + Math.random(),
      time: new Date().toISOString(),
      tab: tabId || 'unknown',
      action: action || 'open',
      detail: detail || '',
      file: fileName || ''
    };
    const h = getHistory(); h.push(item); saveHistory(h); renderSummary();
  }
  window.workHistoryLog = log;

  function currentTab(){
    const active = document.querySelector('.tab.active');
    return active ? active.dataset.tool : 'unknown';
  }

  function renderSummary(){
    const all = getHistory();
    const today = todayKey();
    const todayItems = all.filter(x => todayKey(new Date(x.time)) === today);
    const items = summaryMode === 'today' ? todayItems : (summaryMode === 'date' ? all.filter(x => todayKey(new Date(x.time)) === summaryDate) : all);
    const el = document.getElementById('summaryList');
    if(!el) return;
    document.getElementById('summaryCount').textContent = all.length.toLocaleString();
    document.getElementById('summaryTodayCount').textContent = todayItems.length.toLocaleString();
    document.getElementById('summaryFileCount').textContent = new Set(all.filter(x=>x.file).map(x=>x.file)).size.toLocaleString();
    document.getElementById('summaryTabCount').textContent = new Set(todayItems.map(x=>x.tab).filter(x=>x!=='unknown')).size.toLocaleString();
    if(!items.length){ el.innerHTML='<div class="empty">ยังไม่มีประวัติการทำงาน</div>'; return; }
    const groups = {};
    items.slice().reverse().forEach(x => {
      const key = todayKey(new Date(x.time));
      (groups[key] ||= []).push(x);
    });
    let html='';
    Object.keys(groups).forEach(day=>{
      html += `<div class="summary-day"><div class="summary-day-title">📅 ${fmtDate(groups[day][0].time)}</div>`;
      groups[day].forEach(x=>{
        html += `<div class="summary-row"><div class="summary-time">${fmtTime(x.time)}</div><div class="summary-tab">${tabNames[x.tab] || x.tab}</div><div class="summary-action"><b>${actionNames[x.action] || x.action}</b>${x.detail ? `<span>${escapeHtml(x.detail)}</span>`:''}${x.file ? `<small>📄 ${escapeHtml(x.file)}</small>`:''}</div></div>`;
      });
      html += '</div>';
    });
    el.innerHTML=html;
  }
  function escapeHtml(v){
    return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  }

  document.getElementById('summaryTodayBtn').onclick=()=>{summaryMode='today';renderSummary();};
  document.getElementById('summaryAllBtn').onclick=()=>{summaryMode='all';renderSummary();};
  const summaryDateInput=document.getElementById('summaryDate');
  if(summaryDateInput){
    summaryDateInput.value=summaryDate;
    summaryDateInput.onchange=()=>{
      summaryDate=summaryDateInput.value || todayKey(new Date());
      summaryMode='date';
      renderSummary();
    };
  }

  // บันทึกการเปลี่ยนแท็บ
  document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{
    log('open', btn.dataset.tool, 'ผู้ใช้เปิดแท็บ');
    if(btn.dataset.tool==='summaryTool') setTimeout(renderSummary,0);
  }));

  // บันทึกการเลือกไฟล์ทุกแท็บ
  document.querySelectorAll('input[type="file"]').forEach(input=>input.addEventListener('change',e=>{
    const f=e.target.files && e.target.files[0];
    if(f) log('file', currentTab(), `เลือกไฟล์ ${f.name}`, f.name);
  }));

  // ดักปุ่มสำคัญของแต่ละแท็บ
  const buttonMap = {
    process:['mergeTool','รวมไฟล์ ZIP'],
    download:['mergeTool','ดาวน์โหลด Excel'],
    
    download2:['compareTool','ดาวน์โหลดผลตรวจ ORDER กับ Stock Excel'],
    orderProcess:['orderTool','เตรียมข้อมูล ORDER'],
    orderDownload:['orderTool','พิมพ์ ORDER (Pivot)'],
    orderPivotExcelDownload:['orderTool','ดาวน์โหลด Excel ตามตัวอย่าง'],
    orderSelectAll:['orderTool','เลือกค่าทั้งหมดในตัวกรอง'],
    orderClearFilters:['orderTool','ล้างตัวกรอง ORDER'],
    clear:['mergeTool','ล้างข้อมูล'],
    clear2:['compareTool','ล้างข้อมูล'],
    orderClear:['orderTool','ล้างข้อมูล ORDER'],
    beforeOrderCreate:['beforeOrderTool','ยืนยันรายการพร้อมสั่ง'],
    beforeOrderSelectAll:['beforeOrderTool','เลือกทั้งหมด'],
    beforeOrderClearAll:['beforeOrderTool','ยกเลิกทั้งหมด']
  };
  Object.entries(buttonMap).forEach(([id,info])=>{
    const b=document.getElementById(id);
    if(b) b.addEventListener('click',()=>{
      const action=/download/i.test(id)?'download':(/clear|Clear/.test(id)?'clear':(/process|compare|selectAll/i.test(id)?'process':'filter'));
      log(action, info[0], info[1]);
    });
  });

  // ตัวกรอง ORDER เปลี่ยนค่า
  document.addEventListener('change',e=>{
    if(e.target.closest('#orderFilters')) log('filter','orderTool','เปลี่ยนค่าตัวกรอง ORDER');
  });

  // บันทึกว่าเปิด/รีเฟรชเว็บ โดยไม่ลบประวัติเดิม
  log('refresh', currentTab(), performance.getEntriesByType('navigation')[0]?.type === 'reload' ? 'รีเฟรชหน้าเว็บ' : 'เปิดเว็บ');
  renderSummary();
})();

/* ===== Original inline script 2 ===== */
// Tab switching
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("active"));
    document.querySelectorAll(".tool").forEach(x => x.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tool).classList.add("active");
  });
});

/* ===== Original inline script 3 ===== */
// ===== ZIP MERGE TOOL (จาก Beta.html) =====

let zipFile=null, resultRows=[], headers=[], outputWorkbook=null, mergedFile=null, mergeProcessing=false;
// ข้อมูล Stock ที่ผ่านการรวม/ลบ FRONT-DELETE แล้ว ใช้ต่อในหน้า "ตรวจ ORDER กับ Stock"
let mergedStockRows=[];

// คอลัมน์ที่ระบบลบอัตโนมัติตามเงื่อนไขเดิม: C, D, F, H, I, J, K, L
const AUTO_REMOVE_MERGE_COLS = new Set(
  ['B','D','E','G','I','J','K','L','M'].map(letter => letter.charCodeAt(0) - 65)
);
const drop=document.getElementById('drop'), input=document.getElementById('file');

drop.onclick=()=>input.click();
input.onchange=e=>setFile(e.target.files[0]);
drop.ondragover=e=>{e.preventDefault();drop.style.background='#eef5ff'};
drop.ondragleave=()=>drop.style.background='';
drop.ondrop=e=>{e.preventDefault();drop.style.background='';setFile(e.dataTransfer.files[0])};

function setFile(f){
  if(!f || !f.name.toLowerCase().endsWith('.zip')){
    alert('กรุณาเลือกไฟล์ ZIP'); return;
  }
  if(mergeProcessing)return;

  zipFile=f;
  // แจ้งส่วนอื่น (ช่อง ST ของ Sunshine) ให้ใช้ไฟล์ ZIP ต้นฉบับนี้ด้วย
  document.dispatchEvent(new CustomEvent('mergezip:selected', { detail: { file: f } }));
  resultRows=[];
  headers=[];
  outputWorkbook=null;
  mergedFile=null;
  document.getElementById('mergeTool').classList.add('merge-has-file');

  document.getElementById('fileCount').textContent='0';
  document.getElementById('rowCount').textContent='0';
  document.getElementById('download').disabled=true;
  const sendCompare2Btn = document.getElementById('sendCompare2');
  if(sendCompare2Btn) sendCompare2Btn.disabled=true;
  document.getElementById('process').disabled=true;
  document.getElementById('status').textContent='เลือกไฟล์แล้ว — กำลังเริ่มรวมอัตโนมัติ...';

  // เริ่มรวมทันที ไม่ต้องกดปุ่ม
  setTimeout(()=>processZip(),30);
}

document.getElementById('process').onclick=processZip;


async function processZip(){
  if(!zipFile || mergeProcessing)return;
  mergeProcessing=true;
  resultRows=[]; headers=[]; outputWorkbook=null;
  const bar=document.getElementById('bar');
  const status=document.getElementById('status');
  document.getElementById('download').disabled=true;
  bar.style.width='5%'; status.textContent='กำลังแตกไฟล์ ZIP...';

  try{
    const zip=await JSZip.loadAsync(zipFile);
    const names=Object.keys(zip.files).filter(n=>/\.(xlsx|xls|csv)$/i.test(n)&&!zip.files[n].dir);
    if(!names.length) throw new Error('ไม่พบไฟล์ Excel หรือ CSV ใน ZIP');

    let first=true;
    let processed=0;
    for(const name of names){
      status.textContent=`กำลังอ่าน ${processed+1}/${names.length}: ${name}`;
      const data=await zip.files[name].async('arraybuffer');
      let wb;
      if(/\.csv$/i.test(name)){
        const text=new TextDecoder('utf-8').decode(data);
        wb=XLSX.read(text,{type:'string'});
      }else{
        wb=XLSX.read(data,{type:'array'});
      }
      for(const sheetName of wb.SheetNames){
        const ws=wb.Sheets[sheetName];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
        if(!rows.length)continue;
        const h=rows[0].map(x=>String(x));
        if(first){
          headers=h;
          resultRows.push(h);
          first=false;
        }
        const body=rows.slice(1);
        resultRows.push(...body);
      }
      processed++;
      bar.style.width=(10+processed/names.length*75)+'%';
    }

    // ลบคอลัมน์ที่เลือก โดยอิงตำแหน่งคอลัมน์ A-Z
    // ขั้นตอนนี้ทำก่อนการลบแถว FRONT / DELETE
    const remove = AUTO_REMOVE_MERGE_COLS;
    resultRows=resultRows.map(row=>row.filter((_,i)=>!remove.has(i)));

    // เปลี่ยนชื่อหัวคอลัมน์ผลลัพธ์ให้ตรงตามรูปแบบที่กำหนด
    // หลังจากลบคอลัมน์แล้ว คอลัมน์ที่เหลือจะเป็น:
    // A = SKU Merchant, B = ชื่อ SKU, C = ตำแหน่ง, D = จำนวน
    if(resultRows.length && resultRows[0].length >= 4){
      const standardHeaders=['SKU Merchant','ชื่อ SKU','ตำแหน่ง','จำนวน'];
      resultRows[0]=resultRows[0].map((_,i)=>standardHeaders[i] ?? resultRows[0][i]);
    }

    // ลบแถวที่มีคำว่า FRONT หรือ DELETE เฉพาะในคอลัมน์ "ตำแหน่ง" เท่านั้น
    // ตรวจหาคอลัมน์ "ตำแหน่ง" หลังจากลบคอลัมน์แล้ว
    const positionIndex = findPositionColumnIndex(resultRows[0] || []);
    let removedPositionRows = 0;

    if(positionIndex >= 0){
      const beforeFilter = resultRows.length;

      resultRows = resultRows.filter((row, index) => {
        if(index === 0) return true; // เก็บหัวตาราง
        const positionValue = String(row[positionIndex] ?? '').trim();
        return !/(?:front|delete)/i.test(positionValue);
      });

      removedPositionRows = beforeFilter - resultRows.length;
    }

    // ลบแถวที่ "สต็อกที่มีอยู่ของตำแหน่ง" เป็น 0 (คอลัมน์นี้ถูกเปลี่ยนชื่อหัวเป็น "จำนวน" ไปแล้วข้างบน)
    // เอาเฉพาะแถวที่เป็นตัวเลข 0 จริงๆ ค่าว่างหรือไม่ใช่ตัวเลขจะไม่ลบ
    const stockQtyIndex=(resultRows[0]||[]).findIndex(h=>/^\s*(จำนวน|สต็อกที่มีอยู่ของตำแหน่ง)\s*$/.test(String(h)));
    let removedZeroRows=0;
    if(stockQtyIndex>=0){
      const beforeZero=resultRows.length;
      resultRows=resultRows.filter((row,index)=>{
        if(index===0) return true;
        const raw=String(row[stockQtyIndex]??'').replace(/,/g,'').trim();
        return !(raw!=='' && Number.isFinite(Number(raw)) && Number(raw)===0);
      });
      removedZeroRows=beforeZero-resultRows.length;
    }

    const keptHeader=resultRows[0]||[];

    // เก็บ Stock จากข้อมูลที่ผ่านกติกาการรวมทั้งหมดแล้ว
    // เพื่อให้หน้า ORDER สามารถตรวจ Stock ได้โดยไม่ต้องอัปโหลด Stock ซ้ำ
    mergedStockRows = resultRows.slice(1).map(row => [...row]);

    // สร้าง Pivot จากข้อมูลที่ผ่านการลบทุกขั้นตอนแล้วเท่านั้น
    // ใช้ SKU Merchant + รวมจำนวน และเรียง SKU Merchant
    const skuIndex = keptHeader.findIndex(h => /^\s*SKU\s*Merchant\s*$/i.test(String(h)));
    const skuNameIndex = keptHeader.findIndex(h => /^\s*ชื่อ\s*SKU\s*$/i.test(String(h)));
    const qtyIndex = keptHeader.findIndex(h => /^\s*จำนวน\s*$/i.test(String(h)) || /จำนวน/i.test(String(h)));
    const pivotMap = new Map();

    if(skuIndex >= 0 && qtyIndex >= 0){
      resultRows.slice(1).forEach(row => {
        const sku = String(row?.[skuIndex] ?? '').trim() || '(ว่าง)';
        const skuName = skuNameIndex >= 0
          ? (String(row?.[skuNameIndex] ?? '').trim() || '(ว่าง)')
          : '(ว่าง)';
        const qtyRaw = String(row?.[qtyIndex] ?? '').replace(/,/g,'').trim();
        const qty = Number(qtyRaw);
        const amount = Number.isFinite(qty) ? qty : 0;
        // เก็บทั้ง "ชื่อ SKU" และ "SKU Merchant" ไว้ใน Pivot เพื่อให้ผู้ใช้
        // สามารถเลือกนำคอลัมน์ใดไปจัดกลุ่มต่อเองใน Excel ได้
        const key = skuName + '\u0000' + sku;
        const current = pivotMap.get(key);
        if(current){
          current.qty += amount;
        }else{
          pivotMap.set(key, {skuName, sku, qty: amount});
        }
      });
    }

    const pivotRows = [
      ['ชื่อ SKU', 'SKU Merchant', 'รวมจำนวน'],
      ...[...pivotMap.values()]
        .map(item => [item.skuName, item.sku, item.qty])
        .sort((a,b) => {
          const nameCmp = String(a[0]).localeCompare(String(b[0]), undefined, {numeric:true, sensitivity:'base'});
          if(nameCmp !== 0) return nameCmp;
          return String(a[1]).localeCompare(String(b[1]), undefined, {numeric:true, sensitivity:'base'});
        })
    ];

    outputWorkbook=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet(resultRows);
    XLSX.utils.book_append_sheet(outputWorkbook,ws,'รวมข้อมูล');

    // Sheet Pivot ถูกสร้างหลังจากลบคอลัมน์/ลบ FRONT/DELETE เสร็จแล้ว
    const pivotWs=XLSX.utils.aoa_to_sheet(pivotRows);
    pivotWs['!cols']=[
      {wch: Math.min(Math.max(Math.max(13, ...pivotRows.map(r => String(r[0] ?? '').length + 2)), 13), 40)},
      {wch: Math.min(Math.max(Math.max(13, ...pivotRows.map(r => String(r[1] ?? '').length + 2)), 13), 40)},
      {wch: 14}
    ];
    XLSX.utils.book_append_sheet(outputWorkbook,pivotWs,'Pivot');

    document.getElementById('fileCount').textContent=names.length.toLocaleString();
    document.getElementById('rowCount').textContent=Math.max(0,resultRows.length-1).toLocaleString();
    renderPreview(resultRows.slice(0,11));
    bar.style.width='100%';
    status.textContent=`✅ รวมสำเร็จ ${names.length} ไฟล์ / ${Math.max(0,resultRows.length-1).toLocaleString()} แถว`+
      (positionIndex>=0 ? ` | ลบ FRONT/DELETE ในคอลัมน์ตำแหน่ง ${removedPositionRows.toLocaleString()} แถว` : ' | ไม่พบคอลัมน์ตำแหน่ง จึงไม่ได้ลบ FRONT/DELETE')+
      (stockQtyIndex>=0 ? ` | ลบแถวสต็อกเป็น 0 ${removedZeroRows.toLocaleString()} แถว` : '');
    document.getElementById('download').disabled=false;

    // สร้างไฟล์ผลรวมในหน่วยความจำ เพื่อส่งต่อเป็น "ไฟล์ที่ 2" โดยไม่ต้องดาวน์โหลด/อัปโหลดใหม่
    const mergedBytes=XLSX.write(outputWorkbook,{bookType:'xlsx',type:'array'});
    mergedFile=new File([mergedBytes],'รวมไฟล์จาก ZIP.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});

    // ส่ง Stock ที่รวมจาก ZIP เข้า "ไฟล์ที่ 2 — Stock" ของหน้าตรวจอัตโนมัติ
    applyMergedStockToCompare();

    // แจ้งส่วนอื่น (เช่น ช่อง ST ในแผงนำเข้าข้อมูลของ Sunshine) ว่ามีไฟล์ที่รวมเสร็จแล้ว
    document.dispatchEvent(new CustomEvent('mergedstock:ready', { detail: { file: mergedFile } }));

    const sendCompare2Btn = document.getElementById('sendCompare2');
    if(sendCompare2Btn) sendCompare2Btn.disabled=false;
    mergeProcessing=false;
  }catch(err){
    console.error(err);
    status.textContent='❌ เกิดข้อผิดพลาด: '+err.message;
    bar.style.width='0%';
    mergeProcessing=false;
    alert(err.message);
  }
}

function findPositionColumnIndex(header){
  if(!Array.isArray(header)) return -1;

  // รองรับชื่อคอลัมน์: ตำแหน่ง, Position, Location หรือ Loc
  const exact = header.findIndex(h => /^\\s*ตำแหน่ง\\s*$/i.test(String(h)));
  if(exact >= 0) return exact;

  return header.findIndex(h => /ตำแหน่ง|position|location|loc/i.test(String(h)));
}

function renderPreview(rows){
  if(!rows.length){document.getElementById('preview').textContent='ไม่มีข้อมูล';return}
  let html='<table><thead><tr>';
  rows[0].forEach(x=>html+='<th>'+escapeHtml(x)+'</th>');
  html+='</tr></thead><tbody>';
  rows.slice(1).forEach(r=>{
    html+='<tr>';
    rows[0].forEach((_,i)=>html+='<td>'+escapeHtml(r[i]??'')+'</td>');
    html+='</tr>';
  });
  html+='</tbody></table>';
  document.getElementById('preview').innerHTML=html;
}
function escapeHtml(x){
  return String(x).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

document.getElementById('download').onclick=()=>{
  if(!outputWorkbook)return;
  XLSX.writeFile(outputWorkbook,'สต็อกตำแหน่ง_รวม.xlsx');
};

document.getElementById('clear').onclick=()=>{
  document.getElementById('mergeTool').classList.remove('merge-has-file');
  zipFile=null; resultRows=[]; headers=[]; outputWorkbook=null; mergedFile=null; mergeProcessing=false; input.value='';
  document.getElementById('fileCount').textContent='0';
  document.getElementById('rowCount').textContent='0';
  document.getElementById('status').textContent='ยังไม่ได้เลือกไฟล์';
  document.getElementById('preview').textContent='ยังไม่มีข้อมูล';
  document.getElementById('bar').style.width='0%';
  document.getElementById('process').disabled=true;
  document.getElementById('download').disabled=true;
};

/* ===== Original inline script 4 ===== */
// ===== COMPARE TOOL : ORDER vs STOCK =====

const $=id=>document.getElementById(id);

let data1=null;              // Stock rows as objects
let data2=null;              // ORDER rows as objects (combined Excel + text)
let data2File=null;           // ORDER rows from uploaded Excel/CSV
let data2Text=null;           // ORDER rows from textarea
let stockFileName='';
let orderFileName='';
let stockSkuCol='';
let stockQtyCol='';
let stockPosCol='';
let orderSkuCol='';
let orderQtyCol='';
let compareResults=[];

// รับ Stock ที่รวมจากหน้า "รวมไฟล์ ZIP" เข้าเป็นไฟล์ที่ 2 ของหน้า Compare โดยอัตโนมัติ
// ข้อมูลจะคงอยู่ในหน้า Compare จนกว่าจะกด "ล้างข้อมูล" ในหน้า Compare
function applyMergedStockToCompare(){
  if(!Array.isArray(mergedStockRows) || !mergedStockRows.length || !Array.isArray(resultRows) || !resultRows.length){
    return;
  }

  try{
    const headers = resultRows[0].map(h => String(h ?? ''));
    data1 = mergedStockRows.map(row => {
      const obj = {};
      headers.forEach((h,i) => { obj[h] = row?.[i] ?? ''; });
      return obj;
    });

    const d = detectStockColumns(data1);
    stockFileName = 'Stock จาก ZIP (รวมอัตโนมัติ)';
    stockSkuCol = d.sku;
    stockQtyCol = d.qty;
    stockPosCol = d.pos;

    const name2 = $('name2');
    const info2 = $('info2');
    if(name2) name2.textContent = 'Stock จาก ZIP (อัตโนมัติ)';
    if(info2) info2.textContent = `${data1.length.toLocaleString()} แถว | ${d.headers.length} คอลัมน์`;

    if(typeof updateCompareReady === 'function'){
      updateCompareReady();
    }
  }catch(e){
    console.error('ไม่สามารถส่ง Stock จาก ZIP ไปหน้า Compare:', e);
  }
}

// ล็อกการทำงานของช่องไฟล์ให้ตรงกับตำแหน่งบนหน้าจอแบบชัดเจน
// ช่องแรก = ORDER, ช่องที่สอง = Stock
$("file1").onchange=function(e){
  const file=e.target.files && e.target.files[0];
  if(file) loadOrderCompareFile(file);
};
$("file2").onchange=function(e){
  const file=e.target.files && e.target.files[0];
  if(file) loadStockFile(file);
};
$("download2").onclick=downloadStockCheckResult;
$("clear2").onclick=clearAll;

async function readCompareFile(file){
  const wb=XLSX.read(await file.arrayBuffer(),{type:"array",cellDates:true});
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{defval:"",raw:false});
  if(!rows.length) throw new Error("ไม่พบข้อมูลหรือหัวตาราง");
  return rows;
}

function cleanCompareHeader(v){
  return String(v??"").trim().replace(/\s+/g,"").toLowerCase();
}

function detectColumn(headers, patterns, fallbackIndex=-1, exactNames=[]){
  for(const name of exactNames){
    const exact=headers.find(h=>cleanCompareHeader(h)===name);
    if(exact!==undefined) return exact;
  }
  const found=headers.find(h=>patterns.some(re=>re.test(String(h))));
  if(found!==undefined) return found;
  return fallbackIndex>=0 && fallbackIndex<headers.length ? headers[fallbackIndex] : '';
}

function detectStockColumns(rows){
  const headers=Object.keys(rows[0]||{});
  const sku=detectColumn(headers,[/sku/i,/รหัส/i,/code/i,/product/i,/item/i],0,['skumerchant','sku']);
  const qty=detectColumn(headers,[/จำนวน/i,/qty/i,/quantity/i,/amount/i,/count/i,/ยอด/i],headers.length>1?1:-1);

  // ตรวจหัวคอลัมน์ตำแหน่งให้กว้างขึ้น เพราะไฟล์ Stock แต่ละไฟล์
  // อาจใช้ชื่อ เช่น ตำแหน่ง, ที่เก็บ, location, loc, warehouse ฯลฯ
  let pos=detectColumn(headers,[
    /ตำแหน่ง/i,
    /ที่เก็บ/i,
    /สถานที่/i,
    /คลัง/i,
    /จุดเก็บ/i,
    /location/i,
    /loc(?:ation)?/i,
    /warehouse/i,
    /storage/i,
    /bin/i,
    /shelf/i,
    /rack/i
  ],-1);

  // ถ้าหัวคอลัมน์ไม่ตรง ให้ดูจากข้อมูลจริง:
  // ตำแหน่งมักมีรูปแบบ เช่น KT-001-01, C-00-01, WH-01 ฯลฯ
  if(!pos){
    const candidates=headers.filter(h=>h!==sku && h!==qty);
    let bestHeader='';
    let bestScore=0;

    candidates.forEach(h=>{
      let score=0;
      rows.slice(0,500).forEach(r=>{
        const v=String(r[h]??'').trim();
        if(!v)return;
        if(/^[A-Za-zก-ฮ]{1,10}[-_][A-Za-z0-9ก-ฮ]+/i.test(v)) score++;
        else if(/^(KT|C|WH|FG|RM|ST|DC|B)[-_]/i.test(v)) score+=2;
      });
      if(score>bestScore){
        bestScore=score;
        bestHeader=h;
      }
    });

    if(bestScore>0) pos=bestHeader;
  }

  return {headers,sku,qty,pos};
}

function detectOrderColumns(rows){
  const headers=Object.keys(rows[0]||{});
  const sku=detectColumn(headers,[/sku/i,/รหัส/i,/code/i,/product/i,/item/i],0,['skumerchant','sku']);
  const qty=detectColumn(headers,[/จำนวน/i,/qty/i,/quantity/i,/amount/i,/count/i,/ยอด/i],headers.length>1?1:-1);
  return {headers,sku,qty};
}

async function loadStockFile(file){
  if(!file)return;
  try{
    if(!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("รองรับเฉพาะไฟล์ Excel (.xlsx/.xls) หรือ CSV");
    setProgress(20);
    data1=await readCompareFile(file);
    setProgress(55);

    stockFileName=file.name;
    const d=detectStockColumns(data1);
    stockSkuCol=d.sku;
    stockQtyCol=d.qty;
    stockPosCol=d.pos;

    // loadStockFile ใช้เฉพาะช่องที่ 2
    $("name2").textContent=file.name;
    $("info2").textContent=`${data1.length.toLocaleString()} แถว | ${d.headers.length} คอลัมน์`;
    setProgress(100);
    setTimeout(()=>setProgress(0),300);

    updateCompareReady();
  }catch(e){
    setProgress(0);
    data1=null;
    syncCompareVisibility();
    alert("ไม่สามารถอ่านไฟล์ Stock ได้\n\n"+e.message);
  }
}

async function loadOrderCompareFile(file){
  if(!file)return;
  try{
    if(!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error("รองรับเฉพาะไฟล์ Excel (.xlsx/.xls) หรือ CSV");
    setProgress(20);
    data2File=await readCompareFile(file);
    setProgress(55);

    // ไฟล์ ORDER สามารถทำงานร่วมกับข้อความในช่อง ORDER ได้
    // ถ้ามีทั้งสองแหล่ง ระบบจะรวมเป็นชุดข้อมูลเดียวก่อนตรวจ Stock
    data2=getCombinedOrderRows();
    orderFileName=file.name;
    const d=detectOrderColumns(data2File);
    orderSkuCol=d.sku;
    orderQtyCol=d.qty;

    // loadOrderCompareFile ใช้เฉพาะช่องที่ 1
    $("name1").textContent=file.name;
    $("info1").textContent=`${data2.length.toLocaleString()} รายการ | ${d.headers.length} คอลัมน์${data2Text?.length ? ` | + ข้อความ ${data2Text.length.toLocaleString()} รายการ` : ''}`;
    setProgress(100);
    setTimeout(()=>setProgress(0),300);

    updateCompareReady();
  }catch(e){
    setProgress(0);
    data2=null;
    syncCompareVisibility();
    alert("ไม่สามารถอ่านไฟล์ ORDER ได้\n\n"+e.message);
  }
}

function getCombinedOrderRows(){
  const fileRows=Array.isArray(data2File)?data2File:[];
  const textRows=Array.isArray(data2Text)?data2Text:[];

  // ถ้ามีไฟล์ Excel ให้ยึดหัวคอลัมน์ของไฟล์เป็นหลัก
  // แล้วแปลงข้อความจากช่องกรอกให้ใช้หัวคอลัมน์เดียวกัน เพื่อให้รวมยอด SKU ได้จริง
  if(fileRows.length && textRows.length){
    const fd=detectOrderColumns(fileRows);
    const td=detectOrderColumns(textRows);
    const mappedText=textRows.map(r=>({
      [fd.sku]: r?.[td.sku] ?? '',
      [fd.qty]: r?.[td.qty] ?? r?.[td.qty === 'จำนวน' ? 'จำนวน' : ''] ?? ''
    }));
    return fileRows.concat(mappedText);
  }

  return fileRows.concat(textRows);
}

function refreshCombinedOrderData(){
  data2=getCombinedOrderRows();
  if(!data2.length){
    orderSkuCol='';
    orderQtyCol='';
    return;
  }

  // ใช้หัวคอลัมน์จากไฟล์เป็นหลักเมื่อมีไฟล์
  const sourceRows=Array.isArray(data2File)&&data2File.length?data2File:data2Text;
  const d=detectOrderColumns(sourceRows);
  orderSkuCol=d.sku;
  orderQtyCol=d.qty;

  const name1=$("name1");
  const info1=$("info1");
  if(name1){
    if(data2File?.length && data2Text?.length) name1.textContent=`${orderFileName} + ข้อความ ORDER`;
    else if(data2File?.length) name1.textContent=orderFileName;
    else name1.textContent='ORDER จากข้อความ';
  }
  if(info1){
    info1.textContent=`${data2.length.toLocaleString()} รายการ | ${d.headers.length} คอลัมน์` +
      (data2File?.length && data2Text?.length ? ` | ไฟล์ ${data2File.length.toLocaleString()} + ข้อความ ${data2Text.length.toLocaleString()}` : '');
  }
}

// แสดงกล่องผลตรวจ/ตัวเลขสรุปเฉพาะเมื่อมีข้อมูลครบทั้ง 2 ไฟล์และตรวจเสร็จแล้ว (คุมด้วย CSS)
function setCompareResultVisible(visible){
  const tool=document.getElementById('compareTool');
  if(tool) tool.classList.toggle('compare-has-result',!!visible);
}

// กล่องตรวจอัตโนมัติ/ข้อความสถานะแสดงเมื่อมีข้อมูลครบทั้ง 2 ไฟล์, ปุ่มล้างข้อมูลแสดงเมื่อมีข้อมูลอย่างน้อย 1 ไฟล์
function syncCompareVisibility(){
  const tool=document.getElementById('compareTool');
  if(!tool) return;
  tool.classList.toggle('compare-any',!!(data1||data2));
  tool.classList.toggle('compare-both',!!(data1&&data2));
}

function updateCompareReady(){
  syncCompareVisibility();
  const info=$("autoCompareDetail");

  if(!data1 || !data2){
    setCompareResultVisible(false);
    { const sd=document.getElementById('siDeductBox'); if(sd){ sd.hidden=true; sd.innerHTML=''; } }
    $("compareStatus").textContent="● กรุณาเลือกไฟล์ ORDER และ Stock";
    if(info){
      if(data1){
        info.innerHTML=`ตรวจพบ ORDER: SKU = <b>"${escapeHtml(orderSkuCol)}"</b> | จำนวน = <b>"${escapeHtml(orderQtyCol)}"</b><br>รอเลือกไฟล์ Stock`;
      }else if(data2){
        info.innerHTML=`ตรวจพบ Stock: SKU = <b>"${escapeHtml(stockSkuCol)}"</b> | จำนวน = <b>"${escapeHtml(stockQtyCol)}"</b>${stockPosCol?` | ตำแหน่ง = <b>"${escapeHtml(stockPosCol)}"</b>`:''}<br>รอเลือกไฟล์ ORDER`;
      }else{
        info.textContent="เลือกไฟล์ ORDER และ Stock แล้วระบบจะตรวจจับหัวคอลัมน์จากแถวบนสุดให้อัตโนมัติ";
      }
    }
    return;
  }

  if(!stockSkuCol || !stockQtyCol || !orderSkuCol || !orderQtyCol){
    setCompareResultVisible(false);
    $("compareStatus").textContent="❌ ตรวจจับหัวคอลัมน์ SKU/จำนวนไม่ครบ";
    if(info) info.textContent="ไม่พบหัวคอลัมน์ที่ใช้ตรวจสอบ กรุณาตรวจชื่อหัวคอลัมน์ในแถวบนสุดของไฟล์";
    return;
  }

  if(cleanCompareHeader(stockSkuCol)!==cleanCompareHeader(orderSkuCol)){
    // อนุญาตให้ชื่อหัวคอลัมน์ต่างกันได้ แต่แจ้งให้เห็นชื่อที่ตรวจพบ
  }

  if(info){
    info.innerHTML=
      `ตรวจพบอัตโนมัติ — Stock: SKU = <b>"${escapeHtml(stockSkuCol)}"</b> | จำนวน = <b>"${escapeHtml(stockQtyCol)}"</b>`+
      (stockPosCol?` | ตำแหน่ง = <b>"${escapeHtml(stockPosCol)}"</b>`:'')+
      `<br>ORDER: SKU = <b>"${escapeHtml(orderSkuCol)}"</b> | จำนวน = <b>"${escapeHtml(orderQtyCol)}"</b>`;
  }

  $("compareStatus").textContent="⚡ พบไฟล์ครบแล้ว — กำลังตรวจ ORDER กับ Stock อัตโนมัติ...";
  setTimeout(compareFiles,50);
}

function num(v){
  const n=Number(String(v??"").replace(/,/g,"").trim());
  return Number.isFinite(n)?n:0;
}

function norm(v){
  return String(v??"").trim();
}

// คีย์ SKU สำหรับรวม ORDER: ตัดช่องว่างหัว/ท้ายและรวมช่องว่างที่เกินมา
// เพื่อให้ SKU เดียวกันจากการพิมพ์, คัดลอกจาก Excel หรือคนละรูปแบบช่องว่าง
// ถูกนับรวมเป็นรายการเดียวกัน
/* ===== ความจำยี่ห้อของ SKU =====
   จำ SKU Merchant → ชื่อยี่ห้อ (ชื่อ SKU Merchant) ทุกครั้งที่โหลดไฟล์ ORDER เก็บในเบราว์เซอร์ (ไม่ถูกรีเซ็ตตอนเที่ยงคืน)
   ใช้เติมตัวเลือกยี่ห้อในหน้าตรวจ Stock เมื่อรายการมาจากใบปริ้น/ไฟล์ที่ไม่มีคอลัมน์ยี่ห้อ */
const SKU_BRAND_KEY = 'order_sku_brand_v1';
const SKU_BRAND_MAX = 30000;
let skuBrandCache = null;

function skuBrandDict() {
  if (skuBrandCache) return skuBrandCache;
  try { skuBrandCache = JSON.parse(localStorage.getItem(SKU_BRAND_KEY)) || {}; } catch (e) { skuBrandCache = {}; }
  return skuBrandCache;
}

function skuBrandLearn(rows, skuIndex, brandIndex) {
  if (!Array.isArray(rows) || skuIndex < 0 || brandIndex < 0 || skuIndex === brandIndex) return;
  const d = skuBrandDict();
  let changed = 0;
  rows.forEach(row => {
    const sku = normalizeOrderSku(row?.[skuIndex]);
    const brand = String(row?.[brandIndex] ?? '').trim();
    if (!sku || !brand || d[sku] === brand) return;
    delete d[sku];          // ให้รายการที่เพิ่งใช้ไปอยู่ท้ายสุด
    d[sku] = brand;
    changed++;
  });
  if (!changed) return;
  const keys = Object.keys(d);
  if (keys.length > SKU_BRAND_MAX) keys.slice(0, keys.length - SKU_BRAND_MAX).forEach(k => delete d[k]);
  try { localStorage.setItem(SKU_BRAND_KEY, JSON.stringify(d)); } catch (e) { /* พื้นที่เต็ม: ใช้ในหน่วยความจำต่อ */ }
}

// ลำดับความสำคัญ: ยี่ห้อจาก Pivot ปัจจุบัน → ที่ส่งมาจากหน้าตรวจใบปริ้น → ความจำยี่ห้อของ SKU
function skuBrandNames(sku, pivotItem) {
  if (pivotItem?.merchantNames?.length) return pivotItem.merchantNames;
  const key = normalizeOrderSku(sku);
  const fromScan = window.scanBrandMap && window.scanBrandMap.get(key);
  if (fromScan && fromScan.length) return fromScan;
  const b = skuBrandDict()[key];
  return b ? [b] : [];
}

function normalizeOrderSku(v){
  return String(v??"")
    .trim()
    .replace(/\s+/g," ")
    .toUpperCase();
}

function extractCompareLocationPrefixes(value){
  const raw=norm(value);
  if(!raw)return [];

  // รองรับตำแหน่งหลายค่าที่อยู่ในเซลล์เดียวกัน
  // เช่น KT-001-01, C-00-01 / WH-01
  const chunks=raw
    .split(/[\\n,;\\/|]+/)
    .map(x=>x.trim())
    .filter(Boolean);

  const result=[];
  chunks.forEach(x=>{
    const first=(x.split("-")[0]||x).trim();
    if(!first)return;

    // ตำแหน่งมาตรฐาน เช่น KT-001-01 / C-00-01 / WH-01
    if(/^[A-Za-zก-ฮ][A-Za-z0-9ก-ฮ_]*$/i.test(first)){
      result.push(first.toUpperCase());
    }
  });

  return result.filter((x,i,a)=>a.indexOf(x)===i);
}

function formatComparePosition(v){
  return extractCompareLocationPrefixes(v).join(", ");
}

const COMPARE_SI_MIN_QTY = 4; // เอาเฉพาะจำนวนใน SI ที่ตั้งแต่ค่านี้ขึ้นไป (มากกว่าหรือเท่ากับ 4) ไปหักลบกับ ORDER

// กล่อง "หักลบกับไฟล์ที่ 3 (SI)": บอกว่า SKU Merchant ไหนถูกหักลบ ORDER เดิม / SI / ORDER หลังหัก
function renderSiDeductions(list, siData){
  const box=document.getElementById('siDeductBox');
  if(!box)return;
  if(!siData || !Array.isArray(siData.rows) || !siData.rows.length){ box.hidden=true; box.innerHTML=''; return; }
  box.hidden=false;
  if(!list.length){
    box.innerHTML='<b>🗂️ หักลบกับไฟล์ที่ 3 (SI)</b><div class="compare-si-deduct-note">ไม่มี SKU Merchant ที่ตรงกับ ORDER (เอาเฉพาะจำนวน SI ตั้งแต่ '+COMPARE_SI_MIN_QTY+' ขึ้นไป)</div>';
    return;
  }
  const totalSi=list.reduce((s,x)=>s+(x.before-x.after),0);
  const covered=list.filter(x=>x.after<=0).length;
  const rows=list.map(x=>`<tr><td>${escapeHtml(x.sku)}</td><td class="num">${formatPivotNumber(x.before)}</td><td class="num">${formatPivotNumber(x.si)}</td><td class="num">${formatPivotNumber(x.before-x.after)}</td><td class="num"><b>${formatPivotNumber(x.after)}</b></td></tr>`).join('');
  box.innerHTML=
    `<b>🗂️ หักลบกับไฟล์ที่ 3 (SI)</b>`+
    `<div class="compare-si-deduct-note">หัก ${list.length.toLocaleString()} SKU Merchant | รวมที่หักออก ${formatPivotNumber(totalSi)} ชิ้น | เหลือ 0 (ไม่นำไปเทียบ Stock) ${covered.toLocaleString()} SKU | เอาเฉพาะจำนวน SI ตั้งแต่ ${COMPARE_SI_MIN_QTY} ขึ้นไป แล้วเทียบกับ Stock ต่อ</div>`+
    `<div class="compare-si-deduct-wrap"><table><thead><tr><th>SKU Merchant</th><th class="num">ORDER เดิม</th><th class="num">SI (≥ ${COMPARE_SI_MIN_QTY})</th><th class="num">หักออก</th><th class="num">ORDER หลังหัก</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function compareFiles(){
  if(!data1 || !data2)return;
  if(!stockSkuCol || !stockQtyCol || !orderSkuCol || !orderQtyCol){
    alert("ไม่พบหัวคอลัมน์ SKU/จำนวน ที่จำเป็นสำหรับการตรวจ");
    return;
  }

  try{
    setProgress(15);

    // รวม Stock ตาม SKU และเก็บตำแหน่งที่ไม่ซ้ำ
    const stockMap=new Map();

    data1.forEach(row=>{
      const displaySku=norm(row[stockSkuCol]);
      if(!displaySku)return;

      const sku=normalizeOrderSku(displaySku);
      const qty=num(row[stockQtyCol]);
      let item=stockMap.get(sku);
      if(!item){
        item={sku:displaySku,qty:0,locations:[]};
        stockMap.set(sku,item);
      }
      item.qty+=qty;

      // อ่านตำแหน่งจากคอลัมน์ที่ตรวจพบก่อน
      // ถ้าไม่พบ/คอลัมน์นั้นว่าง ให้ค้นจากทุกคอลัมน์ของ Stock
      // เพื่อรองรับไฟล์ที่ตั้งชื่อหัวคอลัมน์ตำแหน่งต่างจากมาตรฐาน
      let locationPrefixes=[];

      if(stockPosCol){
        locationPrefixes=extractCompareLocationPrefixes(row[stockPosCol]);
      }

      if(!locationPrefixes.length){
        Object.keys(row).forEach(header=>{
          if(header===stockSkuCol || header===stockQtyCol)return;

          const rawValue=norm(row[header]);
          if(!rawValue)return;

          // ดึงเฉพาะค่าที่มีลักษณะเป็นรหัสตำแหน่ง เช่น
          // KT-001-01, C-00-01, WH-01
          const chunks=rawValue
            .split(/[\\n,;\\/|]+/)
            .map(x=>x.trim())
            .filter(Boolean);

          chunks.forEach(chunk=>{
            if(/^[A-Za-zก-ฮ][A-Za-z0-9ก-ฮ_]*-[A-Za-z0-9ก-ฮ_.]+(?:-[A-Za-z0-9ก-ฮ_.]+)*$/i.test(chunk)){
              const prefix=(chunk.split("-")[0]||"").trim().toUpperCase();
              if(prefix && !locationPrefixes.includes(prefix)){
                locationPrefixes.push(prefix);
              }
            }
          });
        });
      }

      locationPrefixes.forEach(loc=>{
        if(loc && !item.locations.some(x=>x.toUpperCase()===loc.toUpperCase())){
          item.locations.push(loc);
        }
      });
    });

    setProgress(40);

    // รวม ORDER ตาม SKU
    // ไม่ว่าจะมาจากการพิมพ์เองหรือ Excel ถ้า SKU ซ้ำกันให้รวมจำนวนทั้งหมด
    const orderMap=new Map();

    data2.forEach(row=>{
      const displaySku=norm(row[orderSkuCol]);
      if(!displaySku)return;

      const key=normalizeOrderSku(displaySku);
      const qty=num(row[orderQtyCol]);
      const current=orderMap.get(key);

      if(current){
        current.orderQty+=qty;
      }else{
        orderMap.set(key,{sku:displaySku,orderQty:qty});
      }
    });

    // ไฟล์ที่ 3 (SI): เอาเฉพาะแถวที่ "จำนวน" มากกว่าหรือเท่ากับ COMPARE_SI_MIN_QTY (4) ไปหักลบกับ ORDER (ไฟล์ที่ 1) ก่อน
    // แล้วค่อยนำ ORDER ที่เหลือไปเทียบกับ Stock (ไฟล์ที่ 2) ตามเงื่อนไขเดิม
    // SKU ที่หักจนเหลือ 0 จะไม่ถูกนำไปเทียบกับ Stock (แสดงไว้ในกล่อง "หักลบกับไฟล์ที่ 3")
    const siDeductions=[];
    const siData=window.CompareSI;
    if(siData && Array.isArray(siData.rows) && siData.rows.length){
      const siMap=new Map();
      siData.rows.forEach(r=>{
        const q=num(r["จำนวน"]);
        if(q<COMPARE_SI_MIN_QTY)return;
        const key=normalizeOrderSku(r["SKU Merchant"]);
        if(!key)return;
        siMap.set(key,(siMap.get(key)||0)+q);
      });
      siMap.forEach((siQty,key)=>{
        const cur=orderMap.get(key);
        if(!cur || cur.orderQty<=0)return;
        const before=cur.orderQty;
        const used=Math.min(before,siQty);
        cur.orderQty=before-used;
        siDeductions.push({sku:cur.sku,before,si:siQty,after:cur.orderQty});
        if(cur.orderQty<=0)orderMap.delete(key);
      });
    }
    renderSiDeductions(siDeductions,siData);

    setProgress(65);

    compareResults=[...orderMap.values()].map(({sku,orderQty})=>{
      const stock=stockMap.get(normalizeOrderSku(sku));
      const stockQty=stock ? stock.qty : 0;
      const locations=stock ? stock.locations.join(", ") : "";

      let status;
      if(!stock || stockQty<=0){
        status="❌ ไม่มี Stock";
      }else if(stockQty<orderQty){
        status=`⚠️ ขาด ${formatPivotNumber(orderQty-stockQty)}`;
      }else{
        status="✅ พอ";
      }

      const pivotItem = orderPivotRows.find(x => normalizeOrderSku(x.sku) === normalizeOrderSku(sku));
      return {
        sku,
        orderQty,
        stockQty,
        status,
        locations,
        merchantNames: skuBrandNames(sku, pivotItem)
      };
    });

    // ผลตรวจชุดใหม่: ให้ตัวเลือกยี่ห้อ/ตำแหน่งเริ่มต้นเป็น "เลือกทั้งหมด" ตามข้อมูลจริง
    compareCopyBrandSelection.clear();
    compareCopyLocationSelection.clear();
    compareCopySelectionsInitialized = false;

    // คงลำดับตามไฟล์ ORDER (ไฟล์ที่ 1) ไม่เรียง SKU ใหม่ตามพยัญชนะ
    // เมื่อแยกลงแต่ละ Sheet แถวถัดไปจะเลื่อนขึ้นมาต่อกันตามลำดับเดิม

    const total=compareResults.length;
    const shortCount=compareResults.filter(x=>x.status.startsWith("⚠️")).length;
    const okCount=compareResults.filter(x=>x.status.startsWith("✅")).length;
    const noneCount=compareResults.filter(x=>x.status.startsWith("❌")).length;

    $("total").textContent=total.toLocaleString();
    $("affected").textContent=shortCount.toLocaleString();
    $("remaining").textContent=okCount.toLocaleString();

    // แถบสรุปใหม่ใช้ผลลัพธ์ชุดเดิม ไม่แตะ logic การตรวจ
    const quickTotal = document.getElementById("compareQuickTotal");
    const quickOk = document.getElementById("compareQuickOk");
    const quickShort = document.getElementById("compareQuickShort");
    const quickNone = document.getElementById("compareQuickNone");
    if (quickTotal) quickTotal.textContent = total.toLocaleString();
    if (quickOk) quickOk.textContent = okCount.toLocaleString();
    if (quickShort) quickShort.textContent = shortCount.toLocaleString();
    if (quickNone) quickNone.textContent = noneCount.toLocaleString();

    $("remainingSku").textContent=total.toLocaleString();
    $("partialSku").textContent=okCount.toLocaleString();
    $("deletedSku").textContent=shortCount.toLocaleString();
    $("remainingQty").textContent=noneCount.toLocaleString();

    $("compareExtra").style.display="block";
    $("resultBox").style.display="block";
    $("downloadBox").style.display="flex";
    setCompareResultVisible(true);

    $("resultHeaderNote").textContent=
      `Stock: ${stockSkuCol} / ${stockQtyCol}${stockPosCol?` / ${stockPosCol}`:''}  •  ORDER: ${orderSkuCol} / ${orderQtyCol}`;

    $("compareExtraNote").textContent=`ทั้งหมด ${total.toLocaleString()} SKU`;
    $("compareStatus").textContent=
      `✅ ตรวจเสร็จแล้ว | Stock ${stockFileName} | ORDER ${orderFileName}`+
      (siDeductions.length ? ` | หักลบไฟล์ที่ 3 (SI) ${siDeductions.length.toLocaleString()} SKU` : '');

    renderCompareResults();

    // แสดงผลตาราง "ยอดคงเหลือ" และ "รายการที่ถูกลบ-ถูกหัก" บนเว็บทันที
    // หลังจากยืนยันจากหน้า "ก่อนสั่ง" หรือเมื่อการตรวจชุดใหม่เสร็จ
    // โดยไม่ต้องกดปุ่มดาวน์โหลด/แสดงผลอีกครั้ง
    renderCompareWebPreview('all');

    setProgress(100);
    setTimeout(()=>setProgress(0),400);
  }catch(e){
    setProgress(0);
    alert("เกิดข้อผิดพลาด\n\n"+e.message);
  }
}

function renderCompareResults(){
  const search=norm($("compareSearch").value).toLowerCase();
  const filter=$("compareStatusFilter").value;

  const filtered=compareResults.filter(item=>{
    if(filter==="ok" && !item.status.startsWith("✅"))return false;
    if(filter==="short" && !item.status.startsWith("⚠️"))return false;
    if(filter==="none" && !item.status.startsWith("❌"))return false;

    if(search){
      const text=[item.sku,item.orderQty,item.stockQty,item.status,item.locations]
        .join(" ").toLowerCase();
      if(!text.includes(search))return false;
    }
    return true;
  });

  $("compareExtraNote").textContent=
    `พบ ${filtered.length.toLocaleString()} / ${compareResults.length.toLocaleString()} SKU`;

  // หน้าจอคงรูปแบบเดิม: SKU / ORDER / Stock รวม / สถานะ / ตำแหน่ง
  const rows=filtered.slice(0,1000).map(item=>({
    "SKU":item.sku,
    "ORDER":formatPivotNumber(item.orderQty),
    "Stock รวม":formatPivotNumber(item.stockQty),
    "สถานะ":item.status,
    "ตำแหน่ง":item.locations || "-"
  }));

  renderTable(rows,"resultPreview",["SKU","ORDER","Stock รวม","สถานะ","ตำแหน่ง"]);
}

$("compareSearch").oninput=renderCompareResults;
$("compareStatusFilter").onchange=renderCompareResults;
$("orderTextInput").oninput=applyOrderTextAuto;

function renderTable(rows,id,columns){
  const box=$(id);
  if(!rows.length){
    box.innerHTML='<div class="empty">ไม่พบข้อมูลตามเงื่อนไข</div>';
    return;
  }

  let h="<table><thead><tr>"+
    columns.map(c=>`<th>${esc(c)}</th>`).join("")+
    "</tr></thead><tbody>";

  rows.forEach(r=>{
    h+="<tr>"+columns.map(c=>`<td>${esc(r?.[c]??"")}</td>`).join("")+"</tr>";
  });

  h+="</tbody></table>";

  if(rows.length>=1000){
    h+='<div style="padding:10px;text-align:center;color:#687d83">แสดงสูงสุด 1,000 รายการ</div>';
  }else{
    h+=`<div style="padding:10px;text-align:center;color:#687d83">แสดงข้อมูล ${rows.length.toLocaleString()} รายการ</div>`;
  }

  box.innerHTML=h;
}

function previewCompareTable(headers, rows){
  if(!rows.length){
    return '<div class="compare-preview-empty">ไม่มีรายการในหัวข้อนี้</div>';
  }

  const head=headers.map(h=>`<th>${esc(h)}</th>`).join('');
  const body=rows.map(row=>`<tr>${row.map(v=>`<td>${esc(v ?? '')}</td>`).join('')}</tr>`).join('');
  return `<div class="compare-preview-table-wrap"><table class="compare-preview-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ===== ตัวเลือกสำหรับคัดลอกผลตรวจ =====
let compareCopyBrandSelection = new Set();
let compareCopyLocationSelection = new Set();
let comparePreviewMode = 'all';
let compareCopySelectionsInitialized = false;

function uniqueSorted(values){
  return [...new Set((values||[]).map(v=>String(v??'').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
}

// ยี่ห้อที่ต่างกันแค่ท้ายชื่อ (เช่น EGO / EGO SPORT) ให้นับรวมเป็นชื่อหน้าคำแรก
function compareBrandKey(name){
  return String(name??''  ).trim().split(/\s+/)[0]||'';
}

function compareBrandPass(item){
  const names=item.merchantNames||[];
  if(!names.length) return true; // ไม่มีข้อมูลยี่ห้อ (เช่น รายการจากใบปริ้น) ให้แสดงเสมอ
  return names.some(name=>compareCopyBrandSelection.has(compareBrandKey(name)));
}

function getCompareBrandOptions(){
  const values=[];
  compareResults.forEach(item=>{
    (item.merchantNames||[]).forEach(v=>values.push(compareBrandKey(v)));
  });
  return uniqueSorted(values);
}

function getCompareLocationOptions(rows){
  const values=[];
  rows.forEach(item=>{
    String(item.locations||'').split(',').map(v=>v.trim()).filter(Boolean).forEach(v=>values.push(v));
  });
  return uniqueSorted(values);
}

function copyControlHtml(type, options, selected){
  const selectedSet=selected||new Set();
  const label=type==='brand'?'🏷️ เลือกยี่ห้อ':'📍 เลือกตำแหน่ง';
  const id=type==='brand'?'compareBrandPicker':'compareLocationPicker';
  const copyId=type==='brand'?'copyRemainingBtn':'copyDeductedBtn';
  const copyText=type==='brand'?'📋 คัดลอกทั้งหมด':'📋 คัดลอก SKU Merchant';
  const optionHtml=options.length ? options.map((value,i)=>{
    const key=encodeURIComponent(value);
    const checked=selectedSet.has(value)?' checked':'';
    return `<label class="compare-copy-option"><input type="checkbox" data-copy-type="${type}" data-copy-value="${key}"${checked}><span>${esc(value)}</span></label>`;
  }).join('') : (type==='brand' ? '<div class="compare-copy-empty">ไม่มีข้อมูลยี่ห้อของรายการเหล่านี้ (แสดงทุกรายการ)<br><small>ยี่ห้อจะเริ่มมีเมื่อเคยเปิดไฟล์ ORDER ที่หน้า รับORDER บนเครื่องนี้</small></div>' : '<div class="compare-copy-empty">ไม่พบตัวเลือก</div>');
  return `<div class="compare-copy-tools">
    <button type="button" class="compare-copy-btn" id="${copyId}">${copyText}</button>
    <details class="compare-copy-picker" id="${id}">
      <summary>${label} <span class="compare-copy-count">${selectedSet.size ? `เลือก ${selectedSet.size}` : 'ไม่เลือก'}</span></summary>
      <div class="compare-copy-picker-body">
        <div class="compare-copy-picker-actions">
          <button type="button" data-copy-action="all" data-copy-type="${type}" onclick="event.preventDefault();event.stopPropagation();window.__compareSetCopySelection('${type}',true)">เลือกทั้งหมด</button>
          <button type="button" data-copy-action="clear" data-copy-type="${type}" onclick="event.preventDefault();event.stopPropagation();window.__compareSetCopySelection('${type}',false)">ล้างตัวเลือก</button>
        </div>
        <div class="compare-copy-options">${optionHtml}</div>
      </div>
    </details>
  </div>`;
}

window.__compareSetCopySelection = function(type, selectAll){
  const target=type==='brand'?compareCopyBrandSelection:compareCopyLocationSelection;
  const options=type==='brand'
    ? getCompareBrandOptions()
    : getCompareLocationOptions(compareResults.filter(x=>x.stockQty>0));

  // เปลี่ยนสถานะชุดข้อมูลจริงก่อน แล้วสะท้อนกลับไปที่ checkbox ที่อยู่บนหน้าจอ
  target.clear();
  if(selectAll) options.forEach(v=>target.add(v));

  const pickerId=type==='brand'?'compareBrandPicker':'compareLocationPicker';
  const picker=document.getElementById(pickerId);
  if(picker){
    picker.querySelectorAll('input[type="checkbox"][data-copy-type]').forEach(cb=>{
      const value=decodeURIComponent(cb.dataset.copyValue||'');
      cb.checked=target.has(value);
    });
    const count=picker.querySelector('.compare-copy-count');
    if(count) count.textContent=target.size?`เลือก ${target.size}`:'ไม่เลือก';
  }

  // อัปเดตเฉพาะแถวข้อมูล ไม่สร้างเมนูใหม่ จึงไม่ทำให้ checkbox กลับไปสถานะเดิม
  updateComparePreviewTables();
};

function bindCompareCopyControls(){
  document.querySelectorAll('[data-copy-type]').forEach(el=>{
    if(el.dataset.bound==='1') return;
    el.dataset.bound='1';
    if(el.matches('input[type="checkbox"]')){
      el.addEventListener('change',()=>{
        const type=el.dataset.copyType;
        const value=decodeURIComponent(el.dataset.copyValue||'');
        const target=type==='brand'?compareCopyBrandSelection:compareCopyLocationSelection;
        if(el.checked) target.add(value); else target.delete(value);
        const picker=el.closest('.compare-copy-picker');
        const count=picker?.querySelector('.compare-copy-count');
        if(count) count.textContent=target.size?`เลือก ${target.size}`:'ไม่เลือก';
        // เก็บสถานะที่ติ๊กไว้ โดยไม่สร้างเมนูใหม่/ไม่ปิด dropdown
        updateComparePreviewTables();
      });
    }
  });

  // ปุ่มเลือกทั้งหมด/ล้างตัวเลือกใช้ handler กลางด้านล่าง เพื่อไม่ให้ DOM ที่ถูกสร้างใหม่ทำให้ event หลุด

  const remainingBtn=document.getElementById('copyRemainingBtn');
  if(remainingBtn && remainingBtn.dataset.bound!=='1'){
    remainingBtn.dataset.bound='1';
    remainingBtn.addEventListener('click',()=>copyRemainingByBrand());
  }
  const deductedBtn=document.getElementById('copyDeductedBtn');
  if(deductedBtn && deductedBtn.dataset.bound!=='1'){
    deductedBtn.dataset.bound='1';
    deductedBtn.addEventListener('click',()=>copyDeductedByLocation());
  }
}

async function copyTextToClipboard(text, successText){
  try{
    if(navigator.clipboard && window.isSecureContext){
      await navigator.clipboard.writeText(text);
    }else{
      const ta=document.createElement('textarea');
      ta.value=text; ta.style.position='fixed'; ta.style.left='-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    if(typeof window.fxToast==='function') window.fxToast(successText,'success');
    else alert(successText);
  }catch(e){
    alert('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณากด Ctrl+C หลังเลือกข้อความ');
  }
}

function copyRemainingByBrand(){
  const rows=compareResults.filter(item=>item.stockQty<=0 || item.stockQty<item.orderQty);
  const selected=compareCopyBrandSelection;
  const filtered=rows.filter(compareBrandPass);
  const text=filtered.map(item=>`${item.sku}	${Math.max(item.orderQty-item.stockQty,0)}`).join('\n');
  if(!text) return alert('ไม่พบรายการตามยี่ห้อที่เลือก');
  copyTextToClipboard(text,`คัดลอกยอดคงเหลือ ${filtered.length.toLocaleString()} รายการแล้ว`);
}

function copyDeductedByLocation(){
  const rows=compareResults.filter(item=>item.stockQty>0);
  const selected=compareCopyLocationSelection;
  const filtered=selected.size ? rows.filter(item=>{
    const locs=String(item.locations||'').split(',').map(v=>v.trim()).filter(Boolean);
    return locs.some(loc=>selected.has(loc));
  }) : [];
  const text=filtered.map(item=>item.sku).join('\n');
  if(!text) return alert('ไม่พบรายการตามตำแหน่งที่เลือก');
  copyTextToClipboard(text,`คัดลอก SKU Merchant ${filtered.length.toLocaleString()} รายการแล้ว`);
}

function updateComparePreviewTables(){
  const remainingSource=compareResults.filter(item=>item.stockQty<=0 || item.stockQty<item.orderQty);
  const remainingFiltered=remainingSource.filter(compareBrandPass);
  const remaining=remainingFiltered.map(item=>[item.sku,Math.max(item.orderQty-item.stockQty,0)]);

  const deductedSource=compareResults.filter(item=>item.stockQty>0);
  const deductedFiltered=compareCopyLocationSelection.size ? deductedSource.filter(item=>{
    const locs=String(item.locations||'').split(',').map(v=>v.trim()).filter(Boolean);
    return locs.some(loc=>compareCopyLocationSelection.has(loc));
  }) : [];
  const deducted=deductedFiltered.map(item=>[
    item.sku,item.orderQty,item.stockQty,Math.min(item.orderQty,item.stockQty),
    Math.max(item.stockQty-item.orderQty,0),item.locations||'-',item.status
  ]);

  const remWrap=document.querySelector('[data-preview-table="remaining"]');
  if(remWrap) remWrap.innerHTML=previewCompareTable(['SKU Merchant','จำนวน'],remaining);
  const remCount=document.querySelector('[data-preview-count="remaining"]');
  if(remCount) remCount.textContent=`${remaining.length.toLocaleString()} รายการ`;

  const dedWrap=document.querySelector('[data-preview-table="deducted"]');
  if(dedWrap) dedWrap.innerHTML=previewCompareTable(['SKU Merchant','จำนวนไฟล์ที่ 1','จำนวนไฟล์ที่ 2','จำนวนที่ถูกลบ','ยอดคงเหลือ','ตำแหน่ง','สถานะ'],deducted);
  const dedCount=document.querySelector('[data-preview-count="deducted"]');
  if(dedCount) dedCount.textContent=`${deducted.length.toLocaleString()} รายการ`;
}

function renderCompareWebPreview(mode='all'){
  comparePreviewMode = mode;
  if(!compareResults.length){
    alert('ยังไม่มีผลตรวจสำหรับแสดง');
    return;
  }

  // ครั้งแรกของผลตรวจชุดนี้ ให้ติ๊กทุกตัวเลือกที่มีอยู่จริงไว้ก่อน
  // หลังจากผู้ใช้ล้างตัวเลือกแล้ว จะไม่เติมกลับอัตโนมัติ
  if(!compareCopySelectionsInitialized){
    getCompareBrandOptions().forEach(v=>compareCopyBrandSelection.add(v));
    getCompareLocationOptions(compareResults.filter(x=>x.stockQty>0)).forEach(v=>compareCopyLocationSelection.add(v));
    compareCopySelectionsInitialized = true;
  }

  const box=document.getElementById('compareWebPreview');
  const body=document.getElementById('compareWebPreviewBody');
  const title=document.getElementById('compareWebPreviewTitle');
  if(!box || !body || !title)return;

  let html='';

  if(mode==='all'){
    title.textContent='📋 ผลตรวจทั้งหมด';

    // ส่วนที่ 1 ตรงกับ Sheet "ยอดคงเหลือ" ในไฟล์ Excel
    const remainingSource=compareResults
      .filter(item=>item.stockQty<=0 || item.stockQty<item.orderQty);
    const remainingFiltered=remainingSource.filter(compareBrandPass);
    const remaining=remainingFiltered.map(item=>[
      item.sku,
      Math.max(item.orderQty-item.stockQty,0)
    ]);

    // ส่วนที่ 2 ตรงกับ Sheet "รายการที่ถูกลบ-ถูกหัก" ในไฟล์ Excel
    const deductedSource=compareResults.filter(item=>item.stockQty>0);
    const deductedFiltered=compareCopyLocationSelection.size ? deductedSource.filter(item=>{
      const locs=String(item.locations||'').split(',').map(v=>v.trim()).filter(Boolean);
      return locs.some(loc=>compareCopyLocationSelection.has(loc));
    }) : [];
    const deducted=deductedFiltered.map(item=>[
        item.sku,
        item.orderQty,
        item.stockQty,
        Math.min(item.orderQty,item.stockQty),
        Math.max(item.stockQty-item.orderQty,0),
        item.locations || '-',
        item.status
      ]);

    html += `<details class="compare-preview-section" open>
      <summary>📦 ยอดคงเหลือ <span class="preview-count" data-preview-count="remaining">${remaining.length.toLocaleString()} รายการ</span></summary>
      ${copyControlHtml('brand', getCompareBrandOptions(), compareCopyBrandSelection)}
      <div data-preview-table="remaining">${previewCompareTable(['SKU Merchant','จำนวน'],remaining)}</div>
    </details>`;

    html += `<details class="compare-preview-section" open>
      <summary>📋 รายการที่ถูกลบ-ถูกหัก <span class="preview-count" data-preview-count="deducted">${deducted.length.toLocaleString()} รายการ</span></summary>
      ${copyControlHtml('location', getCompareLocationOptions(compareResults.filter(item=>item.stockQty>0)), compareCopyLocationSelection)}
      <div data-preview-table="deducted">${previewCompareTable(['SKU Merchant','จำนวนไฟล์ที่ 1','จำนวนไฟล์ที่ 2','จำนวนที่ถูกลบ','ยอดคงเหลือ','ตำแหน่ง','สถานะ'],deducted)}</div>
    </details>`;
  }else if(mode==='short'){
    title.textContent='⚠️ รายการที่ขาด';
    const rows=compareResults
      .filter(item=>item.status.startsWith('⚠️'))
      .map(item=>[
        item.sku,
        item.orderQty,
        item.stockQty,
        Math.max(item.orderQty-item.stockQty,0),
        item.locations || '-',
        item.status
      ]);
    html=`<details class="compare-preview-section" open>
      <summary>⚠️ รายการที่ขาด <span class="preview-count">${rows.length.toLocaleString()} รายการ</span></summary>
      ${previewCompareTable(['SKU Merchant','จำนวน ORDER','Stock รวม','จำนวนที่ขาด','ตำแหน่ง','สถานะ'],rows)}
    </details>`;
  }else{
    title.textContent='❌ รายการไม่มี Stock';
    const rows=compareResults
      .filter(item=>item.status.startsWith('❌'))
      .map(item=>[
        item.sku,
        item.orderQty,
        item.stockQty,
        Math.max(item.orderQty-item.stockQty,0),
        item.locations || '-',
        item.status
      ]);
    html=`<details class="compare-preview-section" open>
      <summary>❌ ไม่มี Stock <span class="preview-count">${rows.length.toLocaleString()} รายการ</span></summary>
      ${previewCompareTable(['SKU Merchant','จำนวน ORDER','Stock รวม','จำนวนที่ขาด','ตำแหน่ง','สถานะ'],rows)}
    </details>`;
  }

  body.innerHTML=html;
  bindCompareCopyControls();
  box.style.display='block';
  if(typeof syncCompareToggleButtons==='function') syncCompareToggleButtons();
}

function downloadStockCheckResult(){
  if(!compareResults.length)return alert("ยังไม่มีผลตรวจสำหรับดาวน์โหลด");

  // Sheet 1: ยอดคงเหลือสำหรับสั่งของ
  const remainingData=[
    ["SKU Merchant","จำนวน"],
    ...compareResults
      .filter(item=>item.stockQty <= 0 || item.stockQty < item.orderQty)
      .map(item=>[
        item.sku,
        Math.max(item.orderQty - item.stockQty, 0)
      ])
  ];

  // Sheet 2: รายละเอียดการตรวจ พร้อมตำแหน่งและสถานะว่าพอ/ขาด
  const deductedData=[
    ["SKU Merchant","จำนวนไฟล์ที่ 1","จำนวนไฟล์ที่ 2","จำนวนที่ถูกลบ","ยอดคงเหลือ","ตำแหน่ง","สถานะ"],
    ...compareResults
      .filter(item=>item.stockQty > 0)
      .map(item=>[
        item.sku,
        item.orderQty,
        item.stockQty,
        Math.min(item.orderQty,item.stockQty),
        Math.max(item.stockQty-item.orderQty,0),
        item.locations || "-",
        item.status
      ])
  ];

  const wsRemaining=XLSX.utils.aoa_to_sheet(remainingData);
  wsRemaining["!cols"]=[{wch:28},{wch:12}];

  const wsDeducted=XLSX.utils.aoa_to_sheet(deductedData);
  wsDeducted["!cols"]=[
    {wch:28},{wch:18},{wch:18},{wch:16},{wch:16},{wch:18},{wch:18}
  ];

  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,wsRemaining,"ยอดคงเหลือ");
  XLSX.utils.book_append_sheet(wb,wsDeducted,"รายการที่ถูกลบ-ถูกหัก");

  XLSX.writeFile(wb,"ผลลัพธ์_เปรียบเทียบและยอดคงเหลือ.xlsx");
}

function downloadCompareSubset(type){
  if(!compareResults.length){
    alert("ยังไม่มีผลตรวจสำหรับดาวน์โหลด");
    return;
  }

  const isShort = type === "short";
  const rows = compareResults.filter(item =>
    isShort ? item.status.startsWith("⚠️") : item.status.startsWith("❌")
  );

  if(!rows.length){
    alert(isShort ? "ไม่มีรายการที่ขาด" : "ไม่มีรายการที่เป็นไม่มี Stock");
    return;
  }

  const data = [
    ["SKU Merchant","จำนวน ORDER","Stock รวม","จำนวนที่ขาด","ตำแหน่ง","สถานะ"],
    ...rows.map(item => [
      item.sku,
      item.orderQty,
      item.stockQty,
      isShort ? Math.max(item.orderQty - item.stockQty, 0) : Math.max(item.orderQty - item.stockQty, 0),
      item.locations || "-",
      item.status
    ])
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = [
    {wch:28},{wch:16},{wch:14},{wch:16},{wch:22},{wch:20}
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, isShort ? "รายการที่ขาด" : "ไม่มี Stock");
  XLSX.writeFile(wb, isShort ? "รายการที่ขาด.xlsx" : "รายการไม่มี_Stock.xlsx");
}

// ปุ่มดูผลตรวจบนเว็บ: กดซ้ำที่ปุ่มเดิมขณะเปิดอยู่ = เก็บข้อมูล, กดปุ่มอื่น = สลับไปดูหมวดนั้น
function isCompareWebPreviewOpen(){
  const box=document.getElementById('compareWebPreview');
  return !!box && box.style.display==='block';
}

function syncCompareToggleButtons(){
  const open=isCompareWebPreviewOpen();
  [['download2','all'],['downloadShort','short'],['downloadNone','none']].forEach(([id,mode])=>{
    const btn=document.getElementById(id);
    if(!btn) return;
    const active=open && comparePreviewMode===mode;
    btn.classList.toggle('is-open',active);
    btn.setAttribute('aria-pressed',String(active));
    if(id==='download2') btn.textContent=(active?'▾ ':'▸ ')+'ทั้งหมด';
  });
}

function toggleCompareWebPreview(mode){
  if(isCompareWebPreviewOpen() && comparePreviewMode===mode){
    document.getElementById('compareWebPreview').style.display='none';
    syncCompareToggleButtons();
    return;
  }
  renderCompareWebPreview(mode);
  syncCompareToggleButtons();
}

const downloadShortBtn=document.getElementById("downloadShort");
if(downloadShortBtn) downloadShortBtn.onclick=()=>toggleCompareWebPreview("short");
const downloadNoneBtn=document.getElementById("downloadNone");
if(downloadNoneBtn) downloadNoneBtn.onclick=()=>toggleCompareWebPreview("none");
const downloadAllPreviewBtn=document.getElementById("download2");
if(downloadAllPreviewBtn) downloadAllPreviewBtn.onclick=()=>toggleCompareWebPreview("all");
const downloadWebExcelBtn=document.getElementById("downloadWebExcel");
if(downloadWebExcelBtn) downloadWebExcelBtn.onclick=downloadStockCheckResult;

let compareTextTimer=null;

function parseCompareOrderText(text){
  const raw=String(text??'').replace(/\r/g,'').trim();
  if(!raw)return [];

  const lines=raw.split('\n').map(x=>x.trimEnd()).filter(x=>x.trim()!=='');
  if(!lines.length)return [];

  // รองรับข้อความที่คัดลอกจาก Excel (Tab), CSV และรูปแบบพิมพ์ตรง ๆ เช่น
  //   SK001 2
  //   WA-203PLAC01-03-XS 2
  // โดยให้ตัวเลขท้ายบรรทัดเป็นจำนวน ORDER
  const hasTab=lines.some(x=>x.includes('\t'));
  const hasComma=lines.some(x=>x.includes(','));
  const delimiter=hasTab?'\t':(hasComma?',':null);

  const splitLine=(line)=>{
    const value=String(line??'').trim();

    // รองรับการผสมข้อมูลในช่องเดียวกันได้ เช่น
    // - บางบรรทัดพิมพ์เอง: "SK001 2"
    // - บางบรรทัดคัดลอกจาก Excel: "SK002\t5"
    // แต่ละบรรทัดจะตรวจรูปแบบของตัวเอง ไม่บังคับใช้ตัวคั่นเดียวกันทั้งกล่อง
    if(delimiter && value.includes(delimiter)){
      return value.split(delimiter).map(v=>String(v??'').trim());
    }

    // รองรับ "SKU จำนวน" โดยจำนวนอยู่ท้ายบรรทัด
    const m=value.match(/^(.+?)\s+(-?\d+(?:[.,]\d+)?)\s*$/);
    if(m) return [m[1].trim(), m[2].trim()];

    // ถ้าเป็นบรรทัดเดี่ยว ให้ถือเป็น SKU และจำนวนว่าง
    return [value];
  };
  const first=splitLine(lines[0]);
  const normalized=first.map(cleanCompareHeader);
  const hasHeader=normalized.some(v=>
    /sku|รหัส|code|product|item/.test(v) || /จำนวน|qty|quantity|amount|count|ยอด/.test(v)
  );

  let headers;
  let start=0;
  if(hasHeader){
    headers=first.map((h,i)=>h || `คอลัมน์ ${i+1}`);
    start=1;
  }else{
    headers=['SKU','จำนวน'];
  }

  const rows=[];
  for(let i=start;i<lines.length;i++){
    const cells=splitLine(lines[i]);
    if(!cells.length)continue;
    const sku=String(cells[0]??'').trim();
    const qty=String(cells[1]??'').trim();
    if(!sku)continue;
    const obj={};
    headers.forEach((h,j)=>obj[h]=cells[j]??'');
    // ถ้าไม่มีหัวตาราง ให้ใช้ชื่อมาตรฐานที่ระบบตรวจจับได้
    if(!hasHeader){ obj.SKU=sku; obj['จำนวน']=qty; }
    rows.push(obj);
  }
  return rows;
}

function applyOrderTextAuto(){
  const input=$("orderTextInput");
  if(!input)return;
  const text=input.value;

  clearTimeout(compareTextTimer);
  compareTextTimer=setTimeout(()=>{
    const rows=parseCompareOrderText(text);

    if(!String(text).trim()){
      data2Text=null;
      refreshCombinedOrderData();
      if(!data2File?.length){
        $("name1").textContent='คลิกเพื่อเลือกไฟล์ ORDER';
        $("info1").textContent='รองรับ Excel / CSV';
      }
      updateCompareReady();
      return;
    }

    if(!rows.length){
      data2Text=null;
      refreshCombinedOrderData();
      $("compareStatus").textContent='❌ อ่านข้อความ ORDER ไม่พบข้อมูล';
      return;
    }

    // เก็บข้อความแยกจากไฟล์ เพื่อให้รวมกันได้ ไม่ว่าจะใส่ไฟล์ก่อนหรือหลัง
    data2Text=rows;
    refreshCombinedOrderData();

    // ถ้ามี Stock อยู่แล้ว จะเข้าสู่ compareFiles() อัตโนมัติผ่าน updateCompareReady()
    updateCompareReady();
  },180);
}

function clearAll(){
  // ล้างเฉพาะ ORDER และผลตรวจ แต่ "ไฟล์ที่ 2 — Stock" จะคงอยู่
  // จนกว่าจะรีเฟรชหน้าเว็บ หรือกดล้างข้อมูล Stock โดยตรง
  data2=null;
  data2File=null;
  data2Text=null;
  orderFileName='';
  orderSkuCol='';
  orderQtyCol='';
  compareResults=[];
  compareCopyBrandSelection.clear();
  compareCopyLocationSelection.clear();
  compareCopySelectionsInitialized = false;

  $("file1").value="";
  if($("orderTextInput")) $("orderTextInput").value="";
  $("name1").textContent="คลิกเพื่อเลือกไฟล์ ORDER";
  $("info1").textContent="รองรับ Excel / CSV";

  if(data1 && stockSkuCol && stockQtyCol){
    $("name2").textContent=stockFileName || "Stock จาก ZIP (อัตโนมัติ)";
    $("info2").textContent=`${data1.length.toLocaleString()} แถว | ${Object.keys(data1[0]||{}).length} คอลัมน์`;
    $("compareStatus").textContent="● Stock ยังคงอยู่ — กรุณาเลือกไฟล์ ORDER";
  }else{
    $("name2").textContent="คลิกเพื่อเลือกไฟล์ Stock";
    $("info2").textContent="รองรับ Excel / CSV";
    $("compareStatus").textContent="● กรุณาเลือกไฟล์ ORDER และ Stock";
  }

  setCompareResultVisible(false);
  syncCompareVisibility();
  $("downloadBox").style.display="none";
  $("resultBox").style.display="none";
  $("compareExtra").style.display="none";
  $("resultPreview").innerHTML='<div class="empty">ยังไม่มีผลลัพธ์</div>';

  // ล้างผลตารางบนเว็บด้วย ไม่ให้ผลเก่าค้างอยู่หลังจากกดปุ่ม "ล้างข้อมูล"
  const webPreview=document.getElementById('compareWebPreview');
  const webPreviewBody=document.getElementById('compareWebPreviewBody');
  if(webPreview) webPreview.style.display='none';
  syncCompareToggleButtons();
  if(webPreviewBody) webPreviewBody.innerHTML='<div class="empty">ยังไม่มีผลตรวจ</div>';
  const webPreviewTitle=document.getElementById('compareWebPreviewTitle');
  if(webPreviewTitle) webPreviewTitle.textContent='📋 ผลลัพธ์บนเว็บ';

  $("compareSearch").value="";
  $("compareStatusFilter").value="all";

  $("total").textContent="0";
  $("affected").textContent="0";
  $("remaining").textContent="0";
  ["compareQuickTotal","compareQuickOk","compareQuickShort","compareQuickNone"].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.textContent="0";
  });
  $("remainingSku").textContent="0";
  $("partialSku").textContent="0";
  $("deletedSku").textContent="0";
  $("remainingQty").textContent="0";

  setProgress(0);
}

function setProgress(v){
  $("progress").style.display=v?"block":"none";
  $("progress").classList.toggle("is-active",!!v);
  $("compareBar").style.width=v+"%";
}

function esc(v){
  return String(v??"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

/* ===== Original inline script 5 ===== */
/* ===== ORDER TOOL : Excel upload + per-column filters ===== */
let orderWorkbook = null;
let orderRows = [];
let orderHeaders = [];
let orderFilteredRows = [];
let orderFiltersState = [];
let orderPivotRows = [];
const orderBrandDeselected = new Set();
const orderTrackingBrandDeselected = new Set();

const orderDrop = document.getElementById("orderDrop");
const orderInput = document.getElementById("orderFile");
const orderDownloadBtn = document.getElementById("orderDownload");
const orderPivotExcelDownloadBtn = document.getElementById("orderPivotExcelDownload");
const orderClearBtn = document.getElementById("orderClear");
// หา index จากชื่อหัวคอลัมน์จริง เพื่อไม่ผูกกับตำแหน่งคอลัมน์
function getOrderColumnIndex(headerName) {
  const target = String(headerName ?? '').trim().toLowerCase();
  return orderHeaders.findIndex(h => String(h ?? '').trim().toLowerCase() === target);
}

function getOrderSkuIndex() {
  // คอลัมน์ที่นำมาแสดงผลจริง
  return getOrderColumnIndex('SKU Merchant');
}

function getOrderGroupIndex() {
  // คอลัมน์ที่ใช้แบ่งกลุ่ม: "ชื่อ SKU Merchant"
  return getOrderColumnIndex('ชื่อ SKU Merchant');
}

function getOrderQtyIndex() {
  return getOrderColumnIndex('จำนวน');
}

// ค่าคงที่เดิมเก็บไว้เป็น fallback สำหรับไฟล์รูปแบบเก่า
const ORDER_PIVOT_SKU_INDEX = 3;
const ORDER_PIVOT_QTY_INDEX = 4;
const orderFiltersBox = document.getElementById("orderFilters");
const orderFilterSummary = document.getElementById("orderFilterSummary");

orderDrop.onclick = () => orderInput.click();
orderInput.onclick = e => e.stopPropagation();

orderInput.onchange = e => {
  const file = e.target.files[0];
  if (file) loadOrderFile(file);
};

orderDrop.ondragover = e => {
  e.preventDefault();
  orderDrop.classList.add("drag-ready");
  orderDrop.style.background = "#eaf9fa";
};

orderDrop.ondragleave = () => {
  orderDrop.classList.remove("drag-ready");
  orderDrop.style.background = "";
};

orderDrop.ondrop = e => {
  e.preventDefault();
  orderDrop.classList.remove("drag-ready");
  orderDrop.style.background = "";
  const file = e.dataTransfer.files[0];
  if (file) loadOrderFile(file);
};

async function loadOrderFile(file) {
  orderBrandDeselected.clear();
  orderTrackingBrandDeselected.clear();
  try {
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      throw new Error("รองรับเฉพาะไฟล์ Excel (.xlsx/.xls) หรือ CSV");
    }

    document.getElementById("orderStatus").textContent = "กำลังอ่านไฟล์ ORDER...";
    document.getElementById("orderBar").style.width = "25%";

    let wb;
    if (/\.csv$/i.test(file.name)) {
      const text = await file.text();
      wb = XLSX.read(text, {type:"string", cellDates:true});
    } else {
      wb = XLSX.read(await file.arrayBuffer(), {type:"array", cellDates:true});
    }

    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, {
      header:1,
      defval:"",
      raw:false
    });

    if (!rows.length || !rows[0].length) {
      throw new Error("ไม่พบข้อมูลหรือหัวตารางในไฟล์");
    }

    orderWorkbook = wb;
    orderRows = rows;
    orderHeaders = rows[0].map((x, i) => {
      const h = String(x ?? "").trim();
      return h || `คอลัมน์ ${i + 1}`;
    });

    document.getElementById("orderFileName").textContent = file.name;
    document.getElementById("orderFileCount").textContent = "1";
    document.getElementById("orderTool").classList.add("has-file");
    document.getElementById("orderRowCount").textContent =
      Math.max(0, rows.length - 1).toLocaleString();

    buildOrderFilters();
    applyOrderFilters();

    orderDownloadBtn.disabled = false;
  orderPivotExcelDownloadBtn.disabled = false;

    document.getElementById("orderBar").style.width = "100%";
    document.getElementById("orderStatus").textContent =
      `✅ เตรียมข้อมูล ORDER อัตโนมัติแล้ว | ${Math.max(0, rows.length - 1).toLocaleString()} รายการ | ${orderHeaders.length} คอลัมน์`;

    setTimeout(() => {
      document.getElementById("orderBar").style.width = "0%";
    }, 400);

  } catch (err) {
    document.getElementById("orderBar").style.width = "0%";
    document.getElementById("orderStatus").textContent = "❌ อ่านไฟล์ไม่สำเร็จ";
    alert("ไม่สามารถอ่านไฟล์ ORDER ได้\n\n" + err.message);
  }
}

function setupOrderColumns() {
  // ไม่ต้องตั้งค่าคอลัมน์จากหน้าเว็บอีกต่อไป
  // Pivot ใช้คอลัมน์ 4 (SKU Merchant) และคอลัมน์ 5 (จำนวน) อัตโนมัติ
}

function getOrderUniqueValues(colIndex) {
  const set = new Set();
  for (let i = 1; i < orderRows.length; i++) {
    set.add(String(orderRows[i]?.[colIndex] ?? ""));
  }
  return [...set].sort((a,b) =>
    a.localeCompare(b, undefined, {numeric:true, sensitivity:"base"})
  );
}

function buildOrderFilters() {
  // แสดงตัวกรองเฉพาะคอลัมน์ที่ 2, 4, 5, 6, 7 ของไฟล์ Excel
  // ตารางตัวอย่างยังคงแสดงข้อมูลทุกคอลัมน์เหมือนเดิม
  const filterColumnIndexes = [1, 3, 4, 5, 6].filter(i => i < orderHeaders.length);

  orderFiltersState = filterColumnIndexes.map(colIndex => {
    const values = getOrderUniqueValues(colIndex);
    return {
      colIndex,
      values,
      selected: new Set(values),
      renderValues: null,
      searchEl: null,
      countEl: null
    };
  });

  orderFiltersBox.innerHTML = "";

  // ค่าที่ควรแสดงในแต่ละคอลัมน์จะคำนวณจากตัวกรองของ "คอลัมน์อื่น"
  // ทำให้เมื่อเลือกคอลัมน์ 2 แล้ว คอลัมน์ 4/5/6/7 จะเปลี่ยนตามทันที
  const getAvailableValues = (targetState) => {
    const rows = orderRows.slice(1);
    const otherStates = orderFiltersState.filter(s => s !== targetState);

    const available = new Set();
    rows.forEach(row => {
      const matchesOtherFilters = otherStates.every(state => {
        const value = String(row?.[state.colIndex] ?? "");
        return state.selected.has(value);
      });
      if (matchesOtherFilters) {
        available.add(String(row?.[targetState.colIndex] ?? ""));
      }
    });
    return available;
  };

  const renderAllFilterLists = () => {
    orderFiltersState.forEach(state => {
      if (typeof state.renderValues === "function") state.renderValues();
    });
  };

  orderFiltersState.forEach((state) => {
    const card = document.createElement("div");
    card.className = "order-filter-card";

    const title = document.createElement("label");
    title.textContent = `คอลัมน์ ${state.colIndex + 1}: ${orderHeaders[state.colIndex]}`;

    const search = document.createElement("input");
    search.className = "filter-search";
    search.type = "text";
    search.placeholder = "🔍 ค้นหาค่า...";
    state.searchEl = search;

    const actions = document.createElement("div");
    actions.className = "value-actions";

    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.textContent = "ทั้งหมด";

    const noneBtn = document.createElement("button");
    noneBtn.type = "button";
    noneBtn.textContent = "ยกเลิกทั้งหมด";

    actions.append(allBtn, noneBtn);

    const list = document.createElement("div");
    list.className = "value-list";

    const count = document.createElement("div");
    count.className = "filter-count";
    state.countEl = count;

    const updateFilterCount = () => {
      count.textContent =
        `เลือก ${state.selected.size.toLocaleString()} / ${state.values.length.toLocaleString()} ค่า`;
    };

    const renderValues = () => {
      const q = search.value.trim().toLowerCase();
      list.innerHTML = "";

      const availableSet = getAvailableValues(state);
      const visibleValues = state.values.filter(v =>
        availableSet.has(String(v)) && String(v).toLowerCase().includes(q)
      );

      if (!visibleValues.length) {
        list.innerHTML = '<div style="padding:10px;text-align:center;color:#71848a;font-size:12px">ไม่พบค่าที่ตรงกับตัวกรองปัจจุบัน</div>';
      } else {
        visibleValues.forEach(value => {
          const item = document.createElement("label");
          item.className = "value-item";

          const cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = state.selected.has(value);

          cb.onchange = () => {
            if (cb.checked) state.selected.add(value);
            else state.selected.delete(value);
            applyOrderFilters();
            renderAllFilterLists();
          };

          const span = document.createElement("span");
          span.textContent = value === "" ? "(ว่าง)" : value;
          span.title = value;

          item.append(cb, span);
          list.append(item);
        });
      }
      updateFilterCount();
    };

    state.renderValues = renderValues;

    allBtn.onclick = () => {
      // เลือกเฉพาะค่าที่กำลังแสดง และตรงกับคำค้นหา
      const q = search.value.trim().toLowerCase();
      const availableSet = getAvailableValues(state);
      const visibleValues = state.values.filter(v =>
        availableSet.has(String(v)) && String(v).toLowerCase().includes(q)
      );
      visibleValues.forEach(v => state.selected.add(v));
      applyOrderFilters();
      renderAllFilterLists();
    };

    noneBtn.onclick = () => {
      // ยกเลิกเฉพาะค่าที่กำลังแสดง ไม่กระทบค่าที่อยู่นอกบริบทปัจจุบัน
      const q = search.value.trim().toLowerCase();
      const availableSet = getAvailableValues(state);
      const visibleValues = state.values.filter(v =>
        availableSet.has(String(v)) && String(v).toLowerCase().includes(q)
      );
      visibleValues.forEach(v => state.selected.delete(v));
      applyOrderFilters();
      renderAllFilterLists();
    };

    search.oninput = () => {
      const q = search.value.trim().toLowerCase();
      const availableSet = getAvailableValues(state);

      if (!q) {
        // ล้างคำค้นหา = เลือกทุกค่าที่มีอยู่ในบริบทปัจจุบัน
        state.values.forEach(v => {
          if (availableSet.has(String(v))) state.selected.add(v);
        });
      } else {
        // มีคำค้นหา = เลือกเฉพาะค่าที่ตรงกับคำค้นหาและมีอยู่ในบริบทปัจจุบัน
        state.values.forEach(v => state.selected.delete(v));
        state.values.forEach(v => {
          if (availableSet.has(String(v)) && String(v).toLowerCase().includes(q)) {
            state.selected.add(v);
          }
        });
      }

      applyOrderFilters();
      renderAllFilterLists();
    };

    card.append(title, search, actions, list, count);
    orderFiltersBox.append(card);
    renderValues();
  });
}

function applyOrderFilters() {
  if (!orderRows.length) return;

  orderFilteredRows = orderRows.slice(1).filter(row => {
    return orderFiltersState.every(state => {
      const value = String(row?.[state.colIndex] ?? "");
      return state.selected.has(value);
    });
  });

  renderOrderPreview([orderHeaders, ...orderFilteredRows.slice(0, 1000)]);

  orderFilterSummary.textContent =
    `แสดง ${orderFilteredRows.length.toLocaleString()} / ${Math.max(0, orderRows.length - 1).toLocaleString()} รายการ` +
    (orderFilteredRows.length > 1000 ? " | ตารางตัวอย่างแสดง 1,000 รายการแรก" : "");

  buildOrderPivot();
  buildOrderSummary();

  // ถ้าเคยตรวจ Stock ไว้แล้ว ให้คำนวณใหม่ตามตัวกรอง ORDER ปัจจุบัน
  const stockCheckBox = document.getElementById("orderStockCheck");
  if (stockCheckBox && stockCheckBox.style.display !== "none" && mergedStockRows.length) {
    checkOrderAgainstMergedStock();
  }

  if (orderRows.length) {
    document.getElementById("orderStatus").textContent =
      `● กรองข้อมูลแล้ว ${orderFilteredRows.length.toLocaleString()} รายการ จากทั้งหมด ${Math.max(0, orderRows.length - 1).toLocaleString()} รายการ`;
  }

  orderDownloadBtn.disabled = false;
  orderPivotExcelDownloadBtn.disabled = false;
  renderSelectedTrackingCopy();
  if (typeof renderBeforeOrderTable === 'function') renderBeforeOrderTable();
}

/* ===== COPY TRACKING BY SELECTED SKU MERCHANT ===== */
function getOrderTrackingIndex() {
  if (!orderHeaders.length) return -1;

  // รองรับชื่อหัวคอลัมน์ Tracking/เลขพัสดุที่พบได้หลายแบบในไฟล์ ORDER
  const normalized = s => String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[._\-/]+/g, ' ')
    .replace(/\s+/g, ' ');

  const exact = new Set([
    'tracking',
    'tracking no',
    'tracking number',
    'tracking no.',
    'เลข tracking',
    'เลขแท็กกิ้ง',
    'เลขแทกกิ้ง',
    'เลขแท็กกิง',
    'เลขแทกกิง',
    'เลขแท็คกิ้ง',
    'เลขแท็คกิง',
    'เลขแทร็กกิ้ง',
    'เลขแทรกกิ้ง',
    'เลขแทร็คกิ้ง',
    'เลขแทร็คกิง',
    'เลขแท็ก',
    'เลขแทก',
    'เลขพัสดุ',
    'หมายเลขพัสดุ',
    'เลขติดตาม',
    'หมายเลขติดตาม',
    'หมายเลข tracking',
    'หมายเลขแทกกิ้ง',
    'หมายเลขแทกกิง',
    'หมายเลขแท็กกิ้ง',
    'หมายเลขแท็กกิง',
    'หมายเลขแท็คกิ้ง',
    'หมายเลขแท็คกิง',
    'หมายเลขแทรกกิ้ง',
    'หมายเลขแทรกกิง',
    'หมายเลขแทรคกิ้ง',
    'หมายเลขแทรคกิง',
    'หมายเลขแทร็คกิ้ง',
    'หมายเลขแทร็คกิง'
  ]);

  const normalizedHeaders = orderHeaders.map(normalized);
  const exactIndex = normalizedHeaders.findIndex(h => exact.has(h));
  if (exactIndex >= 0) return exactIndex;

  // ถ้าเป็นหัวคอลัมน์ภาษาไทย ให้ตรวจจากคำสำคัญด้วย เช่น
  // "หมายเลขแทกกิ้ง", "เลขพัสดุ", "เลขติดตามพัสดุ"
  const thaiIndex = normalizedHeaders.findIndex(s =>
    !/(status|สถานะ|สถานะการจัดส่ง|status tracking)/i.test(s) &&
    (/tracking/.test(s) || /(?:หมายเลข|เลข).*(?:พัสดุ|ติดตาม|แท็กกิ้ง|แทกกิ้ง|แท็กกิง|แทกกิง|แท็คกิ้ง|แท็คกิง|แทร็กกิ้ง|แทรกกิ้ง|แทร็คกิ้ง)/i.test(s))
  );
  if (thaiIndex >= 0) return thaiIndex;

  return -1;
}

function getOrderSkuMerchantFilterState() {
  const groupIndex = getOrderGroupIndex();
  if (groupIndex < 0) return null;
  return orderFiltersState.find(state => state.colIndex === groupIndex) || null;
}

function buildSelectedTrackingGroups() {
  const groupIndex = getOrderGroupIndex();
  const trackingIndex = getOrderTrackingIndex();
  const skuState = getOrderSkuMerchantFilterState();

  if (groupIndex < 0 || trackingIndex < 0 || !skuState || !skuState.selected.size) {
    return { groups: [], trackingIndex, groupIndex };
  }

  const selected = skuState.selected;
  const map = new Map();
  // Tracking เดียวกันต้องคัดลอกเพียง 1 ครั้ง แม้จะพบซ้ำหลายแถวหรือหลายกลุ่ม SKU
  const seenTracking = new Set();

  // ใช้เฉพาะแถวที่ผ่านตัวกรองปัจจุบัน และต้องเป็นชื่อ SKU Merchant ที่เลือกไว้เท่านั้น
  orderFilteredRows.forEach(row => {
    const merchantName = String(row?.[groupIndex] ?? '');
    if (!selected.has(merchantName)) return;

    const tracking = String(row?.[trackingIndex] ?? '').trim();
    if (!tracking) return;

    // เลข Tracking ซ้ำกันให้เอาเพียง 1 เลข โดยคงลำดับที่พบครั้งแรก
    if (seenTracking.has(tracking)) return;
    seenTracking.add(tracking);

    const groupKey = normalizeOrderGroupName(merchantName) || '(ว่าง)';
    if (!map.has(groupKey)) {
      map.set(groupKey, {
        key: groupKey,
        label: merchantName.trim() || '(ว่าง)',
        // เก็บเฉพาะเลข Tracking ที่ไม่ซ้ำกัน
        values: []
      });
    }
    // เพิ่มเฉพาะเลข Tracking ที่พบครั้งแรก
    map.get(groupKey).values.push(tracking);
  });

  const groups = [...map.values()]
    .map(group => ({
      ...group,
      values: [...group.values]
    }))
    .sort((a,b) => a.key.localeCompare(b.key, undefined, {numeric:true, sensitivity:'base'}));

  return { groups, trackingIndex, groupIndex };
}

// ===== เลือกยี่ห้อสำหรับแสดง/คัดลอกเลข Tracking =====
function renderTrackingBrandPicker(groups) {
  const optionsBox = document.getElementById('trackingBrandOptions');
  if (!optionsBox) return;

  // ไม่มีข้อมูลให้เลือก = ซ่อนปุ่มเลือกยี่ห้อทั้งปุ่ม
  const picker = document.getElementById('trackingBrandPicker');
  if (picker) {
    picker.style.display = groups.length ? '' : 'none';
    if (!groups.length) picker.open = false;
  }

  optionsBox.textContent = '';
  groups.forEach(g => {
    const label = document.createElement('label');
    label.className = 'order-brand-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !orderTrackingBrandDeselected.has(g.key);
    cb.onchange = () => {
      if (cb.checked) orderTrackingBrandDeselected.delete(g.key);
      else orderTrackingBrandDeselected.add(g.key);
      updateTrackingBrandSummary(groups);
      renderSelectedTrackingCopy(true);
    };
    const name = document.createElement('span');
    name.textContent = g.label || g.key;
    name.title = g.label || g.key;
    const n = document.createElement('small');
    n.textContent = g.values.length.toLocaleString();
    label.append(cb, name, n);
    optionsBox.append(label);
  });
  updateTrackingBrandSummary(groups);
}

function updateTrackingBrandSummary(groups) {
  const countEl = document.getElementById('trackingBrandCount');
  if (!countEl) return;
  const selected = groups.filter(g => !orderTrackingBrandDeselected.has(g.key)).length;
  countEl.textContent = selected === groups.length ? 'ทั้งหมด' : `เลือก ${selected}/${groups.length}`;
}

(function wireTrackingBrandPicker() {
  const setAll = (selected) => {
    orderTrackingBrandDeselected.clear();
    if (!selected) buildSelectedTrackingGroups().groups.forEach(g => orderTrackingBrandDeselected.add(g.key));
    renderSelectedTrackingCopy();
  };
  const allBtn = document.getElementById('trackingBrandAll');
  const noneBtn = document.getElementById('trackingBrandNone');
  if (allBtn) allBtn.onclick = () => setAll(true);
  if (noneBtn) noneBtn.onclick = () => setAll(false);
})();

function renderSelectedTrackingCopy(skipPicker = false) {
  const panel = document.getElementById('orderTrackingCopy');
  const preview = document.getElementById('orderTrackingPreview');
  const note = document.getElementById('trackingCopyNote');
  if (!panel || !preview || !note) return;

  const skuState = getOrderSkuMerchantFilterState();
  const trackingIndex = getOrderTrackingIndex();

  // ยังไม่เลือกชื่อ SKU Merchant = ไม่แสดงเลข Tracking
  if (!skuState || !skuState.selected.size) {
    panel.style.display = 'none';
    note.textContent = 'เลือกชื่อในคอลัมน์ “ชื่อ SKU Merchant” เพื่อแสดงเลข Tracking';
    renderTrackingBrandPicker([]);
    preview.innerHTML = '<span class="tracking-empty">ยังไม่ได้เลือก SKU Merchant</span>';
    return;
  }

  panel.style.display = 'block';

  if (trackingIndex < 0) {
    renderTrackingBrandPicker([]);
    note.textContent = 'ไม่พบคอลัมน์ Tracking ในไฟล์ ORDER';
    preview.innerHTML = '<span class="tracking-empty">ไม่พบหัวคอลัมน์เลข Tracking / เลขพัสดุ</span>';
    return;
  }

  const result = buildSelectedTrackingGroups();
  if (!skipPicker) renderTrackingBrandPicker(result.groups);

  // แสดง/คัดลอกเฉพาะยี่ห้อที่เลือกไว้ (ค่าเริ่มต้น = ทุกยี่ห้อ)
  const groups = result.groups.filter(g => !orderTrackingBrandDeselected.has(g.key));
  const allTotal = result.groups.reduce((sum, g) => sum + g.values.length, 0);
  const total = groups.reduce((sum, g) => sum + g.values.length, 0);
  const groupCount = groups.length;

  if (!allTotal) {
    note.textContent = `เลือก ${skuState.selected.size.toLocaleString()} ชื่อ แต่ไม่พบเลข Tracking`;
    preview.innerHTML = '<span class="tracking-empty">ไม่มีเลข Tracking จากรายการที่เลือก</span>';
    return;
  }
  if (!total) {
    note.textContent = 'ยังไม่ได้เลือกยี่ห้อ';
    preview.innerHTML = '<span class="tracking-empty">ยังไม่ได้เลือกยี่ห้อ</span>';
    return;
  }

  // แบ่งเป็นกล่องละไม่เกิน 100 เลข Tracking
  // เลขซ้ำถูกตัดออกตั้งแต่ buildSelectedTrackingGroups() แล้ว
  const BOX_SIZE = 100;
  const boxes = [];
  let currentBox = [];
  let currentCount = 0;

  groups.forEach(group => {
    group.values.forEach(tracking => {
      if (currentCount >= BOX_SIZE) {
        boxes.push(currentBox);
        currentBox = [];
        currentCount = 0;
      }
      currentBox.push({
        type: 'tracking',
        value: tracking
      });
      currentCount++;
    });
  });
  if (currentBox.length) boxes.push(currentBox);

  note.textContent =
    `พบ ${total.toLocaleString()} เลข Tracking | ${groupCount.toLocaleString()} กลุ่ม SKU | ${boxes.length.toLocaleString()} ช่อง (ช่องละไม่เกิน 100 เลข) | เลขซ้ำเอาเพียง 1 เลข`;

  // สร้างข้อมูลสำหรับแต่ละกล่องใหม่ โดยยังแสดงชื่อกลุ่มตามลำดับเดิม
  // เพื่อให้แต่ละกล่องอ่านง่าย แต่ตอนคัดลอกจะคัดลอกเฉพาะเลข Tracking เท่านั้น
  let globalIndex = 0;
  const boxHtml = boxes.map((box, boxIndex) => {
    const boxStart = globalIndex;
    const boxEnd = globalIndex + box.length;
    globalIndex = boxEnd;

    const items = [];
    let cursor = 0;
    groups.forEach(group => {
      const groupStart = cursor;
      const groupEnd = cursor + group.values.length;
      const overlapStart = Math.max(groupStart, boxStart);
      const overlapEnd = Math.min(groupEnd, boxEnd);
      if (overlapStart < overlapEnd) {
        items.push(`<div class="tracking-group">${escapeHtml(group.label || group.key)}</div>`);
        for (let i = overlapStart; i < overlapEnd; i++) {
          items.push(`<div class="tracking-item">${escapeHtml(group.values[i - groupStart])}</div>`);
        }
      }
      cursor = groupEnd;
    });

    const values = box.map(item => escapeHtml(item.value)).join('\\n');
    return `<div class="tracking-box" data-box-index="${boxIndex}" data-tracking-count="${box.length}" data-tracking-values="${escapeHtml(values)}">${items.join('')}</div>`;
  }).join('');

  preview.innerHTML = boxHtml;
}

async function copyAllDisplayedTracking() {
  const boxes = [...document.querySelectorAll('#orderTrackingPreview .tracking-box')];
  if (!boxes.length) {
    if (typeof window.fxToast === 'function') window.fxToast('ยังไม่มีเลข Tracking ให้คัดลอก', '');
    return false;
  }

  // ปุ่ม/การคลิกพื้นที่รวมแบบเดิม ให้คัดลอกทั้งหมดทุกกล่องตามลำดับ
  const values = boxes.flatMap(box =>
    [...box.querySelectorAll('.tracking-item')]
      .map(el => String(el.textContent || '').trim())
      .filter(Boolean)
  );
  return await copyTrackingList(values, document.getElementById('orderTrackingPreview'), 'ทั้งหมด');
}

async function copyTrackingBox(box) {
  if (!box) return false;
  const values = [...box.querySelectorAll('.tracking-item')]
    .map(el => String(el.textContent || '').trim())
    .filter(Boolean);
  if (!values.length) return false;

  const boxIndex = Number(box.dataset.boxIndex || 0) + 1;
  return await copyTrackingList(values, box, `ช่องที่ ${boxIndex}`);
}

async function copyTrackingList(values, box, label) {
  const text = values.join('\n');
  if (!text) {
    if (typeof window.fxToast === 'function') window.fxToast('ยังไม่มีเลข Tracking ให้คัดลอก', '');
    return false;
  }

  let copied = false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }

  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      copied = document.execCommand('copy');
      ta.remove();
    } catch (err) {
      copied = false;
    }
  }

  if (!copied) {
    if (box) {
      const range = document.createRange();
      range.selectNodeContents(box);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    alert('เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ\nระบบเลือกเลข Tracking ในช่องนี้ให้แล้ว กด Ctrl+C เพื่อคัดลอก');
    return false;
  }

  if (box) {
    box.classList.add('tracking-all-copied');
    setTimeout(() => box.classList.remove('tracking-all-copied'), 700);
  }

  const count = values.length;
  if (typeof window.fxToast === 'function') {
    window.fxToast(`คัดลอก Tracking ${label} ${count.toLocaleString()} เลขแล้ว`, 'success');
  }
  if (typeof window.workHistoryLog === 'function') {
    window.workHistoryLog('filter', 'orderTool', `คัดลอก Tracking ${label} ${count.toLocaleString()} เลข`);
  }
  return true;
}

async function copyTrackingValue(el) {
  if (!el) return;
  const text = String(el.textContent || '').trim();
  if (!text) return;

  let copied = false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      copied = true;
    }
  } catch (err) {
    copied = false;
  }

  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.width = '1px';
      ta.style.height = '1px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      copied = document.execCommand('copy');
      ta.remove();
    } catch (err) {
      copied = false;
    }
  }

  if (!copied) {
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    alert('เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ\nกด Ctrl+C เพื่อคัดลอกเลข Tracking นี้');
    return;
  }

  const old = el.textContent;
  el.classList.add('tracking-copied');
  el.textContent = '✓ ' + text;
  setTimeout(() => {
    el.textContent = old;
    el.classList.remove('tracking-copied');
  }, 900);

  if (typeof window.workHistoryLog === 'function') {
    window.workHistoryLog('filter', 'orderTool', `คัดลอก Tracking ${text}`);
  }
}

function getSelectedTrackingClipboardText() {
  const result = buildSelectedTrackingGroups();
  // คัดลอกเลข Tracking ทุกตัวที่แสดง โดยเลขซ้ำจะถูกตัดออกตั้งแต่ตอนสร้างกลุ่ม
  return result.groups
    .map(group => group.values.filter(v => String(v ?? '').trim() !== '').join('\n'))
    .filter(Boolean)
    .join('\n\n');
}

const trackingPreviewBox = document.getElementById('orderTrackingPreview');
if (trackingPreviewBox) {
  trackingPreviewBox.title = 'คลิกที่ช่องใดช่องหนึ่งเพื่อคัดลอกเลข Tracking เฉพาะช่องนั้น';
  trackingPreviewBox.addEventListener('click', async (event) => {
    const box = event.target.closest('.tracking-box');
    if (!box || event.target.closest('.tracking-empty')) return;
    await copyTrackingBox(box);
  });
}

document.getElementById("orderSelectAll").onclick = () => {
  // เลือกทั้งหมดเฉพาะค่าที่ตรงกับคำค้นของแต่ละคอลัมน์
  orderFiltersState.forEach((state, index) => {
    const card = orderFiltersBox.children[index];
    const search = card?.querySelector(".filter-search");
    const q = search ? search.value.trim().toLowerCase() : "";
    const visibleValues = state.values.filter(v =>
      String(v).toLowerCase().includes(q)
    );
    visibleValues.forEach(v => state.selected.add(v));
  });
  buildOrderFilters();
  applyOrderFilters();
};

document.getElementById("orderClearFilters").onclick = () => {
  orderFiltersState.forEach(state => state.values.forEach(v => state.selected.add(v)));
  buildOrderFilters();
  applyOrderFilters();
};

function buildOrderSummary() {
  const summaryExtra = document.getElementById("orderSummaryExtra");
  const rowsEl = document.getElementById("orderSummaryRows");
  const skuEl = document.getElementById("orderSummarySku");
  const qtyEl = document.getElementById("orderSummaryQty");
  const missingEl = document.getElementById("orderSummaryMissing");

  if (!summaryExtra || !rowsEl || !skuEl || !qtyEl || !missingEl) return;

  const filtered = Array.isArray(orderFilteredRows) ? orderFilteredRows : [];
  const pivot = Array.isArray(orderPivotRows) ? orderPivotRows : [];

  const totalQty = pivot.reduce((sum, item) => {
    const n = Number(item?.qty);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);

  rowsEl.textContent = filtered.length.toLocaleString();
  skuEl.textContent = pivot.length.toLocaleString();
  qtyEl.textContent = formatPivotNumber(totalQty);

  // จำนวน SKU ที่ไม่มี Stock จะอัปเดตอีกครั้งเมื่อกด "ตรวจ ORDER กับ Stock"
  missingEl.textContent = "0";

  summaryExtra.style.display = "block";
}


// ===== ตรวจ ORDER กับ Stock จากข้อมูลที่รวมในหน้า ZIP =====
// กติกา:
// - SKU ซ้ำใน Stock: รวม "จำนวน" ทุกแถวเข้าด้วยกัน
// - ตำแหน่งหลายจุด: แสดงทุกตำแหน่งในช่องเดียว
// - ตำแหน่ง เช่น KT-001-01 / C-00-01 -> แสดง KT / C
// - ตำแหน่งซ้ำกัน -> แสดงเพียงครั้งเดียว
// - ถ้ายังไม่ได้รวม Stock: แจ้งให้ไปทำหน้า "รวมไฟล์ ZIP" ก่อน
function formatStockLocationShort(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  return (raw.split('-')[0] || raw).trim().toUpperCase();
}

function buildMergedStockMap() {
  const map = new Map();

  if (!Array.isArray(mergedStockRows) || !mergedStockRows.length) {
    return map;
  }

  // ข้อมูลจาก merge ถูกทำให้เป็นมาตรฐาน:
  // A = SKU Merchant, B = ชื่อ SKU, C = ตำแหน่ง, D = จำนวน
  // แต่ยังหา index จากหัวตารางจริงไว้เพื่อความปลอดภัย
  const header = ['SKU Merchant', 'ชื่อ SKU', 'ตำแหน่ง', 'จำนวน'];
  const skuIndex = header.findIndex(h => /^SKU\s*Merchant$/i.test(h));
  const posIndex = header.findIndex(h => /^ตำแหน่ง$/i.test(h));
  const qtyIndex = header.findIndex(h => /^จำนวน$/i.test(h));

  mergedStockRows.forEach(row => {
    const sku = norm(row?.[skuIndex]);
    if (!sku) return;

    const qty = num(row?.[qtyIndex]);
    let item = map.get(sku);

    if (!item) {
      item = {
        sku,
        qty: 0,
        locations: []
      };
      map.set(sku, item);
    }

    item.qty += qty;

    const shortLocation = formatStockLocationShort(row?.[posIndex]);
    if (
      shortLocation &&
      !item.locations.some(x => String(x).toUpperCase() === shortLocation)
    ) {
      item.locations.push(shortLocation);
    }
  });

  return map;
}

function checkOrderAgainstMergedStock() {
  const box = document.getElementById("orderStockCheck");
  const missingEl = document.getElementById("orderSummaryMissing");

  if (!box) return;

  if (!mergedStockRows.length) {
    if (missingEl) missingEl.textContent = "0";
    box.style.display = "block";
    box.innerHTML = `
      <div class="empty">
        ⚠️ ยังไม่มีข้อมูล Stock<br>
        กรุณาไปที่หน้า <b>📦 รวมไฟล์ ZIP</b> และเลือก ZIP เพื่อรวม Stock ก่อน
      </div>`;
    return;
  }

  if (!orderPivotRows.length) {
    if (missingEl) missingEl.textContent = "0";
    box.style.display = "block";
    box.innerHTML = '<div class="empty">ไม่มีข้อมูล ORDER หลังกรอง</div>';
    return;
  }

  const stockMap = buildMergedStockMap();
  const rows = [];
  let missingCount = 0;

  // orderPivotRows รวม SKU ซ้ำของ ORDER อยู่แล้ว
  orderPivotRows.forEach(order => {
    const sku = String(order?.sku ?? '').trim();
    const orderQty = num(order?.qty);
    const stock = stockMap.get(sku);

    const stockQty = stock ? stock.qty : 0;
    const locations = stock ? stock.locations.join(', ') : '';

    let status = '';
    let rowClass = '';

    if (!stock || stockQty <= 0) {
      status = '❌ ไม่มี Stock';
      rowClass = 'stock-none';
      missingCount++;
    } else if (stockQty < orderQty) {
      status = `⚠️ ขาด ${formatPivotNumber(orderQty - stockQty)}`;
      rowClass = 'stock-short';
    } else {
      status = '✅ พอ';
      rowClass = 'stock-ok';
    }

    rows.push({
      sku,
      orderQty,
      stockQty,
      status,
      locations,
      rowClass
    });
  });

  if (missingEl) missingEl.textContent = missingCount.toLocaleString();

  let html = `
    <div style="margin-bottom:8px;font-size:12px;color:#94adbd">
      รวม Stock จากหน้า "รวมไฟล์ ZIP" โดยรวม SKU ที่ซ้ำกัน และรวมตำแหน่งแบบไม่ซ้ำ
    </div>
    <table>
      <thead>
        <tr>
          <th>SKU</th>
          <th>ORDER</th>
          <th>Stock รวม</th>
          <th>สถานะ</th>
          <th>ตำแหน่ง</th>
        </tr>
      </thead>
      <tbody>`;

  rows.forEach(r => {
    html += `
      <tr class="${r.rowClass}">
        <td>${escapeHtml(r.sku)}</td>
        <td>${escapeHtml(formatPivotNumber(r.orderQty))}</td>
        <td>${escapeHtml(formatPivotNumber(r.stockQty))}</td>
        <td>${escapeHtml(r.status)}</td>
        <td>${escapeHtml(r.locations || '-')}</td>
      </tr>`;
  });

  html += `</tbody></table>`;
  box.innerHTML = html;
  box.style.display = "block";
}

const orderStockCheckBtn = document.getElementById("orderStockCheckBtn");
if (orderStockCheckBtn) {
  orderStockCheckBtn.onclick = checkOrderAgainstMergedStock;
}

// ใช้ "ชื่อ SKU Merchant" เป็นตัวกำหนดกลุ่ม
// และใช้ "SKU Merchant" เป็นข้อมูลที่นำมาแสดงผล
// ถ้าชื่อกลุ่มลงท้ายด้วย FRONT จะยังถือเป็นกลุ่มเดิม
function normalizeOrderGroupName(value) {
  // กติกาการแบ่งกลุ่ม: ยึดเฉพาะ "คำแรก" ของคอลัมน์ ชื่อ SKU Merchant
  // ไม่สนใจตัวพิมพ์เล็ก/ใหญ่ และข้อความคำอื่นที่ตามหลังคำแรก (รวมถึง FRONT)
  // เช่น IMANE / Imane / IMANE FRONT / Imane Front = กลุ่มเดียวกัน
  const firstWord = String(value ?? '').trim().split(/\s+/)[0] || '';
  return firstWord.toLowerCase();
}

function compareOrderGroup(a, b) {
  const aa = normalizeOrderGroupName(a);
  const bb = normalizeOrderGroupName(b);
  return aa.localeCompare(bb, undefined, {numeric:true, sensitivity:'base'});
}

function compareOrderExportRows(a, b, groupIndex, skuIndex) {
  const groupCmp = compareOrderGroup(a?.[groupIndex], b?.[groupIndex]);
  if (groupCmp !== 0) return groupCmp;
  return String(a?.[skuIndex] ?? '').localeCompare(
    String(b?.[skuIndex] ?? ''),
    undefined,
    {numeric:true, sensitivity:'base'}
  );
}

function addOrderSkuSpacingRows(rows, groupIndex, skuIndex) {
  // 1) แบ่งกลุ่มจาก "ชื่อ SKU Merchant" เท่านั้น
  // 2) "ชื่อ SKU Merchant" ที่ลงท้าย FRONT ไม่นับเป็นกลุ่มใหม่
  // 3) ข้อมูลที่แสดงยังใช้ค่า "SKU Merchant" เต็ม ๆ
  // 4) ภายในกลุ่มไม่เว้นบรรทัด
  // 5) เมื่อเปลี่ยนกลุ่ม เว้น 3 บรรทัด
  if (!rows.length) return [];

  const sorted = [...rows].sort((a, b) =>
    compareOrderExportRows(a, b, groupIndex, skuIndex)
  );

  const out = [];
  let previousGroup = null;

  sorted.forEach((row) => {
    const group = normalizeOrderGroupName(row?.[groupIndex]);
    if (previousGroup !== null && group !== previousGroup) {
      for (let i = 0; i < 3; i++) out.push([]);
    }
    out.push(row);
    previousGroup = group;
  });

  return out;
}

function compareOrderPivotRows(a, b) {
  const groupCmp = compareOrderGroup(a?.groupName, b?.groupName);
  if (groupCmp !== 0) return groupCmp;
  return String(a?.sku ?? '').localeCompare(
    String(b?.sku ?? ''),
    undefined,
    {numeric:true, sensitivity:'base'}
  );
}

function downloadOrderPivotExcel() {
  // ดาวน์โหลด Excel ให้ตรงกับ "ตัวอย่างข้อมูล" ด้านล่างของหน้ารับORDER
  // ใช้หัวคอลัมน์และลำดับแถวเดียวกับตาราง Preview หลังกรอง
  if (!orderRows.length || !orderHeaders.length) {
    return alert('ยังไม่มีข้อมูล ORDER สำหรับดาวน์โหลด');
  }
  if (!window.XLSX) return alert('ไม่พบไลบรารี Excel (XLSX)');

  const dataRows = orderFilteredRows.length
    ? orderFilteredRows
    : orderRows.slice(1);
  const skuIndex = getOrderSkuIndex() >= 0 ? getOrderSkuIndex() : ORDER_PIVOT_SKU_INDEX;
  const groupIndex = getOrderGroupIndex() >= 0 ? getOrderGroupIndex() : skuIndex;
  const qtyIndex = getOrderQtyIndex() >= 0 ? getOrderQtyIndex() : ORDER_PIVOT_QTY_INDEX;

  // Excel ไม่เว้นบรรทัดระหว่างกลุ่ม
  // ยังคงเรียงตาม "ชื่อ SKU Merchant" และแสดงข้อมูลทุกคอลัมน์ตามเดิม
  const sortedDataRows = [...dataRows].sort((a, b) =>
    compareOrderExportRows(a, b, groupIndex, skuIndex)
  );

  const data = [
    [...orderHeaders],
    ...sortedDataRows.map(row => orderHeaders.map((_, i) => row?.[i] ?? ''))
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // ปรับความกว้างคอลัมน์ให้อ่านง่าย โดยยึดข้อมูลจริงในตัวอย่าง
  ws['!cols'] = orderHeaders.map((header, colIndex) => {
    let maxLen = String(header ?? '').length;
    dataRows.slice(0, 1000).forEach(row => {
      const len = String(row?.[colIndex] ?? '').length;
      if (len > maxLen) maxLen = len;
    });
    return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
  });

  const wb = XLSX.utils.book_new();

  // ส่งออกเฉพาะ Sheet Pivot เท่านั้น
  // ไม่ใส่ Sheet ORDER เพื่อให้ไฟล์ที่ดาวน์โหลดเหลือแค่ Pivot
  const pivotHeader = [
    orderHeaders[skuIndex] || 'SKU Merchant',
    orderHeaders[qtyIndex] || 'จำนวน'
  ];
  // Pivot ใน Excel ไม่เว้นบรรทัดระหว่างกลุ่ม
  const sortedPivotRows = [...orderPivotRows].sort(compareOrderPivotRows);
  const pivotRowsForExcel = sortedPivotRows.map(item => [item.sku, item.qty]);
  const pivotData = [
    pivotHeader,
    ...pivotRowsForExcel
  ];
  const pivotWs = XLSX.utils.aoa_to_sheet(pivotData);
  pivotWs['!cols'] = [
    { wch: Math.min(Math.max(String(pivotHeader[0]).length + 2, 14), 40) },
    { wch: Math.min(Math.max(String(pivotHeader[1]).length + 2, 12), 20) }
  ];
  XLSX.utils.book_append_sheet(wb, pivotWs, 'Pivot');

  XLSX.writeFile(wb, 'ORDER_Pivot.xlsx');
}

orderPivotExcelDownloadBtn.onclick = downloadOrderPivotExcel;

const orderPivotCopyAllBtn = document.getElementById('orderPivotCopyAllBtn');
if (orderPivotCopyAllBtn) {
  orderPivotCopyAllBtn.onclick = copyAllOrderPivot;
}

orderDownloadBtn.onclick = printOrderSheet;


// ===== คัดลอกข้อมูล Pivot ทั้งหมด =====
// คัดลอกทุกแถวของ Pivot ที่สร้างจริง ไม่จำกัดเฉพาะ 1,000 แถวที่แสดงบนหน้าจอ
async function copyAllOrderPivot() {
  const allRows = Array.isArray(orderPivotRows) ? orderPivotRows : [];
  if (!allRows.length) {
    if (typeof window.fxToast === 'function') window.fxToast('ยังไม่มีข้อมูล Pivot ให้คัดลอก', '');
    else alert('ยังไม่มีข้อมูล Pivot ให้คัดลอก');
    return;
  }

  // คัดลอกเฉพาะยี่ห้อที่เลือกไว้ (ค่าเริ่มต้น = เลือกทุกยี่ห้อ)
  const rows = allRows.filter(r => !orderBrandDeselected.has(r?.groupName));
  if (!rows.length) {
    const emptyMsg = 'กรุณาเลือกยี่ห้ออย่างน้อย 1 ยี่ห้อ';
    if (typeof window.fxToast === 'function') window.fxToast(emptyMsg, '');
    else alert(emptyMsg);
    return;
  }

  // คัดลอกเฉพาะข้อมูล ไม่เอาหัวตาราง
  // ใช้ Clipboard แบบ HTML ตาราง เพื่อบังคับให้ Excel มอง SKU Merchant
  // เป็น "1 ช่อง" เสมอ แม้ภายใน SKU จะมีช่องว่างกี่ตำแหน่งก็ตาม
  // ช่องว่างภายใน SKU จะถูกเก็บไว้ทั้งหมด ส่วนช่องว่างหัว/ท้ายจะตัดออก
  const copyRows = rows.map(r => {
    const sku = String(r?.sku ?? '')
      .replace(/[\t\r\n]+/g, ' ')
      .trim();
    const qty = formatPivotNumber(r?.qty ?? 0);
    return { sku, qty };
  });

  const escapeClipboardHtml = value => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // HTML จะทำให้ Excel แยกคอลัมน์ตาม <td> เท่านั้น
  // ดังนั้น "SKU Merchant" ที่มีช่องว่างภายในจะไม่ถูกแยกไปคอลัมน์จำนวน
  const html = [
    '<table><tbody>',
    ...copyRows.map(r =>
      `<tr><td>${escapeClipboardHtml(r.sku)}</td><td>${escapeClipboardHtml(r.qty)}</td></tr>`
    ),
    '</tbody></table>'
  ].join('');

  // text/plain ใช้เป็น fallback สำหรับโปรแกรมที่ไม่รองรับ HTML clipboard
  const text = copyRows.map(r => `${r.sku}\t${r.qty}`).join('\n');

  let copied = false;

  // วิธีหลัก: คัดลอกทั้ง HTML + plain text
  // Excel จะใช้ HTML table ทำให้ช่องว่างใน SKU ไม่กลายเป็นตัวแบ่งคอลัมน์
  try {
    if (
      navigator.clipboard &&
      window.isSecureContext &&
      typeof ClipboardItem !== 'undefined' &&
      typeof navigator.clipboard.write === 'function'
    ) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
      copied = true;
    }
  } catch (e) {
    copied = false;
  }

  // Fallback: text/plain
  if (!copied) {
    try {
      if (navigator.clipboard && window.isSecureContext &&
          typeof navigator.clipboard.writeText === 'function') {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch (e) {
      copied = false;
    }
  }

  // Fallback สุดท้ายสำหรับเบราว์เซอร์เก่า
  if (!copied) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.setAttribute('readonly', '');
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      copied = document.execCommand('copy');
      ta.remove();
    } catch (e) {
      copied = false;
    }
  }

  if (copied) {
    const msg = rows.length === allRows.length
      ? `คัดลอก Pivot ทั้งหมด ${rows.length.toLocaleString()} รายการแล้ว (ไม่รวมหัวตาราง)`
      : `คัดลอก Pivot ที่เลือก ${rows.length.toLocaleString()} จาก ${allRows.length.toLocaleString()} รายการแล้ว (ไม่รวมหัวตาราง)`;
    if (typeof window.fxToast === 'function') window.fxToast(msg, 'success');
    else alert(msg);
    if (typeof window.workHistoryLog === 'function') {
      window.workHistoryLog('filter', 'orderTool', msg);
    }
  } else {
    alert('ไม่สามารถคัดลอกอัตโนมัติได้ กรุณาเลือกข้อมูลแล้วกด Ctrl+C');
  }
}

function buildOrderPivot() {
  if (!orderRows.length) {
    orderPivotRows = [];
    document.getElementById("orderPivotWrap").style.display = "none";
    return;
  }

  const skuIndex = getOrderSkuIndex() >= 0 ? getOrderSkuIndex() : ORDER_PIVOT_SKU_INDEX;
  const qtyIndex = getOrderQtyIndex() >= 0 ? getOrderQtyIndex() : ORDER_PIVOT_QTY_INDEX;
  if (skuIndex >= orderHeaders.length || qtyIndex >= orderHeaders.length || skuIndex === qtyIndex || skuIndex < 0 || qtyIndex < 0) {
    orderPivotRows = [];
    document.getElementById("orderPivotWrap").style.display = "none";
    return;
  }

  const groupIndex = getOrderGroupIndex() >= 0 ? getOrderGroupIndex() : skuIndex;

  // Pivot แสดงเฉพาะค่าในคอลัมน์ "SKU Merchant"
  // แต่ลำดับและการเว้นบรรทัดยึดจากคอลัมน์ "ชื่อ SKU Merchant"
  const map = new Map();
  skuBrandLearn(orderRows.slice(1), skuIndex, groupIndex);
  orderFilteredRows.forEach(row => {
    const sku = String(row?.[skuIndex] ?? "").trim() || "(ว่าง)";
    const groupName = normalizeOrderGroupName(row?.[groupIndex]) || "(ว่าง)";
    const qtyRaw = String(row?.[qtyIndex] ?? "").replace(/,/g, "").trim();
    const qty = Number(qtyRaw);
    const amount = Number.isFinite(qty) ? qty : 0;
    const key = sku;
    const existing = map.get(key);
    if (existing) {
      existing.qty += amount;
      const exactMerchant = String(row?.[groupIndex] ?? '').trim();
      if (exactMerchant && !existing.merchantNames.includes(exactMerchant)) existing.merchantNames.push(exactMerchant);
    } else {
      const exactMerchant = String(row?.[groupIndex] ?? '').trim();
      map.set(key, { sku, qty: amount, groupName, merchantNames: exactMerchant ? [exactMerchant] : [] });
    }
  });

  orderPivotRows = [...map.values()].sort(compareOrderPivotRows);

  const skuHeader = "SKU Merchant";
  const qtyHeader = "จำนวน";
  const wrap = document.getElementById("orderPivotWrap");
  const box = document.getElementById("orderPivotPreview");
  const note = document.getElementById("orderPivotNote");

  wrap.style.display = "block";
  note.textContent = `รวม ${orderPivotRows.length.toLocaleString()} รายการ จาก ${orderFilteredRows.length.toLocaleString()} แถว | ${skuHeader} + รวม ${qtyHeader}`;
  renderOrderBrandPicker();

  if (!orderPivotRows.length) {
    box.innerHTML = '<div class="empty">ไม่มีข้อมูลหลังกรอง</div>';
    return;
  }

  renderOrderPivotTable();
}

// ตารางตัวอย่าง Pivot แสดงเฉพาะยี่ห้อที่เลือกไว้ (ค่าเริ่มต้น = ทุกยี่ห้อ)
function renderOrderPivotTable() {
  const box = document.getElementById("orderPivotPreview");
  if (!box) return;
  const skuHeader = "SKU Merchant";
  const qtyHeader = "จำนวน";
  const visibleRows = orderPivotRows.filter(r => !orderBrandDeselected.has(r?.groupName));

  if (!orderPivotRows.length) {
    box.innerHTML = '<div class="empty">ไม่มีข้อมูลหลังกรอง</div>';
    return;
  }
  if (!visibleRows.length) {
    box.innerHTML = '<div class="empty">ยังไม่ได้เลือกยี่ห้อ</div>';
    return;
  }

  let html = `<table><thead><tr><th>${escapeHtml(skuHeader)}</th><th>${escapeHtml(qtyHeader)}</th></tr></thead><tbody>`;
  visibleRows.slice(0,1000).forEach(r => {
    html += `<tr><td>${escapeHtml(r.sku)}</td><td>${escapeHtml(formatPivotNumber(r.qty))}</td></tr>`;
  });
  html += `</tbody></table>`;
  if (visibleRows.length > 1000) {
    html += `<div style="padding:8px;text-align:center;color:#687d83;font-size:11px">แสดง 1,000 รายการแรก จาก ${visibleRows.length.toLocaleString()} รายการ</div>`;
  }
  box.innerHTML = html;
}

// ===== เลือกยี่ห้อสำหรับคัดลอก Pivot =====
// ยี่ห้อ = กลุ่มเดียวกับที่ Pivot ใช้แบ่ง (คำแรกของ "ชื่อ SKU Merchant")
// เก็บเฉพาะยี่ห้อที่ "ไม่ได้เลือก" ไว้ ยี่ห้อใหม่จึงถูกเลือกโดยอัตโนมัติ
function renderOrderBrandPicker() {
  const optionsBox = document.getElementById('orderBrandOptions');
  const countEl = document.getElementById('orderBrandCount');
  const copyBtn = document.getElementById('orderPivotCopyAllBtn');
  if (!optionsBox || !countEl || !copyBtn) return;

  const brands = new Map();
  (Array.isArray(orderPivotRows) ? orderPivotRows : []).forEach(r => {
    const key = r?.groupName;
    let b = brands.get(key);
    if (!b) {
      const original = String(r?.merchantNames?.[0] ?? '').trim().split(/\s+/)[0];
      b = { key, label: original || key, rows: 0 };
      brands.set(key, b);
    }
    b.rows += 1;
  });

  const picker = document.getElementById('orderBrandPicker');
  if (picker) {
    picker.style.display = brands.size ? '' : 'none';
    if (!brands.size) picker.open = false;
  }

  optionsBox.textContent = '';
  brands.forEach(b => {
    const label = document.createElement('label');
    label.className = 'order-brand-option';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !orderBrandDeselected.has(b.key);
    cb.onchange = () => {
      if (cb.checked) orderBrandDeselected.delete(b.key);
      else orderBrandDeselected.add(b.key);
      updateOrderBrandSummary();
      renderOrderPivotTable();
    };
    const name = document.createElement('span');
    name.textContent = b.label;
    name.title = b.label;
    const n = document.createElement('small');
    n.textContent = b.rows.toLocaleString();
    label.append(cb, name, n);
    optionsBox.append(label);
  });
  updateOrderBrandSummary();
}

function updateOrderBrandSummary() {
  const countEl = document.getElementById('orderBrandCount');
  const copyBtn = document.getElementById('orderPivotCopyAllBtn');
  if (!countEl || !copyBtn) return;
  const rows = Array.isArray(orderPivotRows) ? orderPivotRows : [];
  const keys = new Set(rows.map(r => r?.groupName));
  const selectedKeys = [...keys].filter(k => !orderBrandDeselected.has(k));
  const selectedRows = rows.filter(r => !orderBrandDeselected.has(r?.groupName)).length;

  if (selectedKeys.length === keys.size) {
    countEl.textContent = 'ทั้งหมด';
    copyBtn.textContent = '📋 คัดลอกทั้งหมด';
  } else {
    countEl.textContent = `เลือก ${selectedKeys.length}/${keys.size}`;
    copyBtn.textContent = `📋 คัดลอกที่เลือก (${selectedRows.toLocaleString()})`;
  }
}

(function wireOrderBrandPicker() {
  const setAll = (selected) => {
    orderBrandDeselected.clear();
    if (!selected) (orderPivotRows || []).forEach(r => orderBrandDeselected.add(r?.groupName));
    renderOrderBrandPicker();
    renderOrderPivotTable();
  };
  const allBtn = document.getElementById('orderBrandAll');
  const noneBtn = document.getElementById('orderBrandNone');
  if (allBtn) allBtn.onclick = () => setAll(true);
  if (noneBtn) noneBtn.onclick = () => setAll(false);
})();

function formatPivotNumber(n) {
  return Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, {maximumFractionDigits: 2});
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wordRun(text, {bold=false, size=22, align=null} = {}) {
  const alignXml = align ? `<w:jc w:val="${align}"/>` : '';
  return `<w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold ? '<w:b/><w:bCs/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
}

function wordParagraph(text, opts={}) {
  const align = opts.align || 'left';
  const size = opts.size || 22;
  const bold = !!opts.bold;
  return `<w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="${opts.after ?? 0}" w:line="${opts.line || 240}"/></w:pPr>${wordRun(text,{bold,size})}</w:p>`;
}

function wordCell(text, opts={}) {
  const size = opts.size || 20;
  const bold = !!opts.bold;
  const align = opts.align || 'left';
  const shade = opts.shade ? `<w:shd w:fill="${opts.shade}"/>` : '';
  return `<w:tc><w:tcPr>${shade}<w:tcMar><w:top w:w="45" w:type="dxa"/><w:left w:w="70" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="70" w:type="dxa"/></w:tcMar></w:tcPr><w:p><w:pPr><w:jc w:val="${align}"/><w:spacing w:before="0" w:after="0" w:line="280"/></w:pPr>${wordRun(text,{bold,size})}</w:p></w:tc>`;
}

function wordTableRow(cells, header=false) {
  return `<w:tr>${header ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.join('')}</w:tr>`;
}

function downloadOrderWord() {
  if (!orderRows.length) {
    alert('ยังไม่มีรายการ ORDER');
    return;
  }

  // ถ้ายังไม่มี Pivot ให้สร้างอัตโนมัติก่อนดาวน์โหลด
  if (!orderPivotRows.length) {
    try { buildOrderPivot(); } catch (e) {
      console.error('ORDER Pivot error:', e);
    }
  }

  if (!orderPivotRows.length) {
    alert('ยังไม่มีข้อมูลสำหรับสร้าง Word');
    return;
  }

  if (!window.JSZip) {
    alert('ไม่พบไลบรารีสร้าง Word (JSZip) กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
    return;
  }

  const sortedPivotRows = [...orderPivotRows].sort(compareOrderPivotRows);
  let bodyXml = '';
  let previousGroup = null;

  // ตั้งตำแหน่งจำนวนให้ชิด SKU มากขึ้น และเว้นหลังแต่ละบรรทัด 2pt
  const tabXml = '<w:tabs><w:tab w:val="right" w:pos="3900"/></w:tabs>';

  sortedPivotRows.forEach((r) => {
    const group = normalizeOrderGroupName(r?.groupName);

    // เว้น 3 บรรทัดเมื่อเปลี่ยนกลุ่ม เหมือนรูปแบบเดิม
    if (previousGroup !== null && group !== previousGroup) {
      bodyXml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr></w:p>';
      bodyXml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr></w:p>';
      bodyXml += '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240"/></w:pPr></w:p>';
    }

    const sku = xmlEscape(r?.sku ?? '');
    const qty = xmlEscape(formatPivotNumber(r?.qty ?? 0));

    bodyXml += `<w:p>
      <w:pPr>
        ${tabXml}
        <w:spacing w:before="0" w:after="40" w:line="260"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>
          <w:sz w:val="20"/><w:szCs w:val="20"/>
        </w:rPr>
        <w:t xml:space="preserve">${sku}</w:t>
      </w:r>
      <w:r><w:tab/></w:r>
      <w:r>
        <w:rPr>
          <w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>
          <w:sz w:val="20"/><w:szCs w:val="20"/>
        </w:rPr>
        <w:t xml:space="preserve">${qty}</w:t>
      </w:r>
    </w:p>`;

    previousGroup = group;
  });

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1080" w:bottom="1440" w:left="1080" w:header="360" w:footer="360" w:gutter="0"/>
      <w:cols w:num="2" w:space="720"/>
      <w:docGrid w:linePitch="260"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>
      <w:sz w:val="20"/><w:szCs w:val="20"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="260"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/></w:rPr>
  </w:style>
</w:styles>`;

  const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:compat/>
</w:settings>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
</Relationships>`;

  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypesXml);
  zip.folder('_rels').file('.rels', rootRelsXml);
  const wordFolder = zip.folder('word');
  wordFolder.file('document.xml', documentXml);
  wordFolder.file('styles.xml', stylesXml);
  wordFolder.file('settings.xml', settingsXml);
  wordFolder.folder('_rels').file('document.xml.rels', documentRelsXml);

  const filename = `ORDER_Pivot_${new Date().toISOString().slice(0,10)}.docx`;
  const oldText = orderDownloadBtn.textContent;
  orderDownloadBtn.disabled = true;
  orderDownloadBtn.textContent = '⏳ กำลังสร้าง Word...';

  zip.generateAsync({type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'})
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        a.remove();
        URL.revokeObjectURL(url);
      }, 1000);

      if (typeof window.workHistoryLog === 'function') {
        window.workHistoryLog('download', 'orderTool', 'ดาวน์โหลด Word ข้อมูล Pivot');
      }
    })
    .catch((e) => {
      console.error('ORDER Word error:', e);
      alert('สร้างไฟล์ Word ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    })
    .finally(() => {
      orderDownloadBtn.disabled = false;
      orderDownloadBtn.textContent = oldText;
    });
}

function printOrderPDF() {
  if (!orderRows.length) {
    alert('ยังไม่มีรายการ ORDER');
    return;
  }

  if (!orderPivotRows.length) {
    try { buildOrderPivot(); } catch (e) { console.error(e); }
  }
  if (!orderPivotRows.length) {
    alert('ยังไม่มีข้อมูลสำหรับสร้าง PDF');
    return;
  }

  if (typeof window.html2pdf !== 'function') {
    alert('ไม่พบไลบรารีสร้าง PDF กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่อีกครั้ง');
    return;
  }

  const sortedPivotRows = [...orderPivotRows].sort(compareOrderPivotRows);

  function escHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let previousGroup = null;
  let itemsHtml = '';

  sortedPivotRows.forEach((r) => {
    const group = normalizeOrderGroupName(r?.groupName);
    if (previousGroup !== null && group !== previousGroup) {
      itemsHtml += '<div class="group-spacer" aria-hidden="true"></div>';
    }
    itemsHtml += `
      <div class="order-item">
        <span class="sku">${escHtml(r?.sku)}</span>
        <span class="qty">${escHtml(formatPivotNumber(r?.qty ?? 0))}</span>
      </div>`;
    previousGroup = group;
  });

  // สร้างพื้นที่สำหรับ PDF โดยเฉพาะ ไม่เปิด Popup และไม่เรียก window.print()
  const pdfRoot = document.createElement('div');
  pdfRoot.id = '__orderPdfRoot';
  pdfRoot.innerHTML = `
    <div class="order-pdf-sheet">
      <div class="print-head">
        <strong>ใบรายการสินค้า (Order Picking)</strong>
        <span>สร้าง PDF เมื่อ ${escHtml(new Date().toLocaleString('th-TH'))}</span>
      </div>
      <div class="print-grid">${itemsHtml}</div>
    </div>`;

  const pdfStyle = document.createElement('style');
  pdfStyle.id = '__orderPdfStyle';
  pdfStyle.textContent = `
    #__orderPdfRoot {
      position: fixed;
      left: -100000px;
      top: 0;
      width: 210mm;
      background: #fff;
      color: #111;
      z-index: -1;
      font-family: Tahoma, "Noto Sans Thai", sans-serif;
      font-size: 10pt;
      line-height: 1.35;
    }
    #__orderPdfRoot .order-pdf-sheet {
      width: 210mm;
      min-height: 297mm;
      padding: 14mm;
      background: #fff;
    }
    #__orderPdfRoot .print-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin: 0 0 4mm;
      padding-bottom: 2mm;
      border-bottom: 1px solid #bbb;
      font-size: 9pt;
    }
    #__orderPdfRoot .print-head strong { font-size: 12pt; }
    #__orderPdfRoot .print-grid {
      column-count: 2;
      column-gap: 10mm;
      column-fill: auto;
    }
    #__orderPdfRoot .order-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      column-gap: 5mm;
      align-items: baseline;
      width: 100%;
      min-height: 5.2mm;
      padding: 0.7mm 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    #__orderPdfRoot .sku {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #__orderPdfRoot .qty {
      min-width: 14mm;
      text-align: right;
      white-space: nowrap;
    }
    #__orderPdfRoot .group-spacer {
      height: 7mm;
      break-inside: avoid;
      page-break-inside: avoid;
    }
  `;

  document.head.appendChild(pdfStyle);
  document.body.appendChild(pdfRoot);

  // รอให้ฟอนต์/DOM พร้อมก่อนแปลงเป็น PDF
  const filename = `ORDER_Pivot_${new Date().toISOString().slice(0,10)}.pdf`;
  const options = {
    margin: 0,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false
    },
    jsPDF: {
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true
    },
    pagebreak: {
      mode: ['css', 'legacy']
    }
  };

  orderDownloadBtn.disabled = true;
  const oldText = orderDownloadBtn.textContent;
  orderDownloadBtn.textContent = '⏳ กำลังสร้าง PDF...';

  Promise.resolve(document.fonts?.ready)
    .then(() => new Promise(resolve => setTimeout(resolve, 150)))
    .then(() => html2pdf().set(options).from(pdfRoot).save())
    .then(() => {
      if (typeof window.workHistoryLog === 'function') {
        window.workHistoryLog('download', 'orderTool', 'ดาวน์โหลด PDF ข้อมูล Pivot');
      }
    })
    .catch((e) => {
      console.error('ORDER PDF error:', e);
      alert('สร้าง PDF ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    })
    .finally(() => {
      try { pdfRoot.remove(); } catch (_) {}
      try { pdfStyle.remove(); } catch (_) {}
      orderDownloadBtn.disabled = false;
      orderDownloadBtn.textContent = oldText;
    });
}

// จัดหน้าใบปริ้น: คืนค่าเป็นคอลัมน์ (ทีละ 2 คอลัมน์ = 1 หน้า) ของรายการ Pivot และช่องว่างระหว่างกลุ่ม
// ใช้ร่วมกันระหว่างการปริ้นและหน้า "ตรวจใบปริ้น" เพื่อให้ลำดับ/การแบ่งหน้าตรงกันเสมอ
const ORDER_SHEET_CONTENT_H = 246.2;
const ORDER_SHEET_ROW_H = 5.32;
// เว้นระหว่างกลุ่ม 3 บรรทัดว่าง (บรรทัดละ 4.26 มม.) ตามไฟล์ Word
const ORDER_SHEET_SPACER_H = 4.26 * 3;

function layoutOrderSheetColumns(rows = orderPivotRows) {
  const columns = [[]];
  let used = 0;
  let previousGroup = null;
  const pushColumn = () => { columns.push([]); used = 0; };
  [...rows].sort(compareOrderPivotRows).forEach((r) => {
    const group = normalizeOrderGroupName(r?.groupName);
    if (previousGroup !== null && group !== previousGroup && used > 0) {
      if (used + ORDER_SHEET_SPACER_H + ORDER_SHEET_ROW_H > ORDER_SHEET_CONTENT_H) pushColumn();
      else { columns[columns.length - 1].push({ spacer: true }); used += ORDER_SHEET_SPACER_H; }
    }
    if (used + ORDER_SHEET_ROW_H > ORDER_SHEET_CONTENT_H) pushColumn();
    columns[columns.length - 1].push({ row: r });
    used += ORDER_SHEET_ROW_H;
    previousGroup = group;
  });
  return columns;
}

// เลย์เอาต์เดียวกับไฟล์ Word: A4, ขอบ 25.4/19.05 มม., 2 คอลัมน์ (ช่องว่าง 12.7 มม.),
// Tahoma 10pt, ตัวเลขจำนวนชิดขวาที่ 68.8 มม. จากขอบซ้ายของคอลัมน์ ไม่มีหัว/ท้ายกระดาษ
// (ตั้ง @page margin เป็น 0 เพื่อไม่ให้เบราว์เซอร์พิมพ์วันที่/ชื่อไฟล์/เลขหน้า แล้วจัดหน้าเอง)
function orderSheetCss(scope) {
  const s = scope ? scope + ' ' : '';
  return `
    ${s}.page { width: 210mm; height: 296mm; padding: 25.4mm 19.05mm 24.4mm; display: grid; grid-template-columns: 79.6mm 79.6mm; column-gap: 12.7mm; overflow: hidden; page-break-after: always; break-after: page; }
    ${s}.page:last-child { page-break-after: auto; break-after: auto; }
    ${s}.row { display: flex; justify-content: space-between; align-items: center; gap: 3mm; width: 68.8mm; min-width: 68.8mm; height: ${ORDER_SHEET_ROW_H}mm; line-height: 1; white-space: nowrap; }
    ${s}.row .qty { text-align: right; }
    ${s}.spacer { height: ${ORDER_SHEET_SPACER_H}mm; }`;
}

function buildOrderSheetPagesHtml(rows = orderPivotRows) {
  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const columns = layoutOrderSheetColumns(rows).map(col => col.map(e => e.spacer
    ? '<div class="spacer"></div>'
    : `<div class="row"><span>${esc(e.row?.sku)}</span><span class="qty">${esc(formatPivotNumber(e.row?.qty ?? 0))}</span></div>`));
  let pagesHtml = '';
  for (let i = 0; i < columns.length; i += 2) {
    pagesHtml += `<section class="page"><div class="col">${columns[i].join('')}</div><div class="col">${(columns[i + 1] || []).join('')}</div></section>`;
  }
  return pagesHtml;
}

function printOrderSheet() {
  if (!orderRows.length) {
    alert('ยังไม่มีรายการ ORDER');
    return;
  }
  if (!orderPivotRows.length) {
    try { buildOrderPivot(); } catch (e) { console.error(e); }
  }
  if (!orderPivotRows.length) {
    alert('ยังไม่มีข้อมูลสำหรับปริ้น');
    return;
  }

  const pagesHtml = buildOrderSheetPagesHtml();

  const title = `ORDER_Pivot_${new Date().toISOString().slice(0, 10)}`;
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${title}</title><style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; }
    body { color: #000; font-family: Tahoma, "Noto Sans Thai", sans-serif; font-size: 10pt; }
    ${orderSheetCss('')}
  </style></head><body>${pagesHtml}</body></html>`;

  // เก็บรายการที่ปริ้นจริง + ไฟล์ PDF ไว้ในเว็บ (ใช้ต่อในหน้า "ตรวจใบปริ้น")
  if (window.SavedPrints && typeof window.SavedPrints.saveFromPrint === 'function') {
    try {
      window.SavedPrints.saveFromPrint({
        rows: [...orderPivotRows].sort(compareOrderPivotRows).map(r => ({ sku: r.sku, qty: r.qty, groupName: r.groupName, merchantNames: r.merchantNames || [] })),
        pagesHtml,
        css: orderSheetCss('#__pdfSnap'),
        title
      });
    } catch (e) { console.error('save print error:', e); }
  }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
  document.body.appendChild(frame);

  const cleanup = () => { try { frame.remove(); } catch (_) {} };
  const win = frame.contentWindow;
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.addEventListener('afterprint', cleanup);
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch (e) {
      console.error('ORDER print error:', e);
      alert('เปิดหน้าต่างปริ้นไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      cleanup();
    }
  }, 250);
  setTimeout(cleanup, 10 * 60 * 1000);
}

orderDownloadBtn.onclick = printOrderSheet;

orderClearBtn.onclick = () => {
  orderBrandDeselected.clear();
  orderTrackingBrandDeselected.clear();
  orderWorkbook = null;
  orderRows = [];
  orderHeaders = [];
  orderFilteredRows = [];
  orderFiltersState = [];
  orderPivotRows = [];
  orderInput.value = "";
  document.getElementById("orderTool").classList.remove("has-file");

  document.getElementById("orderFileName").textContent = "";
  document.getElementById("orderFileCount").textContent = "0";
  document.getElementById("orderRowCount").textContent = "0";
  document.getElementById("orderStatus").textContent = "ยังไม่ได้เลือกไฟล์ ORDER";
  document.getElementById("orderPreview").textContent = "ยังไม่มีข้อมูล";
  document.getElementById("orderBar").style.width = "0%";
  orderFilterSummary.textContent = "ยังไม่มีข้อมูล";
  document.getElementById("orderTrackingCopy").style.display = "none";
  document.getElementById("orderPivotWrap").style.display = "none";
  document.getElementById("orderPivotPreview").innerHTML = "";
  document.getElementById("orderSummaryExtra").style.display = "none";
  document.getElementById("orderSummaryRows").textContent = "0";
  document.getElementById("orderSummarySku").textContent = "0";
  document.getElementById("orderSummaryQty").textContent = "0";
  document.getElementById("orderSummaryMissing").textContent = "0";
  document.getElementById("orderStockCheck").style.display = "none";
  document.getElementById("orderStockCheck").innerHTML = "";
  orderFiltersBox.innerHTML = '<div class="empty">กรุณาเลือกไฟล์ ORDER ก่อน</div>';
  renderSelectedTrackingCopy();
  renderOrderBrandPicker();

  orderDownloadBtn.disabled = true;
  orderPivotExcelDownloadBtn.disabled = true;
  if (typeof resetBeforeOrderTable === "function") resetBeforeOrderTable();
};

function renderOrderPreview(rows) {
  const box = document.getElementById("orderPreview");

  if (!rows.length) {
    box.innerHTML = '<div class="empty">ไม่มีข้อมูล</div>';
    return;
  }

  let h = "<table><thead><tr>";
  rows[0].forEach(x => h += "<th>" + escapeHtml(x) + "</th>");
  h += "</tr></thead><tbody>";

  rows.slice(1).forEach(r => {
    h += "<tr>";
    rows[0].forEach((_, i) => {
      h += "<td>" + escapeHtml(r[i] ?? "") + "</td>";
    });
    h += "</tr>";
  });

  h += "</tbody></table>";
  box.innerHTML = h;
}

/* ===== Original inline script 6 ===== */
function toggleOrderFilters(){
  const panel=document.getElementById('orderFilterPanel');
  if(!panel)return;
  panel.classList.toggle('collapsed');
  const b=document.getElementById('orderFilterToggle');
  if(b)b.textContent=panel.classList.contains('collapsed')?'เปิดตัวกรอง ▼':'พับเก็บ ▲';
}

/* ===== Original inline script 7 ===== */
(() => {
  const $ = (s, r=document) => r.querySelector(s);

  // Ambient particle layer
  const canvas = document.createElement('canvas');
  canvas.id = 'fxParticles';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let dots = [];
  function resizeFX(){
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth*dpr; canvas.height = innerHeight*dpr;
    canvas.style.width = innerWidth+'px'; canvas.style.height = innerHeight+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    const count = Math.min(75, Math.max(28, Math.floor(innerWidth/20)));
    dots = Array.from({length:count},()=>({
      x:Math.random()*innerWidth,y:Math.random()*innerHeight,
      r:Math.random()*1.5+.4,vx:(Math.random()-.5)*.18,vy:(Math.random()-.5)*.18,
      a:Math.random()*.45+.12
    }));
  }
  function drawFX(){
    ctx.clearRect(0,0,innerWidth,innerHeight);
    for(const p of dots){
      p.x+=p.vx;p.y+=p.vy;
      if(p.x<0)p.x=innerWidth;if(p.x>innerWidth)p.x=0;
      if(p.y<0)p.y=innerHeight;if(p.y>innerHeight)p.y=0;
      ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=`rgba(56,217,255,${p.a})`;ctx.fill();
    }
    requestAnimationFrame(drawFX);
  }
  addEventListener('resize',resizeFX,{passive:true}); resizeFX(); drawFX();

  // Header status + clock
  const top = $('.top');
  if(top && !$('.fx-system')){
    const box=document.createElement('div');
    box.className='fx-system';
    box.innerHTML='<span class="fx-dot"></span><b>พร้อมใช้งาน</b><span class="fx-clock"></span>';
    top.appendChild(box);
  }
  const clock=$('.fx-clock');
  function tick(){
    if(clock) clock.textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
  }
  tick(); setInterval(tick,1000);

  // Toast helper
  const wrap=document.createElement('div'); wrap.className='fx-toast-wrap'; document.body.appendChild(wrap);
  window.fxToast=(message,type='')=>{
    const el=document.createElement('div'); el.className='fx-toast '+type; el.textContent=message;
    wrap.appendChild(el); setTimeout(()=>el.remove(),3000);
  };

  // Smooth tab entrance + toast
  document.querySelectorAll('.tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      setTimeout(()=>{
        const target=document.getElementById(tab.dataset.tool);
        if(target){target.classList.remove('fx-tab-enter');void target.offsetWidth;target.classList.add('fx-tab-enter');}
      },10);
      const name=(tab.textContent||'').trim();
      window.fxToast('เปิด '+name,'success');
    });
  });

  // Command palette: Ctrl/Cmd + K
  const modal=document.createElement('div');
  modal.className='fx-command';
  modal.innerHTML=`
    <div class="fx-command-box">
      <div class="fx-command-head">
        <input id="fxCommandInput" type="search" placeholder="🔎 ค้นหาคำสั่ง เช่น รับORDER, รวมไฟล์, ตรวจ Stock">
      </div>
      <div class="fx-command-list" id="fxCommandList"></div>
    </div>`;
  document.body.appendChild(modal);

  const commands=[
    ['📦 รวมไฟล์ ZIP','mergeTool'],
    ['🔎 ตรวจ ORDER กับ Stock','compareTool'],
    ['📥 รับORDER','orderTool'],
    ['🛒 ก่อนสั่ง','beforeOrderTool'],
    ['📋 สรุปงาน','summaryTool']
  ];
  const list=$('#fxCommandList',modal), input=$('#fxCommandInput',modal);
  function renderCommands(q=''){
    list.innerHTML='';
    commands.filter(x=>x[0].toLowerCase().includes(q.toLowerCase())).forEach(([label,id])=>{
      const b=document.createElement('button');b.className='fx-command-item';
      b.innerHTML=`<span>${label}</span><span class="fx-key">ENTER</span>`;
      b.onclick=()=>{const t=document.querySelector(`.tab[data-tool="${id}"]`);if(t)t.click();closePalette();};
      list.appendChild(b);
    });
  }
  function openPalette(){modal.classList.add('open');renderCommands();setTimeout(()=>input.focus(),30)}
  function closePalette(){modal.classList.remove('open')}
  input.addEventListener('input',()=>renderCommands(input.value));
  input.addEventListener('keydown',e=>{
    if(e.key==='Escape')closePalette();
    if(e.key==='Enter'){const first=list.querySelector('button');if(first)first.click();}
  });
  modal.addEventListener('click',e=>{if(e.target===modal)closePalette()});
  document.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();}
    if(e.key==='Escape')closePalette();
  });

  // Removed the floating Ctrl+K command hint from the UI.
})();

/* ===== Original inline script 8 ===== */
(() => {
  'use strict';
  // Everything in this block is namespaced with pd/fx and only adds UI.
  const STORAGE='order_pro_activity_v1';
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>Array.from(r.querySelectorAll(s));
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const now=()=>new Date();
  const fmt=d=>d.toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit',second:'2-digit'});

  let logs=[];
  try{logs=JSON.parse(localStorage.getItem(STORAGE)||'[]');if(!Array.isArray(logs))logs=[];}catch(_){logs=[];}
  const save=()=>{try{localStorage.setItem(STORAGE,JSON.stringify(logs.slice(-40)));}catch(_){}};
  function log(icon,text){
    logs.push({icon,text,time:now().toISOString()});logs=logs.slice(-40);save();
    renderLog();
  }

  const btn=document.createElement('button');
  btn.id='proDashBtn';
  btn.type='button';
  btn.innerHTML='<span class="pd-led"></span> 📊 Dashboard';
  document.body.appendChild(btn);

  const overlay=document.createElement('div');
  overlay.id='proDashOverlay';
  overlay.innerHTML=`
    <aside id="proDashPanel" aria-label="Dashboard">
      <div class="pd-head">
        <div><div class="pd-title">📊 ORDER Command Center</div><div class="pd-sub">ภาพรวมการทำงาน • ข้อมูลคำนวณจากหน้าเว็บปัจจุบัน</div></div>
        <button class="pd-close" type="button" aria-label="ปิด">×</button>
      </div>
      <div class="pd-grid">
        <div class="pd-card"><div class="pd-label">ตารางข้อมูล</div><div class="pd-value" id="pdTables">0</div></div>
        <div class="pd-card"><div class="pd-label">แถวข้อมูล</div><div class="pd-value" id="pdRows">0</div></div>
        <div class="pd-card"><div class="pd-label">SKU ไม่ซ้ำ</div><div class="pd-value" id="pdSku">—</div></div>
        <div class="pd-card"><div class="pd-label">แท็บที่เปิด</div><div class="pd-value" id="pdTab">—</div></div>
      </div>
      <div class="pd-section">
        <div class="pd-section-title">📈 จำนวนแถวตามแท็บ</div>
        <div class="pd-bars" id="pdBars"></div>
      </div>
      <div class="pd-section">
        <div class="pd-section-title">🕘 ประวัติการใช้งาน</div>
        <div class="pd-log" id="pdLog"></div>
        <div class="pd-actions">
          <button class="pd-action" id="pdRefresh" type="button">↻ รีเฟรชข้อมูล</button>
          <button class="pd-action" id="pdClear" type="button">ล้างประวัติ</button>
        </div>
      </div>
    </aside>`;
  document.body.appendChild(overlay);

  const tabName=t=>{
    const x=(t?.textContent||'').replace(/\s+/g,' ').trim();
    return x || 'ไม่ทราบชื่อ';
  };

  function tableStats(root){
    const tables=qa('table',root);
    let rows=0, skuSet=new Set();
    tables.forEach(t=>{
      const trs=qa('tbody tr',t);
      rows+=trs.length;
      const heads=qa('thead th',t).map(x=>x.textContent.trim().toLowerCase());
      const si=heads.findIndex(x=>/sku|รหัสสินค้า/.test(x));
      if(si>=0) trs.forEach(tr=>{const cells=qa('td',tr);const v=(cells[si]?.textContent||'').trim();if(v)skuSet.add(v);});
    });
    return {tables:tables.length,rows,sku:skuSet.size};
  }

  function allTabStats(){
    return qa('.tab[data-tool]').map(t=>{
      const id=t.getAttribute('data-tool');
      const root=document.getElementById(id);
      const st=root?tableStats(root):{rows:0,tables:0,sku:0};
      return {id,name:tabName(t),rows:st.rows};
    });
  }

  function activeTab(){
    const t=qa('.tab[data-tool]').find(x=>x.classList.contains('active') || x.getAttribute('aria-selected')==='true');
    return t?tabName(t):'—';
  }

  function renderBars(){
    const host=q('#pdBars'); if(!host)return;
    const data=allTabStats(); const max=Math.max(1,...data.map(x=>x.rows));
    host.innerHTML=data.map(x=>{
      const h=Math.max(4,Math.round((x.rows/max)*105));
      return `<div class="pd-bar-wrap" title="${esc(x.name)}: ${x.rows.toLocaleString()} แถว">
        <div class="pd-bar-num">${x.rows.toLocaleString()}</div>
        <div class="pd-bar" style="height:${h}px"></div>
        <div class="pd-bar-label">${esc(x.name)}</div>
      </div>`;
    }).join('');
  }

  function refresh(){
    const active=qa('.tab[data-tool]').find(t=>t.classList.contains('active') || t.getAttribute('aria-selected')==='true');
    const root=active?document.getElementById(active.dataset.tool):document.body;
    const st=tableStats(root||document.body);
    q('#pdTables').textContent=st.tables.toLocaleString();
    q('#pdRows').textContent=st.rows.toLocaleString();
    q('#pdSku').textContent=st.sku?st.sku.toLocaleString():'—';
    q('#pdTab').textContent=active?tabName(active):'—';
    renderBars();renderLog();
  }

  function renderLog(){
    const host=q('#pdLog');if(!host)return;
    if(!logs.length){host.innerHTML='<div class="pd-log-row"><div class="pd-log-icon">💡</div><div class="pd-log-main"><div class="pd-log-text">ยังไม่มีประวัติการใช้งาน</div><div class="pd-log-time">กิจกรรมจะถูกบันทึกเมื่อเริ่มใช้งาน</div></div></div>';return;}
    host.innerHTML=logs.slice().reverse().slice(0,15).map(x=>{
      let d;try{d=new Date(x.time)}catch(_){d=now()}
      return `<div class="pd-log-row"><div class="pd-log-icon">${esc(x.icon||'•')}</div><div class="pd-log-main"><div class="pd-log-text">${esc(x.text)}</div><div class="pd-log-time">${fmt(d)}</div></div></div>`;
    }).join('');
  }

  function lockButtonPosition(){btn.style.setProperty('position','fixed','important');btn.style.setProperty('top','auto','important');btn.style.setProperty('left',window.innerWidth<=600?'12px':'16px','important');btn.style.setProperty('right','auto','important');btn.style.setProperty('bottom',window.innerWidth<=600?'72px':'72px','important');btn.style.setProperty('transform','none','important');}
  function open(){lockButtonPosition();refresh();overlay.classList.add('open');lockButtonPosition();}
  function close(){overlay.classList.remove('open');lockButtonPosition();}
  window.addEventListener('resize',lockButtonPosition,{passive:true});
  window.addEventListener('scroll',lockButtonPosition,{passive:true});

  btn.addEventListener('click',open);
  q('.pd-close',overlay).addEventListener('click',close);
  overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay.classList.contains('open'))close();});

  q('#pdRefresh',overlay).addEventListener('click',()=>{refresh();if(window.fxToast)window.fxToast('รีเฟรช Dashboard แล้ว','success');});
  q('#pdClear',overlay).addEventListener('click',()=>{
    logs=[];save();renderLog();
    if(window.fxToast)window.fxToast('ล้างประวัติการใช้งานแล้ว','success');
  });

  // Observe tab changes and common user actions without replacing existing handlers.
  qa('.tab[data-tool]').forEach(t=>{
    t.addEventListener('click',()=>{
      log('📂','เปิด '+tabName(t));
      setTimeout(refresh,80);
    },{passive:true});
  });

  document.addEventListener('change',e=>{
    const el=e.target;
    if(el && (el.matches('input[type=file]') || el.matches('select'))){
      const name=el.files?.[0]?.name || el.getAttribute('aria-label') || 'ตัวเลือกข้อมูล';
      log('📥','มีการเปลี่ยนข้อมูล: '+name);
    }
    setTimeout(refresh,100);
  },{passive:true});

  document.addEventListener('click',e=>{
    const b=e.target.closest('button');
    if(!b || b===btn || b.closest('#proDashPanel'))return;
    const text=(b.textContent||'').replace(/\s+/g,' ').trim();
    if(!text)return;
    if(/ดาวน์โหลด|download|export/i.test(text)) log('⬇️','กด '+text.slice(0,60));
    else if(/รวมไฟล์|ตรวจ|รับorder|รับ order|สรุป/i.test(text)) log('⚡','กด '+text.slice(0,60));
    setTimeout(refresh,120);
  },{passive:true});

  // Keep stats current without observing the Dashboard's own DOM.
  // This avoids a MutationObserver -> refresh -> DOM change -> MutationObserver loop.
  let pdTimer=null;
  function startPdRefresh(){
    if(pdTimer) clearInterval(pdTimer);
    pdTimer=setInterval(()=>{if(overlay.classList.contains('open'))refresh();},1200);
  }
  startPdRefresh();
  setTimeout(refresh,250);
})();

/* ===== Original inline script 9 ===== */
/* ===== PRODUCTIVITY PACK — safe, isolated, no MutationObserver ===== */
(function(){
  'use strict';
  const THEME_KEY='order_ui_theme_v1';
  const $=(s,r=document)=>r.querySelector(s);
  const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));
  let lastSku='';
  let lastSkuCell=null;

  function toast(msg,type='success'){
    if(window.fxToast){ window.fxToast(msg,type); return; }
    let w=$('#ppToastWrap');
    if(!w){w=document.createElement('div');w.id='ppToastWrap';w.style='position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10030;display:flex;flex-direction:column;gap:7px;pointer-events:none';document.body.appendChild(w);}
    const x=document.createElement('div');x.textContent=msg;x.style='padding:10px 15px;border-radius:10px;background:rgba(7,20,33,.96);color:#eaf7ff;border:1px solid rgba(56,217,255,.25);font:700 12px system-ui;box-shadow:0 12px 30px rgba(0,0,0,.35)';w.appendChild(x);setTimeout(()=>x.remove(),1800);
  }
  function copyText(text){
    text=String(text||'').trim(); if(!text)return Promise.reject();
    if(navigator.clipboard&&window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise((resolve,reject)=>{const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');resolve()}catch(e){reject(e)}ta.remove();});
  }
  function themeName(t){return t==='light'?'☀️ Light':t==='midnight'?'🌌 Midnight':'🌙 Dark'}
  function applyTheme(t){
    t=['dark','midnight','light'].includes(t)?t:'dark';
    document.documentElement.setAttribute('data-prod-theme',t);
    localStorage.setItem(THEME_KEY,t);
    const b=$('#ppThemeBtn'); if(b)b.textContent=t==='light'?'☀️':t==='midnight'?'🌌':'🌙';
  }
  function isTyping(e){const t=e.target;return t && (t.matches('input,textarea,select,[contenteditable="true"]') || t.isContentEditable);}

  function findSkuColumns(table){
    const head=table.tHead?.rows?.[0] || table.querySelector('thead tr');
    if(!head)return [];
    return Array.from(head.cells).map((c,i)=>({i,text:(c.textContent||'').trim()})).filter(x=>/\bsku\b|รหัสสินค้า|รหัส\s*sku/i.test(x.text));
  }
  function scanSkuButtons(){
    $$('table').forEach(table=>{
      if(table.closest('#proDashPanel') || table.closest('#beforeOrderTool'))return;
      const cols=findSkuColumns(table); if(!cols.length)return;
      const rows=$$('tbody tr',table);
      rows.forEach(row=>cols.forEach(col=>{
        const cell=row.cells[col.i]; if(!cell)return;
        const raw=(cell.textContent||'').trim(); if(!raw||raw==='-')return;
        cell.classList.add('pp-sku-copy-cell');
        cell.title='คลิกเพื่อคัดลอก SKU';
      }));
    });
  }

  function injectUi(){
    if(!$('#ppToolbar')){
      const bar=document.createElement('div');bar.id='ppToolbar';bar.innerHTML='<button class="pp-float" id="ppThemeBtn" title="เปลี่ยน Theme">🌙</button><button class="pp-float" id="ppHelpBtn" title="แป้นพิมพ์ลัด">⌨️ ?</button>';
      document.body.appendChild(bar);
      const menu=document.createElement('div');menu.id='ppThemeMenu';menu.innerHTML='<button class="pp-theme-item" data-theme="dark">🌙 Dark</button><button class="pp-theme-item" data-theme="midnight">🌌 Midnight</button><button class="pp-theme-item" data-theme="light">☀️ Light</button>';document.body.appendChild(menu);
      const ov=document.createElement('div');ov.id='ppShortcutsOverlay';ov.innerHTML='<div id="ppShortcutsModal"><div class="pp-short-head"><div class="pp-short-title">⌨️ Keyboard Shortcuts</div><button class="pp-short-close" type="button">×</button></div><div class="pp-short-row"><span>ค้นหา / Command</span><span class="pp-key">Ctrl + K</span></div><div class="pp-short-row"><span>คัดลอก SKU ที่เลือก</span><span class="pp-key">Ctrl + C</span></div><div class="pp-short-row"><span>ไปหน้า รวมไฟล์ ZIP</span><span class="pp-key">Alt + 1</span></div><div class="pp-short-row"><span>ไปหน้า ตรวจ ORDER กับ Stock</span><span class="pp-key">Alt + 2</span></div><div class="pp-short-row"><span>ไปหน้า รับORDER</span><span class="pp-key">Alt + 3</span></div><div class="pp-short-row"><span>ไปหน้า สรุปงาน</span><span class="pp-key">Alt + 4</span></div><div class="pp-short-row"><span>เปิดหน้าต่างคีย์ลัด</span><span class="pp-key">?</span></div><div class="pp-short-row"><span>ปิดหน้าต่าง / เมนู</span><span class="pp-key">Esc</span></div></div>';document.body.appendChild(ov);
    }
    applyTheme(localStorage.getItem(THEME_KEY)||'dark');
  }

  function openShortcuts(){$('#ppShortcutsOverlay')?.classList.add('open')}
  function closeOverlays(){$('#ppShortcutsOverlay')?.classList.remove('open');$('#ppThemeMenu')?.classList.remove('open')}
  function goTab(n){const tab=$(`.tab[data-tool="${n}"]`);if(tab){tab.click();toast('เปิด '+(tab.textContent||'แท็บ').trim(),'success')}}

  document.addEventListener('click',e=>{
    const cell=e.target.closest('table td');
    if(cell){
      const table=cell.closest('table'),cols=table?findSkuColumns(table):[];
      const idx=cell.cellIndex;
      if(cols.some(c=>c.i===idx)){
        const v=(cell.textContent||'').trim();
        if(v && v!=='-'){
          lastSku=v;lastSkuCell=cell;$$('.pp-copy-active').forEach(x=>x.classList.remove('pp-copy-active'));cell.classList.add('pp-copy-active');
          copyText(lastSku).then(()=>toast('คัดลอก SKU แล้ว: '+lastSku,'success')).catch(()=>toast('ไม่สามารถคัดลอก SKU ได้','error'));
        }
      }
    }
    const themeBtn=e.target.closest('#ppThemeBtn');
    if(themeBtn){e.stopPropagation();$('#ppThemeMenu')?.classList.toggle('open');return;}
    const themeItem=e.target.closest('.pp-theme-item');
    if(themeItem){applyTheme(themeItem.dataset.theme);$('#ppThemeMenu')?.classList.remove('open');toast('เปลี่ยน Theme เป็น '+themeName(themeItem.dataset.theme),'success');return;}
    if(e.target.closest('#ppHelpBtn')){openShortcuts();return;}
    if(e.target.closest('.pp-short-close')||e.target=== $('#ppShortcutsOverlay')){closeOverlays();}
  },true);

  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'){closeOverlays();return;}
    if(isTyping(e))return;
    if(e.key==='?' && !e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();openShortcuts();return;}
    if(e.altKey&&!e.ctrlKey&&!e.metaKey){
      const map={'1':'mergeTool','2':'compareTool','3':'orderTool','4':'summaryTool'};
      if(map[e.key]){e.preventDefault();goTab(map[e.key]);return;}
    }
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='c' && lastSku && !window.getSelection()?.toString()){
      e.preventDefault();copyText(lastSku).then(()=>toast('คัดลอก SKU แล้ว: '+lastSku,'success')).catch(()=>{});
    }
  },true);

  // Do not replace the existing Ctrl+K command palette; only add the other shortcuts here.
  injectUi();
  scanSkuButtons();
  setInterval(scanSkuButtons,1400);
  document.addEventListener('click',e=>{if(!e.target.closest('#ppThemeMenu,#ppThemeBtn'))$('#ppThemeMenu')?.classList.remove('open')},{passive:true});
})();

/* Global click feedback: every click, anywhere on the page */
(function initGlobalClickFeedback(){
  let pressTarget = null;
  let pressTimer = null;

  function addRipple(x, y){
    // คลื่นวงแหวน 3 ชั้นซ้อนกัน ขยายออกและจางหาย
    [0, 110, 220].forEach((delay, i) => {
      const ring = document.createElement('span');
      ring.className = 'wave-ring';
      ring.style.left = x + 'px';
      ring.style.top = y + 'px';
      ring.style.setProperty('--d', delay + 'ms');
      ring.style.setProperty('--s', String(5 + i * 1.8));
      document.body.appendChild(ring);
      setTimeout(() => ring.remove(), 1400);
    });
  }

  function addFlash(x, y){
    const flash = document.createElement('span');
    flash.className = 'global-click-flash';
    flash.style.left = x + 'px';
    flash.style.top = y + 'px';
    document.body.appendChild(flash);
    requestAnimationFrame(() => flash.classList.add('is-active'));
    setTimeout(() => flash.remove(), 260);
  }

  function clearPressed(){
    if (!pressTarget) return;
    clearTimeout(pressTimer);
    const el = pressTarget;
    pressTimer = setTimeout(() => el.classList.remove('global-click-pressed'), 120);
    pressTarget = null;
  }

  document.addEventListener('pointerdown', (e) => {
    // Works for mouse, touch and pen, including clicks on buttons, inputs,
    // tables, empty areas, overlays and scrollable regions.
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // (เอาคลื่นวงแหวนและแสงวาบตอนคลิกออกแล้ว)

    // (เอาเอฟเฟกต์ย่อขนาดองค์ประกอบที่ถูกกดออกแล้ว เหลือแค่คลื่นและแสงวาบ)
  }, {passive:true});

  document.addEventListener('pointerup', clearPressed, {passive:true});
  document.addEventListener('pointercancel', clearPressed, {passive:true});
  document.addEventListener('blur', clearPressed, {passive:true});
})();


/* ===== BEFORE ORDER TOOL : เลือกรายการจาก ORDER Pivot เพื่อสร้างไฟล์พร้อมสั่ง ===== */
let beforeOrderSelectedRows = new Set();
let beforeOrderSourceRows = null;

// หน้านี้ใช้ข้อมูล Pivot จากหน้า รับORDER โดยตรง
// จึงแสดงเพียง SKU Merchant + จำนวน ตามไฟล์ Excel Pivot ที่ผู้ใช้ต้องการ
// beforeOrderRef = ใบปริ้นที่บันทึกไว้ที่ผู้ใช้เลือกใช้แทน Pivot ปัจจุบัน ({ id, rows })
let beforeOrderRef = null;
let beforeOrderPivotSeen = null;

function getBeforeOrderRows() {
  if (beforeOrderRef) return beforeOrderRef.rows;
  if (Array.isArray(orderPivotRows) && orderPivotRows.length) {
    return orderPivotRows;
  }
  return [];
}

// รายการใบปริ้นที่เคยปริ้น (แถวเดียวกับหน้าตรวจใบปริ้น) ให้เลือกมาใช้เป็นรายการก่อนสั่ง
async function renderBeforeOrderRef() {
  const box = document.getElementById('beforeOrderRef');
  const list = document.getElementById('beforeOrderRefList');
  const sp = window.SavedPrints;
  if (!box || !list || !sp) return;
  let prints = [];
  try { prints = (await sp.list()).filter(r => Array.isArray(r.rows) && r.rows.length); } catch (e) { prints = []; }
  box.hidden = prints.length === 0;
  if (beforeOrderRef && !prints.some(p => p.id === beforeOrderRef.id)) {
    beforeOrderRef = null;
    renderBeforeOrderTable();
    return;
  }

  const mk = (cls, text, title, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = cls; b.textContent = text;
    if (title) b.title = title;
    b.addEventListener('click', fn);
    return b;
  };
  const activeId = beforeOrderRef ? beforeOrderRef.id : 'current';
  list.textContent = '';
  const frag = document.createDocumentFragment();
  const addRow = (id, title, meta, rec) => {
    const row = document.createElement('div');
    row.className = 'saved-file' + (activeId === id ? ' is-current' : '');
    const info = document.createElement('div');
    info.className = 'saved-file-info';
    const strong = document.createElement('strong');
    strong.textContent = title;
    const span = document.createElement('span');
    span.textContent = meta;
    info.append(strong, span);
    const actions = document.createElement('div');
    actions.className = 'saved-file-actions';
    const use = mk('saved-file-open', activeId === id ? '✓ ใช้อยู่' : 'ใช้อ้างอิง', 'ใช้รายการนี้เป็นรายการก่อนสั่ง', () => {
      beforeOrderRef = rec ? { id: rec.id, rows: rec.rows } : null;
      renderBeforeOrderTable();
    });
    use.setAttribute('aria-pressed', String(activeId === id));
    actions.appendChild(use);
    if (rec) {
      const pdf = mk('saved-file-alt', '📄 PDF', 'เปิด PDF ในแท็บใหม่', () => sp.openPdf(rec));
      const dl = mk('saved-file-alt', '⬇', 'ดาวน์โหลด PDF', () => sp.downloadPdf(rec));
      pdf.disabled = dl.disabled = !rec.pdf;
      const del = mk('saved-file-del', 'ลบ', 'ลบใบปริ้นนี้ออกจากรายการ', async () => {
        try { await sp.remove(rec.id); } catch (e) { /* ไม่กระทบ */ }
      });
      actions.append(pdf, dl, del);
    }
    row.append(info, actions);
    frag.appendChild(row);
  };
  const cur = Array.isArray(orderPivotRows) ? orderPivotRows.length : 0;
  if (cur > 0) addRow('current', 'รายการจากหน้า รับORDER ตอนนี้', `${cur.toLocaleString()} รายการ`, null);
  prints.forEach(rec => addRow(rec.id, `ใบปริ้น ${sp.formatDate(rec.savedAt)}`,
    `${rec.count.toLocaleString()} รายการ · ${rec.pdf ? 'PDF ' + sp.formatSize(rec.pdf.size) : 'กำลังสร้าง PDF...'}`, rec));
  list.appendChild(frag);
}

document.addEventListener('savedprints:changed', () => renderBeforeOrderRef());
document.addEventListener('DOMContentLoaded', () => setTimeout(renderBeforeOrderRef, 300));
document.querySelectorAll('.tab[data-tool="beforeOrderTool"]').forEach(t => t.addEventListener('click', () => setTimeout(renderBeforeOrderRef, 0)));
(function () {
  const clr = document.getElementById('beforeOrderRefClear');
  if (!clr) return;
  clr.addEventListener('click', async () => {
    if (!confirm('ลบใบปริ้นที่บันทึกไว้ทั้งหมด (รวมไฟล์ PDF)?')) return;
    try { await window.SavedPrints.clear(); } catch (e) { /* ไม่กระทบ */ }
  });
})();

function resetBeforeOrderTable() {
  beforeOrderSelectedRows = new Set();
  beforeOrderSourceRows = null;
  beforeOrderRef = null;
  beforeOrderPivotSeen = null;
  setTimeout(renderBeforeOrderRef, 0);
  const card = document.querySelector('#beforeOrderTool .before-order-card');
  const count = document.getElementById('beforeOrderRowCount');
  const selected = document.getElementById('beforeOrderSelectedCount');
  const status = document.getElementById('beforeOrderStatus');
  const create = document.getElementById('beforeOrderCreate');
  const preview = document.getElementById('beforeOrderPreview');
  if (count) count.textContent = '0';
  if (selected) selected.textContent = '0';
  if (create) create.disabled = true;
  if (status) status.textContent = 'กรุณาเลือกไฟล์ที่หน้า 📥 รับORDER ก่อน';
  if (preview) preview.innerHTML = '<div class="empty">ยังไม่มีข้อมูล Pivot จากหน้า รับORDER</div>';

  // ถ้ายังไม่มี Pivot จากหน้า รับORDER ไม่ต้องแสดงหน้าก่อนสั่งว่าง ๆ
  if (card) card.style.display = 'none';
}

function updateBeforeOrderSelectionUI() {
  const rows = getBeforeOrderRows();
  const selectedCount = rows.reduce((n, row) => n + (beforeOrderSelectedRows.has(row) ? 1 : 0), 0);
  const selectedEl = document.getElementById('beforeOrderSelectedCount');
  const createBtn = document.getElementById('beforeOrderCreate');
  const status = document.getElementById('beforeOrderStatus');

  if (selectedEl) selectedEl.textContent = selectedCount.toLocaleString();
  if (createBtn) createBtn.disabled = selectedCount === 0;

  if (status) {
    if (!rows.length) {
      status.textContent = 'ยังไม่มีข้อมูล Pivot จากหน้า 📥 รับORDER';
    } else {
      status.textContent =
        `แสดง ${rows.length.toLocaleString()} รายการ | เลือกไว้ ${selectedCount.toLocaleString()} รายการ` +
        (beforeOrderRef ? ' | ใช้รายการจากใบปริ้นที่บันทึกไว้' : ' | ใช้ข้อมูล Pivot จากหน้า รับORDER โดยตรง');
    }
  }

  // ปุ่มเลือกทั้งหมด / ยกเลิกทั้งหมดให้กดได้ตลอด เพื่อให้ผู้ใช้สั่งซ้ำได้ทันที
  // แม้สถานะปัจจุบันจะเลือกครบหรือยกเลิกครบแล้วก็ตาม
  const selectAllBtn = document.getElementById('beforeOrderSelectAll');
  const clearAllBtn = document.getElementById('beforeOrderClearAll');
  if (selectAllBtn) selectAllBtn.disabled = rows.length === 0;
  if (clearAllBtn) clearAllBtn.disabled = rows.length === 0;
}

function renderBeforeOrderTable() {
  const box = document.getElementById('beforeOrderPreview');
  const countEl = document.getElementById('beforeOrderRowCount');
  if (!box || !countEl) return;

  // Pivot ใหม่จากหน้า รับORDER (โหลดไฟล์/กรอง) ให้กลับมาใช้ Pivot ปัจจุบัน
  if (beforeOrderRef && Array.isArray(orderPivotRows) && orderPivotRows.length && orderPivotRows !== beforeOrderPivotSeen && beforeOrderPivotSeen !== null) {
    beforeOrderRef = null;
  }
  beforeOrderPivotSeen = orderPivotRows;
  renderBeforeOrderRef();

  const rows = getBeforeOrderRows();

  // ถ้า Pivot เปลี่ยนจากการโหลดไฟล์/กรองข้อมูล ให้เลือกทุกแถวใหม่
  if (beforeOrderSourceRows !== rows) {
    beforeOrderSourceRows = rows;
    beforeOrderSelectedRows = new Set(rows);
  } else {
    const current = new Set(rows);
    beforeOrderSelectedRows = new Set(
      [...beforeOrderSelectedRows].filter(row => current.has(row))
    );
  }

  countEl.textContent = rows.length.toLocaleString();

  const card = document.querySelector('#beforeOrderTool .before-order-card');

  if (!rows.length) {
    box.innerHTML = '<div class="empty">ยังไม่มีข้อมูล Pivot จากหน้า 📥 รับORDER</div>';
    if (card) card.style.display = 'none';
    updateBeforeOrderSelectionUI();
    return;
  }

  // มีข้อมูล Pivot แล้วจึงค่อยแสดงหน้าก่อนสั่ง
  if (card) card.style.display = '';

  let h = '<table class="before-order-table"><thead><tr>';
  h += '<th class="before-order-check-col">เลือก</th>';
  h += '<th>SKU Merchant</th><th>จำนวน</th>';
  h += '</tr></thead><tbody>';

  rows.forEach((row, rowIndex) => {
    const checked = beforeOrderSelectedRows.has(row) ? ' checked' : '';
    const sku = row?.sku ?? '';
    const qtyValue = row?.qty ?? 0;
    const qty = Number.isFinite(Number(qtyValue)) ? Number(qtyValue) : 0;
    h += `<tr data-before-order-index="${rowIndex}">`;
    h += `<td class="before-order-check-col"><input type="checkbox" class="before-order-row-check"${checked} aria-label="เลือกแถวที่ ${rowIndex + 1}"></td>`;
    h += `<td>${escapeHtml(sku)}</td>`;
    h += `<td class="before-order-qty-cell"><input type="number" class="before-order-qty-input" value="${escapeHtml(String(qty))}" min="0" step="1" inputmode="numeric" aria-label="จำนวน ${escapeHtml(sku)}"></td>`;
    h += '</tr>';
  });

  h += '</tbody></table>';
  box.innerHTML = h;
  updateBeforeOrderSelectionUI();
}

function createBeforeOrderExcel() {
  const rows = getBeforeOrderRows();
  const selectedRows = rows.filter(row => beforeOrderSelectedRows.has(row));

  if (!selectedRows.length) {
    alert('กรุณาเลือกอย่างน้อย 1 แถวก่อนยืนยัน');
    return;
  }
  if (!window.XLSX) {
    alert('ไม่พบไลบรารี Excel (XLSX)');
    return;
  }

  // ยืนยันรายการแล้วสร้าง "ไฟล์ Excel Pivot" ในหน่วยความจำ
  // โดยไม่ต้องดาวน์โหลดลงเครื่อง จากนั้นส่งไฟล์นั้นไปเป็น "ไฟล์ที่ 1 — ORDER"
  // ของหน้า ตรวจ ORDER กับ Stock เพื่อทำขั้นตอนถัดไปทันที
  const pivotData = [
    ['SKU Merchant', 'จำนวน'],
    ...selectedRows.map(row => [row?.sku ?? '', row?.qty ?? 0])
  ];

  // ส่งชื่อยี่ห้อของรายการที่เลือกไปด้วย (ใบปริ้นเก่าที่ไม่มี merchantNames ใช้ชื่อกลุ่มแทน)
  // เพื่อให้ตัวเลือกยี่ห้อหน้าตรวจ Stock ใช้ได้ แม้รายการมาจากไฟล์ ORDER อื่นที่ไม่ได้เปิดอยู่
  window.scanBrandMap = new Map(selectedRows.map(row => [
    normalizeOrderSku(row?.sku),
    (row?.merchantNames && row.merchantNames.length) ? row.merchantNames : (row?.groupName ? [String(row.groupName).toUpperCase()] : [])
  ]));

  const ws = XLSX.utils.aoa_to_sheet(pivotData);
  ws['!cols'] = [
    { wch: Math.min(Math.max(14, ...selectedRows.map(r => String(r?.sku ?? '').length + 2)), 45) },
    { wch: Math.min(Math.max(10, ...selectedRows.map(r => String(r?.qty ?? '').length + 2)), 20) }
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Pivot');

  // สร้างไฟล์ Excel ในหน่วยความจำเพื่อส่งต่อไปยัง File 1
  const excelArray = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fileName =
    `ORDER_Pivot_พร้อมสั่ง_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_` +
    `${pad(now.getHours())}-${pad(now.getMinutes())}.xlsx`;
  const file = new File([excelArray], fileName, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });

  // ถ้าต้องการ ให้ช่อง input จริงมีไฟล์เดียวกันด้วย (รองรับเบราว์เซอร์ที่อนุญาต)
  const file1Input = document.getElementById('file1');
  if (file1Input && typeof DataTransfer !== 'undefined') {
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      file1Input.files = dt.files;
    } catch (e) {
      // ไม่กระทบการทำงานหลัก เพราะระบบจะส่ง File เข้า loadOrderCompareFile โดยตรง
    }
  }

  // ส่งไฟล์ที่ยืนยันเข้า "ไฟล์ที่ 1 — ORDER" ทันที
  loadOrderCompareFile(file).then(() => {
    const compareTool = document.getElementById('compareTool');
    const compareTab = document.querySelector('.tab[data-tool="compareTool"]');
    if (compareTool && compareTab) {
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      document.querySelectorAll('.tool').forEach(x => x.classList.remove('active'));
      compareTab.classList.add('active');
      compareTool.classList.add('active');
    }

    const status = document.getElementById('beforeOrderStatus');
    if (status) {
      status.textContent = `✅ ยืนยันแล้ว ${selectedRows.length.toLocaleString()} รายการ | สร้าง Excel Pivot และนำไปไว้ที่ 📥 ไฟล์ที่ 1 — ORDER แล้ว`;
    }

    if (typeof window.workHistoryLog === 'function') {
      window.workHistoryLog(
        'process',
        'beforeOrderTool',
        `ยืนยัน ${selectedRows.length.toLocaleString()} รายการ → สร้าง Excel Pivot และส่งเข้าไฟล์ที่ 1 — ORDER`,
        fileName
      );
    }

    // เลื่อนไปผลตรวจอัตโนมัติเฉพาะเมื่อกด "ยืนยันรายการพร้อมสั่ง"
    // การพิมพ์/วางข้อความในช่อง ORDER จะไม่ดึงหน้าจอลงไปเอง
    setTimeout(() => {
      const preview = document.getElementById('compareWebPreview');
      if (preview && preview.style.display !== 'none') {
        preview.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 120);
  }).catch(err => {
    console.error(err);
    alert('สร้างไฟล์พร้อมส่งต่อไม่สำเร็จ\n\n' + (err?.message || err));
  });
}

// คลิกตรงไหนของแถวก็ได้เพื่อสลับการเลือก (ยกเว้นช่องจำนวน/checkbox เอง)
document.addEventListener('click', event => {
  const row = event.target.closest('#beforeOrderPreview tbody tr[data-before-order-index]');
  if (!row) return;
  if (event.target.closest('.before-order-qty-input, .before-order-row-check, button, a, select, textarea')) return;

  const index = Number(row.dataset.beforeOrderIndex);
  const rows = getBeforeOrderRows();
  const item = rows[index];
  if (!item) return;

  const check = row.querySelector('.before-order-row-check');
  if (!check) return;
  check.checked = !check.checked;
  if (check.checked) beforeOrderSelectedRows.add(item);
  else beforeOrderSelectedRows.delete(item);
  updateBeforeOrderSelectionUI();
});

document.addEventListener('change', event => {
  const check = event.target.closest('#beforeOrderPreview .before-order-row-check');
  if (!check) return;

  const tr = check.closest('tr');
  const index = Number(tr?.dataset?.beforeOrderIndex);
  const rows = getBeforeOrderRows();
  const row = rows[index];
  if (!row) return;

  if (check.checked) beforeOrderSelectedRows.add(row);
  else beforeOrderSelectedRows.delete(row);

  updateBeforeOrderSelectionUI();
});

// ช่อง "จำนวน" ในหน้า ก่อนสั่ง แก้ไขได้โดยตรง
// ค่าที่แก้จะถูกนำไปใช้ตอนกด "ยืนยัน" สร้าง Excel และส่งเข้าไฟล์ที่ 1
// ใช้ input event เพื่อให้พิมพ์/ปรับตัวเลขได้ทันทีโดยไม่ต้องกดปุ่มบันทึกแยก
// และใช้ change เป็นตัวช่วยกรณีเบราว์เซอร์ส่งค่าหลังออกจากช่อง
function updateBeforeOrderQtyFromInput(input) {
  const tr = input.closest('tr');
  const index = Number(tr?.dataset?.beforeOrderIndex);
  const rows = getBeforeOrderRows();
  const row = rows[index];
  if (!row) return;

  let value = String(input.value ?? '').trim();
  if (value === '') {
    row.qty = 0;
    return;
  }

  let number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    number = 0;
    input.value = '0';
  }
  row.qty = number;
}

document.addEventListener('input', event => {
  const input = event.target.closest('#beforeOrderPreview .before-order-qty-input');
  if (!input) return;
  updateBeforeOrderQtyFromInput(input);
});

document.addEventListener('change', event => {
  const input = event.target.closest('#beforeOrderPreview .before-order-qty-input');
  if (!input) return;
  updateBeforeOrderQtyFromInput(input);
});

const beforeOrderSelectAllBtn = document.getElementById('beforeOrderSelectAll');
if (beforeOrderSelectAllBtn) {
  beforeOrderSelectAllBtn.onclick = () => {
    getBeforeOrderRows().forEach(row => beforeOrderSelectedRows.add(row));
    renderBeforeOrderTable();
    if (typeof window.workHistoryLog === 'function') {
      window.workHistoryLog('filter', 'beforeOrderTool', 'เลือกข้อมูล Pivot ทุกแถว');
    }
  };
}

const beforeOrderClearAllBtn = document.getElementById('beforeOrderClearAll');
if (beforeOrderClearAllBtn) {
  beforeOrderClearAllBtn.onclick = () => {
    beforeOrderSelectedRows.clear();
    renderBeforeOrderTable();
    if (typeof window.workHistoryLog === 'function') {
      window.workHistoryLog('filter', 'beforeOrderTool', 'ยกเลิกการเลือกข้อมูล Pivot ทุกแถว');
    }
  };
}

const beforeOrderCreateBtn = document.getElementById('beforeOrderCreate');
if (beforeOrderCreateBtn) {
  beforeOrderCreateBtn.onclick = createBeforeOrderExcel;
}

// เปิดแท็บ "ก่อนสั่ง" แล้วดึงข้อมูล Pivot ล่าสุดจากหน้า รับORDER ทันที
const beforeOrderTab = document.querySelector('.tab[data-tool="beforeOrderTool"]');
if (beforeOrderTab) {
  beforeOrderTab.addEventListener('click', () => {
    setTimeout(() => renderBeforeOrderTable(), 0);
  });
}

renderBeforeOrderTable();


/* ===== สวิตช์โหมดสี สว่าง / มืด (แถบด้านข้าง) ===== */
(function initThemeSwitch(){
  const KEY = 'order_ui_theme_v1';
  const root = document.documentElement;
  const buttons = [...document.querySelectorAll('.theme-opt')];
  if (!buttons.length) return;

  const current = () => (root.getAttribute('data-prod-theme') === 'light' ? 'light' : 'dark');
  const sync = () => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === current())));

  buttons.forEach(b => b.addEventListener('click', () => {
    const t = b.dataset.themeChoice === 'light' ? 'light' : 'dark';
    root.setAttribute('data-prod-theme', t);
    try { localStorage.setItem(KEY, t); } catch (_) {}
    sync();
  }));
  sync();
})();

/* ===== เอฟเฟกต์เมาส์: คลื่นหมึกในปุ่ม/แท็บ/กล่องต่างๆ + แสงตามเมาส์ ===== */
(function initPointerEffects(){
  const reduce = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const INK_SELECTOR = 'button, .tab, .drop, .beta-drop, .upload-area, summary, .value-item, .order-brand-option, .compare-copy-option, .tracking-box, .quick-status-item, .beta-stat';

  // 1) คลื่นหมึก (ripple) ขยายจากจุดที่กดภายในองค์ประกอบ
  document.addEventListener('pointerdown', (e) => {
    if (reduce.matches) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const host = target ? target.closest(INK_SELECTOR) : null;
    if (!host || host.disabled || host.getAttribute('aria-disabled') === 'true') return;

    const rect = host.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    if (cs.overflow === 'visible') host.style.setProperty('overflow', 'hidden', 'important');

    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    const radius = Math.hypot(Math.max(x, rect.width - x), Math.max(y, rect.height - y));
    const ink = document.createElement('span');
    ink.className = 'ink-wave';
    ink.style.width = ink.style.height = (radius * 2) + 'px';
    ink.style.left = (x - radius) + 'px';
    ink.style.top = (y - radius) + 'px';
    host.appendChild(ink);
    setTimeout(() => ink.remove(), 800);
  }, { passive: true });

  // 2) แสงนุ่มๆ ตามเมาส์ (เฉพาะอุปกรณ์ที่มีเมาส์)
  if (!window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const glow = document.createElement('div');
  glow.id = 'fxCursorGlow';
  glow.setAttribute('aria-hidden', 'true');
  document.body.appendChild(glow);

  let tx = -1000, ty = -1000, cx = -1000, cy = -1000, raf = 0;
  const loop = () => {
    cx += (tx - cx) * 0.16; cy += (ty - cy) * 0.16;
    glow.style.transform = `translate3d(${cx}px,${cy}px,0)`;
    raf = (Math.abs(tx - cx) > 0.5 || Math.abs(ty - cy) > 0.5) ? requestAnimationFrame(loop) : 0;
  };
  document.addEventListener('pointermove', (e) => {
    if (reduce.matches || e.pointerType === 'touch') return;
    if (!glow.classList.contains('on')) { cx = tx = e.clientX; cy = ty = e.clientY; glow.classList.add('on'); }
    tx = e.clientX; ty = e.clientY;
    if (!raf) raf = requestAnimationFrame(loop);
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => glow.classList.remove('on'));
})();
/* ตัวเลือก (ยี่ห้อ/ตำแหน่ง) ทุกหน้า: กดที่ไหนก็ได้นอกกล่อง หรือกด Esc เพื่อพับเก็บ */
(function () {
  const SEL = 'details.order-brand-picker, details.compare-copy-picker';
  function closeOthers(keep) {
    document.querySelectorAll(SEL).forEach(d => { if (d.open && d !== keep) d.open = false; });
  }
  document.addEventListener('pointerdown', e => {
    closeOthers(e.target.closest ? e.target.closest(SEL) : null);
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOthers(null); });
  document.addEventListener('focusin', e => {
    const d = e.target.closest && e.target.closest(SEL);
    if (!d) closeOthers(null);
  });
})();
/* รีเซ็ตหน้า รับORDER และ ตรวจใบปริ้น ทุก 00:00 (ไฟล์ที่เคยใช้ที่บันทึกไว้ยังอยู่) */
(function () {
  const dayKey = () => { const d = new Date(); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  let day = dayKey();
  setInterval(() => {
    const now = dayKey();
    if (now === day) return;
    day = now;
    ['orderClear', 'scanClear'].forEach(id => { const b = document.getElementById(id); if (b) b.click(); });
    if (typeof window.fxToast === 'function') window.fxToast('ข้ามวันแล้ว รีเซ็ตหน้า รับORDER และ ตรวจใบปริ้นให้อัตโนมัติ', '');
  }, 15000);
})();
/* เรียงลำดับตารางผลตรวจ (คลิกหัวคอลัมน์: น้อย→มาก, มาก→น้อย, กลับลำดับเดิม) */
(function () {
  const body = document.getElementById('compareWebPreviewBody');
  if (!body) return;
  const state = {}; // key = ชื่อตาราง -> { col, dir }
  let scheduled = false;
  const obs = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; applyAll(); }, 0);
  });

  const keyOf = wrap => {
    const holder = wrap.closest('[data-preview-table]');
    return holder ? holder.getAttribute('data-preview-table') : 'other:' + Array.from(wrap.querySelectorAll('th')).map(t => t.textContent).join('|');
  };
  const num = s => { const t = String(s).replace(/,/g, '').trim(); return t !== '' && /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : null; };
  const cmp = (a, b) => {
    const x = num(a), y = num(b);
    if (x !== null && y !== null) return x - y;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  };

  function apply(wrap) {
    const table = wrap.querySelector('table');
    if (!table) return;
    const tb = table.tBodies[0];
    const rows = Array.from(tb.rows);
    rows.forEach((r, i) => { if (r.dataset.i === undefined) r.dataset.i = String(i); });
    const st = state[keyOf(wrap)];
    const ths = Array.from(table.tHead.rows[0].cells);
    ths.forEach((th, i) => {
      th.classList.add('sortable');
      if (st && st.col === i) th.setAttribute('data-sort', st.dir > 0 ? 'asc' : 'desc'); else th.removeAttribute('data-sort');
    });
    rows.sort((a, b) => {
      if (!st) return a.dataset.i - b.dataset.i;
      const r = cmp(a.cells[st.col].textContent, b.cells[st.col].textContent) * st.dir;
      return r || a.dataset.i - b.dataset.i;
    });
    // เรียงเฉพาะเมื่อลำดับต่างจากเดิม และหยุดสังเกตระหว่างเรียง กันวนซ้ำไม่รู้จบ
    if (rows.every((r, i) => tb.rows[i] === r)) return;
    obs.disconnect();
    rows.forEach(r => tb.appendChild(r));
    obs.observe(body, { childList: true, subtree: true });
  }

  function applyAll() { body.querySelectorAll('.compare-preview-table-wrap').forEach(apply); }

  body.addEventListener('click', e => {
    const th = e.target.closest && e.target.closest('.compare-preview-table thead th');
    if (!th) return;
    const wrap = th.closest('.compare-preview-table-wrap');
    const key = keyOf(wrap);
    const col = th.cellIndex;
    const cur = state[key];
    if (!cur || cur.col !== col) state[key] = { col, dir: 1 };
    else if (cur.dir === 1) state[key] = { col, dir: -1 };
    else delete state[key];
    apply(wrap);
  });

  obs.observe(body, { childList: true, subtree: true });
  applyAll();
})();