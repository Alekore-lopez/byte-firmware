# Byte - Configurar y arrancar la central (servidor propio)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio/configurar.ps1?v=$(Get-Random)" | iex
# Te pide las claves (se quedan SOLO en tu PC), detecta tu IP, escribe
# data\.config.yaml completo y arranca la central con Docker.

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

$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
New-Item -ItemType Directory -Force -Path $data | Out-Null
Bajar "docker-compose.yml" (Join-Path $dir "docker-compose.yml")
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py")
$plantilla = Join-Path $data "config-ejemplo.yaml"
Bajar "config-ejemplo.yaml" $plantilla

Write-Host ""
Write-Host "=== Configurar la central de Byte ===" -ForegroundColor Cyan
Write-Host "Las claves que pegues aqui se guardan SOLO en tu PC." -ForegroundColor Yellow
Write-Host ""

do {
  $groq = (Read-Host "1) Pega tu clave de Groq (empieza por gsk_)").Trim()
  if (-not $groq.StartsWith("gsk_")) { Write-Host "   Esa no empieza por gsk_. Intenta de nuevo." -ForegroundColor Red }
} until ($groq.StartsWith("gsk_"))

do {
  $eleven = (Read-Host "2) Pega tu clave de ElevenLabs (empieza por sk_)").Trim()
  if (-not $eleven.StartsWith("sk_")) { Write-Host "   Esa no empieza por sk_ (no pegues el ID de la clave). Intenta de nuevo." -ForegroundColor Red }
} until ($eleven.StartsWith("sk_"))

$voz = (Read-Host "3) Voice ID de ElevenLabs [Enter = jIfDBCX5TxkYFbRa1J1L]").Trim()
if ($voz -eq "") { $voz = "jIfDBCX5TxkYFbRa1J1L" }

$ip = $null
try {
  $ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq "Up" } |
         Select-Object -First 1).IPv4Address.IPAddress
} catch { }
$resp = (Read-Host "4) Tu IP parece ser '$ip'. Enter si es correcta, o escribe la correcta").Trim()
if ($resp -ne "") { $ip = $resp }
if (-not $ip) { throw "No tengo IP. Mira 'Direccion IPv4' con el comando ipconfig y vuelve a correr esto." }

$texto = [IO.File]::ReadAllText($plantilla, [Text.Encoding]::UTF8)
$texto = $texto.Replace("192.168.1.50", $ip)
$texto = $texto.Replace("PEGA_AQUI_TU_CLAVE_DE_GROQ", $groq)
$texto = $texto.Replace("TU_VOICE_ID", $voz)
$texto = $texto.Replace("TU_CLAVE_DE_ELEVENLABS", $eleven)
$texto = $texto.Replace("TTS: EdgeTTS", "TTS: ElevenLabsTTS")

$config = Join-Path $data ".config.yaml"
if (Test-Path $config) { Copy-Item $config "$config.anterior" -Force }
[IO.File]::WriteAllText($config, $texto, (New-Object Text.UTF8Encoding($false)))
Remove-Item $plantilla -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Listo: configuracion guardada en $config" -ForegroundColor Green

$si = (Read-Host "5) Arrancar la central ahora? (s/n)").Trim().ToLower()
if ($si -eq "s") {
  Set-Location $dir
  Write-Host "Descargando y arrancando la central (la primera vez tarda varios minutos)..." -ForegroundColor Cyan
  docker compose up -d
  if ($LASTEXITCODE -ne 0) { throw "Docker no pudo arrancar. Revisa que Docker Desktop este abierto." }
  Write-Host ""
  Write-Host "Central encendida. Tu direccion OTA es: http://$($ip):8003/xiaozhi/ota/" -ForegroundColor Green
  Write-Host "Mostrando el registro (log). Para salir: Ctrl+C (la central sigue corriendo)." -ForegroundColor Yellow
  docker logs -f --tail 50 byte-servidor
}
