-- ============================================================
-- Sunshine (Plan Order) — ทำให้ "สั่งเป้า" (op_com.qty) ลดจริงตามเคลื่อนไหว ไม่ใช่แค่คำนวณสดหน้าเว็บ
-- รันใน Supabase > SQL Editor (รันครั้งเดียว รันซ้ำได้ไม่เสียหาย) ต้องรัน op_setup.sql + op_append.sql มาก่อนแล้ว
--
-- แนวคิด: แยกเป้าออกเป็น 2 ค่าต่อแถว
--   base_qty = เป้าตั้งต้น (ที่อัปโหลด/บวกเพิ่มเข้ามา) ไม่เคยถูกหักเอง
--   qty      = เป้าที่เหลือจริง (คำนวณใหม่ทุกครั้งจาก base_qty หักด้วยเคลื่อนไหว) — คอลัมน์นี้คือค่าที่หน้าเว็บอ่าน
-- ฟังก์ชัน op_com_recalc() คำนวณ qty ใหม่ทั้งตารางจาก base_qty + op_stock_moves ปัจจุบัน (เรียกซ้ำได้ ไม่สะสมพลาด)
-- ถูกเรียกอัตโนมัติท้าย op_upload (ตอนอัปโหลด SI), op_append (ตอนอัปโหลดเป้าใหม่ทับ), op_com_increment (ตอนบวกเพิ่มเป้า)
--
-- สูตรหัก (เหมือนที่หน้าเว็บเคยคำนวณสด): เคลื่อนไหว (+) ตั้งแต่ 4 ขึ้นไป หรือเท่ากับเป้าตั้งต้นพอดี ถึงจะหักได้
-- ============================================================

-- ---------- 0) ฟังก์ชันแปลงข้อความเคลื่อนไหว (เช่น "+5", "-3") เป็นตัวเลขแบบปลอดภัย (พังแล้วคืน 0 ไม่ทำให้ recalc ล้ม) ----------
create or replace function public.op_num(p text) returns numeric
language plpgsql immutable as $$
declare v text;
begin
  v := regexp_replace(coalesce(p, ''), '[^0-9.-]', '', 'g');
  if v = '' or v = '-' or v = '.' or v = '-.' then return 0; end if;
  return v::numeric;
exception when others then
  return 0;
end;
$$;

-- ---------- 1) เพิ่มคอลัมน์ base_qty (เป้าตั้งต้น) ----------
alter table public.op_com add column if not exists base_qty numeric;

-- ---------- 2) รวมแถวซ้ำ sku เดิม (ถ้ามี) ให้เหลือ sku ละ 1 แถว ก่อนตั้ง unique constraint ----------
with dups as (
  select sku, sum(qty) as total_qty, min(id) as keep_id
  from public.op_com
  group by sku
  having count(*) > 1
)
update public.op_com c
set qty = d.total_qty
from dups d
where c.id = d.keep_id;

delete from public.op_com c
using (
  select sku, min(id) as keep_id
  from public.op_com
  group by sku
  having count(*) > 1
) d
where c.sku = d.sku and c.id <> d.keep_id;

-- ---------- 3) ตั้ง base_qty เริ่มต้น = qty ปัจจุบัน (เป้าที่เคยตั้งไว้ ถือเป็นเป้าตั้งต้น) ----------
update public.op_com set base_qty = qty where base_qty is null;
alter table public.op_com alter column base_qty set not null;
alter table public.op_com alter column base_qty set default 0;

-- ---------- 4) กันซ้ำ sku ต่อจากนี้ ----------
alter table public.op_com drop constraint if exists op_com_sku_unique;
alter table public.op_com add constraint op_com_sku_unique unique (sku);

-- ---------- 5) แถวใหม่ที่ไม่ได้ส่ง base_qty มา (เช่นอัปโหลดทับผ่าน op_append) ให้ตั้ง base_qty = qty อัตโนมัติ ----------
create or replace function public.op_com_fill_base() returns trigger
language plpgsql as $$
begin
  if new.base_qty is null then
    new.base_qty := new.qty;
  end if;
  return new;
end;
$$;

drop trigger if exists op_com_fill_base_trg on public.op_com;
create trigger op_com_fill_base_trg
before insert on public.op_com
for each row execute function public.op_com_fill_base();

