-- ============================================================
-- Sunshine (Plan Order) — ให้ยอดที่ "หักสั่งเป้า" ไปแล้วค้างอยู่ถาวร ไม่เด้งกลับตอนอัปโหลด SI ชุดใหม่
-- รันใน Supabase > SQL Editor (รันครั้งเดียว รันซ้ำได้ไม่เสียหาย) ต้องรัน op_com_recalc.sql + op_front_sale.sql มาก่อนแล้ว
--
-- ปัญหาเดิม: op_com_recalc คิด qty = base_qty − เคลื่อนไหวใน op_stock_moves "ตอนนี้" แต่ SI ทุกครั้งเขียนทับทั้งตาราง
--           พอ SI ชุดใหม่ไม่มีแถวเก่า ยอดหักหายไปด้วย สั่งเป้าเลยเด้งกลับมาเท่าเดิม
--
-- แนวคิดใหม่: เพิ่ม carried = ยอดที่หักไปแล้วจาก SI ชุดก่อนๆ (สะสม)
--   ก่อนที่ SI ชุดใหม่จะเขียนทับ (op_upload target 'moves' ก้อนแรก) → เอายอดหักของชุดเก่าไปบวกเข้า carried ก่อน
--   qty = base_qty − carried − ยอดหักจาก SI ชุดปัจจุบัน   (ต่ำสุด 0)
--   อัปโหลดสั่งเป้าใหม่ทับ (op_append) → แถวใหม่ carried = 0 เริ่มนับใหม่ (สั่งเป้าใหม่ก็กลับมามีค่า)
-- เงื่อนไขหักเหมือนเดิม: เคลื่อนไหว (+) ตั้งแต่ 4 ขึ้นไป หรือเท่ากับเป้าที่เหลือพอดี
-- ============================================================

-- ---------- 1) คอลัมน์ carried ----------
alter table public.op_com add column if not exists carried numeric not null default 0;

-- ---------- 2) เงื่อนไขหักของ SI ชุดเดียว (ใช้ร่วมกันทั้ง fold และ recalc) ----------
create or replace function public.op_com_batch_deduction(p_base numeric, p_carried numeric, p_move numeric)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_move, 0) >= 4
      or (coalesce(p_move, 0) > 0 and coalesce(p_move, 0) = (p_base - p_carried))
    then coalesce(p_move, 0) else 0 end;
$$;

-- ---------- 3) พับยอดหักของ SI ชุดปัจจุบัน เข้า carried (เรียกก่อน SI ชุดใหม่เขียนทับ) ----------
create or replace function public.op_com_fold_moves() returns integer
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
  )
  update public.op_com c
  set carried = least(c.base_qty, c.carried + public.op_com_batch_deduction(c.base_qty, c.carried, m.move_qty))
  from moves m
  where m.sku = c.sku
    and public.op_com_batch_deduction(c.base_qty, c.carried, m.move_qty) > 0;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.op_com_fold_moves() from public, anon, authenticated;

-- ---------- 4) recalc ใหม่: หัก carried (ชุดก่อนๆ) + ยอดหักของ SI ชุดปัจจุบัน ----------
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
      greatest(0, c.base_qty - c.carried
        - public.op_com_batch_deduction(c.base_qty, c.carried, m.move_qty)) as new_qty
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

-- ---------- 5) op_upload: ก่อนล้าง op_stock_moves (ก้อนแรกของการอัปโหลด SI) ให้พับยอดหักเข้า carried ก่อน ----------
-- (เหมือนเวอร์ชันล่าสุดใน op_front_sale.sql ทุกอย่าง เพิ่มแค่บรรทัด perform op_com_fold_moves ใน branch moves)
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
    if p_reset then
      perform public.op_com_fold_moves(); -- เก็บยอดที่หักจาก SI ชุดเก่าไว้ใน op_com.carried ก่อนถูกเขียนทับ
      truncate public.op_stock_moves restart identity;
    end if;
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

-- ---------- 6) คำนวณตารางตอนนี้ใหม่ทันที (carried = 0 ทุกแถว ผลเท่าเดิม) ----------
select public.op_com_recalc();
