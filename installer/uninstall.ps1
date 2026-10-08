# ถอนการติดตั้ง ORDER Workspace (ลบไฟล์โปรแกรม ทางลัด และรายการใน Settings > Apps)
Add-Type -AssemblyName System.Windows.Forms
$name = 'ORDER Workspace'
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$data = Join-Path $env:LOCALAPPDATA $name

$ans = [System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้ง $name ?", $name, 'YesNo', 'Question')
if ($ans -ne 'Yes') { exit }

Remove-Item (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item (Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk") -Force -ErrorAction SilentlyContinue
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OrderWorkspace' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $dest -Recurse -Force -ErrorAction SilentlyContinue

$keep = [System.Windows.Forms.MessageBox]::Show("เก็บข้อมูลที่บันทึกไว้ในโปรแกรม (ไฟล์ ORDER ที่เคยใช้, ใบปริ้น, การตั้งค่า) ไว้หรือไม่?`nกด No เพื่อลบข้อมูลทั้งหมด", $name, 'YesNo', 'Question')
if ($keep -eq 'No') { Remove-Item $data -Recurse -Force -ErrorAction SilentlyContinue }

[System.Windows.Forms.MessageBox]::Show("ถอนการติดตั้ง $name เรียบร้อย", $name, 'OK', 'Information') | Out-Null
