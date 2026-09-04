

param(
  [string]$Source = "$PSScriptRoot\..\native-host\assets\wide-logo.png",
  [string]$Out    = "$PSScriptRoot\..\native-host\assets\wide.ico",

  [string]$Tile   = "#2a2d37"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $Source)) { throw "Logo not found: $Source" }

$image = [System.Drawing.Image]::FromFile($Source)
$full  = New-Object System.Drawing.Bitmap($image)
$image.Dispose()

$corner = $full.GetPixel(0, 0)
$transparentSource = $corner.A -lt 16
$bg = if ($transparentSource) {
  [System.Drawing.ColorTranslator]::FromHtml($Tile)
} else {
  $corner
}
Write-Host ("kaynak: {0}x{1}, {2}, karo #{3:X2}{4:X2}{5:X2}" -f `
  $full.Width, $full.Height,
  $(if ($transparentSource) { "saydam" } else { "duz zemin" }),
  $bg.R, $bg.G, $bg.B)

$minX = $full.Width; $minY = $full.Height; $maxX = 0; $maxY = 0
for ($y = 0; $y -lt $full.Height; $y += 2) {
  for ($x = 0; $x -lt $full.Width; $x += 2) {
    $c = $full.GetPixel($x, $y)

    $isArt = if ($transparentSource) {
      $c.A -gt 64
    } else {
      $c.A -gt 10 -and
        ([Math]::Abs($c.R - $bg.R) + [Math]::Abs($c.G - $bg.G) + [Math]::Abs($c.B - $bg.B)) -gt 60
    }
    if ($isArt) {
      if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
    }
  }
}
if ($maxX -le $minX) { throw "Artwork not found in $Source (is it a single flat colour?)" }
Write-Host ("cizim alani: {0},{1} - {2},{3}" -f $minX, $minY, $maxX, $maxY)

$cx = ($minX + $maxX) / 2
$cy = ($minY + $maxY) / 2
$side = [Math]::Max($maxX - $minX, $maxY - $minY)
$side = [int]($side * 1.32)
$left = [int]($cx - $side / 2)
$top  = [int]($cy - $side / 2)

$ground = if ($transparentSource -and -not $PSBoundParameters.ContainsKey('Tile')) {
  [System.Drawing.Color]::Transparent
} else {
  $bg
}
Write-Host ("ikon zemini: {0}" -f $(if ($ground.A -eq 0) { "saydam" } else { "#{0:X2}{1:X2}{2:X2}" -f $ground.R, $ground.G, $ground.B }))

$sizes = @(256, 128, 64, 48, 32, 16)
$pngs  = @()
foreach ($size in $sizes) {
  $canvas = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.Clear($ground)

  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.DrawImage(
    $full,
    (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
    (New-Object System.Drawing.Rectangle($left, $top, $side, $side)),
    [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()

  $stream = New-Object System.IO.MemoryStream
  $canvas.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngs += ,$stream.ToArray()
  $stream.Dispose()
  $canvas.Dispose()
}
$full.Dispose()

$bytes = New-Object System.Collections.Generic.List[Byte]
$u16 = { param($v) $bytes.AddRange([System.BitConverter]::GetBytes([UInt16]$v)) }
$u32 = { param($v) $bytes.AddRange([System.BitConverter]::GetBytes([UInt32]$v)) }

& $u16 0
& $u16 1
& $u16 $sizes.Count
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $size = $sizes[$i]

  $dimension = [Byte]$(if ($size -ge 256) { 0 } else { $size })
  $bytes.Add($dimension)
  $bytes.Add($dimension)
  $bytes.Add([Byte]0)
  $bytes.Add([Byte]0)
  & $u16 1
  & $u16 32
  & $u32 $pngs[$i].Length
  & $u32 $offset
  $offset += $pngs[$i].Length
}
foreach ($png in $pngs) { $bytes.AddRange($png) }

$target = Join-Path (Resolve-Path -LiteralPath (Split-Path $Out)).Path (Split-Path $Out -Leaf)
[System.IO.File]::WriteAllBytes($target, $bytes.ToArray())
$Out = $target

Write-Host ("yazildi: {0} ({1} bayt, {2} boyut)" -f $Out, (Get-Item $Out).Length, $sizes.Count)
