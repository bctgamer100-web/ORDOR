param(
  [string]$Src = (Join-Path $PSScriptRoot '..\css\style.css'),
  [string]$Dst = (Join-Path $PSScriptRoot '..\css\theme-light.css')
)

# สร้าง css/theme-light.css จาก css/style.css โดยกลับค่าความสว่าง (HSL lightness) ของสีทุกจุด
# แล้วครอบด้วย html[data-prod-theme="light"] รันซ้ำได้ทุกครั้งที่แก้ style.css

$scope = 'html[data-prod-theme="light"]'
$culture = [Globalization.CultureInfo]::InvariantCulture

function Convert-Color {
  param([double]$r, [double]$g, [double]$b, [double]$a, [string]$prop)
  $r1 = $r / 255; $g1 = $g / 255; $b1 = $b / 255
  $max = [Math]::Max($r1, [Math]::Max($g1, $b1)); $min = [Math]::Min($r1, [Math]::Min($g1, $b1))
  $l = ($max + $min) / 2
  $d = $max - $min
  if ($d -eq 0) { $h = 0.0; $s = 0.0 }
  else {
    if ($l -gt 0.5) { $s = $d / (2 - $max - $min) } else { $s = $d / ($max + $min) }
    if ($max -eq $r1) { $h = (($g1 - $b1) / $d) % 6 }
    elseif ($max -eq $g1) { $h = (($b1 - $r1) / $d) + 2 }
    else { $h = (($r1 - $g1) / $d) + 4 }
    $h = $h / 6; if ($h -lt 0) { $h += 1 }
  }

  $isShadow = $prop -match 'shadow|filter'
  # เงาสีดำ: คงเป็นเงาบางลง (พื้นสว่างไม่ต้องการเงาเข้ม)
  if ($isShadow -and $l -lt 0.12) {
    return 'rgba(30,41,59,' + ([Math]::Round($a * 0.35, 3)).ToString($culture) + ')'
  }
  # ฉากทับ (overlay) สีดำโปร่งแสง: คงเดิม
  if ($prop -like 'background*' -and $l -lt 0.06 -and $a -lt 0.8) {
    return 'rgba(' + [int]$r + ',' + [int]$g + ',' + [int]$b + ',' + ([Math]::Round($a, 3)).ToString($culture) + ')'
  }

  $l2 = 1 - $l
  if ($s -eq 0) { $rr = $l2; $gg = $l2; $bb = $l2 }
  else {
    if ($l2 -lt 0.5) { $q = $l2 * (1 + $s) } else { $q = $l2 + $s - $l2 * $s }
    $p = 2 * $l2 - $q
    $hue = {
      param($t)
      if ($t -lt 0) { $t += 1 }; if ($t -gt 1) { $t -= 1 }
      if ($t -lt 1/6) { return $p + ($q - $p) * 6 * $t }
      if ($t -lt 1/2) { return $q }
      if ($t -lt 2/3) { return $p + ($q - $p) * (2/3 - $t) * 6 }
      return $p
    }
    $rr = & $hue ($h + 1/3); $gg = & $hue $h; $bb = & $hue ($h - 1/3)
  }
  $ri = [int][Math]::Round($rr * 255); $gi = [int][Math]::Round($gg * 255); $bi = [int][Math]::Round($bb * 255)
  if ($a -ge 0.999) { return ('#{0:x2}{1:x2}{2:x2}' -f $ri, $gi, $bi) }
  return "rgba($ri,$gi,$bi," + ([Math]::Round($a, 3)).ToString($culture) + ')'
}

$tokenRegex = [regex]'(?<![\w&])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|rgba?\([^)]*\)|(?<![\w-])(?:white|black)(?![\w-])'

function Convert-ValueColors {
  param([string]$value, [string]$prop)
  $parts = [regex]::Split($value, '("[^"]*"|''[^'']*'')')
  for ($i = 0; $i -lt $parts.Length; $i += 2) {
    $parts[$i] = $tokenRegex.Replace($parts[$i], {
      param($m)
      $t = $m.Value
      if ($t -eq 'white') { return (Convert-Color 255 255 255 1 $prop) }
      if ($t -eq 'black') { return (Convert-Color 0 0 0 1 $prop) }
      if ($t.StartsWith('#')) {
        $x = $t.Substring(1)
        if ($x.Length -le 4) { $x = ($x.ToCharArray() | ForEach-Object { "$_$_" }) -join '' }
        $r = [Convert]::ToInt32($x.Substring(0, 2), 16); $g = [Convert]::ToInt32($x.Substring(2, 2), 16); $b = [Convert]::ToInt32($x.Substring(4, 2), 16)
        $a = 1.0; if ($x.Length -eq 8) { $a = [Convert]::ToInt32($x.Substring(6, 2), 16) / 255 }
        return (Convert-Color $r $g $b $a $prop)
      }
      $nums = [regex]::Matches($t, '[-+]?\d*\.?\d+%?') | ForEach-Object { $_.Value }
      if ($nums.Count -lt 3) { return $t }
      $vals = @()
      foreach ($n in $nums) { if ($n.EndsWith('%')) { $vals += ([double]::Parse($n.TrimEnd('%'), $culture) / 100) } else { $vals += [double]::Parse($n, $culture) } }
      $a = 1.0; if ($vals.Count -ge 4) { $a = $vals[3] }
      return (Convert-Color $vals[0] $vals[1] $vals[2] $a $prop)
    })
  }
  return ($parts -join '')
}

