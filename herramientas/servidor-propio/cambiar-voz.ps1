# Byte - Cambiar la voz (poner otra voz de ElevenLabs)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/cambiar-voz.ps1?v=$(Get-Random)" | iex
#
# Que hace:
#   1) Te pide el Voice ID de la voz nueva (lo copias en elevenlabs.io > My Voices > ... > Copy voice ID).
#   2) Hace una prueba: Byte dice una frase con la voz nueva y la escuchas ANTES de cambiar nada.
#   3) Si te gusta, la pone en $HOME\byte-servidor\data\.config.yaml (deja copia .antes-de-voz)
#      y reinicia la central.
# Tu clave de ElevenLabs NO se muestra ni se pide: se lee del .config.yaml que ya tienes.
# Para volver a la voz anterior: corre este mismo script y pega el Voice ID viejo.

$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
$conf = Join-Path $HOME "byte-servidor\data\.config.yaml"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }
$texto = [IO.File]::ReadAllText($conf, $utf8)

$m = [regex]::Match($texto, "text-to-speech/([^?""/\s]+)")
if (-not $m.Success) { throw "No encontre la voz de ElevenLabs en $conf (bloque ElevenLabsTTS)." }
$vozActual = $m.Groups[1].Value
$k = [regex]::Match($texto, "xi-api-key:\s*""?([^""\r\n]+)""?")
if (-not $k.Success -or $k.Groups[1].Value -match "TU_CLAVE") { throw "No hay clave de ElevenLabs en $conf." }
$clave = $k.Groups[1].Value.Trim()

Write-Host ""
Write-Host "Voz actual de Byte: $vozActual" -ForegroundColor Cyan
Write-Host "Pega el Voice ID de la voz nueva (son unas 20 letras y numeros, ej. jIfDBCX5TxkYFbRa1J1L):"
$voz = (Read-Host "Voice ID").Trim()
if ($voz -notmatch "^[A-Za-z0-9]{15,40}$") {
  throw "Eso no parece un Voice ID. Copialo en elevenlabs.io > My Voices > (los 3 puntos de la voz) > Copy voice ID."
}
if ($voz -eq $vozActual) { Write-Host "Esa ya es la voz de Byte. No cambie nada." -ForegroundColor Yellow; return }

Write-Host ""
Write-Host "=== 1) Prueba de la voz nueva ===" -ForegroundColor Cyan
$prueba = Join-Path $env:TEMP "byte-voz-prueba.mp3"
$cuerpo = @{ text = "Hola Alejandro, soy Byte. Asi suena mi voz nueva. Que tal te parece?"; model_id = "eleven_flash_v2_5"; language_code = "es" } | ConvertTo-Json
try {
  Invoke-WebRequest -UseBasicParsing -Method Post `
    -Uri "https://api.elevenlabs.io/v1/text-to-speech/$voz`?output_format=mp3_44100_128" `
    -Headers @{ "xi-api-key" = $clave } -ContentType "application/json; charset=utf-8" `
    -Body ([Text.Encoding]::UTF8.GetBytes($cuerpo)) -OutFile $prueba
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  $detalle = ""
  try { $detalle = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch { }
  if ($detalle) { Write-Host "ElevenLabs dice: $detalle" -ForegroundColor DarkGray }
  if ($code -eq 402) { throw "ElevenLabs pide plan de pago para usar esa voz por API. Pasa con las voces de la 'Voice Library' (de otras personas) en el plan gratis. Usa una voz creada por ti en Voice Design, o sube a un plan pago." }
  if ($code -eq 404 -or $code -eq 400) { throw "ElevenLabs no encontro esa voz. Revisa que este guardada en 'My Voices' (boton Save / Add to my voices) y copia de nuevo el ID." }
  if ($code -eq 401) { throw "ElevenLabs rechazo la clave del .config.yaml (o le falta permiso de Text to Speech)." }
  throw "No pude probar la voz (codigo $code): $($_.Exception.Message)"
}
Write-Host "Escuchala: se abre el audio de prueba..." -ForegroundColor Green
Start-Process $prueba
$ok = Read-Host "Te gusta? Escribe S para ponersela a Byte, o N para dejar la de antes"
if ($ok -notmatch "^[sS]") { Write-Host "No cambie nada. Byte sigue con su voz de antes." -ForegroundColor Yellow; return }

Write-Host ""
Write-Host "=== 2) Poniendo la voz nueva ===" -ForegroundColor Cyan
Copy-Item $conf "$conf.antes-de-voz" -Force
$texto = $texto.Replace("text-to-speech/$vozActual", "text-to-speech/$voz")
# Por si Byte todavia hablaba con la voz gratis de respaldo:
$texto = [regex]::Replace($texto, "(?m)^(\s+TTS:\s*)EdgeTTS\b", "`${1}ElevenLabsTTS")
[IO.File]::WriteAllText($conf, $texto, $utf8)
Write-Host "Listo (copia de la anterior: .config.yaml.antes-de-voz)." -ForegroundColor Green

Write-Host ""
Write-Host "=== 3) Reiniciando la central ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
cmd /c "docker restart byte-servidor" | Out-Null
Start-Sleep -Seconds 25
cmd /c "docker logs --since 1m byte-servidor 2>&1" | Select-String -Pattern "TTS|ERROR" | Select-Object -Last 6
Write-Host ""
Write-Host "Listo. Abre Byte y dile 'Byte, cuentame un chiste' para oir la voz nueva." -ForegroundColor Green
Write-Host "Para volver a la anterior: corre este script otra vez y pega $vozActual" -ForegroundColor Green
