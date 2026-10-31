# Byte - Arreglar la central: herramientas propias, Gemini 3 y oido en espanol
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio/arreglar-central.ps1?v=$(Get-Random)" | iex
# Que hace:
#  1) Baja parche_byte.py y el docker-compose.yml nuevo (aplica el parche cada vez que arranca).
#  2) Apaga las herramientas de ejemplo del servidor (clima chino, noticias chinas) y
#     ajusta la personalidad para usar clima, noticias y buscar_en_internet.
#  3) Recrea la central y muestra el registro.

$ErrorActionPreference = "Stop"
$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio",
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio"
)
function Bajar($archivo, $destino) {
  foreach ($f in $fuentes) {
    try { Invoke-WebRequest -UseBasicParsing -Uri "$f/$archivo`?v=$(Get-Random)" -OutFile $destino; return } catch { }
  }
  throw "No pude descargar $archivo. Revisa tu internet."
}
$utf8 = New-Object Text.UTF8Encoding($false)

$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
$conf = Join-Path $data ".config.yaml"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }

Write-Host ""
Write-Host "=== 1) Bajando los arreglos ===" -ForegroundColor Cyan
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py")
Copy-Item (Join-Path $dir "docker-compose.yml") (Join-Path $dir "docker-compose.yml.anterior") -Force -ErrorAction SilentlyContinue
Bajar "docker-compose.yml" (Join-Path $dir "docker-compose.yml")
Write-Host "Listo." -ForegroundColor Green

Write-Host ""
Write-Host "=== 2) Ajustando la configuracion ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
$orig = $texto
$linea = "  - Para el clima usa la herramienta clima, para noticias usa noticias y para cualquier otro dato actual usa buscar_en_internet, siempre antes de responder. Si no encuentras nada, dilo con sencillez. Nunca inventes datos."
$texto = [regex]::Replace($texto, "(?m)^  - Para clima, noticias, precios[^\r\n]*", $linea)
$texto = [regex]::Replace($texto, "(?m)^  - Si te preguntan algo que cambia con el tiempo[^\r\n]*", $linea)
if ($texto -notmatch "(?m)^Intent:") {
  $bloque = "`n# Herramientas que trae el servidor: apagadas para que no choquen con las de Byte.`nIntent:`n  function_call:`n    type: function_call`n    functions: []`n"
  $texto = $texto.TrimEnd() + "`n" + $bloque
}
if ($texto -ne $orig) {
  Copy-Item $conf "$conf.antes-de-arreglo" -Force
  [IO.File]::WriteAllText($conf, $texto, $utf8)
  Write-Host "Configuracion actualizada (copia: .config.yaml.antes-de-arreglo)." -ForegroundColor Green
} else {
  Write-Host "La configuracion ya estaba al dia."
}

$ok = Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue
if (-not $ok) { Write-Host "OJO: las herramientas de internet no estan corriendo. Corre activar-internet.ps1 despues." -ForegroundColor Yellow }

Write-Host ""
Write-Host "=== 3) Recreando la central ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
Set-Location $dir
docker compose up -d --force-recreate 2>&1 | Out-Host
Write-Host "Esperando 30 segundos..." -ForegroundColor Cyan
Start-Sleep -Seconds 30
docker logs --since 1m byte-servidor 2>&1 | Select-String -Pattern "parche_byte|byte-internet|buscar_en_internet|Error|ERROR" | Select-Object -Last 15
Write-Host ""
Write-Host "Listo. Debes ver 'parche_byte ... arreglado' y las herramientas buscar_en_internet, noticias, clima." -ForegroundColor Green
Write-Host "Reabre Byte.bat y preguntale: 'Byte, como esta el clima en Bogota?'" -ForegroundColor Green
