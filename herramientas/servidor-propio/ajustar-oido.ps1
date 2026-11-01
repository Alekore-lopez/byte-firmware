# Byte - Ajustar el oido (que espere a que termines de hablar y te entienda mejor)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/ajustar-oido.ps1?v=$(Get-Random)" | iex
#
# Que cambia en $HOME\byte-servidor\data\.config.yaml (deja copia .antes-de-oido):
#   1) Detector de voz (VAD): espera 1,2 s de silencio antes de responder (venia en 0,2 s).
#   2) Whisper: usa el modelo completo whisper-large-v3 en vez del "turbo".
# Y baja parche_byte.py nuevo: Whisper sin "creatividad", sin frases fantasma
# y corrigiendo "Suspended" (lo que a veces oye en ingles) a "Suspendete".
# No toca tus claves.

$ErrorActionPreference = "Stop"
$esperaMs = 1200   # cambia este numero si quieres que espere mas (1500) o menos (900)

$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-2d9gwt/herramientas/servidor-propio",
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio"
)
function Bajar($archivo, $destino, $debeTener) {
  foreach ($f in $fuentes) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "$f/$archivo`?v=$(Get-Random)" -OutFile $destino
      if ((Get-Content $destino -Raw -Encoding UTF8) -match $debeTener) { return }
    } catch { }
  }
  throw "No pude descargar la version nueva de $archivo. Espera 5 minutos y vuelve a intentar."
}
$utf8 = New-Object Text.UTF8Encoding($false)
$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
$conf = Join-Path $data ".config.yaml"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }

Write-Host ""
Write-Host "=== 1) Bajando el parche nuevo del oido ===" -ForegroundColor Cyan
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py") "_BYTE_CORRECCIONES"
Write-Host "Listo." -ForegroundColor Green

Write-Host ""
Write-Host "=== 2) Ajustando el detector de voz y Whisper ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
$orig = $texto
if ($texto -match "(?m)^VAD:") {
  # Ya hay bloque VAD: solo cambiamos cuanto espera.
  $texto = [regex]::Replace($texto, "(?m)^(\s+min_silence_duration_ms:\s*)\d+", "`${1}$esperaMs")
  if ($texto -notmatch "min_silence_duration_ms") {
    $texto = [regex]::Replace($texto, "(?m)^(  SileroVAD:\s*\r?\n)", "`${1}    min_silence_duration_ms: $esperaMs`n")
  }
} else {
  $vad = @"
# DETECTOR DE VOZ (VAD): decide cuando empezaste y cuando terminaste de hablar.
VAD:
  SileroVAD:
    type: silero
    model_dir: models/snakers4_silero-vad
    threshold: 0.5               # desde que "seguridad" (0 a 1) cuenta como voz. Sube a 0.6 si el ruido lo activa
    threshold_low: 0.25          # por debajo de esto ya es silencio. Mas bajo = no te corta si bajas la voz al final
    min_silence_duration_ms: $esperaMs   # cuanto silencio (milisegundos) espera antes de responder. Venia en 200

"@
  $vad = $vad -replace "`r`n", "`n"
  if ($texto -match "(?m)^ASR:") {
    $texto = [regex]::Replace($texto, "(?m)^ASR:", ($vad + "ASR:"))
  } else {
    $texto = $texto.TrimEnd() + "`n`n" + $vad
  }
}
$texto = $texto.Replace("model_name: whisper-large-v3-turbo", "model_name: whisper-large-v3")

if ($texto -ne $orig) {
  Copy-Item $conf "$conf.antes-de-oido" -Force
  [IO.File]::WriteAllText($conf, $texto, $utf8)
  Write-Host "Configuracion actualizada (copia: .config.yaml.antes-de-oido)." -ForegroundColor Green
} else { Write-Host "Ya estaba ajustado." }
Write-Host ""
Select-String -Path $conf -Pattern "min_silence_duration_ms|threshold|model_name: whisper" | ForEach-Object { "  " + $_.Line.Trim() }

Write-Host ""
Write-Host "=== 3) Reiniciando la central ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
cmd /c "docker restart byte-servidor" | Out-Null
Start-Sleep -Seconds 25
cmd /c "docker logs --since 1m byte-servidor 2>&1" | Select-String -Pattern "parche_byte|SileroVAD|ERROR" | Select-Object -Last 10
Write-Host ""
Write-Host "Listo. Prueba: dile a Byte una frase larga con una pausa en la mitad," -ForegroundColor Green
Write-Host "por ejemplo 'Byte, cuentame... un dato curioso de los pulpos'. Debe esperar a que termines." -ForegroundColor Green
Write-Host "Si quedo muy lento, cambia min_silence_duration_ms a 900 en $conf y corre: docker restart byte-servidor" -ForegroundColor Green
