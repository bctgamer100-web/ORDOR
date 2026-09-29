-- ============================================================
-- Sunshine — ให้เว็บ "อ่าน" ตาราง op_com ได้ (เพื่อแสดงคอลัมน์ สั่งเป้า)
-- รันครั้งเดียวใน Supabase > SQL Editor (รันซ้ำได้ ไม่เสียหาย)
--
-- ผลลัพธ์: เว็บอ่านได้อย่างเดียว ส่วนการเพิ่มข้อมูลทำได้ผ่านฟังก์ชัน op_append (ต้องใส่รหัสอัปโหลด) เท่านั้น
-- ไม่แตะข้อมูลในตาราง
-- ============================================================

alter table public.op_com enable row level security;

revoke insert, update, delete, truncate on public.op_com from anon, authenticated;

drop policy if exists "op_com read" on public.op_com;
create policy "op_com read" on public.op_com for select to anon, authenticated using (true);
