-- ============================================================
-- Sunshine — เขียนทับตาราง op_com (สั่งเป้า) ผ่านฟังก์ชัน op_append
-- รันใน Supabase > SQL Editor (รันซ้ำได้) ต้องรัน op_setup.sql มาก่อนแล้ว เพราะใช้รหัสอัปโหลดชุดเดียวกัน
--
-- เวอร์ชันนี้: ก้อนแรกของการอัปโหลดส่ง p_reset = true → ล้างตาราง op_com ก่อน แล้วใส่ข้อมูลใหม่ (เขียนทับ)
--               ก้อนถัดไปส่ง p_reset = false → ใส่ต่อท้ายก้อนแรก (เว็บแบ่งส่งทีละ 5,000 แถว)
--
-- ตาราง public.op_com ต้องมีอยู่แล้ว สคริปต์นี้ไม่สร้าง/แก้โครงสร้างตารางให้
-- ฟังก์ชันจะใส่เฉพาะคอลัมน์ที่ชื่อตรงกับคอลัมน์ในตาราง (เว็บส่ง sku, qty) คอลัมน์อัตโนมัติอย่าง id ไม่ต้องส่ง
--
-- จำกัด 1 ครั้ง/วัน (นับที่เวลาไทย Asia/Bangkok) ใช้ op_settings เก็บ "วันที่อัปโหลดล่าสุด" (key = 'last_upload_com')
-- เป็นจุดตรวจสอบร่วม ทำให้บล็อกข้ามเครื่อง/ข้ามเบราว์เซอร์ได้จริง เช็กเฉพาะก้อนแรก (p_reset=true)
-- ============================================================

-- ลบฟังก์ชันเวอร์ชันเก่า (3 พารามิเตอร์) ที่เคยรันไว้ ไม่ให้ชื่อซ้ำกัน
drop function if exists public.op_append(text, text, jsonb);

create or replace function public.op_append(p_passcode text, p_target text, p_rows jsonb, p_reset boolean default false)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_cols text;
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

  if p_target = 'com' then
    if p_reset then
      select value::date into v_last from public.op_settings where key = 'last_upload_com';
      if v_last is not null and v_last = v_today then
        raise exception 'ชนิดนี้อัปโหลดไปแล้ววันนี้ (จำกัด 1 ครั้ง/วัน ต่อชนิด) กรุณาอัปโหลดใหม่หลังเที่ยงคืน' using errcode = 'P0001';
      end if;
      truncate public.op_com restart identity;
    end if;

    if p_rows is null or jsonb_array_length(p_rows) = 0 then
      if p_reset then
        insert into public.op_settings (key, value) values ('last_upload_com', v_today::text)
        on conflict (key) do update set value = excluded.value;
      end if;
      return 0;
    end if;

    select string_agg(quote_ident(c.column_name), ',' order by c.ordinal_position)
      into v_cols
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'op_com'
      and c.column_name in (select jsonb_object_keys(p_rows -> 0));

    if v_cols is null then
      raise exception 'หัวคอลัมน์ในไฟล์ไม่ตรงกับคอลัมน์ใดๆ ของตาราง op_com';
    end if;

    execute format(
      'insert into public.op_com (%1$s) select %1$s from jsonb_populate_recordset(null::public.op_com, $1)',
      v_cols
    ) using p_rows;
    get diagnostics v_count = row_count;
  else
    raise exception 'ไม่รู้จักตาราง: %', p_target;
  end if;

  if p_reset then
    insert into public.op_settings (key, value) values ('last_upload_com', v_today::text)
    on conflict (key) do update set value = excluded.value;
  end if;

  return v_count;
end;
$$;

revoke all on function public.op_append(text, text, jsonb, boolean) from public;
grant execute on function public.op_append(text, text, jsonb, boolean) to anon, authenticated;
