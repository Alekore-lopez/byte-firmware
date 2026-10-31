# Byte - Activar Spotify (Byte como control remoto; necesita Spotify Premium)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/activar-spotify.ps1?v=$(Get-Random)" | iex
# Antes: corre activar-internet.ps1 (este script se suma a esas herramientas).

$ErrorActionPreference = "Stop"
$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio",
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio"
)
function Bajar($archivo, $destino, $debeTener) {
  foreach ($f in $fuentes) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$f/$archivo`?v=$(Get-Random)" -OutFile $destino
      if ((Get-Content $destino -Raw) -match $debeTener) { return }
    } catch { }
  }
  throw "No pude descargar la version nueva de $archivo. Espera 5 minutos y vuelve a intentar."
}
$utf8 = New-Object Text.UTF8Encoding($false)

$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
$conf = Join-Path $data ".config.yaml"
$inet = Join-Path $dir "internet"
if (-not (Test-Path (Join-Path $inet "byte_internet.py"))) { throw "Primero corre activar-internet.ps1." }

Write-Host ""
Write-Host "=== 1) Bajando las herramientas de Spotify ===" -ForegroundColor Cyan
Bajar "byte_spotify.py" (Join-Path $inet "byte_spotify.py") "spotify_poner"
Bajar "byte_internet.py" (Join-Path $inet "byte_internet.py") "byte_spotify"
$py = $null
try { $py = (& python -c "import sys; print(sys.executable)") } catch { }
if (-not $py -or -not (Test-Path $py)) { throw "No encontre Python." }
$pyw = Join-Path (Split-Path $py) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = $py }
& $py -m pip install --quiet --upgrade spotipy
if ($LASTEXITCODE -ne 0) { throw "pip no pudo instalar spotipy. Mandale a Claude lo que salio arriba." }
Write-Host "Listo." -ForegroundColor Green

$cfg = Join-Path $inet "spotify.json"
if (-not (Test-Path $cfg)) {
  Write-Host ""
  Write-Host "=== 2) Crea tu app de Spotify (gratis, una sola vez) ===" -ForegroundColor Cyan
  Write-Host " a) Se abre developer.spotify.com/dashboard. Inicia sesion con tu cuenta Premium."
  Write-Host " b) 'Create app'. Nombre: Byte. Descripcion: asistente de casa."
  Write-Host " c) Redirect URI, copiala EXACTA:  http://127.0.0.1:8806/callback   y toca 'Add'."
  Write-Host " d) Marca 'Web API', acepta los terminos y 'Save'."
  Write-Host " e) Entra a la app > 'Settings' y copia el 'Client ID' (NO el Client secret)."
  Start-Process "https://developer.spotify.com/dashboard"
  do {
    $id = (Read-Host "Pega aqui el Client ID").Trim()
    $ok = $id -match "^[0-9a-fA-F]{32}$"
    if (-not $ok) { Write-Host "   El Client ID tiene 32 letras y numeros (0-9, a-f). Intenta de nuevo." -ForegroundColor Red }
  } until ($ok)
  [IO.File]::WriteAllText($cfg, "{`"client_id`": `"$id`"}", $utf8)
}

Write-Host ""
Write-Host "=== 3) Iniciar sesion en Spotify ===" -ForegroundColor Cyan
Write-Host "Se abre el navegador: toca 'Aceptar' para darle permiso a Byte."
Push-Location $inet
& $py byte_spotify.py --login
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { throw "No se pudo iniciar sesion. Revisa que la Redirect URI de tu app sea http://127.0.0.1:8806/callback" }

Write-Host ""
Write-Host "=== 4) Reiniciando las herramientas y la central ===" -ForegroundColor Cyan
$viejo = Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $viejo) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 1
Start-Process -FilePath $pyw -ArgumentList "`"$(Join-Path $inet 'byte_internet.py')`"" -WorkingDirectory $inet -WindowStyle Hidden
Start-Sleep -Seconds 5

$texto = [IO.File]::ReadAllText($conf, $utf8)
if ($texto -notmatch "spotify_poner") {
  $u = [char]0xFA
  $linea = "  - Para poner m${u}sica usa spotify_poner y para pausar, seguir o cambiar de canci$([char]0xF3)n usa spotify_control. La m${u}sica suena en el Spotify de Alecore (PC, celular o TV), no en tu parlante."
  $nuevo = [regex]::Replace($texto, "(?m)^(  - Si la pregunta no se entiende)", "$linea`n`$1")
  if ($nuevo -ne $texto) {
    Copy-Item $conf "$conf.antes-de-spotify" -Force
    [IO.File]::WriteAllText($conf, $nuevo, $utf8)
    Write-Host "Personalidad actualizada (copia: .config.yaml.antes-de-spotify)." -ForegroundColor Green
  }
}
$ErrorActionPreference = "Continue"
cmd /c "docker restart byte-servidor" | Out-Null
Write-Host "Esperando 25 segundos..." -ForegroundColor Cyan
Start-Sleep -Seconds 25
cmd /c "docker logs --since 1m byte-servidor 2>&1" | Select-String -Pattern "spotify_poner|ERROR" | Select-Object -Last 5
Write-Host ""
Write-Host "Listo. Abre Spotify en el PC, reabre Byte.bat y dile: 'Byte, pon musica de Karol G'." -ForegroundColor Green
