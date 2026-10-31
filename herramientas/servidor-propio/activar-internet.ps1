# Byte - Activar la busqueda en internet en la central (clima, noticias, buscar)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio/activar-internet.ps1?v=$(Get-Random)" | iex
# Que hace:
#  1) Baja byte_internet.py a $HOME\byte-servidor\internet e instala lo que necesita.
#  2) Lo arranca sin ventana (puerto 8805, solo en este PC) y lo deja en el Inicio de Windows.
#  3) Le dice a la central que use esas herramientas (data\.mcp_server_settings.json).
#  4) Ajusta la personalidad para que busque antes de responder y reinicia la central.
# No necesita claves.

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
$inet = Join-Path $dir "internet"
New-Item -ItemType Directory -Force -Path $inet | Out-Null

Write-Host ""
Write-Host "=== 1) Bajando las herramientas de internet ===" -ForegroundColor Cyan
$script = Join-Path $inet "byte_internet.py"
Bajar "byte_internet.py" $script

$py = $null
try { $py = (& python -c "import sys; print(sys.executable)") } catch { }
if (-not $py -or -not (Test-Path $py)) { throw "No encontre Python. Abre una terminal nueva o instala Python 3 desde python.org." }
$pyw = Join-Path (Split-Path $py) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = $py }
Write-Host "Python: $py"
& $py -m pip install --quiet --upgrade fastmcp ddgs
if ($LASTEXITCODE -ne 0) { throw "pip no pudo instalar fastmcp/ddgs. Mandale a Claude lo que salio arriba." }

Write-Host ""
Write-Host "=== 2) Arrancando las herramientas (puerto 8805) ===" -ForegroundColor Cyan
$viejo = Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $viejo) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
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

# Acceso directo en Inicio: arrancan solas al prender el PC
$inicio = [Environment]::GetFolderPath("Startup")
$ws = New-Object -ComObject WScript.Shell
$lnk = $ws.CreateShortcut((Join-Path $inicio "Byte internet.lnk"))
$lnk.TargetPath = $pyw
$lnk.Arguments = "`"$script`""
$lnk.WorkingDirectory = $inet
$lnk.WindowStyle = 7
$lnk.Save()
Write-Host "Quedan en el Inicio de Windows (arrancan solas)."

Write-Host ""
Write-Host "=== 3) Conectando la central ===" -ForegroundColor Cyan
$mcp = @'
{
  "mcpServers": {
    "byte-internet": {
      "url": "http://host.docker.internal:8805/mcp",
      "transport": "streamable-http"
    }
  }
}
'@
[IO.File]::WriteAllText((Join-Path $data ".mcp_server_settings.json"), $mcp, $utf8)

# Desde aqui los comandos de docker escriben avisos normales; no los tomamos como error
$ErrorActionPreference = "Continue"

# Prueba: la central (dentro de Docker) alcanza las herramientas?
$prueba = @'
import urllib.request, urllib.error
try:
    urllib.request.urlopen("http://host.docker.internal:8805/mcp", timeout=5)
    print("OK")
except urllib.error.HTTPError:
    print("OK")
except Exception as e:
    print("NO", e)
'@
[IO.File]::WriteAllText((Join-Path $data "probar_internet.py"), $prueba, $utf8)
$r = (docker exec byte-servidor python /opt/xiaozhi-esp32-server/data/probar_internet.py) 2>&1
Remove-Item (Join-Path $data "probar_internet.py") -ErrorAction SilentlyContinue
if ("$r" -notmatch "^OK") { Write-Host "La central no alcanza las herramientas: $r" -ForegroundColor Red; Write-Host "Mandale a Claude este mensaje." }
else { Write-Host "La central alcanza las herramientas." -ForegroundColor Green }

Write-Host ""
Write-Host "=== 4) Ajustando la personalidad ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
if ($texto -match "buscar_en_internet") {
  Write-Host "La personalidad ya menciona las herramientas."
} else {
  $linea = "  - Para el clima usa la herramienta clima, para noticias usa noticias y para cualquier otro dato actual usa buscar_en_internet, siempre antes de responder. Si no encuentras nada, dilo con sencillez. Nunca inventes datos."
  $nuevo = [regex]::Replace($texto, "(?m)^  - Si te preguntan algo que cambia con el tiempo[^\r\n]*", $linea)
  if ($nuevo -eq $texto) {
    Write-Host "No encontre la linea a cambiar; la agrego al final de QUE HACES." -ForegroundColor Yellow
    $nuevo = [regex]::Replace($texto, "(?m)^(  - Si la pregunta no se entiende)", "$linea`n`$1")
  }
  Copy-Item $conf "$conf.antes-de-internet" -Force
  [IO.File]::WriteAllText($conf, $nuevo, $utf8)
  Write-Host "Personalidad actualizada (copia: .config.yaml.antes-de-internet)." -ForegroundColor Green
}

docker restart byte-servidor | Out-Null
Write-Host ""
Write-Host "Central reiniciada. Esperando 25 segundos..." -ForegroundColor Cyan
Start-Sleep -Seconds 25
docker logs --since 1m byte-servidor 2>&1 | Select-String -Pattern "mcp|MCP|byte-internet|error|Error" | Select-Object -Last 15
Write-Host ""
Write-Host "Listo. Reabre Byte.bat y preguntale: 'Byte, como esta el clima en Bogota?'" -ForegroundColor Green
