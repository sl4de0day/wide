

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root "dist\wide"
$hostExe = Join-Path $root "native-host\build\bin\Release\wide.exe"

if (-not (Test-Path $hostExe)) { throw "Build the host first (cmake --build …)." }

Write-Host "== clean =="











if (Test-Path $out) {
  foreach ($try in 1..5) {
    $left = Get-ChildItem $out -Force -ErrorAction SilentlyContinue
    if (-not $left) { break }
    $left | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    if ($try -lt 5) { Start-Sleep -Milliseconds 400 }
  }
  $left = Get-ChildItem $out -Force -ErrorAction SilentlyContinue
  if ($left) { throw "dist\wide could not be emptied; something has these open: $($left.Name -join ', ')" }
}
New-Item -ItemType Directory -Force -Path $out | Out-Null

Write-Host "== host exe + node.exe =="
Copy-Item $hostExe (Join-Path $out "wide.exe")
$node = (Get-Command node -ErrorAction Stop).Source
Copy-Item $node (Join-Path $out "node.exe")

Write-Host "== assets / ui / out\main / sidecar / resources =="
Copy-Item (Join-Path $root "native-host\assets") (Join-Path $out "assets") -Recurse
Copy-Item (Join-Path $root "out\renderer")        (Join-Path $out "ui")     -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $out "out") | Out-Null
Copy-Item (Join-Path $root "out\main")            (Join-Path $out "out\main") -Recurse
New-Item -ItemType Directory -Force -Path (Join-Path $out "sidecar\native")  | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $out "sidecar\workers") | Out-Null
Copy-Item (Join-Path $root "sidecar\*.cjs")         (Join-Path $out "sidecar")
Copy-Item (Join-Path $root "sidecar\native\*.cjs")  (Join-Path $out "sidecar\native")


Copy-Item (Join-Path $root "sidecar\workers\*.cjs") (Join-Path $out "sidecar\workers")



New-Item -ItemType Directory -Force -Path (Join-Path $out "resources") | Out-Null
Copy-Item (Join-Path $root "resources\sssF.include") (Join-Path $out "resources")

Write-Host "== production node_modules (typescript, node-pty, prettier, node-forge, grpc) =="
$pkg = @'
{ "name":"wide-runtime","version":"0.0.1","private":true,
  "dependencies":{ "@lydell/node-pty":"^1.2.0-beta.14","typescript":"^5.9.3","prettier":"^3.9.6","node-forge":"^1.3.1","@grpc/grpc-js":"^1.12.5","@grpc/proto-loader":"^0.7.13" } }
'@
Set-Content -Path (Join-Path $out "package.json") -Value $pkg -Encoding utf8
Push-Location $out
& npm install --omit=dev --no-audit --no-fund --ignore-scripts *> $null

Pop-Location

$size = [math]::Round(((Get-ChildItem $out -Recurse -File | Measure-Object Length -Sum).Sum/1MB),0)
Write-Host "== done: $out  ($size MB) =="
