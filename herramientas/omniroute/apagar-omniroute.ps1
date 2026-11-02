# OmniRoute - Apagar el servidor
$ErrorActionPreference = "Continue"
Write-Host ""
Write-Host "  Apagando OmniRoute..." -ForegroundColor Cyan
cmd /c "omniroute stop >nul 2>&1"
Start-Sleep -Seconds 2
# Si seguia vivo, se cierra el proceso que tiene el puerto
Get-NetTCPConnection -LocalPort 20128 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Write-Host "    [OK] OmniRoute apagado." -ForegroundColor Green
Start-Sleep -Seconds 2
