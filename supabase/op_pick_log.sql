-- ประวัติ SKU ที่ส่งออกใบย้ายสินค้า (ปุ่ม "ไฟล์ย้ายสินค้าแยกตำแหน่ง" / "นำเข้า BigSeller") ใช้ร่วมกันทุกเครื่อง
-- หน้า ตรวจ ORDER กับ Stock ใช้ทำสีแถวที่ SKU เคยเบิกไปแล้ว "วันนี้" (เหลือง 1 ครั้ง · ส้ม 2 · แดง 3+)
-- รีเซ็ตทุกเที่ยงคืนตามเวลาไทย: ข้อมูลของวันก่อนๆ ถูกลบตอนมีการบันทึกครั้งถัดไป
-- รันใน Supabase > SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่เสียหาย)

create table if not exists public.op_pick_log (
  id        bigint generated always as identity primary key,
  day       date        not null default ((now() at time zone 'Asia/Bangkok')::date),
  sku_key   text        not null,                 -- SKU แบบ normalize แล้ว (ใช้เทียบ)
  sku       text        not null,                 -- SKU ตามที่แสดง
  qty       numeric     not null default 0,       -- จำนวนที่ส่งออกในครั้งนั้น
  picked_at timestamptz not null default now()
);
create index if not exists op_pick_log_day_key on public.op_pick_log (day, sku_key);

-- หน้าเว็บเข้าถึงผ่านฟังก์ชันด้านล่างเท่านั้น ไม่ให้อ่าน/แก้/ลบตารางตรงๆ
alter table public.op_pick_log enable row level security;
revoke all on public.op_pick_log from anon, authenticated;

-- บันทึกการส่งออก 1 ครั้ง: p_rows = [{ "sku_key": "...", "sku": "...", "qty": 3 }, ...] (1 แถวต่อ SKU ต่อการส่งออก)
create or replace function public.op_pick_record(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows ต้องเป็นอาร์เรย์';
  end if;
  if jsonb_array_length(p_rows) > 3000 then
    raise exception 'ส่งมามากเกินไปในครั้งเดียว (สูงสุด 3000 แถว)';
  end if;

  delete from public.op_pick_log where day < v_today;   -- รีเซ็ตทุกเที่ยงคืน

  insert into public.op_pick_log (day, sku_key, sku, qty)
  select v_today, x.sku_key, coalesce(nullif(x.sku, ''), x.sku_key), coalesce(x.qty, 0)
  from jsonb_to_recordset(p_rows) as x(sku_key text, sku text, qty numeric)
  where coalesce(x.sku_key, '') <> '';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- สรุปของ "วันนี้" ต่อ SKU: n = จำนวนครั้งที่ส่งออก, qty = รวมกี่ชิ้น, last_at = เวลาล่าสุด
create or replace function public.op_pick_today()
returns table (sku_key text, sku text, n integer, qty numeric, last_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select l.sku_key, max(l.sku) as sku, count(*)::integer as n, sum(l.qty) as qty, max(l.picked_at) as last_at
  from public.op_pick_log l
  where l.day = (now() at time zone 'Asia/Bangkok')::date
  group by l.sku_key;
$$;

revoke all on function public.op_pick_record(jsonb) from public;
revoke all on function public.op_pick_today() from public;
grant execute on function public.op_pick_record(jsonb) to anon, authenticated;
grant execute on function public.op_pick_today() to anon, authenticated;
