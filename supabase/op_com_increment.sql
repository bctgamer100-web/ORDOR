-- ============================================================
-- Sunshine (Plan Order) — เพิ่มจำนวนเข้า "สั่งเป้า" (op_com) แบบบวกเพิ่ม ไม่เขียนทับของเดิม
-- รันใน Supabase > SQL Editor (รันซ้ำได้) ต้องรัน op_setup.sql มาก่อนแล้ว เพราะใช้รหัสอัปโหลดชุดเดียวกัน
--
-- ใช้คู่กับปุ่ม "นำเข้าตารางสี/ไซซ์ (เพิ่มเข้าสั่งเป้า)" ในหน้าใบสั่งซื้อล่วงหน้า:
-- เอาไฟล์ตารางสี/ไซซ์ที่ดาวน์โหลดออกไปก่อนหน้านี้ (ปุ่มดาวน์โหลดตารางสี/ไซซ์) กลับมานำเข้าใหม่
-- ค่าที่ส่งมา (sku, qty) จะถูก "บวกเพิ่ม" เข้ากับ qty เดิมของ SKU นั้นใน op_com (ไม่ใช่เขียนทับทั้งตารางแบบ op_append)
-- ถ้ายังไม่เคยมี SKU นั้นในตาราง จะสร้างแถวใหม่ให้
--
-- ต้องรัน op_com_recalc.sql มาก่อน (เพิ่มคอลัมน์ base_qty + unique constraint บน sku + ฟังก์ชัน op_com_recalc)
-- เวอร์ชันนี้บวกเพิ่มที่ base_qty (เป้าตั้งต้น) ไม่ใช่ qty ตรงๆ แล้วเรียก op_com_recalc() ให้คำนวณ qty (เป้าที่เหลือจริง) ใหม่
-- เพราะถ้าบวกที่ qty ตรงๆ ตอนเคลื่อนไหวครั้งถัดไปจะคำนวณทับค่าที่เพิ่งบวกไปหายได้
-- ============================================================

create or replace function public.op_com_increment(p_passcode text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_count integer := 0;
  r record;
begin
  select value into v_hash from public.op_settings where key = 'upload_passcode_hash';
  if v_hash is null then
    raise exception 'ยังไม่ได้ตั้งรหัสอัปโหลดในฐานข้อมูล (ตาราง op_settings)' using errcode = '28P01';
  end if;
  if crypt(coalesce(p_passcode, ''), v_hash) <> v_hash then
    raise exception 'รหัสอัปโหลดไม่ถูกต้อง' using errcode = '28P01';
  end if;

  if p_rows is null or jsonb_array_length(p_rows) = 0 then
    return 0;
  end if;

  for r in
    select x.sku, x.qty
    from jsonb_to_recordset(p_rows) as x(sku text, qty numeric)
    where coalesce(x.sku, '') <> '' and coalesce(x.qty, 0) <> 0
  loop
    update public.op_com
      set base_qty = base_qty + r.qty
      where id = (select id from public.op_com where sku = r.sku order by id limit 1);
    if not found then
      insert into public.op_com (sku, qty, base_qty) values (r.sku, r.qty, r.qty);
    end if;
    v_count := v_count + 1;
  end loop;

  perform public.op_com_recalc();

  return v_count;
end;
$$;

revoke all on function public.op_com_increment(text, jsonb) from public;
grant execute on function public.op_com_increment(text, jsonb) to anon, authenticated;
