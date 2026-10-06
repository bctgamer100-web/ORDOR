-- ปิดรหัสอัปโหลด: ตั้งรหัสเป็นค่าว่าง หน้าเว็บส่งรหัสว่างไปตอนอัปโหลด จึงไม่ต้องพิมพ์รหัสอีก
-- (ฟังก์ชัน op_upload / op_append / op_com_increment ... เช็กรหัสด้วย crypt(p_passcode, hash) เหมือนเดิม ไม่ต้องแก้)
-- ยังจำกัดอัปโหลด 1 ครั้ง/วัน ต่อชนิดเหมือนเดิม
-- ข้อควรรู้: เว็บเปิดสาธารณะ ใครได้ลิงก์ก็อัปโหลดทับข้อมูลได้
-- รันใน Supabase > SQL Editor ครั้งเดียว
update public.op_settings
set value = extensions.crypt('', extensions.gen_salt('bf'))
where key = 'upload_passcode_hash';

-- อยากเปิดรหัสกลับ: แก้ 'รหัสใหม่' แล้วรันบรรทัดนี้แทน (หน้าเว็บจะถามรหัสเองเมื่อฐานข้อมูลตอบว่ารหัสผิด)
-- update public.op_settings set value = extensions.crypt('รหัสใหม่', extensions.gen_salt('bf')) where key = 'upload_passcode_hash';
