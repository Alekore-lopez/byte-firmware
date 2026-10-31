# Byte - Cambiar el cerebro de la central a Google Gemini (plan gratis con limites mas altos)
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/refs/heads/claude/project-thread-oolb50/herramientas/servidor-propio/cambiar-a-gemini.ps1?v=$(Get-Random)" | iex
# Pide tu clave de Gemini (aistudio.google.com/apikey), elige un modelo "flash" disponible,
# lo pone en data\.config.yaml y reinicia la central. El oido (Groq Whisper) y la voz no cambian.

$ErrorActionPreference = "Stop"
$f = Join-Path $HOME "byte-servidor\data\.config.yaml"
if (-not (Test-Path $f)) { throw "No encuentro $f. Corre primero configurar.ps1" }

do {
  $g = (Read-Host "Pega tu clave de Gemini (empieza por AIza o AQ.)").Trim()
  $ok = ($g.Length -ge 20) -and -not $g.Contains(" ")
  if (-not $ok) { Write-Host "   Esa no parece una clave de Gemini. Intenta de nuevo." -ForegroundColor Red }
} until ($ok)

Write-Host "Buscando modelos disponibles para tu clave..." -ForegroundColor Cyan
$lista = (Invoke-RestMethod "https://generativelanguage.googleapis.com/v1beta/openai/models" -Headers @{ Authorization = "Bearer $g" }).data.id |
         ForEach-Object { $_ -replace '^models/', '' }
$flash = $lista | Where-Object { $_ -match 'flash' -and $_ -notmatch 'image|tts|audio|live|preview|exp|thinking|embedding' }
$preferidos = @("gemini-2.5-flash-lite", "gemini-2.0-flash", "gemini-2.5-flash")
$modelo = $null
foreach ($p in $preferidos) { if ($flash -contains $p) { $modelo = $p; break } }
if (-not $modelo) { $modelo = ($flash | Where-Object { $_ -match 'lite' } | Select-Object -First 1) }
if (-not $modelo) { $modelo = ($flash | Select-Object -First 1) }
if (-not $modelo) { Write-Host ($lista -join "`n"); throw "No encontre un modelo flash. Mandale a Claude esta lista." }
Write-Host "Modelo elegido: $modelo" -ForegroundColor Green

$t = [IO.File]::ReadAllText($f)
Copy-Item $f "$f.antes-de-gemini" -Force
$t = $t -replace 'LLM: GroqLLM', 'LLM: GeminiLLM'
if ($t -notmatch 'GeminiLLM:') {
  $bloque = "LLM:`n  GeminiLLM:`n    type: openai`n    api_key: $g`n    base_url: https://generativelanguage.googleapis.com/v1beta/openai/`n    model_name: $modelo`n    temperature: 0.7`n    max_tokens: 800`n"
  $t = [regex]::Replace($t, 'LLM:\r?\n  GroqLLM:', ($bloque + "  GroqLLM:"))
}
[IO.File]::WriteAllText($f, $t, (New-Object Text.UTF8Encoding($false)))
Write-Host "Configuracion actualizada (copia de seguridad: .config.yaml.antes-de-gemini)." -ForegroundColor Green

docker restart byte-servidor | Out-Null
Write-Host "Central reiniciada. Espera 20 segundos, reabre Byte.bat y saludalo." -ForegroundColor Green
