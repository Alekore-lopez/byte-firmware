# Byte - Cambiar el cerebro de la central a OmniRoute (combo con respaldo)
# Uso, en PowerShell:
#   cd $HOME\byte-firmware; git pull
#   powershell -ExecutionPolicy Bypass -File herramientas\omniroute\usar-omniroute.ps1
# Para volver al cerebro de antes (Gemini directo):
#   powershell -ExecutionPolicy Bypass -File herramientas\omniroute\usar-omniroute.ps1 -Volver
#
# Que hace:
#   1. Enciende OmniRoute y prueba el combo desde tu PC (si falla, no cambia nada).
#   2. Prueba que la central (dentro de Docker) alcance a OmniRoute.
#   3. Copia de seguridad del .config.yaml.
#   4. Agrega el bloque OmniRouteLLM y lo pone como cerebro (LLM).
#   5. Reinicia la central.
# Usa la misma clave de OmniRoute que guardo instalar-omniroute.ps1 (cifrada).
param([string]$Modelo = "byte", [switch]$Volver)

$ErrorActionPreference = "Continue"
$aqui   = Split-Path -Parent $MyInvocation.MyCommand.Path
$conf   = Join-Path $HOME "byte-servidor\data\.config.yaml"
$copia  = "$conf.antes-de-omniroute"
$utf8   = New-Object Text.UTF8Encoding($false)
function Paso($t) { Write-Host ""; Write-Host "  $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "    [OK] $t" -ForegroundColor Green }
function Mal($t)  { Write-Host "    [X]  $t" -ForegroundColor Red }
function Salir    { Read-Host "  Enter para cerrar"; exit 1 }

Write-Host ""
Write-Host "  ==== Byte: cerebro por OmniRoute ====" -ForegroundColor White
if (-not (Test-Path $conf)) { Mal "No encontre $conf"; Salir }

if ($Volver) {
  if (-not (Test-Path $copia)) { Mal "No hay copia $copia"; Salir }
  Copy-Item $copia $conf -Force
  docker restart byte-servidor | Out-Null
  Ok "Volvio el cerebro de antes y la central se reinicio. Espera 20 s y habla con Byte."
  Read-Host "  Enter para cerrar"; exit 0
}

# 1) OmniRoute + clave + prueba desde el PC
Paso "1/5 Probando el combo '$Modelo' desde tu PC"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $aqui "encender-omniroute.ps1") -Silencio
if ($LASTEXITCODE -ne 0) { Salir }
$archivoClave = Join-Path $HOME "byte-omniroute\clave.dat"
if (-not (Test-Path $archivoClave)) { Mal "No hay clave guardada. Corre instalar-omniroute.ps1"; Salir }
try {
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR((Get-Content $archivoClave | ConvertTo-SecureString))
  $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
} catch { Mal "No pude leer la clave guardada. Corre instalar-omniroute.ps1"; Salir }

$cuerpo = @{ model = $Modelo; max_tokens = 60; messages = @(@{ role = "user"; content = "Saluda en una frase corta, en espanol." }) } | ConvertTo-Json -Depth 5
$inicio = Get-Date
try {
  $r = Invoke-RestMethod -Method Post -Uri "http://localhost:20128/v1/chat/completions" -Headers @{ Authorization = "Bearer $clave" } -ContentType "application/json" -Body $cuerpo -TimeoutSec 60
  $seg = [math]::Round(((Get-Date) - $inicio).TotalSeconds, 1)
  Ok "El combo contesto en $seg s: $($r.choices[0].message.content)"
} catch {
  Mal "El combo '$Modelo' no contesto: $($_.Exception.Message)"
  Write-Host "    Revisa en el panel que el combo exista con ese nombre y que la clave tenga permiso para usarlo." -ForegroundColor Yellow
  Write-Host "    No cambie nada de Byte." -ForegroundColor Yellow
  Salir
}

# 2) Desde Docker
Paso "2/5 Probando que la central alcance a OmniRoute"
$py = "import urllib.request,sys;q=urllib.request.Request('http://host.docker.internal:20128/v1/models',headers={'Authorization':'Bearer '+sys.argv[1]});print(urllib.request.urlopen(q,timeout=8).status)"
$estado = docker exec byte-servidor python -c $py $clave 2>&1
if ("$estado" -match "200") { Ok "La central ve a OmniRoute (host.docker.internal:20128)." }
else {
  Mal "La central no alcanza a OmniRoute: $estado"
  Write-Host "    Revisa que la central este encendida (boton Byte) y vuelve a intentar. No cambie nada." -ForegroundColor Yellow
  Salir
}

# 3) Copia de seguridad (la primera copia se conserva: es la de antes de OmniRoute)
Paso "3/5 Copia de seguridad"
if (-not (Test-Path $copia)) { Copy-Item $conf $copia -Force }
Copy-Item $conf "$conf.$(Get-Date -Format yyyyMMdd-HHmmss).bak" -Force
Ok "Copia guardada: $copia"

# 4) Editar .config.yaml linea por linea
Paso "4/5 Poniendo OmniRoute como cerebro"
$texto = [IO.File]::ReadAllText($conf, $utf8)
$nl = if ($texto.Contains("`r`n")) { "`r`n" } else { "`n" }
$lineas = [System.Collections.Generic.List[string]]($texto -split "\r?\n")

# Quitar un bloque OmniRouteLLM viejo (si se corre dos veces)
$i = $lineas.FindIndex({ param($l) $l -match '^  OmniRouteLLM:\s*$' })
if ($i -ge 0) {
  $lineas.RemoveAt($i)
  while ($i -lt $lineas.Count -and $lineas[$i] -match '^    ') { $lineas.RemoveAt($i) }
}
$j = $lineas.FindIndex({ param($l) $l -match '^LLM:\s*(#.*)?$' })
if ($j -lt 0) { Mal "No encontre la seccion 'LLM:' en .config.yaml. No cambie nada."; Salir }
$bloque = @(
  "  OmniRouteLLM:",
  "    type: openai",
  "    api_key: $clave",
  "    base_url: http://host.docker.internal:20128/v1",
  "    model_name: $Modelo",
  "    temperature: 0.7",
  "    max_tokens: 800"
)
$lineas.InsertRange($j + 1, [string[]]$bloque)

$cambio = $false
for ($k = 0; $k -lt $lineas.Count; $k++) {
  if ($lineas[$k] -match '^[ \t]+LLM:[ \t]*\S+') {
    $lineas[$k] = $lineas[$k] -replace 'LLM:[ \t]*\S+', 'LLM: OmniRouteLLM'
    $cambio = $true
    break
  }
}
if (-not $cambio) { Mal "No encontre 'LLM:' dentro de selected_module. No cambie nada."; Salir }
[IO.File]::WriteAllText($conf, ($lineas -join $nl), $utf8)
Remove-Variable clave
Ok "Cerebro = OmniRouteLLM (combo '$Modelo')."

# 5) Reiniciar
Paso "5/5 Reiniciando la central"
docker restart byte-servidor | Out-Null
Ok "Listo. Espera 20 segundos, abre Byte y saludalo."
Write-Host ""
Write-Host "  Si algo sale mal, vuelve al cerebro de antes con:" -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File herramientas\omniroute\usar-omniroute.ps1 -Volver" -ForegroundColor Cyan
Read-Host "  Enter para cerrar"
