# Byte - Actualizar las herramientas de internet (clima, noticias, buscar) y probarlas
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/actualizar-internet.ps1?v=$(Get-Random)" | iex
#
# Que hace:
#  1) Baja la version nueva de byte_internet.py (clima mas rapido: IPv4 primero,
#     maximo 7 s por pagina, plan B wttr.in, Bogota sin buscar coordenadas).
#  2) Prueba el clima de Bogota aqui mismo y te dice cuanto tardo.
#  3) Reinicia las herramientas (puerto 8805) y revisa que la central las alcance.
# No toca la voz, ni la personalidad, ni las claves.

$ErrorActionPreference = "Stop"
$base = "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio"
$inet = Join-Path $HOME "byte-servidor\internet"
if (-not (Test-Path $inet)) { throw "No encontre $inet. Primero corre activar-internet.ps1." }
$script = Join-Path $inet "byte_internet.py"

Write-Host ""
Write-Host "=== 1) Bajando la version nueva ===" -ForegroundColor Cyan
if (Test-Path $script) { Copy-Item $script "$script.antes" -Force }
Invoke-WebRequest -UseBasicParsing -Uri "$base/byte_internet.py?v=$(Get-Random)" -OutFile $script
Write-Host "Listo (copia de la anterior: byte_internet.py.antes)" -ForegroundColor Green

$py = (& python -c "import sys; print(sys.executable)")
$pyw = Join-Path (Split-Path $py) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = $py }

Write-Host ""
Write-Host "=== 2) Probando el clima de Bogota desde este PC ===" -ForegroundColor Cyan
Push-Location $inet
& $py byte_internet.py --probar-clima
Pop-Location

Write-Host ""
Write-Host "=== 3) Reiniciando las herramientas (puerto 8805) ===" -ForegroundColor Cyan
foreach ($c in (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue)) {
  Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
Start-Process -FilePath $pyw -ArgumentList "`"$script`"" -WorkingDirectory $inet -WindowStyle Hidden
$listo = $false
for ($i = 0; $i -lt 20 -and -not $listo; $i++) {
  Start-Sleep -Seconds 1
  if (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue) { $listo = $true }
}
if (-not $listo) {
  Get-Content (Join-Path $inet "registro.txt") -Tail 20 -ErrorAction SilentlyContinue
  throw "Las herramientas no arrancaron. Mandale a Claude lo que salio arriba."
}
Write-Host "Herramientas en linea." -ForegroundColor Green

# La central (Docker) tiene que poder llegar a las herramientas
$prueba = docker exec byte-servidor python -c "import socket; socket.create_connection(('host.docker.internal', 8805), 5); print('ok')" 2>&1
if ("$prueba" -match "^ok") { Write-Host "La central alcanza las herramientas." -ForegroundColor Green }
else { Write-Host "La central NO alcanza las herramientas: $prueba" -ForegroundColor Red }

# La central se reconecta a las herramientas al reiniciarse
docker restart byte-servidor | Out-Null
Write-Host ""
Write-Host "Central reiniciada. Espera unos 20 s y preguntale el clima a Byte." -ForegroundColor White