function Find-Close {
  param([string]$text, [int]$open)
  $depth = 0; $i = $open; $n = $text.Length
  while ($i -lt $n) {
    $c = $text[$i]
    if ($c -eq '"' -or $c -eq "'") { $q = $c; $i++; while ($i -lt $n -and $text[$i] -ne $q) { if ($text[$i] -eq '\') { $i++ }; $i++ }; $i++; continue }
    if ($c -eq '{') { $depth++ }
    elseif ($c -eq '}') { $depth--; if ($depth -eq 0) { return $i } }
    $i++
  }
  return -1
}

function Split-Top {
  param([string]$text, [char]$sep)
  $out = New-Object System.Collections.Generic.List[string]
  $sb = New-Object Text.StringBuilder; $paren = 0; $i = 0; $n = $text.Length
  while ($i -lt $n) {
    $c = $text[$i]
    if ($c -eq '"' -or $c -eq "'") { $q = $c; [void]$sb.Append($c); $i++; while ($i -lt $n -and $text[$i] -ne $q) { if ($text[$i] -eq '\') { [void]$sb.Append($text[$i]); $i++ }; [void]$sb.Append($text[$i]); $i++ }; if ($i -lt $n) { [void]$sb.Append($text[$i]) }; $i++; continue }
    if ($c -eq '(' -or $c -eq '[') { $paren++ } elseif ($c -eq ')' -or $c -eq ']') { $paren-- }
    if ($c -eq $sep -and $paren -eq 0) { $out.Add($sb.ToString()); [void]$sb.Clear() } else { [void]$sb.Append($c) }
    $i++
  }
  if ($sb.Length -gt 0) { $out.Add($sb.ToString()) }
  return $out
}

function Scope-Selector {
  param([string]$selector)
  $items = foreach ($p in (Split-Top $selector ',')) {
    $p = $p.Trim(); if (-not $p) { continue }
    if ($p -match '^(html|:root)(?![\w-])') { $scope + $p.Substring($Matches[1].Length) }
    else { "$scope $p" }
  }
  return ($items -join ',')
}

function Convert-Rules {
  param([string]$text)
  $out = New-Object Text.StringBuilder
  $pos = 0; $n = $text.Length
  while ($pos -lt $n) {
    $open = $text.IndexOf('{', $pos)
    if ($open -lt 0) { break }
    $prelude = $text.Substring($pos, $open - $pos).Trim()
    $close = Find-Close $text $open
    if ($close -lt 0) { break }
    $body = $text.Substring($open + 1, $close - $open - 1)
    $pos = $close + 1

    if ($prelude.StartsWith('@media') -or $prelude.StartsWith('@supports')) {
      $inner = Convert-Rules $body
      if ($inner.Trim()) { [void]$out.Append($prelude + '{' + "`n" + $inner + '}' + "`n") }
      continue
    }
    if ($prelude.StartsWith('@')) { continue }

    # ปล่อยทุกคุณสมบัติที่เกี่ยวกับสี (แม้ค่าไม่มีสี เช่น transparent/none/var()) เพื่อคงลำดับการชนะของ cascade เดิม
    $decls = New-Object System.Collections.Generic.List[string]
    foreach ($d in (Split-Top $body ';')) {
      $idx = $d.IndexOf(':'); if ($idx -lt 1) { continue }
      $prop = $d.Substring(0, $idx).Trim(); $val = $d.Substring($idx + 1).Trim()
      if ($prop -notmatch '^(color|background(-.*)?|border(-(top|right|bottom|left|block|inline).*)?|border-color|outline(-.*)?|box-shadow|text-shadow|fill|stroke|filter|backdrop-filter|scrollbar-color|caret-color|accent-color|column-rule.*|text-decoration(-color)?|--.*)$') { continue }
      $important = $val -match '!important\s*$'
      $val = ($val -replace '\s*!important\s*$', '').Trim()
      if ($val -match 'url\(') { continue }
      $new = Convert-ValueColors $val $prop
      $flag = ''; if ($important) { $flag = '!important' }
      $decls.Add("$prop`:$new$flag")
    }
    if ($decls.Count -gt 0) { [void]$out.Append((Scope-Selector $prelude) + '{' + ($decls -join ';') + '}' + "`n") }
  }
  return $out.ToString()
}

$css = [IO.File]::ReadAllText($Src, [Text.Encoding]::UTF8)
$css = [regex]::Replace($css, '/\*.*?\*/', '', 'Singleline')
$rules = Convert-Rules $css

$header = "/* AUTO-GENERATED by tools/build-light-theme.ps1 from css/style.css - อย่าแก้ไฟล์นี้ตรงๆ (แก้ที่ theme-light.extra.css หรือ style.css แล้วรันสคริปต์ใหม่) */`n"
$extraPath = Join-Path (Split-Path $Dst) 'theme-light.extra.css'
$extra = ''; if (Test-Path $extraPath) { $extra = [IO.File]::ReadAllText($extraPath, [Text.Encoding]::UTF8) }
[IO.File]::WriteAllText($Dst, $header + $scope + '{color-scheme:light}' + "`n" + $rules + "`n" + $extra, (New-Object Text.UTF8Encoding($false)))
"Wrote $Dst : $((Get-Item $Dst).Length) bytes"