-- ---------- 6) คำนวณ qty ใหม่ทั้งตารางจาก base_qty หักเคลื่อนไหวปัจจุบัน ----------
create or replace function public.op_com_recalc() returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  with moves as (
    select sku, sum(public.op_num(move)) as move_qty
    from public.op_stock_moves
    group by sku
  ),
  calc as (
    select c.id,
      greatest(0, c.base_qty - (
        case when coalesce(m.move_qty, 0) >= 4
               or (coalesce(m.move_qty, 0) > 0 and coalesce(m.move_qty, 0) = c.base_qty)
             then coalesce(m.move_qty, 0) else 0 end
      )) as new_qty
    from public.op_com c
    left join moves m on m.sku = c.sku
  )
  update public.op_com c
  set qty = calc.new_qty
  from calc
  where calc.id = c.id and c.qty is distinct from calc.new_qty;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.op_com_recalc() from public, anon, authenticated;

-- ---------- 7) ให้ตัวตารางเริ่มต้นสอดคล้องกับเคลื่อนไหวปัจจุบันทันที ----------
select public.op_com_recalc();

-- ---------- 8) อัปเดตฟังก์ชัน op_upload ให้เรียก recalc อัตโนมัติหลังอัปโหลด SI (moves) ----------
-- (เหมือน op_setup.sql เดิมทุกอย่าง เพิ่มแค่บรรทัดเรียก recalc ท้าย branch moves — ไม่แตะส่วนตั้งรหัสอัปโหลดท้ายไฟล์ op_setup.sql)
create or replace function public.op_upload(p_passcode text, p_target text, p_rows jsonb, p_reset boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_count integer := 0;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_last date;
begin
  select value into v_hash from public.op_settings where key = 'upload_passcode_hash';
  if v_hash is null then
    raise exception 'ยังไม่ได้ตั้งรหัสอัปโหลดในฐานข้อมูล (ตาราง op_settings)' using errcode = '28P01';
  end if;
  if crypt(coalesce(p_passcode, ''), v_hash) <> v_hash then
    raise exception 'รหัสอัปโหลดไม่ถูกต้อง' using errcode = '28P01';
  end if;

  if p_target not in ('sales', 'stock', 'moves') then
    raise exception 'ไม่รู้จักตาราง: %', p_target;
  end if;

  if p_reset then
    select value::date into v_last from public.op_settings where key = 'last_upload_' || p_target;
    if v_last is not null and v_last = v_today then
      raise exception 'ชนิดนี้อัปโหลดไปแล้ววันนี้ (จำกัด 1 ครั้ง/วัน ต่อชนิด) กรุณาอัปโหลดใหม่หลังเที่ยงคืน' using errcode = 'P0001';
    end if;
  end if;

  if p_target = 'sales' then
    if p_reset then truncate public.op_sales; end if;
    insert into public.op_sales (sku, qty)
    select x.sku, coalesce(x.qty, 0)
    from jsonb_to_recordset(p_rows) as x(sku text, qty numeric)
    where coalesce(x.sku, '') <> ''
    on conflict (sku) do update set qty = public.op_sales.qty + excluded.qty;

  elsif p_target = 'stock' then
    if p_reset then truncate public.op_stock restart identity; end if;
    insert into public.op_stock (sku, sku_name, location, qty)
    select x.sku, x.sku_name, x.location, coalesce(x.qty, 0)
    from jsonb_to_recordset(p_rows) as x(sku text, sku_name text, location text, qty numeric)
    where coalesce(x.sku, '') <> '';

  elsif p_target = 'moves' then
    if p_reset then truncate public.op_stock_moves restart identity; end if;
    insert into public.op_stock_moves (sku, sku_name, moved_at, location, stock_before, move, stock_after, type)
    select x.sku, x.sku_name, x.moved_at, x.location, x.stock_before, x.move, x.stock_after, x.type
    from jsonb_to_recordset(p_rows) as x(sku text, sku_name text, moved_at text, location text,
                                         stock_before text, move text, stock_after text, type text)
    where coalesce(x.sku, '') <> '';
  end if;

  if p_reset then
    insert into public.op_settings (key, value) values ('last_upload_' || p_target, v_today::text)
    on conflict (key) do update set value = excluded.value;
  end if;

  get diagnostics v_count = row_count;

  if p_target = 'moves' then
    perform public.op_com_recalc();
  end if;

  return v_count;
end;
$$;

revoke all on function public.op_upload(text, text, jsonb, boolean) from public;
grant execute on function public.op_upload(text, text, jsonb, boolean) to anon, authenticated;
