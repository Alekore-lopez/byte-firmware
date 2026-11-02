# OmniRoute - Instalar los botones de un clic (se corre una sola vez)
# Uso, en PowerShell:
#   cd $HOME\byte-firmware; git checkout main; git pull
#   powershell -ExecutionPolicy Bypass -File herramientas\omniroute\instalar-omniroute.ps1
#
# Que hace:
#   1. Revisa que OmniRoute este instalado y lo enciende.
#   2. Guarda tu clave de OmniRoute CIFRADA (solo tu usuario de Windows la lee).
#   3. Guarda el nombre del modelo para programar.
#   4. Ofrece instalar aider (el ayudante de programacion por terminal).
#   5. Crea en el escritorio: "OmniRoute", "Programar con IA" y "Apagar OmniRoute".
# No toca la central de Byte ni tu .config.yaml.

$ErrorActionPreference = "Continue"
$aqui  = Split-Path -Parent $MyInvocation.MyCommand.Path
$datos = Join-Path $HOME "byte-omniroute"
function Paso($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "    [OK] $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "    [X]  $t" -ForegroundColor Red }
function Ojo($t)  { Write-Host "    [!]  $t" -ForegroundColor Yellow }

Write-Host ""
Write-Host "  ==== OmniRoute: botones de un clic ====" -ForegroundColor White
New-Item -ItemType Directory -Force -Path $datos | Out-Null

# 1) OmniRoute
Paso "1/5 OmniRoute"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $aqui "encender-omniroute.ps1") -Silencio
if ($LASTEXITCODE -ne 0) { Read-Host "  Enter para cerrar"; exit 1 }

# 2) Clave (se escribe con asteriscos; nunca se muestra ni se guarda en texto plano)
Paso "2/5 Clave de OmniRoute"
$archivoClave = Join-Path $datos "clave.dat"
$cambiar = "s"
if (Test-Path $archivoClave) { $cambiar = Read-Host "    Ya tienes una clave guardada. Cambiarla? (s/n)" }
if ($cambiar -eq "s") {
  Write-Host "    Copiala del panel: OmniProxy > Endpoint > Claves registradas." -ForegroundColor Gray
  $seguro = Read-Host "    Pega la clave y presiona Enter" -AsSecureString
  if ($seguro.Length -lt 8) { Mal "La clave quedo vacia o muy corta. Corre el instalador de nuevo."; Read-Host "  Enter para cerrar"; exit 1 }
  $seguro | ConvertFrom-SecureString | Set-Content -Path $archivoClave
  Ok "Clave guardada cifrada en $archivoClave"
} else { Ok "Se mantiene la clave que ya tenias." }

# 3) Modelo para programar
Paso "3/5 Modelo para programar"
$archivoModelo = Join-Path $datos "modelo.txt"
$actual = ""
if (Test-Path $archivoModelo) { $actual = (Get-Content $archivoModelo -Raw).Trim() }
Write-Host "    Escribe el nombre del modelo o combo tal como sale en OmniRoute" -ForegroundColor Gray
Write-Host "    (lo ves en el panel, en Modelos o Combos). Enter = dejar '$actual'." -ForegroundColor Gray
$m = Read-Host "    Modelo"
if ($m.Trim()) { Set-Content -Path $archivoModelo -Value $m.Trim(); Ok "Modelo: $($m.Trim())" }
elseif ($actual) { Ok "Modelo: $actual" }
else { Ojo "Sin modelo por ahora. Lo puedes escribir luego en $archivoModelo" }

# 4) aider
Paso "4/5 aider (programar por terminal)"
if (Get-Command aider -ErrorAction SilentlyContinue) { Ok "aider ya esta instalado." }
elseif (-not (Get-Command python -ErrorAction SilentlyContinue)) { Ojo "No encontre Python; instala aider luego." }
else {
  $r = Read-Host "    Instalo aider ahora? Tarda 1-3 minutos (s/n)"
  if ($r -eq "s") {
    python -m pip install --upgrade aider-install
    aider-install
    if (Get-Command aider -ErrorAction SilentlyContinue) { Ok "aider instalado." }
    else { Ojo "aider quedo instalado pero Windows aun no lo ve. Cierra y abre la terminal." }
  }
}

# 5) Botones del escritorio
Paso "5/5 Botones del escritorio"
$ps  = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$esc = [Environment]::GetFolderPath("Desktop")
$ws  = New-Object -ComObject WScript.Shell
function Boton($nombre, $argumentos, $icono, $descripcion) {
  $l = $ws.CreateShortcut((Join-Path $esc "$nombre.lnk"))
  $l.TargetPath = $ps
  $l.Arguments = $argumentos
  $l.WorkingDirectory = $aqui
  $l.IconLocation = $icono
  $l.Description = $descripcion
  $l.Save()
}
$f = "-NoProfile -ExecutionPolicy Bypass"
Boton "OmniRoute" "$f -File `"$(Join-Path $aqui 'encender-omniroute.ps1')`" -Panel -Silencio" "$env:SystemRoot\System32\shell32.dll,13" "Enciende OmniRoute y abre su panel"
Boton "Programar con IA" "$f -NoExit -File `"$(Join-Path $aqui 'programar.ps1')`"" "$env:SystemRoot\System32\imageres.dll,264" "Terminal con aider conectada a OmniRoute"
Boton "Apagar OmniRoute" "$f -File `"$(Join-Path $aqui 'apagar-omniroute.ps1')`"" "$env:SystemRoot\System32\shell32.dll,27" "Apaga OmniRoute"
Ok "Listo: 'OmniRoute', 'Programar con IA' y 'Apagar OmniRoute' en tu escritorio."

Write-Host ""
Write-Host "  Tip: clic derecho en 'Programar con IA' > 'Anclar a la barra de tareas'." -ForegroundColor Cyan
Write-Host "  Recuerda: cambia la contrasena CHANGEME del panel si aun no lo hiciste." -ForegroundColor Yellow
Read-Host "  Enter para cerrar"
