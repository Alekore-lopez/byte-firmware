# Byte - Probar todas las voces gratis (Edge) y elegir una
# Uso, en PowerShell (una sola linea):
#   iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/probar-voces.ps1?v=$(Get-Random)" | iex
#
# Que hace:
#   1) Dentro de la central (Docker) graba la misma frase con cada voz latina de Edge,
#      en dos versiones: "normal" y "tierna" (un poquito mas aguda y alegre).
#   2) Abre una pagina en tu navegador para escucharlas todas, numeradas.
#   3) Te pregunta cual quieres y la pone en Byte (deja copia .antes-de-voz-edge) y reinicia.
# Las voces de Edge son gratis y sin limite: no gastan creditos de nada.
# No usa ni muestra ninguna clave.

$ErrorActionPreference = "Stop"
$utf8 = New-Object Text.UTF8Encoding($false)
$data = Join-Path $HOME "byte-servidor\data"
$conf = Join-Path $data ".config.yaml"
if (-not (Test-Path $conf)) { throw "No encontre $conf. Primero corre configurar.ps1." }

$estado = (docker inspect -f "{{.State.Running}}" byte-servidor 2>$null)
if ($estado -ne "true") { throw "La central no esta prendida. Abre Docker y dale al boton 'Byte' primero." }

# Tono de la version "tierna": +Hz mas aguda y +% mas rapida
$tiernaPitch = 20
$tiernaRate = 5

$py = @'
import asyncio, json, os, sys
import edge_tts

OUT = "data/voces-prueba"
FRASE = ("¡Hola, Alejandro! Soy Byte. ¿Qué hacemos hoy? "
         "Si quieres te pongo música, o te cuento algo bonito.")
TIERNA_PITCH = int(sys.argv[1]); TIERNA_RATE = int(sys.argv[2])

async def grabar(sem, voz, pitch, rate, archivo):
    async with sem:
        for intento in range(3):
            try:
                c = edge_tts.Communicate(FRASE, voice=voz, pitch=f"{pitch:+}Hz", rate=f"{rate:+}%")
                await c.save(os.path.join(OUT, archivo))
                return True
            except Exception as e:
                await asyncio.sleep(1 + intento)
        print("  no se pudo grabar", voz, flush=True)
        return False

async def main():
    os.makedirs(OUT, exist_ok=True)
    voces = await edge_tts.list_voices()
    elegidas = []
    for v in voces:
        loc = v["Locale"]
        latina = loc.startswith("es-") and loc not in ("es-ES", "es-GQ")
        multi = "Multilingual" in v["ShortName"]
        if latina or multi:
            elegidas.append(v)
    # primero Colombia, luego el resto de Latinoamerica, al final las multilingues
    elegidas.sort(key=lambda v: (v["Locale"] != "es-CO", "Multilingual" in v["ShortName"], v["Locale"], v["ShortName"]))
    print(f"Grabando {len(elegidas)} voces x 2 versiones...", flush=True)
    sem = asyncio.Semaphore(6)
    lista, tareas = [], []
    for i, v in enumerate(elegidas, 1):
        n = v["ShortName"]
        lista.append({"n": i, "voz": n, "pais": v["Locale"], "genero": v["Gender"],
                      "normal": f"{i:02d}-normal.mp3", "tierna": f"{i:02d}-tierna.mp3"})
        tareas.append(grabar(sem, n, 0, 0, f"{i:02d}-normal.mp3"))
        tareas.append(grabar(sem, n, TIERNA_PITCH, TIERNA_RATE, f"{i:02d}-tierna.mp3"))
    await asyncio.gather(*tareas)
    with open(os.path.join(OUT, "voces.json"), "w", encoding="utf-8") as f:
        json.dump(lista, f, ensure_ascii=False)
    print("Listo.", flush=True)

asyncio.run(main())
'@
[IO.File]::WriteAllText((Join-Path $data "probar_voces.py"), $py, $utf8)
$carpeta = Join-Path $data "voces-prueba"
if (Test-Path $carpeta) { Remove-Item $carpeta -Recurse -Force }

Write-Host ""
Write-Host "=== 1) Grabando las voces (tarda 1 o 2 minutos) ===" -ForegroundColor Cyan
docker exec byte-servidor python data/probar_voces.py $tiernaPitch $tiernaRate
if ($LASTEXITCODE -ne 0) { throw "No se pudieron grabar las voces. Revisa que el PC tenga internet." }
$voces = [IO.File]::ReadAllText((Join-Path $carpeta "voces.json"), $utf8) | ConvertFrom-Json

# Nombre bonito del pais
$paises = @{ "es-AR"="Argentina"; "es-BO"="Bolivia"; "es-CL"="Chile"; "es-CO"="Colombia"; "es-CR"="Costa Rica";
  "es-CU"="Cuba"; "es-DO"="Rep. Dominicana"; "es-EC"="Ecuador"; "es-GT"="Guatemala"; "es-HN"="Honduras";
  "es-MX"="Mexico"; "es-NI"="Nicaragua"; "es-PA"="Panama"; "es-PE"="Peru"; "es-PR"="Puerto Rico";
  "es-PY"="Paraguay"; "es-SV"="El Salvador"; "es-US"="Latinos en EE. UU."; "es-UY"="Uruguay"; "es-VE"="Venezuela" }

