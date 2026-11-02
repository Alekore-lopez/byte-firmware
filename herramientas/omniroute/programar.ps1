# Programar con IA - abre una terminal lista para programar usando OmniRoute
# Lo abre el boton "Programar con IA" del escritorio (lo crea instalar-omniroute.ps1).
#
# Que hace:
#   1. Enciende OmniRoute si estaba apagado.
#   2. Carga tu clave de OmniRoute (guardada cifrada, nunca en texto plano).
#   3. Deja listas las variables OPENAI_API_BASE / OPENAI_API_KEY, que usan
#      aider y casi cualquier herramienta compatible con OpenAI.
#   4. Abre aider en la carpeta del proyecto (byte-firmware por defecto).
# Al salir de aider (escribe /exit) la terminal queda abierta y configurada.
param([string]$Carpeta = (Join-Path $HOME "byte-firmware"))

$ErrorActionPreference = "Continue"
$Host.UI.RawUI.WindowTitle = "Programar con IA (OmniRoute)"
$datos = Join-Path $HOME "byte-omniroute"
$aqui  = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  ==== Programar con IA (OmniRoute) ====" -ForegroundColor White

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $aqui "encender-omniroute.ps1") -Silencio
if ($LASTEXITCODE -ne 0) { return }

# Clave cifrada con tu usuario de Windows (DPAPI): solo tu cuenta la puede leer
$archivoClave = Join-Path $datos "clave.dat"
if (-not (Test-Path $archivoClave)) {
  Write-Host "    [X]  No hay clave guardada. Corre de nuevo instalar-omniroute.ps1" -ForegroundColor Red
  return
}
try {
  $seguro = Get-Content $archivoClave | ConvertTo-SecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
  $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
} catch {
  Write-Host "    [X]  No pude leer la clave. Corre de nuevo instalar-omniroute.ps1" -ForegroundColor Red
  return
}

# Solo para ESTA ventana (no quedan guardadas en Windows)
$env:OPENAI_API_BASE = "http://localhost:20128/v1"
$env:OPENAI_BASE_URL = "http://localhost:20128/v1"
$env:OPENAI_API_KEY  = $clave
$env:OMNIROUTE_KEY   = $clave
Remove-Variable clave

$modelo = ""
$archivoModelo = Join-Path $datos "modelo.txt"
if (Test-Path $archivoModelo) { $modelo = (Get-Content $archivoModelo -Raw).Trim() }

if (Test-Path $Carpeta) { Set-Location $Carpeta }
Write-Host "    [OK] Carpeta: $(Get-Location)" -ForegroundColor Green
Write-Host "    [OK] Terminal conectada a OmniRoute (http://localhost:20128/v1)" -ForegroundColor Green

if (-not $modelo) {
  Write-Host ""
  Write-Host "    [!]  Falta elegir el modelo. Escribe su nombre (como sale en OmniRoute) en:" -ForegroundColor Yellow
  Write-Host "         $archivoModelo" -ForegroundColor Yellow
  return
}
if (-not (Get-Command aider -ErrorAction SilentlyContinue)) {
  Write-Host ""
  Write-Host "    [!]  aider no esta instalado. Instalalo con:" -ForegroundColor Yellow
  Write-Host "         python -m pip install aider-install; aider-install" -ForegroundColor Yellow
  return
}

Write-Host ""
Write-Host "    Abriendo aider con el modelo '$modelo'." -ForegroundColor Cyan
Write-Host "    Pidele cambios en espanol. Comandos utiles: /add archivo, /undo, /exit" -ForegroundColor Cyan
Write-Host ""
# openai/ = le dice a aider que hable con un servidor compatible con OpenAI (OmniRoute)
aider --model "openai/$modelo" --no-show-model-warnings
Write-Host ""
Write-Host "    Saliste de aider. Esta terminal sigue conectada a OmniRoute." -ForegroundColor Cyan
Write-Host "    Para volver a entrar escribe:  aider --model openai/$modelo" -ForegroundColor Cyan
