# ติดตั้ง ORDER Workspace สำหรับผู้ใช้ปัจจุบัน (ไม่ต้องใช้สิทธิ์ผู้ดูแล)
# รันโดย ORDER-Workspace-Setup.exe จากโฟลเดอร์ที่แตกไฟล์ชั่วคราว
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$name = 'ORDER Workspace'
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "Programs\$name"
$exe = Join-Path $dest "$name.exe"

try {
    # ติดตั้งทับเวอร์ชันเดิม: ลบเฉพาะไฟล์โปรแกรม ข้อมูลผู้ใช้อยู่ใน %LOCALAPPDATA%\ORDER Workspace\profile ไม่ถูกแตะ
    if (Test-Path "$dest\app") { Remove-Item "$dest\app" -Recurse -Force }
    New-Item -ItemType Directory -Force $dest | Out-Null
    Expand-Archive -Path (Join-Path $src 'app.zip') -DestinationPath "$dest\app" -Force
    Copy-Item (Join-Path $src 'OrderWorkspace.exe') $exe -Force
    Copy-Item (Join-Path $src 'app.ico') "$dest\app.ico" -Force
    Copy-Item (Join-Path $src 'uninstall.ps1') "$dest\uninstall.ps1" -Force

    # ทางลัดบนเดสก์ท็อปและ Start Menu
    $shell = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) "$name.lnk"
    foreach ($lnk in @((Join-Path $desktop "$name.lnk"), $startMenu)) {
        $s = $shell.CreateShortcut($lnk)
        $s.TargetPath = $exe
        $s.WorkingDirectory = $dest
        $s.IconLocation = "$dest\app.ico"
        $s.Description = 'จัดการออเดอร์และสต็อก'
        $s.Save()
    }

    # รายการใน Settings > Apps เพื่อถอนการติดตั้งได้
    $key = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\OrderWorkspace"
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty $key DisplayName $name
    Set-ItemProperty $key DisplayIcon "$dest\app.ico"
    Set-ItemProperty $key DisplayVersion '__VERSION__'
    Set-ItemProperty $key Publisher 'ORDER Workspace'
    Set-ItemProperty $key InstallLocation $dest
    Set-ItemProperty $key UninstallString "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$dest\uninstall.ps1`""
    Set-ItemProperty $key NoModify 1 -Type DWord
    Set-ItemProperty $key NoRepair 1 -Type DWord

    [System.Windows.Forms.MessageBox]::Show("ติดตั้ง $name เรียบร้อย`nเปิดได้จากไอคอนบนเดสก์ท็อปหรือ Start Menu", $name, 'OK', 'Information') | Out-Null
    Start-Process $exe
} catch {
    [System.Windows.Forms.MessageBox]::Show("ติดตั้งไม่สำเร็จ:`n$($_.Exception.Message)", $name, 'OK', 'Error') | Out-Null
    exit 1
}
