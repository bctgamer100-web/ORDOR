-- ที่เก็บ "ใบปริ้น / รายการที่ยืนยัน / ไฟล์ที่เคยใช้" ให้ทุกเครื่องเห็นร่วมกัน (แทน IndexedDB ที่อยู่แค่ในเบราว์เซอร์)
--   kind = 'print'   ใบปริ้นที่เคยปริ้น      (data = รายการ SKU/qty ที่ปริ้นจริง, ไฟล์ = PDF)
--   kind = 'confirm' รายการที่ยืนยันก่อนสั่ง  (data = brandMap, ไฟล์ = ORDER xlsx ที่ยืนยัน, qty = รวมกี่ชิ้น)
--   kind = 'file'    ไฟล์ที่เคยใช้ (รับORDER) (ไฟล์ = ORDER xlsx/csv ต้นฉบับ, count = จำนวนรายการ)
-- เก็บไว้ 1 วัน: รีเซ็ตตามเวลาไทย 00:00 (แถวของวันก่อนถูกลบตอนมีการเรียก op_share_purge)
-- รันใน Supabase > SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่เสียหาย)
--
-- ชื่อที่สร้าง:  ตาราง public.op_share_items
--               bucket  op-share  (ไฟล์จริง: PDF / xlsx)
--               ฟังก์ชัน op_share_save / op_share_list / op_share_delete / op_share_clear / op_share_purge

-- ---------------------------------------------------------------------------
-- 1) ตาราง
-- ---------------------------------------------------------------------------
create table if not exists public.op_share_items (
  kind       text        not null check (kind in ('print', 'confirm', 'file')),
  id         text        not null,                 -- id ที่ฝั่งเว็บสร้าง (เช่น p1728..., c1728...)
  day        date        not null default ((now() at time zone 'Asia/Bangkok')::date),
  saved_at   timestamptz not null default now(),
  name       text        not null default '',      -- ชื่อไฟล์ / หัวข้อที่แสดง
  count      integer     not null default 0,       -- จำนวนรายการ
  qty        numeric     not null default 0,       -- รวมกี่ชิ้น (confirm)
  data       jsonb,                                -- rows (print) / brandMap (confirm)
  meta       jsonb,                                -- เช่น orderFile, title, lastModified
  file_path  text,                                 -- path ใน bucket op-share (null = ไม่มีไฟล์)
  file_size  bigint,
  mime       text,
  primary key (kind, id)
);
create index if not exists op_share_items_day on public.op_share_items (day, kind, saved_at desc);

-- หน้าเว็บเข้าถึงผ่านฟังก์ชันด้านล่างเท่านั้น ไม่ให้อ่าน/แก้/ลบตารางตรงๆ
alter table public.op_share_items enable row level security;
revoke all on public.op_share_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Storage bucket สำหรับไฟล์จริง (ไม่เปิด public: ดาวน์โหลดผ่าน supabase client)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('op-share', 'op-share', false, 52428800)         -- 50 MB ต่อไฟล์
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists op_share_read   on storage.objects;
drop policy if exists op_share_insert on storage.objects;
drop policy if exists op_share_delete on storage.objects;
create policy op_share_read   on storage.objects for select to anon, authenticated using (bucket_id = 'op-share');
create policy op_share_insert on storage.objects for insert to anon, authenticated with check (bucket_id = 'op-share');
create policy op_share_delete on storage.objects for delete to anon, authenticated using (bucket_id = 'op-share');

-- ---------------------------------------------------------------------------
-- 3) ฟังก์ชัน
-- ---------------------------------------------------------------------------