$filas = foreach ($v in $voces) {
  $pais = $paises[$v.pais]; if (-not $pais) { $pais = "Multilingue ($($v.pais))" }
  $gen = if ($v.genero -eq "Female") { "Mujer" } else { "Hombre" }
  $nombre = ($v.voz -split "-")[2] -replace "(Multilingual)?Neural$", ""
  "<tr><td class=n>$($v.n)</td><td><b>$nombre</b><br><small>$pais &middot; $gen</small></td>" +
  "<td><audio controls preload=none src='$($v.normal)'></audio></td>" +
  "<td><audio controls preload=none src='$($v.tierna)'></audio></td></tr>"
}
$html = @"
<!doctype html><html lang=es><meta charset=utf-8><title>Voces para Byte</title>
<style>
body{font-family:system-ui,sans-serif;background:#111;color:#f2ede1;margin:24px}
h1{font-weight:600}p{color:#bbb}table{border-collapse:collapse;width:100%}
td,th{padding:8px;border-bottom:1px solid #333;text-align:left;vertical-align:middle}
.n{font-size:22px;color:#7fe0c0;width:40px}small{color:#999}audio{height:36px}
</style>
<h1>Voces gratis para Byte</h1>
<p>Escucha y anota el <b>numero</b> de la que te guste, y si la quieres <b>normal</b> o <b>tierna</b>.
Luego vuelve a PowerShell y escribelo. Todas son gratis y sin limite.</p>
<table><tr><th>#</th><th>Voz</th><th>Normal</th><th>Tierna (mas aguda y alegre)</th></tr>
$($filas -join "`n")
</table></html>
"@
$pagina = Join-Path $carpeta "voces.html"
[IO.File]::WriteAllText($pagina, $html, $utf8)
Start-Process $pagina

Write-Host ""
Write-Host "=== 2) Elige ===" -ForegroundColor Cyan
Write-Host "Se abrio la pagina con $($voces.Count) voces. Escuchalas con calma."
$num = (Read-Host "Numero de la voz que quieres (Enter = no cambiar nada)").Trim()
if (-not $num) { Write-Host "No cambie nada. Puedes volver a abrir la pagina: $pagina"; return }
$elegida = $voces | Where-Object { $_.n -eq [int]$num }
if (-not $elegida) { throw "No hay voz con el numero $num." }
$tipo = (Read-Host "Normal (N) o tierna (T)?").Trim().ToUpper()
$pitch = 0; $rate = 0
if ($tipo -eq "T") { $pitch = $tiernaPitch; $rate = $tiernaRate }

Write-Host ""
Write-Host "=== 3) Poniendo la voz en Byte ===" -ForegroundColor Cyan
$texto = [IO.File]::ReadAllText($conf, $utf8)
$m = [regex]::Match($texto, "(?ms)^([ \t]+)EdgeTTS:[ \t]*\r?\n(.*?)(?=^[ \t]{0,2}\S|\z)")
if (-not $m.Success) { throw "No encontre el bloque EdgeTTS en $conf. Mandame una captura." }
$bloque = $m.Groups[2].Value
$sangria = $m.Groups[1].Value + "  "
$nl = if ($texto.Contains("`r`n")) { "`r`n" } else { "`n" }
function Poner($b, $clave, $valor) {
  $re = "(?m)^([ \t]+)" + $clave + ":[^\r\n]*"
  if ([regex]::IsMatch($b, $re)) { return ([regex]$re).Replace($b, "`${1}${clave}: $valor", 1) }
  return "$sangria${clave}: $valor$nl" + $b
}
$nuevo = Poner $bloque "voice" $elegida.voz
$nuevo = Poner $nuevo "pitch" $pitch
$nuevo = Poner $nuevo "rate" $rate
$texto = $texto.Substring(0, $m.Groups[2].Index) + $nuevo + $texto.Substring($m.Groups[2].Index + $bloque.Length)
# Que Byte use Edge (por si estaba en ElevenLabs)
$texto = [regex]::Replace($texto, "(?m)^([ \t]+TTS:[ \t]*)ElevenLabsTTS\b", "`${1}EdgeTTS")
Copy-Item $conf "$conf.antes-de-voz-edge" -Force
[IO.File]::WriteAllText($conf, $texto, $utf8)
docker restart byte-servidor | Out-Null
$como = if ($pitch) { "tierna" } else { "normal" }
Write-Host "Listo: Byte ahora habla con $($elegida.voz) ($como). Dale 20 segundos y dile 'Byte'." -ForegroundColor Green
Write-Host "Si no te gusta, corre este script otra vez. Copia de antes: $conf.antes-de-voz-edge"
