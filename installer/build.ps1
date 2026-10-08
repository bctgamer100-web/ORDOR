# สร้างไฟล์ติดตั้ง dist\ORDER-Workspace-Setup.exe
# ใช้เฉพาะเครื่องมือที่มีใน Windows อยู่แล้ว (csc.exe ของ .NET Framework + IExpress) ไม่ต้องลงอะไรเพิ่ม
# รัน: powershell -ExecutionPolicy Bypass -File installer\build.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $here
$version = Get-Date -Format 'yyyy.M.d'
# IExpress อ่าน path ภาษาไทยไม่ได้ จึงประกอบไฟล์ในโฟลเดอร์ชั่วคราวก่อน
$work = Join-Path $env:TEMP 'order-workspace-build'
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory $work | Out-Null

# 1) ไอคอน: วาดตามโลโก้ใน favicon.svg หลายขนาด แล้วรวมเป็น .ico (PNG ภายใน)
function New-LogoPng([int]$size) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = 'AntiAlias'
    $g.ScaleTransform($size / 64.0, $size / 64.0)
    function RoundRect($x, $y, $w, $h, $r) {
        $p = New-Object System.Drawing.Drawing2D.GraphicsPath
        $d = $r * 2
        $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
        $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
        $p.CloseFigure(); $p
    }
    $g.FillPath((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 0x0f, 0x16, 0x20))), (RoundRect 0 0 64 64 14))
    $g.DrawPath((New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(89, 0x78, 0xa9, 0xff)), 3), (RoundRect 1.5 1.5 61 61 12.5))
    $pen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(255, 0x78, 0xa9, 0xff)), 4.5
    $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
    # เครื่องหมาย ⌘: เส้นตรง 4 เส้น + ห่วง 3/4 วงที่มุม
    $g.DrawLine($pen, 19, 24, 45, 24); $g.DrawLine($pen, 19, 40, 45, 40)
    $g.DrawLine($pen, 24, 19, 24, 45); $g.DrawLine($pen, 40, 19, 40, 45)
    $g.DrawArc($pen, 14, 14, 10, 10, 90, 270); $g.DrawArc($pen, 40, 14, 10, 10, 180, 270)
    $g.DrawArc($pen, 40, 40, 10, 10, 270, 270); $g.DrawArc($pen, 14, 40, 10, 10, 0, 270)
    $g.Dispose()
    $ms = New-Object System.IO.MemoryStream
    if ($size -ge 256) {
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    } else {
        # ขนาดเล็กเก็บเป็น DIB 32 บิต (BMP ใน .ico) ให้ทุกส่วนของ Windows อ่านได้
        $bw = New-Object System.IO.BinaryWriter $ms
        $bw.Write([uint32]40); $bw.Write([int32]$size); $bw.Write([int32]($size * 2))
        $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
        $bw.Write([uint32]($size * $size * 4)); $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
        for ($y = $size - 1; $y -ge 0; $y--) {
            for ($x = 0; $x -lt $size; $x++) { $bw.Write([int32]$bmp.GetPixel($x, $y).ToArgb()) }
        }
        $maskRow = [int]([Math]::Ceiling($size / 32.0) * 4)
        $bw.Write((New-Object byte[] ($maskRow * $size)))
        $bw.Flush()
    }
    $bmp.Dispose()
    , $ms.ToArray()
}
$sizes = 16, 24, 32, 48, 64, 128, 256
$pngs = $sizes | ForEach-Object { , (New-LogoPng $_) }
$ico = New-Object System.IO.MemoryStream
$w = New-Object System.IO.BinaryWriter $ico
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $s = $sizes[$i]; $b = if ($s -ge 256) { 0 } else { $s }
    $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$pngs[$i].Length); $w.Write([uint32]$offset)
    $offset += $pngs[$i].Length
}
foreach ($p in $pngs) { $w.Write($p) }
$w.Flush()
[IO.File]::WriteAllBytes("$work\app.ico", $ico.ToArray())

# 2) ตัวเปิดโปรแกรม .exe
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
& $csc /nologo /target:winexe /codepage:65001 /optimize "/win32icon:$work\app.ico" "/out:$work\OrderWorkspace.exe" /r:System.Windows.Forms.dll "$here\launcher.cs"
if ($LASTEXITCODE -ne 0) { throw 'คอมไพล์ launcher.cs ไม่สำเร็จ' }

# 3) ไฟล์เว็บที่ใช้จริง (ไม่รวม backup / tests / tools / supabase)
$stage = Join-Path $work 'app'
New-Item -ItemType Directory $stage | Out-Null
Copy-Item "$root\index.html", "$root\favicon.svg" $stage
Copy-Item "$root\css", "$root\js" $stage -Recurse
Compress-Archive -Path "$stage\*" -DestinationPath "$work\app.zip"
Remove-Item $stage -Recurse -Force

$utf8Bom = New-Object System.Text.UTF8Encoding $true
[IO.File]::WriteAllText("$work\install.ps1", ((Get-Content "$here\install.ps1" -Raw -Encoding UTF8) -replace '__VERSION__', $version), $utf8Bom)
Copy-Item "$here\uninstall.ps1" $work

# 4) รวมเป็นไฟล์ติดตั้งด้วย IExpress
$target = Join-Path $work 'ORDER-Workspace-Setup.exe'
$files = 'install.ps1', 'uninstall.ps1', 'app.zip', 'OrderWorkspace.exe', 'app.ico'
$fileDefs = (0..($files.Count - 1) | ForEach-Object { "FILE$_=`"$($files[$_])`"" }) -join "`r`n"
$fileRefs = (0..($files.Count - 1) | ForEach-Object { "%FILE$_%=" }) -join "`r`n"
$sed = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=0
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=$target
FriendlyName=ORDER Workspace Setup
AppLaunched=powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File install.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
$fileDefs
[SourceFiles]
SourceFiles0=$work\
[SourceFiles0]
$fileRefs
"@
[IO.File]::WriteAllText("$work\setup.sed", $sed, [Text.Encoding]::ASCII)
Start-Process "$env:WINDIR\System32\iexpress.exe" -ArgumentList '/N', '/Q', "$work\setup.sed" -Wait
if (-not (Test-Path $target)) { throw 'IExpress สร้างไฟล์ติดตั้งไม่สำเร็จ' }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
Copy-Item $target $dist -Force
Write-Host "เสร็จแล้ว: $dist\ORDER-Workspace-Setup.exe (เวอร์ชัน $version)"
