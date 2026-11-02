# Byte - Revisar que todo este listo antes de encender
# Lo usa el boton "Byte" antes de arrancar, y el boton "Revisar Byte" por separado.
# No gasta creditos: solo pregunta a cada servicio si tu clave es valida.
# Nunca muestra tus claves.
#
# Resultado: [OK] bien, [!] aviso (Byte funciona, pero falta algo), [X] falla grave.
# Codigo de salida: 0 si no hay fallas graves, 1 si las hay.

$ErrorActionPreference = "Continue"
$dir  = Join-Path $HOME "byte-servidor"
$data = Join-Path $dir "data"
$conf = Join-Path $data ".config.yaml"
$inet = Join-Path $dir "internet"
$utf8 = New-Object Text.UTF8Encoding($false)
$script:graves = 0
$script:avisos = 0

function Bien($t)  { Write-Host "  [OK] $t" -ForegroundColor Green }
function Aviso($t, $arreglo) {
  $script:avisos++
  Write-Host "  [!]  $t" -ForegroundColor Yellow
  if ($arreglo) { Write-Host "       -> $arreglo" -ForegroundColor DarkYellow }
}
function Grave($t, $arreglo) {
  $script:graves++
  Write-Host "  [X]  $t" -ForegroundColor Red
  if ($arreglo) { Write-Host "       -> $arreglo" -ForegroundColor DarkYellow }
}
function Titulo($t) { Write-Host ""; Write-Host " $t" -ForegroundColor Cyan }
function Http($url, $headers) {
  # Devuelve el codigo HTTP (0 si no hubo respuesta)
  try {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -TimeoutSec 8
    return [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

Write-Host ""
Write-Host " ===== Revision de Byte =====" -ForegroundColor White

# ---------------------------------------------------------------- 1. Internet
Titulo "1. Internet"
if ((Http "https://www.google.com/generate_204" @{}) -in 200, 204) { Bien "Hay internet." }
else { Grave "No hay internet." "Revisa el WiFi del PC. Byte necesita internet para oir, pensar y hablar." }

# ---------------------------------------------------------------- 2. Docker
Titulo "2. Docker"
$dockerExe = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerExe) { Bien "Docker Desktop instalado." }
else { Grave "Docker Desktop no esta instalado." "winget install -e --id Docker.DockerDesktop" }
$wsl = (cmd /c "wsl --status >nul 2>&1"); if ($LASTEXITCODE -eq 0) { Bien "WSL 2 instalado." }
else { Aviso "No pude confirmar WSL 2." "Si Docker no arranca: wsl --install (como administrador) y reinicia." }
cmd /c "docker info >nul 2>&1"
if ($LASTEXITCODE -eq 0) { Bien "Docker esta corriendo." }
else { Aviso "Docker esta cerrado." "El boton 'Byte' lo abre solo." }

# ---------------------------------------------------------------- 3. Archivos
Titulo "3. Archivos de la central"
foreach ($a in @("docker-compose.yml", "data\.config.yaml")) {
  if (Test-Path (Join-Path $dir $a)) { Bien "$a" } else { Grave "Falta $a" "Corre configurar.ps1" }
}
if (Test-Path (Join-Path $data "parche_byte.py")) { Bien "data\parche_byte.py (arreglos)" }
else { Aviso "Falta data\parche_byte.py: sin el, Gemini falla con herramientas." "Corre arreglar-central.ps1" }
$compose = Get-Content (Join-Path $dir "docker-compose.yml") -Raw -ErrorAction SilentlyContinue
if ($compose -and $compose -notmatch "parche_byte") { Aviso "docker-compose.yml no aplica los arreglos al arrancar." "Corre arreglar-central.ps1" }

# ---------------------------------------------------------------- 4. Claves
Titulo "4. Claves (se prueban sin gastar creditos)"
$texto = ""
if (Test-Path $conf) { $texto = [IO.File]::ReadAllText($conf, $utf8) }

$groq = [regex]::Match($texto, "gsk_[A-Za-z0-9]+").Value
if (-not $groq) { Grave "No hay clave de Groq (oido)." "Corre configurar.ps1" }
else {
  $c = Http "https://api.groq.com/openai/v1/models" @{ Authorization = "Bearer $groq" }
  if ($c -eq 200) { Bien "Groq (oido): clave valida." }
  elseif ($c -in 401, 403) { Grave "Groq (oido): la clave no sirve o fue borrada." "Crea una nueva en console.groq.com y reemplaza gsk_... en .config.yaml" }
  else { Aviso "Groq (oido): no pude comprobar (codigo $c)." "" }
}

$llm = [regex]::Match($texto, "(?m)^[ \t]+LLM:[ \t]*(\S+)").Groups[1].Value
if ($llm -eq "GeminiLLM") {
  $bloque = [regex]::Match($texto, "(?ms)^  GeminiLLM:.*?(?=^  \S|^\S|\z)").Value
  $gkey = [regex]::Match($bloque, "api_key:\s*`"?([^`"\s]+)").Groups[1].Value
  $gmod = [regex]::Match($bloque, "model_name:\s*`"?([^`"\s]+)").Groups[1].Value
  if (-not $gkey) { Grave "No hay clave de Gemini (cerebro)." "Corre cambiar-a-gemini.ps1" }
  else {
    $c = Http "https://generativelanguage.googleapis.com/v1beta/models/$gmod" @{ "x-goog-api-key" = $gkey }
    if ($c -eq 200) { Bien "Gemini (cerebro): clave valida, modelo $gmod disponible." }
    elseif ($c -eq 404) { Grave "Gemini: el modelo $gmod ya no existe." "Corre cambiar-a-gemini.ps1 para elegir otro." }
    elseif ($c -in 400, 401, 403) { Grave "Gemini (cerebro): la clave no sirve o fue borrada." "Crea una en aistudio.google.com/apikey y corre cambiar-a-gemini.ps1" }
    else { Aviso "Gemini: no pude comprobar (codigo $c)." "" }
  }
} elseif ($llm -eq "OmniRouteLLM") {
  $bloque = [regex]::Match($texto, "(?ms)^  OmniRouteLLM:.*?(?=^  \S|^\S|\z)").Value
  $okey = [regex]::Match($bloque, "api_key:\s*`"?([^`"\s]+)").Groups[1].Value
  $c = Http "http://127.0.0.1:20128/v1/models" @{ Authorization = "Bearer $okey" }
  if ($c -eq 200) { Bien "OmniRoute (cerebro): encendido y la clave sirve." }
  elseif ($c -eq 0) { Grave "OmniRoute (cerebro) esta apagado." "Doble clic en el icono OmniRoute del escritorio." }
  else { Grave "OmniRoute (cerebro): respondio codigo $c." "Revisa la clave en el panel (Gestor de API)." }
} elseif ($llm) { Bien "Cerebro: $llm (no se revisa la clave)." }

$tts = [regex]::Match($texto, "(?m)^[ \t]+TTS:[ \t]*(\S+)").Groups[1].Value
if ($tts -eq "ElevenLabsTTS") {
  $ekey = [regex]::Match($texto, "xi-api-key:\s*`"?([^`"\s]+)").Groups[1].Value
  if (-not $ekey -or $ekey -match "TU_CLAVE") { Grave "No hay clave de ElevenLabs (voz)." "Corre configurar.ps1" }
  else {
    $c = Http "https://api.elevenlabs.io/v1/user/subscription" @{ "xi-api-key" = $ekey }
    if ($c -eq 200) {
      Bien "ElevenLabs (voz): clave valida."
      try {
        $s = Invoke-RestMethod -Uri "https://api.elevenlabs.io/v1/user/subscription" -Headers @{ "xi-api-key" = $ekey } -TimeoutSec 8
        $quedan = [int]$s.character_limit - [int]$s.character_count
        if ($quedan -lt 1000) { Aviso "ElevenLabs: quedan solo $quedan caracteres este mes." "Cuando se acaben, Byte se queda mudo. Cambia a EdgeTTS (gratis) en .config.yaml." }
        else { Bien "ElevenLabs: quedan $quedan caracteres este mes." }
      } catch { }
    }
    elseif ($c -in 401, 403) { Aviso "ElevenLabs (voz): no acepto la clave para leer el saldo." "Si Byte habla bien, la clave solo tiene permiso de voz y esta bien. Si se quedo mudo, crea una nueva en elevenlabs.io." }
    else { Aviso "ElevenLabs: no pude comprobar (codigo $c)." "" }
  }
} elseif ($tts) { Bien "Voz: $tts" }

# ---------------------------------------------------------------- 5. Red local (IP)
Titulo "5. Direccion del PC en la red"
$ip = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1).IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress
$ipConf = [regex]::Match($texto, "websocket:\s*ws://([0-9.]+):").Groups[1].Value
if (-not $ip) { Aviso "No pude ver la IP del PC." "" }
elseif ($ipConf -and $ipConf -ne $ip) {
  # El router le dio otra IP al PC: la placa no encontraria la central. Se arregla solo.
  $nuevo = $texto.Replace("ws://$ipConf`:", "ws://$ip`:")
  Copy-Item $conf "$conf.antes-de-ip" -Force
  [IO.File]::WriteAllText($conf, $nuevo, $utf8)
  $texto = $nuevo
  $pyx = Join-Path $env:LOCALAPPDATA "py-xiaozhi\py-xiaozhi\config\config.json"
  if (Test-Path $pyx) {
    $j = [IO.File]::ReadAllText($pyx, $utf8).Replace("//$ipConf`:", "//$ip`:")
    [IO.File]::WriteAllText($pyx, $j, $utf8)
  }
  cmd /c "docker restart byte-servidor >nul 2>&1"
  Aviso "La IP del PC cambio de $ipConf a $ip. Ya la actualice." "La placa guarda la direccion vieja: reserva la IP $ip para este PC en tu router (DHCP) para que no cambie mas."
}
else { Bien "IP del PC: $ip (coincide con la configuracion)." }

# ---------------------------------------------------------------- 6. Herramientas
Titulo "6. Herramientas (internet y Spotify)"
if (-not (Test-Path (Join-Path $inet "byte_internet.py"))) { Aviso "No estan instaladas: Byte no buscara en internet." "Corre activar-internet.ps1" }
else {
  Bien "byte_internet.py instalado."
  $py = (Get-Command python -ErrorAction SilentlyContinue).Source
  if (-not $py) { Grave "No encontre Python." "Instala Python 3 desde python.org (marca 'Add to PATH')." }
  else {
    $faltan = (& $py -c "import importlib.util as u; print(' '.join(m for m in ['fastmcp','ddgs'] if not u.find_spec(m)))" 2>$null)
    if ($faltan) { Aviso "Faltan librerias de Python: $faltan" "Corre activar-internet.ps1" } else { Bien "Librerias de Python listas." }
  }
  if (Test-Path (Join-Path $inet "spotify.json")) {
    if (Test-Path (Join-Path $inet "spotify_token.json")) { Bien "Spotify: sesion iniciada." }
    else { Aviso "Spotify: falta iniciar sesion." "Corre activar-spotify.ps1" }
  }
  if (Get-NetTCPConnection -LocalPort 8805 -State Listen -ErrorAction SilentlyContinue) { Bien "Herramientas corriendo (puerto 8805)." }
  else { Aviso "Herramientas apagadas." "El boton 'Byte' las prende." }
}

# ---------------------------------------------------------------- 7. Puertos
Titulo "7. Puertos de la central"
foreach ($p in 8000, 8003) {
  $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $c) { Bien "Puerto $p libre (la central lo usara)." }
  else {
    $proc = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).ProcessName
    if ($proc -match "docker|wslrelay|com.docker|vpnkit") { Bien "Puerto $p en uso por la central." }
    else { Grave "El puerto $p lo esta usando otro programa ($proc)." "Cierra $proc o reinicia el PC." }
  }
}

# ---------------------------------------------------------------- Resumen
Write-Host ""
if ($script:graves -gt 0) {
  Write-Host " ===== $($script:graves) falla(s) grave(s), $($script:avisos) aviso(s). Arregla lo rojo antes de encender. =====" -ForegroundColor Red
  exit 1
} elseif ($script:avisos -gt 0) {
  Write-Host " ===== Todo lo importante esta bien ($($script:avisos) aviso(s) en amarillo). =====" -ForegroundColor Yellow
} else {
  Write-Host " ===== Todo perfecto. =====" -ForegroundColor Green
}
exit 0
