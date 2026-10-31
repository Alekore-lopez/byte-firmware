# Byte - Aprender tus gustos y ser proactivo ("oye, seguimos con la playlist de ayer?")
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/aprender-gustos.ps1?v=$(Get-Random)" | iex
#
# Que hace (no toca tus claves):
#   1) Baja parche_byte.py nuevo a data\ :
#        - memoria version 2: guarda gustos (musica, temas, rutinas), que hicieron
#          la ultima vez e ideas para proponerte la proxima.
#        - una sola memoria para toda la casa: lo que aprende en el PC lo sabe la placa.
#        - el saludo al despertar llega en espanol ("Hola, Byte!").
#   2) Baja byte_spotify.py nuevo: anota lo que suena y trae spotify_retomar.
#   3) Agrega a la personalidad (.config.yaml) como usar lo que aprende.
#      Deja copias: .config.yaml.antes-de-gustos y .memory.yaml.antes-de-gustos
#   4) Reinicia la central y las herramientas.

$ErrorActionPreference = "Stop"
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
$inet = Join-Path $dir "internet"
$conf = Join-Path $data ".config.yaml"
$mem  = Join-Path $data ".memory.yaml"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }

Write-Host ""
Write-Host "=== 1) Bajando la memoria nueva (version 2) ===" -ForegroundColor Cyan
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py") "_BYTE_CLAVE_CASA"
if (Test-Path $mem) {
  Copy-Item $mem "$mem.antes-de-gustos" -Force
  Write-Host "Copia de lo que Byte ya recuerda: .memory.yaml.antes-de-gustos" -ForegroundColor Green
}
Write-Host "Listo." -ForegroundColor Green

Write-Host ""
Write-Host "=== 2) Bajando Spotify con historial ===" -ForegroundColor Cyan
$hayHerramientas = Test-Path (Join-Path $inet "byte_internet.py")
if ($hayHerramientas) {
  Bajar "byte_spotify.py" (Join-Path $inet "byte_spotify.py") "spotify_retomar"
  Write-Host "Listo. Lo que suene se anota en data\.musica_reciente.json" -ForegroundColor Green
} else {
  Write-Host "No tienes las herramientas de internet/Spotify; me salto este paso." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "=== 3) Ensenandole a usar lo que aprende ===" -ForegroundColor Cyan
$tmp = Join-Path $env:TEMP "byte-gustos-prompt.txt"
Bajar "gustos-prompt.txt" $tmp "spotify_retomar"
$bloque = ([IO.File]::ReadAllText($tmp, $utf8)) -replace "`r`n", "`n"
$texto = [IO.File]::ReadAllText($conf, $utf8)
$orig = $texto
if ($texto -match "LO QUE APRENDES DE ALECORE") {
  # Ya estaba: lo cambiamos por la version nueva (desde el titulo hasta la siguiente seccion)
  $texto = [regex]::Replace($texto, "(?ms)^  # LO QUE APRENDES DE ALECORE.*?(?=^  # )", { param($m) $bloque })
} elseif ($texto -match "(?m)^  # L.MITES") {
  $texto = [regex]::Replace($texto, "(?m)^(  # L.MITES)", { param($m) $bloque + $m.Groups[1].Value })
} elseif ($texto -match "(?m)^  # EJEMPLOS") {
  $texto = [regex]::Replace($texto, "(?m)^(  # EJEMPLOS)", { param($m) $bloque + $m.Groups[1].Value })
} else {
  Write-Host "No encontre donde agregarlo en la personalidad. Mandale a Claude una captura de esta ventana." -ForegroundColor Yellow
}
if ($texto -ne $orig) {
  Copy-Item $conf "$conf.antes-de-gustos" -Force
  [IO.File]::WriteAllText($conf, $texto, $utf8)
  Write-Host "Personalidad actualizada (copia: .config.yaml.antes-de-gustos)." -ForegroundColor Green
} else { Write-Host "La personalidad ya estaba al dia." }

Write-Host ""
Write-Host "=== 4) Reiniciando la central y las herramientas ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
if ($hayHerramientas) {
  $py = $null
  try { $py = (& python -c "import sys; print(sys.executable)") } catch { }
  if ($py -and (Test-Path $py)) {
    $pyw = Join-Path (Split-Path $py) "pythonw.exe"
    if (-not (Test-Path $pyw)) { $pyw = $py }
    $viejo = Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $viejo) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 1
    Start-Process -FilePath $pyw -ArgumentList "`"$(Join-Path $inet 'byte_internet.py')`"" -WorkingDirectory $inet -WindowStyle Hidden
    Start-Sleep -Seconds 5
    Write-Host "Herramientas reiniciadas." -ForegroundColor Green
  } else { Write-Host "No encontre Python: reinicia las herramientas con el boton 'Byte'." -ForegroundColor Yellow }
}
cmd /c "docker restart byte-servidor" | Out-Null
Start-Sleep -Seconds 25
cmd /c "docker logs --since 1m byte-servidor 2>&1" | Select-String -Pattern "parche_byte|ERROR" | Select-Object -Last 12

Write-Host ""
Write-Host "Listo. Como probarlo:" -ForegroundColor Green
Write-Host " 1) Dile a Byte: 'pon la playlist Rock en espanol' y 'recuerda que me encanta el cafe'." -ForegroundColor Green
Write-Host " 2) Dile 'suspendete' (ahi es cuando guarda lo que aprendio)." -ForegroundColor Green
Write-Host " 3) Espera 10 segundos, despiertalo con 'Byte' y escucha que te propone." -ForegroundColor Green
Write-Host " 4) Preguntale: 'Byte, que sabes de mi?'" -ForegroundColor Green
Write-Host "Ver lo que aprendio: Get-Content $mem" -ForegroundColor Green
