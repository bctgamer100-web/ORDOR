-- ฐานข้อมูลเลข Tracking + SKU + จำนวน ของออเดอร์ที่เคยกด "ปริ้น ORDER (Pivot)" ในหน้า "รับORDER" ใช้ร่วมกันทุกเครื่อง
-- ใช้กันออเดอร์ซ้ำ: โหลดไฟล์ใหม่แล้วแถวไหน (Tracking + SKU) เคยปริ้นไปแล้ว (จากไฟล์อื่น) หน้าเว็บจะแจ้งเตือน + ซ่อนแถวที่ซ้ำได้
-- เก็บ 90 วัน: แถวที่เก่ากว่านั้นถูกลบตอนมีการบันทึกครั้งถัดไป
-- รันใน Supabase > SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่เสียหาย)
--
-- ชื่อที่สร้าง:  ตาราง public.op_order_track
--               ฟังก์ชัน op_track_check (เช็กซ้ำตอนโหลดไฟล์) / op_track_record (บันทึกตอนปริ้น) / op_track_find (ค้นเลข Tracking)

create table if not exists public.op_order_track (
  id        bigint generated always as identity primary key,
  tracking  text        not null,                 -- เลข Tracking ตามไฟล์ (ตัดช่องว่างหัวท้ายแล้ว)
  sku_key   text        not null,                 -- SKU แบบ normalize แล้ว (ใช้เทียบ)
  sku       text        not null,                 -- SKU ตามที่แสดง
  qty       numeric     not null default 0,       -- จำนวนรวมของ SKU นี้ในพัสดุนี้
  batch     text        not null,                 -- รหัสเนื้อหาไฟล์ (หน้าเว็บคำนวณ) โหลดไฟล์เดิมซ้ำจะได้รหัสเดิม จึงไม่นับว่าซ้ำ
  file_name text,                                 -- ชื่อไฟล์ที่ปริ้นครั้งแรก
  seen_at   timestamptz not null default now(),   -- เวลาที่ปริ้นครั้งแรก
  unique (tracking, sku_key)                      -- 1 แถวต่อ SKU ต่อพัสดุ เก็บของครั้งแรกไว้
);
create index if not exists op_order_track_seen on public.op_order_track (seen_at);

-- หน้าเว็บเข้าถึงผ่านฟังก์ชันด้านล่างเท่านั้น ไม่ให้อ่าน/แก้/ลบตารางตรงๆ
alter table public.op_order_track enable row level security;
revoke all on public.op_order_track from anon, authenticated;

-- เวอร์ชันก่อนๆ: เช็ก+บันทึกในฟังก์ชันเดียว / เช็กด้วยเลข Tracking อย่างเดียว — ตอนนี้เช็กด้วย Tracking + SKU
drop function if exists public.op_track_check(jsonb, text, text);
drop function if exists public.op_track_check(text[], text);

-- เช็กซ้ำตอนโหลดไฟล์ (ไม่บันทึกอะไร) เทียบทีละคู่ Tracking + SKU
-- (พัสดุเดียวมีหลายยี่ห้อได้: ปริ้นไปแค่บางยี่ห้อ SKU ที่เหลือในพัสดุนั้นต้องไม่ถูกนับว่าซ้ำ)
--   p_keys  = [{ "tracking": "TH123", "sku_key": "ABC-1" }, ...] ทุกคู่ในไฟล์ · p_batch = รหัสเนื้อหาไฟล์
-- คืนคู่ที่ "เคยปริ้นแล้วจากไฟล์อื่น" (คนละ batch) พร้อมจำนวน/ไฟล์/เวลาที่ปริ้นครั้งแรก
create or replace function public.op_track_check(p_keys jsonb, p_batch text)
returns table (tracking text, sku_key text, sku text, qty numeric, file_name text, seen_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select t.tracking, t.sku_key, t.sku, t.qty, t.file_name, t.seen_at
  from public.op_order_track t
  join (select distinct btrim(x.tracking) as tracking, x.sku_key
        from jsonb_to_recordset(case when jsonb_typeof(p_keys) = 'array' then p_keys else '[]'::jsonb end)
             as x(tracking text, sku_key text)) k
    on k.tracking = t.tracking and k.sku_key = t.sku_key
  where t.batch <> coalesce(p_batch, '')
    and t.seen_at >= now() - interval '90 days'
  order by t.seen_at, t.tracking, t.sku;
$$;

-- บันทึกตอนกดปริ้น ORDER: p_rows = [{ "tracking": "TH123", "sku_key": "ABC-1", "sku": "abc-1", "qty": 2 }, ...]
-- (เฉพาะแถวที่ปริ้นจริง 1 แถวต่อ SKU ต่อพัสดุ) · p_batch = รหัสเนื้อหาไฟล์ · p_file = ชื่อไฟล์
-- แถวที่มีอยู่แล้วไม่ถูกแก้ (ข้อมูลครั้งแรกยังอยู่) คืนจำนวนแถวที่เพิ่มใหม่
create or replace function public.op_track_record(p_rows jsonb, p_batch text, p_file text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows ต้องเป็นอาร์เรย์';
  end if;
  if jsonb_array_length(p_rows) > 20000 then
    raise exception 'ส่งมามากเกินไปในครั้งเดียว (สูงสุด 20000 แถว)';
  end if;
  if coalesce(p_batch, '') = '' then
    raise exception 'ต้องระบุ p_batch';
  end if;

  delete from public.op_order_track t where t.seen_at < now() - interval '90 days';   -- เก็บ 90 วัน

  insert into public.op_order_track (tracking, sku_key, sku, qty, batch, file_name)
  select btrim(x.tracking), x.sku_key, max(coalesce(nullif(x.sku, ''), x.sku_key)), sum(coalesce(x.qty, 0)), p_batch, nullif(p_file, '')
  from jsonb_to_recordset(p_rows) as x(tracking text, sku_key text, sku text, qty numeric)
  where coalesce(btrim(x.tracking), '') <> '' and coalesce(x.sku_key, '') <> ''
  group by btrim(x.tracking), x.sku_key
  on conflict (tracking, sku_key) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ค้นเลข Tracking (ขึ้นต้นด้วยคำที่พิมพ์ ไม่สนตัวพิมพ์เล็ก/ใหญ่) คืนสูงสุด 200 แถว ใหม่สุดก่อน
create or replace function public.op_track_find(p_tracking text)
returns table (tracking text, sku text, qty numeric, file_name text, seen_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select t.tracking, t.sku, t.qty, t.file_name, t.seen_at
  from public.op_order_track t
  where length(btrim(coalesce(p_tracking, ''))) >= 4
    and upper(t.tracking) like upper(btrim(p_tracking)) || '%'
  order by t.seen_at desc, t.tracking, t.sku
  limit 200;
$$;

revoke all on function public.op_track_check(jsonb, text) from public;
revoke all on function public.op_track_record(jsonb, text, text) from public;
revoke all on function public.op_track_find(text) from public;
grant execute on function public.op_track_check(jsonb, text) to anon, authenticated;
grant execute on function public.op_track_record(jsonb, text, text) to anon, authenticated;
grant execute on function public.op_track_find(text) to anon, authenticated;
