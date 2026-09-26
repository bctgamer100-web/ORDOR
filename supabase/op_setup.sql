-- ============================================================
-- Sunshine (op) — ตารางสำหรับเว็บจัดออเดอร์ ย้ายมาจาก Google Sheets
-- รันครั้งเดียวใน Supabase > SQL Editor
--
-- สคริปต์นี้ "สร้างใหม่" เฉพาะตารางที่ขึ้นต้นด้วย op_ เท่านั้น
-- ไม่แก้ไข/ลบ ตารางอื่นของโปรเจกต์ (รวมถึง products ที่เว็บแค่อ่านอย่างเดียว)
-- ============================================================

-- ยอดขายย้อนหลัง (แทนชีต 3M) — เก็บแบบสรุปยอดต่อ SKU แล้ว
create table if not exists public.op_sales (
  sku text primary key,
  qty numeric not null default 0
);

-- สต๊อกและตำแหน่ง (แทนชีต ST)
create table if not exists public.op_stock (
  id bigint generated always as identity primary key,
  sku text not null,
  sku_name text,
  location text,
  qty numeric not null default 0
);
create index if not exists op_stock_sku_idx on public.op_stock (sku);

-- ประวัติเคลื่อนไหวสต๊อก (แทนชีต SI) — เก็บค่าตามไฟล์เป็นข้อความ (เช่น "+5")
create table if not exists public.op_stock_moves (
  id bigint generated always as identity primary key,
  sku text not null,
  sku_name text,
  moved_at text,
  location text,
  stock_before text,
  move text,
  stock_after text,
  type text
);

-- ที่เก็บรหัสอัปโหลด (hash) — ห้าม anon/authenticated อ่านเด็ดขาด
create table if not exists public.op_settings (
  key text primary key,
  value text not null
);

-- ---------- สิทธิ์ ----------
alter table public.op_sales       enable row level security;
alter table public.op_stock       enable row level security;
alter table public.op_stock_moves enable row level security;
alter table public.op_settings    enable row level security;

-- เว็บอ่านได้อย่างเดียว เขียนได้ผ่านฟังก์ชัน op_upload (ต้องใส่รหัส) เท่านั้น
revoke insert, update, delete, truncate on public.op_sales, public.op_stock, public.op_stock_moves from anon, authenticated;
revoke all on public.op_settings from anon, authenticated;

drop policy if exists "op_sales read" on public.op_sales;
create policy "op_sales read" on public.op_sales for select to anon, authenticated using (true);

drop policy if exists "op_stock read" on public.op_stock;
create policy "op_stock read" on public.op_stock for select to anon, authenticated using (true);

drop policy if exists "op_stock_moves read" on public.op_stock_moves;
create policy "op_stock_moves read" on public.op_stock_moves for select to anon, authenticated using (true);

-- ---------- ฟังก์ชันอัปโหลด ----------
-- p_target: 'sales' | 'stock' | 'moves'
-- p_reset = true  → ล้างตารางก่อนแล้วค่อยใส่ (ส่งมาพร้อมก้อนแรก)
-- p_reset = false → ใส่ต่อท้าย (ก้อนถัดๆ ไป) — เว็บแบ่งส่งทีละก้อนกัน statement timeout
create or replace function public.op_upload(p_passcode text, p_target text, p_rows jsonb, p_reset boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_count integer := 0;
begin
  select value into v_hash from public.op_settings where key = 'upload_passcode_hash';
  if v_hash is null then
    raise exception 'ยังไม่ได้ตั้งรหัสอัปโหลดในฐานข้อมูล (ตาราง op_settings)' using errcode = '28P01';
  end if;
  if crypt(coalesce(p_passcode, ''), v_hash) <> v_hash then
    raise exception 'รหัสอัปโหลดไม่ถูกต้อง' using errcode = '28P01';
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

  else
    raise exception 'ไม่รู้จักตาราง: %', p_target;
  end if;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.op_upload(text, text, jsonb, boolean) from public;
grant execute on function public.op_upload(text, text, jsonb, boolean) to anon, authenticated;

-- ---------- ตั้งรหัสอัปโหลด ----------
-- เปลี่ยน 'CHANGE_ME' เป็นรหัสที่ต้องการก่อนรัน (รันบรรทัดนี้ซ้ำได้ทุกเมื่อที่อยากเปลี่ยนรหัส)
insert into public.op_settings (key, value)
values ('upload_passcode_hash', extensions.crypt('CHANGE_ME', extensions.gen_salt('bf')))
on conflict (key) do update set value = excluded.value;
