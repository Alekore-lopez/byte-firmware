# OmniRoute - Encender el servidor (sin ventanas) y, si quieres, abrir el panel
# Uso: powershell -File encender-omniroute.ps1 [-Panel] [-Silencio]
#   -Panel     abre http://localhost:20128 en el navegador al final
#   -Silencio  no espera Enter al terminar (lo usan otros scripts)
param([switch]$Panel, [switch]$Silencio)

$ErrorActionPreference = "Continue"
$PUERTO = 20128
function Ok($t)  { Write-Host "    [OK] $t" -ForegroundColor Green }
function Mal($t) { Write-Host "    [X]  $t" -ForegroundColor Red }
function Escuchando { [bool](Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) }

if (Escuchando) {
  Ok "OmniRoute ya estaba encendido."
} else {
  if (-not (Get-Command omniroute -ErrorAction SilentlyContinue)) {
    Mal "No encontre el comando 'omniroute'. Instalalo con: npm install -g omniroute"
    if (-not $Silencio) { Read-Host "  Enter para cerrar" }
    exit 1
  }
  # Seguridad: OmniRoute escucha en toda la red WiFi. Con esto, nadie puede
  # usar tus modelos sin la clave de OmniRoute (Byte y la terminal si la tienen).
  $env:REQUIRE_API_KEY = "true"
  # --daemon = corre escondido en segundo plano; --no-open = no abre el navegador
  Start-Process -FilePath "cmd.exe" -ArgumentList "/c omniroute serve --daemon --no-open" -WindowStyle Hidden
  Write-Host "    Encendiendo OmniRoute" -NoNewline
  $t = 0
  while (-not (Escuchando) -and $t -lt 90) { Start-Sleep -Seconds 2; $t += 2; Write-Host "." -NoNewline }
  Write-Host ""
  if (Escuchando) { Ok "OmniRoute encendido en http://localhost:$PUERTO" }
  else {
    Mal "OmniRoute no contesto en 90 s. Prueba a mano en una terminal: omniroute serve"
    if (-not $Silencio) { Read-Host "  Enter para cerrar" }
    exit 1
  }
}

if ($Panel) { Start-Process "http://localhost:$PUERTO" }
exit 0
