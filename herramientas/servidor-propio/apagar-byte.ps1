# Byte - Apagar todo con un clic (lo abre el boton "Apagar Byte" del escritorio)
$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Apagando Byte"
Write-Host ""
Write-Host "  ==== Apagando a Byte ====" -ForegroundColor White

# Programa de Byte en el PC (py-xiaozhi)
Get-CimInstance Win32_Process -Filter "Name like 'python%'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "main\.py" -and $_.CommandLine -notmatch "byte_internet" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host "    Programa de Byte cerrado." -ForegroundColor Green

# Herramientas (internet, Spotify)
Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Write-Host "    Herramientas apagadas." -ForegroundColor Green

# Central
cmd /c "docker stop byte-servidor >nul 2>&1"
Write-Host "    Central apagada (Docker sigue abierto; cierralo si quieres)." -ForegroundColor Green
Write-Host ""
Write-Host "  ==== Byte apagado. Hasta luego ====" -ForegroundColor White
Start-Sleep -Seconds 3
