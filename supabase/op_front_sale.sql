-- ============================================================
-- Sunshine (Plan Order) — เก็บ "ขาย" (สต็อกพร้อมขายของตำแหน่ง FRONT/ในบ้าน) แยกจาก op_stock โดยสิ้นเชิง
-- รันใน Supabase > SQL Editor (รันครั้งเดียว รันซ้ำได้ไม่เสียหาย) ต้องรัน op_setup.sql มาก่อนแล้ว
--
-- เหตุผลที่แยกตาราง: op_stock (คอลัมน์ "คลัง") ตัดแถว FRONT/DELETE/ในบ้านทิ้งตั้งแต่ตอนอัปโหลด (ดู toStockRows ใน sunshine.js)
-- เพราะสต๊อก FRONT ต้องปริ้นใบไปเช็คนับจริงก่อนถึงจะเชื่อได้ ไม่เอามารวมคำนวณสั่งซื้อ — ไฟล์นี้ "ไม่แตะ" ตรรกะนั้นเลย
-- แค่เพิ่มช่องทางใหม่อ่านไฟล์ ST ชุดเดียวกัน แต่กลับด้านตัวกรอง (เอาเฉพาะ FRONT/ในบ้าน) และอ่านคนละคอลัมน์ ("สต็อกพร้อมขายของตำแหน่ง")
-- ไปเก็บไว้อีกตารางหนึ่ง ใช้ปุ่ม "อัปโหลดทั้งหมด" เดิมปุ่มเดียวกัน ไม่ต้องอัปโหลดไฟล์ ST ซ้ำสองรอบ
-- ============================================================

create table if not exists public.op_front_sale (
  sku text primary key,
  qty numeric not null default 0
);

alter table public.op_front_sale enable row level security;
revoke insert, update, delete, truncate on public.op_front_sale from anon, authenticated;

drop policy if exists "op_front_sale read" on public.op_front_sale;
create policy "op_front_sale read" on public.op_front_sale for select to anon, authenticated using (true);

-- ---------- อัปเดต op_upload ให้รองรับ target ใหม่ 'frontsale' ----------
-- (เหมือนเวอร์ชันล่าสุดใน op_com_recalc.sql ทุกอย่าง เพิ่มแค่ 'frontsale' ในลิสต์ที่รับ และ branch ใหม่ท้ายๆ)
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

  if p_target not in ('sales', 'stock', 'moves', 'frontsale') then
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

  elsif p_target = 'frontsale' then
    if p_reset then truncate public.op_front_sale; end if;
    insert into public.op_front_sale (sku, qty)
    select x.sku, coalesce(x.qty, 0)
    from jsonb_to_recordset(p_rows) as x(sku text, qty numeric)
    where coalesce(x.sku, '') <> ''
    on conflict (sku) do update set qty = excluded.qty;
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
