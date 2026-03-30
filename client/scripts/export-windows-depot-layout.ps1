param(
  [string]$DepotRoot = ".\releases\steam\microsoft-windows",
  [string]$OutputPng = ".\tests\output\platforms\windows\depot-layout.png",
  [string]$OutputTxt = ".\tests\output\platforms\windows\depot-layout.txt",
  [int]$MaxFileLines = 110
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Format-Bytes([long]$Bytes) {
  if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
  if ($Bytes -ge 1MB) { return "{0:N2} MB" -f ($Bytes / 1MB) }
  if ($Bytes -ge 1KB) { return "{0:N2} KB" -f ($Bytes / 1KB) }
  return "$Bytes B"
}

function Relative-DepotPath([string]$Root, [string]$Target) {
  return [System.IO.Path]::GetRelativePath($Root, $Target).Replace("/", "\")
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$resolvedDepotRoot = (Resolve-Path (Join-Path $repoRoot $DepotRoot)).Path
$resolvedOutputPng = Join-Path $repoRoot $OutputPng
$resolvedOutputTxt = Join-Path $repoRoot $OutputTxt

New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($resolvedOutputPng)) | Out-Null
New-Item -ItemType Directory -Force -Path ([System.IO.Path]::GetDirectoryName($resolvedOutputTxt)) | Out-Null

$files = Get-ChildItem -LiteralPath $resolvedDepotRoot -Recurse -File | Sort-Object FullName
$topLevelEntries = Get-ChildItem -LiteralPath $resolvedDepotRoot | Sort-Object @{ Expression = { -not $_.PSIsContainer } }, Name
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
if ($null -eq $totalBytes) {
  $totalBytes = 0
}

$keyPaths = @(
  "ConquerorsDominationDemo.exe",
  "locales",
  "resources\app.asar",
  "resources\dist\index.html",
  "resources\server\dist\index.js"
)

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Conquerors Domination Demo - Windows Steam Depot")
$lines.Add("Generated on Windows runner: $(Get-Date -Format s)")
$lines.Add("Depot root: $resolvedDepotRoot")
$lines.Add("Total files: $($files.Count)")
$lines.Add("Total size: $(Format-Bytes([long]$totalBytes))")
$lines.Add("")
$lines.Add("Top-level entries:")
foreach ($entry in $topLevelEntries) {
  $kind = if ($entry.PSIsContainer) { "[DIR]" } else { "[FILE]" }
  $size = if ($entry.PSIsContainer) { "" } else { " ($(Format-Bytes([long]$entry.Length)))" }
  $lines.Add("  $kind $($entry.Name)$size")
}

$lines.Add("")
$lines.Add("Key launch/runtime paths:")
foreach ($relativePath in $keyPaths) {
  $absolutePath = Join-Path $resolvedDepotRoot $relativePath
  $status = if (Test-Path -LiteralPath $absolutePath) { "OK" } else { "MISSING" }
  $lines.Add("  [$status] $relativePath")
}

$lines.Add("")
$lines.Add("Sample recursive file list:")
$displayFiles = $files | Select-Object -First $MaxFileLines
foreach ($file in $displayFiles) {
  $relativePath = Relative-DepotPath $resolvedDepotRoot $file.FullName
  $lines.Add("  $relativePath ($(Format-Bytes([long]$file.Length)))")
}

if ($files.Count -gt $MaxFileLines) {
  $lines.Add("  ... plus $($files.Count - $MaxFileLines) more files")
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($resolvedOutputTxt, $lines, $utf8NoBom)

Add-Type -AssemblyName System.Drawing

$font = New-Object System.Drawing.Font("Consolas", 15, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
$headerFont = New-Object System.Drawing.Font("Consolas", 18, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
$probeBitmap = New-Object System.Drawing.Bitmap 1, 1
$probeGraphics = [System.Drawing.Graphics]::FromImage($probeBitmap)
$probeGraphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

$lineHeight = [Math]::Ceiling($probeGraphics.MeasureString("Ag", $font).Height) + 4
$headerHeight = [Math]::Ceiling($probeGraphics.MeasureString("Ag", $headerFont).Height) + 8
$maxWidth = 0

for ($index = 0; $index -lt $lines.Count; $index++) {
  $activeFont = if ($index -eq 0) { $headerFont } else { $font }
  $measured = $probeGraphics.MeasureString($lines[$index], $activeFont)
  if ($measured.Width -gt $maxWidth) {
    $maxWidth = $measured.Width
  }
}

$probeGraphics.Dispose()
$probeBitmap.Dispose()

$padding = 28
$width = [Math]::Max(1700, [int][Math]::Ceiling($maxWidth) + ($padding * 2))
$height = [Math]::Max(950, $padding + $headerHeight + (($lines.Count - 1) * $lineHeight) + $padding)

$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(20, 25, 31))

$headerBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 244, 180, 77))
$textBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 235, 240, 245))
$mutedBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 150, 165, 180))

$y = $padding
for ($index = 0; $index -lt $lines.Count; $index++) {
  $line = $lines[$index]
  if ($index -eq 0) {
    $graphics.DrawString($line, $headerFont, $headerBrush, $padding, $y)
    $y += $headerHeight
    continue
  }

  $brush = if ($line.StartsWith("  [OK]") -or $line.StartsWith("  [MISSING]")) { $headerBrush } elseif ([string]::IsNullOrWhiteSpace($line)) { $mutedBrush } else { $textBrush }
  $graphics.DrawString($line, $font, $brush, $padding, $y)
  $y += $lineHeight
}

$bitmap.Save($resolvedOutputPng, [System.Drawing.Imaging.ImageFormat]::Png)

$graphics.Dispose()
$bitmap.Dispose()
$font.Dispose()
$headerFont.Dispose()
$headerBrush.Dispose()
$textBrush.Dispose()
$mutedBrush.Dispose()

Write-Host "Windows depot layout screenshot saved to $resolvedOutputPng"
Write-Host "Windows depot layout text report saved to $resolvedOutputTxt"
