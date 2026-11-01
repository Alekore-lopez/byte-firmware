# Byte en el celular - Instalar el puente en el HP (se corre una sola vez)
#
# Que hace:
#   1. Trae lo ultimo del repo y prepara el puente (npm install).
#   2. Revisa Tailscale (la red privada entre tu HP y tu iPhone).
#   3. Deja el puente arrancando solo al prender el PC (escondido).
#   4. Lo comparte por Tailscale con HTTPS (tailscale serve).
#   5. Abre la pagina con el codigo QR para emparejar el iPhone.
# No toca tus claves de Groq/Gemini ni la central.

$ErrorActionPreference = "Continue"
$repo   = Join-Path $HOME "byte-firmware"
$movil  = Join-Path $repo "herramientas\movil"
$datos  = Join-Path $HOME "byte-servidor\movil"
$PUERTO = 8810

function Paso($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "    [OK] $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "    [X]  $t" -ForegroundColor Red }
function Ojo($t)  { Write-Host "    [!]  $t" -ForegroundColor Yellow }
function Salir    { Read-Host "  Enter para cerrar"; exit 1 }

Write-Host ""
Write-Host "  ==== Byte en el celular: instalando el puente ====" -ForegroundColor White

# 1) Repo y Node
Paso "1/5 Codigo de Byte"
if (-not (Test-Path (Join-Path $repo ".git"))) { Mal "No encontre $repo. Clona el repo primero."; Salir }
Push-Location $repo
git checkout main 2>$null | Out-Null
git pull --ff-only 2>&1 | Out-Null
Pop-Location
if (-not (Test-Path (Join-Path $movil "puente.js"))) { Mal "No esta herramientas\movil (espera ~5 min tras fusionar el PR y vuelve a correr)."; Salir }
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Mal "Falta Node.js. Instalalo con: winget install -e --id OpenJS.NodeJS.LTS"; Salir }
Push-Location $movil
cmd /c "npm install --omit=dev --no-audit --no-fund >nul 2>&1"
$npmOk = ($LASTEXITCODE -eq 0)
Pop-Location
if ($npmOk) { Ok "Puente listo ($movil)." } else { Mal "npm install fallo. Corre 'npm install' dentro de $movil y mira el error."; Salir }

# 2) Tailscale
Paso "2/5 Tailscale (red privada HP <-> iPhone)"
$ts = (Get-Command tailscale -ErrorAction SilentlyContinue).Source
if (-not $ts) { $p = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"; if (Test-Path $p) { $ts = $p } }
if (-not $ts) {
  Ojo "Tailscale no esta instalado. Lo instalo ahora..."
  winget install -e --id Tailscale.Tailscale --accept-source-agreements --accept-package-agreements
  $p = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path $p) { $ts = $p } else { Mal "No se pudo instalar. Descargalo de tailscale.com/download"; Salir }
}
& $ts status *> $null
if ($LASTEXITCODE -ne 0) {
  Ojo "Tailscale no ha iniciado sesion. Se abre el navegador: entra con tu cuenta (Google sirve)."
  & $ts up
  & $ts status *> $null
  if ($LASTEXITCODE -ne 0) { Mal "Sigue sin sesion. Abre Tailscale (icono junto al reloj) -> Log in, y vuelve a correr este script."; Salir }
}
Ok "Tailscale conectado."

# 3) Arranque automatico (escondido)
Paso "3/5 Que el puente arranque solo con el PC"
New-Item -ItemType Directory -Force -Path $datos | Out-Null
$vbs = Join-Path $datos "iniciar-puente.vbs"
$linea = 'CreateObject("WScript.Shell").Run """' + $node + '"" ""' + (Join-Path $movil "puente.js") + '""", 0, False'
Set-Content -Path $vbs -Value $linea -Encoding ASCII
$lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "Byte movil.lnk"
$sh = New-Object -ComObject WScript.Shell
$a = $sh.CreateShortcut($lnk); $a.TargetPath = "wscript.exe"; $a.Arguments = "`"$vbs`""; $a.WorkingDirectory = $movil; $a.Save()
Ok "Arrancara solo al prender el PC."
if (Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) {
  Ok "El puente ya estaba corriendo."
} else {
  Start-Process wscript.exe -ArgumentList "`"$vbs`""
  $t = 0
  while (-not (Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) -and $t -lt 15) { Start-Sleep 1; $t++ }
  if (Get-NetTCPConnection -LocalPort $PUERTO -State Listen -ErrorAction SilentlyContinue) { Ok "Puente encendido." }
  else { Mal "El puente no arranco. Mira $datos\registro.txt"; Salir }
}

# 4) Compartir por Tailscale con HTTPS
Paso "4/5 Compartir el puente con tus equipos (HTTPS)"
$salida = & $ts serve --bg $PUERTO 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) {
  $dns = ((& $ts status --json | Out-String | ConvertFrom-Json).Self.DNSName).TrimEnd(".")
  Ok "Byte esta en: https://$dns"
  # El puente la lee de aqui si al arrancar no encuentra el programa de Tailscale
  Set-Content -Path (Join-Path $datos "direccion.txt") -Value $dns -Encoding ASCII
} else {
  Mal "tailscale serve no funciono."
  if ($salida -match "HTTPS|cert") {
    Ojo "Falta activar HTTPS en tu cuenta de Tailscale:"
    Ojo "  login.tailscale.com/admin/dns -> MagicDNS: Enable -> HTTPS Certificates: Enable"
    Start-Process "https://login.tailscale.com/admin/dns"
  } else { Write-Host $salida }
  Ojo "Cuando lo actives, vuelve a correr este script."
  Salir
}

# 5) Emparejar
Paso "5/5 Emparejar tu iPhone"
Start-Process "http://127.0.0.1:8811"
Ok "Se abrio la pagina con el codigo QR. Sigue los 3 pasos que salen ahi."
Write-Host ""
Write-Host "  ==== Listo. El iPhone necesita la app Tailscale abierta con tu misma cuenta ====" -ForegroundColor White
Read-Host "  Enter para cerrar"
