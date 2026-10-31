# Byte - Crear los botones "Byte" y "Apagar Byte" en el escritorio
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/crear-boton.ps1?v=$(Get-Random)" | iex

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
  throw "No pude descargar $archivo. Espera 5 minutos y vuelve a intentar."
}

$dir = Join-Path $HOME "byte-servidor"
if (-not (Test-Path (Join-Path $dir "docker-compose.yml"))) { throw "Primero corre configurar.ps1." }
Bajar "encender-byte.ps1" (Join-Path $dir "encender-byte.ps1") "Encendiendo a Byte"
Bajar "apagar-byte.ps1" (Join-Path $dir "apagar-byte.ps1") "Apagando a Byte"

# Icono de la nube (lo creo el instalador de la pantalla); si no esta, uno de Windows
$ico = Join-Path $env:LOCALAPPDATA "Byte\byte.ico"
if (-not (Test-Path $ico)) { $ico = "$env:SystemRoot\System32\imageres.dll,109" }

$ps = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$esc = [Environment]::GetFolderPath("Desktop")
$ws = New-Object -ComObject WScript.Shell
function Boton($nombre, $script, $icono, $descripcion) {
  $l = $ws.CreateShortcut((Join-Path $esc "$nombre.lnk"))
  $l.TargetPath = $ps
  $l.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $dir $script)`""
  $l.WorkingDirectory = $dir
  $l.IconLocation = $icono
  $l.Description = $descripcion
  $l.Save()
}
Boton "Byte" "encender-byte.ps1" $ico "Enciende Docker, la central, las herramientas y Byte"
Boton "Apagar Byte" "apagar-byte.ps1" "$env:SystemRoot\System32\shell32.dll,27" "Apaga Byte, las herramientas y la central"

Write-Host ""
Write-Host "Listo: en tu escritorio quedaron 'Byte' (la nube) y 'Apagar Byte'." -ForegroundColor Green
Write-Host "Doble clic en 'Byte' y espera a que diga 'Byte encendido'." -ForegroundColor Green
Write-Host "Tip: clic derecho en 'Byte' > 'Anclar a la barra de tareas' para tenerlo a un clic." -ForegroundColor Cyan
