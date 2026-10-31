# Byte - Probar voces estilo caricatura (Edge TTS, gratis, sin claves)
# Lo ejecuta instalar.ps1. Tambien puedes correrlo solo:
#   powershell -ExecutionPolicy Bypass -File "$HOME\byte-servidor\probar-voces.ps1"

$ErrorActionPreference = "Stop"
$aqui    = Split-Path -Parent $MyInvocation.MyCommand.Path
$texto   = Join-Path $aqui "texto-prueba.txt"
$carpeta = Join-Path $HOME "byte-voces"
New-Item -ItemType Directory -Force -Path $carpeta | Out-Null

Write-Host "Instalando edge-tts (solo la primera vez)..." -ForegroundColor Cyan
python -m pip install --quiet --upgrade edge-tts
if ($LASTEXITCODE -ne 0) { throw "No se pudo instalar edge-tts. Revisa que Python funcione con: python --version" }

# Voz, tono (Hz) y velocidad (%). Subir el tono = voz mas aguda, tipo caricatura.
$pruebas = @(
  @{ voz = "es-CO-GonzaloNeural"; tono = "+0Hz";  vel = "+0%"  },
  @{ voz = "es-CO-GonzaloNeural"; tono = "+30Hz"; vel = "+10%" },
  @{ voz = "es-CO-GonzaloNeural"; tono = "+60Hz"; vel = "+15%" },
  @{ voz = "es-CO-SalomeNeural";  tono = "+30Hz"; vel = "+10%" },
  @{ voz = "es-MX-JorgeNeural";   tono = "+40Hz"; vel = "+10%" },
  @{ voz = "es-MX-JorgeNeural";   tono = "+70Hz"; vel = "+20%" }
)

$n = 1
foreach ($p in $pruebas) {
  $nombre = ("{0}-{1}-tono{2}-vel{3}.mp3" -f $n, $p.voz, $p.tono, $p.vel) -replace '[+%]', ''
  $salida = Join-Path $carpeta $nombre
  Write-Host "Creando $nombre ..."
  python -m edge_tts --voice $p.voz "--pitch=$($p.tono)" "--rate=$($p.vel)" --file $texto --write-media $salida
  $n++
}

Write-Host "Listo. Escucha los audios y dile a Claude cual numero te gusto." -ForegroundColor Green
Start-Process explorer.exe $carpeta
