-- ST (ตำแหน่งสต็อก) รีเซ็ตโควตาอัปโหลด 2 ครั้ง/วัน: เที่ยงคืน (เดิม) + เที่ยงวัน 12:00 เวลาไทย (ไฟล์นี้)
-- วิธีทำงาน: ฟังก์ชัน op_upload เทียบ "วันที่อัปโหลดล่าสุด" (op_settings.key = 'last_upload_stock') กับวันนี้
-- ไฟล์นี้ตั้งงานตามเวลา (pg_cron) ให้ลบค่านั้นทิ้งตอน 12:00 น. → ST อัปโหลดได้อีกครั้งช่วงบ่าย
-- ไม่แตะฟังก์ชัน op_upload และไม่กระทบชนิดอื่น (3M = sales, SI = moves ยังจำกัด 1 ครั้ง/วันเหมือนเดิม)
-- รันใน Supabase > SQL Editor ครั้งเดียว (รันซ้ำได้ ไม่เสียหาย)

create extension if not exists pg_cron;

-- เอางานเดิมชื่อเดียวกันออกก่อน (ถ้ามี) แล้วตั้งใหม่
do $$
begin
  if exists (select 1 from cron.job where jobname = 'op_st_noon_reset') then
    perform cron.unschedule('op_st_noon_reset');
  end if;
end
$$;

-- pg_cron ใช้เวลา UTC: 12:00 น. ไทย (UTC+7) = 05:00 UTC
select cron.schedule(
  'op_st_noon_reset',
  '0 5 * * *',
  $job$ delete from public.op_settings where key = 'last_upload_stock' $job$
);

-- ตรวจ: ต้องเห็นงาน op_st_noon_reset ตารางเวลา '0 5 * * *'
select jobid, jobname, schedule, command, active from cron.job where jobname = 'op_st_noon_reset';
