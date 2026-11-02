# Byte - Encender todo con un clic
# Lo abre el boton "Byte" del escritorio (lo crea crear-boton.ps1).
# Orden: Docker Desktop -> central (contenedor) -> herramientas (internet,
# Spotify) -> espera a que la central responda -> abre Byte (py-xiaozhi).

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Encendiendo Byte"
$dir  = Join-Path $HOME "byte-servidor"
$inet = Join-Path $dir "internet"

function Paso($texto) { Write-Host ""; Write-Host "  $texto" -ForegroundColor Cyan }
function Ok($texto)   { Write-Host "    $texto" -ForegroundColor Green }
function Mal($texto)  { Write-Host "    $texto" -ForegroundColor Red }
function DockerListo { cmd /c "docker info >nul 2>&1"; return ($LASTEXITCODE -eq 0) }

Write-Host ""
Write-Host "  ==== Encendiendo a Byte ====" -ForegroundColor White

# Si el cerebro de Byte pasa por OmniRoute (puerto 20128), se enciende antes de la revision
$cfg = Join-Path $dir "data\.config.yaml"
$omni = Join-Path $HOME "byte-firmware\herramientas\omniroute\encender-omniroute.ps1"
if ((Test-Path $omni) -and (Test-Path $cfg) -and (Select-String -Path $cfg -Pattern ":20128" -Quiet)) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $omni -Silencio
}

# 0) Revision previa: si algo grave falla, no arranca y dice como arreglarlo
$revisar = Join-Path $dir "revisar-byte.ps1"
if (Test-Path $revisar) {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $revisar
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "  No encendi a Byte porque hay fallas graves (en rojo). Arreglalas y vuelve a tocar el boton." -ForegroundColor Red
    Read-Host "  Enter para cerrar"
    exit 1
  }
  Start-Sleep -Seconds 2
}

# 1) Docker Desktop
Paso "1/4 Docker (la casa de la central)"
if (-not (DockerListo)) {
  $exe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
  if (-not (Test-Path $exe)) { Mal "No encontre Docker Desktop."; Read-Host "Enter para cerrar"; exit 1 }
  Start-Process $exe
  Write-Host "    Abriendo Docker Desktop (puede tardar hasta 2 minutos)" -NoNewline
  $t = 0
  while (-not (DockerListo) -and $t -lt 180) { Start-Sleep -Seconds 3; $t += 3; Write-Host "." -NoNewline }
  Write-Host ""
  if (-not (DockerListo)) { Mal "Docker no arranco. Abrelo a mano y vuelve a tocar el boton."; Read-Host "Enter para cerrar"; exit 1 }
}
Ok "Docker listo."

# 2) Central
Paso "2/4 Central (oido, cerebro y voz)"
Push-Location $dir
cmd /c "docker compose up -d >nul 2>&1"
Pop-Location
if ($LASTEXITCODE -ne 0) { Mal "La central no arranco. Revisa con: docker logs byte-servidor"; Read-Host "Enter para cerrar"; exit 1 }
Ok "Central encendida."

# 3) Herramientas (internet, Spotify)
Paso "3/4 Herramientas (internet y Spotify)"
if (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue) {
  Ok "Ya estaban corriendo."
} elseif (Test-Path (Join-Path $inet "byte_internet.py")) {
  $lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Byte internet.lnk"
  if (Test-Path $lnk) { Start-Process $lnk }
  else {
    $py = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
    if (-not $py) { $py = (Get-Command python -ErrorAction SilentlyContinue).Source }
    Start-Process -FilePath $py -ArgumentList "`"$(Join-Path $inet 'byte_internet.py')`"" -WorkingDirectory $inet -WindowStyle Hidden
  }
  $t = 0
  while (-not (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue) -and $t -lt 20) { Start-Sleep -Seconds 1; $t++ }
  if (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue) { Ok "Herramientas en linea." }
  else { Mal "No arrancaron (Byte funciona, pero sin internet ni Spotify). Mira internet\registro.txt" }
} else {
  Write-Host "    No estan instaladas (opcional)." -ForegroundColor Yellow
}

# 4) Esperar a que la central responda y abrir Byte
Paso "4/4 Esperando a que la central conteste"
$listo = $false
$t = 0
while (-not $listo -and $t -lt 90) {
  try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:8003/xiaozhi/ota/" -TimeoutSec 3 | Out-Null; $listo = $true }
  catch { if ($_.Exception.Response) { $listo = $true } else { Start-Sleep -Seconds 2; $t += 2; Write-Host "." -NoNewline } }
}
Write-Host ""
if ($listo) { Ok "La central contesta." } else { Write-Host "    La central tarda; abro Byte igual." -ForegroundColor Yellow }

$bat = Join-Path ([Environment]::GetFolderPath("Desktop")) "Byte.bat"
$pyx = Join-Path $HOME "py-xiaozhi"
if (Test-Path $bat) {
  Start-Process $bat -WindowStyle Minimized
  Ok "Abriendo Byte en el PC..."
} elseif (Test-Path (Join-Path $pyx "main.py")) {
  Start-Process -FilePath "python" -ArgumentList "main.py" -WorkingDirectory $pyx -WindowStyle Minimized
  Ok "Abriendo Byte en el PC..."
} else {
  Ok "Central lista. Enciende la placa de Byte y te contestara."
}

# Byte Desk (si ya lo instalaste): queda en la barra, junto al reloj
$desk = Join-Path $HOME "byte-firmware\herramientas\desk"
$electron = Join-Path $desk "node_modules\electron\dist\electron.exe"
if (Test-Path $electron) {
  # --oculto: arranca en la barra sin abrir la ventana. Si ya estaba abierto, no se duplica.
  Start-Process -FilePath $electron -ArgumentList "`"$desk`" --oculto" -WorkingDirectory $desk
  Ok "Byte Desk activo en la barra (junto al reloj)."
}

# Puente del celular (si ya lo instalaste con herramientas\movil\instalar-movil.ps1)
$vbsMovil = Join-Path $dir "movil\iniciar-puente.vbs"
if ((Test-Path $vbsMovil) -and -not (Get-NetTCPConnection -LocalPort 8810 -State Listen -ErrorAction SilentlyContinue)) {
  Start-Process wscript.exe -ArgumentList "`"$vbsMovil`""
  Ok "Puente del celular encendido."
}

Write-Host ""
Write-Host "  ==== Byte encendido. Dile 'Oye Byte' ====" -ForegroundColor White
Start-Sleep -Seconds 4
