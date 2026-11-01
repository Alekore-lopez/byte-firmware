# Byte - Llamar al dueno por su nombre: "Alejandro" (antes usaba un apodo)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/cambiar-nombre.ps1?v=$(Get-Random)" | iex
#
# Que hace (no toca tus claves):
#   1) En la personalidad (.config.yaml) cambia el apodo por "Alejandro" y deja
#      claro que Alejandro es su creador y su dueno. Copia: .config.yaml.antes-de-nombre
#   2) En lo que Byte recuerda (.memory.yaml) cambia el apodo por "Alejandro",
#      asi no se le olvida nada. Copia: .memory.yaml.antes-de-nombre
#   3) Baja parche_byte.py y byte_spotify.py nuevos (el oido y la memoria
#      tambien usan el nombre) y reinicia la central y las herramientas.

$ErrorActionPreference = "Stop"
$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio",
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-w5vuhx/herramientas/servidor-propio"
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
$utf8  = New-Object Text.UTF8Encoding($false)
$dir   = Join-Path $HOME "byte-servidor"
$data  = Join-Path $dir "data"
$inet  = Join-Path $dir "internet"
$conf  = Join-Path $data ".config.yaml"
$mem   = Join-Path $data ".memory.yaml"
$apodo = "Ale" + "core"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }

Write-Host ""
Write-Host "=== 1) Personalidad: Alejandro, su creador y dueno ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
$orig  = $texto
$a = [char]0xE1   # a con tilde
$n = [char]0xF1   # enie
# La linea de "con quien hablas": creador Y dueno
$texto = [regex]::Replace($texto, "(?m)^  - $apodo es tu creador y la persona principal\..*$",
  "  - Alejandro es tu creador y tu due${n}o, la persona principal. Ll${a}malo `"Alejandro`".")
$texto = $texto.Replace($apodo, "Alejandro").Replace($apodo.ToUpper(), "ALEJANDRO")
if ($texto -ne $orig) {
  Copy-Item $conf "$conf.antes-de-nombre" -Force
  [IO.File]::WriteAllText($conf, $texto, $utf8)
  Write-Host "Listo: ahora Byte te llama Alejandro." -ForegroundColor Green
} else { Write-Host "La personalidad ya decia Alejandro." }

Write-Host ""
Write-Host "=== 2) Memoria: lo que Byte ya sabe de ti ===" -ForegroundColor Cyan
if (Test-Path $mem) {
  $m = [IO.File]::ReadAllText($mem, $utf8)
  $m2 = $m.Replace($apodo, "Alejandro")
  if ($m2 -ne $m) {
    Copy-Item $mem "$mem.antes-de-nombre" -Force
    [IO.File]::WriteAllText($mem, $m2, $utf8)
    Write-Host "Listo: recuerda todo, ahora con tu nombre." -ForegroundColor Green
  } else { Write-Host "La memoria no tenia el apodo." }
} else { Write-Host "Byte todavia no tiene memoria guardada; nada que cambiar." }

Write-Host ""
Write-Host "=== 3) Oido y herramientas con tu nombre ===" -ForegroundColor Cyan
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py") "nombre_dueno"
$hayHerramientas = Test-Path (Join-Path $inet "byte_internet.py")
if ($hayHerramientas -and (Test-Path (Join-Path $inet "byte_spotify.py"))) {
  Bajar "byte_spotify.py" (Join-Path $inet "byte_spotify.py") "Alejandro"
}
Write-Host "Listo." -ForegroundColor Green

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
Write-Host "Listo. Pruebalo: 'Byte, como me llamo?' o 'Byte, quien es tu dueno?'" -ForegroundColor Green