-- บันทึก/อัปเดต 1 รายการ (id เดิม = อัปเดต แต่คงเวลา saved_at ครั้งแรกไว้)
-- ลำดับที่ฝั่งเว็บควรทำ: อัปโหลดไฟล์ขึ้น bucket ก่อน แล้วเรียกฟังก์ชันนี้พร้อม p_file_path
-- p_file_path ต้องขึ้นต้นด้วย "<kind>/" เช่น print/2025-10-10/p1728.pdf (ใช้ตัวอักษร a-z 0-9 - _ . เท่านั้น)
create or replace function public.op_share_save(
  p_kind      text,
  p_id        text,
  p_name      text    default '',
  p_count     integer default 0,
  p_qty       numeric default 0,
  p_data      jsonb   default null,
  p_meta      jsonb   default null,
  p_file_path text    default null,
  p_file_size bigint  default null,
  p_mime      text    default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_kind not in ('print', 'confirm', 'file') then
    raise exception 'kind ไม่ถูกต้อง';
  end if;
  if coalesce(p_id, '') = '' or length(p_id) > 300 then
    raise exception 'id ไม่ถูกต้อง';
  end if;
  if p_data is not null and length(p_data::text) > 4000000 then
    raise exception 'ข้อมูลใหญ่เกินไป (สูงสุด ~4 MB)';
  end if;
  if p_file_path is not null and (left(p_file_path, length(p_kind) + 1) <> p_kind || '/' or p_file_path !~ '^[A-Za-z0-9._/-]+$') then
    raise exception 'file_path ไม่ถูกต้อง';
  end if;

  insert into public.op_share_items as t (kind, id, name, count, qty, data, meta, file_path, file_size, mime)
  values (p_kind, p_id, coalesce(p_name, ''), coalesce(p_count, 0), coalesce(p_qty, 0), p_data, p_meta, p_file_path, p_file_size, p_mime)
  on conflict (kind, id) do update
    set name      = excluded.name,
        count     = excluded.count,
        qty       = excluded.qty,
        data      = coalesce(excluded.data, t.data),
        meta      = coalesce(excluded.meta, t.meta),
        file_path = coalesce(excluded.file_path, t.file_path),
        file_size = coalesce(excluded.file_size, t.file_size),
        mime      = coalesce(excluded.mime, t.mime);
end;
$$;

-- รายการของ "วันนี้" ตาม kind (ใหม่สุดก่อน) — p_with_data = false จะไม่ส่ง data กลับ (เบากว่า ใช้ตอนแสดงลิสต์)
create or replace function public.op_share_list(p_kind text, p_with_data boolean default false)
returns table (
  id text, saved_at timestamptz, name text, count integer, qty numeric,
  data jsonb, meta jsonb, file_path text, file_size bigint, mime text
)
language sql
security definer
set search_path = public
stable
as $$
  select i.id, i.saved_at, i.name, i.count, i.qty,
         case when p_with_data then i.data else null end,
         i.meta, i.file_path, i.file_size, i.mime
  from public.op_share_items i
  where i.kind = p_kind
    and i.day = (now() at time zone 'Asia/Bangkok')::date
  order by i.saved_at desc
  limit 200;
$$;

-- ลบ 1 รายการ: คืน path ไฟล์ เพื่อให้ฝั่งเว็บสั่ง supabase.storage.from('op-share').remove([path])
-- (การลบแถวใน storage.objects ผ่าน SQL ไม่ลบไฟล์จริง จึงให้ลบผ่าน Storage API)
create or replace function public.op_share_delete(p_kind text, p_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_path text;
begin
  delete from public.op_share_items where kind = p_kind and id = p_id returning file_path into v_path;
  return v_path;
end;
$$;

-- ลบทั้งหมดของ kind นั้น (ปุ่ม "ลบทั้งหมด"): คืน path ไฟล์ทั้งหมดให้ฝั่งเว็บลบผ่าน Storage API
create or replace function public.op_share_clear(p_kind text)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare v_paths text[];
begin
  with d as (delete from public.op_share_items where kind = p_kind returning file_path)
  select coalesce(array_agg(file_path) filter (where file_path is not null), '{}') into v_paths from d;
  return v_paths;
end;
$$;

-- ลบรายการของวันก่อนหน้า (รีเซ็ตเที่ยงคืนไทย): คืน path ไฟล์ที่ต้องลบผ่าน Storage API
-- ฝั่งเว็บเรียกตอนเปิดหน้า/ก่อน list
create or replace function public.op_share_purge()
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare v_paths text[];
begin
  with d as (
    delete from public.op_share_items
    where day < (now() at time zone 'Asia/Bangkok')::date
    returning file_path
  )
  select coalesce(array_agg(file_path) filter (where file_path is not null), '{}') into v_paths from d;
  return v_paths;
end;
$$;

revoke all on function public.op_share_save(text, text, text, integer, numeric, jsonb, jsonb, text, bigint, text) from public;
revoke all on function public.op_share_list(text, boolean) from public;
revoke all on function public.op_share_delete(text, text) from public;
revoke all on function public.op_share_clear(text) from public;
revoke all on function public.op_share_purge() from public;
grant execute on function public.op_share_save(text, text, text, integer, numeric, jsonb, jsonb, text, bigint, text) to anon, authenticated;
grant execute on function public.op_share_list(text, boolean) to anon, authenticated;
grant execute on function public.op_share_delete(text, text) to anon, authenticated;
grant execute on function public.op_share_clear(text) to anon, authenticated;
grant execute on function public.op_share_purge() to anon, authenticated;
