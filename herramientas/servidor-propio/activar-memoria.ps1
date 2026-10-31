# Byte - Activar la memoria (recuerda lo que le cuentas entre conversaciones)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/activar-memoria.ps1?v=$(Get-Random)" | iex
# La memoria se guarda SOLO en tu PC: $HOME\byte-servidor\data\.memory.yaml

$ErrorActionPreference = "Stop"
$fuentes = @(
  "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio",
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
Write-Host "=== 1) Bajando el parche de memoria en espanol ===" -ForegroundColor Cyan
Bajar "parche_byte.py" (Join-Path $data "parche_byte.py") "cuaderno de memoria"
Write-Host "Listo." -ForegroundColor Green

Write-Host ""
Write-Host "=== 2) Prendiendo la memoria ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
$orig = $texto
$texto = [regex]::Replace($texto, "(?m)^  Memory: nomem[^\r\n]*", "  Memory: mem_local_short")
if ($texto -notmatch "(?m)^Memory:") {
  $texto = $texto.TrimEnd() + "`n`n# Memoria: resume lo importante al final de cada conversacion (data/.memory.yaml)`nMemory:`n  mem_local_short:`n    type: mem_local_short`n    llm: `"`"`n"
}
if ($texto -notmatch "conversaciones pasadas") {
  $linea = "  - Lo que recuerdas de conversaciones pasadas est$([char]0xE1) en tu memoria: $([char]0xFA)salo con naturalidad cuando venga al caso, sin recitarlo."
  $texto = [regex]::Replace($texto, "(?m)^(  - Si la pregunta no se entiende)", "$linea`n`$1")
}
if ($texto -ne $orig) {
  Copy-Item $conf "$conf.antes-de-memoria" -Force
  [IO.File]::WriteAllText($conf, $texto, $utf8)
  Write-Host "Configuracion actualizada (copia: .config.yaml.antes-de-memoria)." -ForegroundColor Green
} else { Write-Host "La memoria ya estaba prendida." }

Write-Host ""
Write-Host "=== 3) Reiniciando la central ===" -ForegroundColor Cyan
$ErrorActionPreference = "Continue"
cmd /c "docker restart byte-servidor" | Out-Null
Start-Sleep -Seconds 25
cmd /c "docker logs --since 1m byte-servidor 2>&1" | Select-String -Pattern "parche_byte|ERROR" | Select-Object -Last 8
Write-Host ""
Write-Host "Listo. Prueba: cuentale algo a Byte, dile 'suspendete', despiertalo y preguntale si lo recuerda." -ForegroundColor Green
Write-Host "Ver lo que recuerda: Get-Content $data\.memory.yaml" -ForegroundColor Green
