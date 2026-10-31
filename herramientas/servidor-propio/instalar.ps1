# Byte - Instalador del servidor propio (plan B de voz)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/instalar.ps1?v=$(Get-Random)" | iex
# Crea C:\Users\TU_USUARIO\byte-servidor con todos los archivos y abre el probador de voces.
# Si ya tienes data\.config.yaml (con tus claves), NO lo sobrescribe.

$ErrorActionPreference = "Stop"
$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio",
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio"
)

function Bajar($archivo, $destino) {
  foreach ($f in $fuentes) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$f/$archivo`?v=$(Get-Random)" -OutFile $destino
      return
    } catch { }
  }
  throw "No pude descargar $archivo. Revisa tu internet."
}

$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null
Write-Host "Descargando archivos de Byte en $dir ..." -ForegroundColor Cyan

foreach ($a in @("docker-compose.yml", "probar-voces.ps1", "texto-prueba.txt", "GUIA.md")) {
  Bajar $a (Join-Path $dir $a)
  Write-Host "  OK $a"
}

$config = Join-Path $data ".config.yaml"
if (Test-Path $config) {
  Bajar "config-ejemplo.yaml" (Join-Path $data "config-ejemplo.yaml")
  Write-Host "  Ya tenias data\.config.yaml: lo deje igual (el nuevo quedo como config-ejemplo.yaml)" -ForegroundColor Yellow
} else {
  Bajar "config-ejemplo.yaml" $config
  Write-Host "  OK data\.config.yaml (aqui iran tu clave de Groq y tu IP)"
}

Write-Host ""
Write-Host "Archivos listos. Ahora creo los audios de prueba..." -ForegroundColor Green
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dir "probar-voces.ps1")
