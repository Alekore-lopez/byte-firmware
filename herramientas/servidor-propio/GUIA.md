# Servidor propio de Byte (voz propia con ElevenLabs)

## La idea en una analogía
Byte es como un teléfono que llama a una **central**. La central tiene tres trabajadores:

| Trabajo | Pieza | Costo |
|---|---|---|
| Oído (ASR): voz → texto | Whisper en **Groq** | Gratis con límite |
| Cerebro (LLM): piensa la respuesta | **Google Gemini** (flash-lite) | Gratis con límite |
| Boca (TTS): texto → voz | **ElevenLabs**, voz diseñada con Voice Design | Plan gratis con créditos al mes |

La central es **xiaozhi-esp32-server** (proyecto libre), y corre en Docker en tu PC.

**Lo que implica:** el PC tiene que estar prendido y con Docker abierto, y solo funciona dentro del WiFi de la casa. Para volver a xiaozhi.me, restaura `config.json.xiaozhi-me` en py-xiaozhi.

## Requisitos (una sola vez)
1. **Docker Desktop + WSL 2:** en PowerShell como administrador corre `wsl --install` y luego `winget install -e --id Docker.DockerDesktop`. Reinicia el PC.
2. **Claves** (secretas, nunca en chats ni capturas):
   - Groq: console.groq.com → API Keys (empieza por `gsk_`).
   - ElevenLabs: Developers → API Keys (empieza por `sk_`; se muestra una sola vez).
   - Gemini: aistudio.google.com/apikey (empieza por `AIza` o `AQ.`).
3. **Voz:** ElevenLabs → Creación de voz → Diseño de voz. Descríbela con rasgos, no con nombres de personajes, y copia su **Voice ID**.

## Instalar y arrancar
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/configurar.ps1?v=$(Get-Random)" | iex
```
Te pide Groq, ElevenLabs, Voice ID e IP, escribe `data\.config.yaml` y arranca la central. Luego cambia el cerebro a Gemini:
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/cambiar-a-gemini.ps1?v=$(Get-Random)" | iex
```
> Antes del merge del PR, cambia `main` por `refs/heads/claude/project-thread-oolb50` en la dirección.

## Búsqueda en internet (clima, noticias, buscar)
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/activar-internet.ps1?v=$(Get-Random)" | iex
```
Instala `byte_internet.py` en `$HOME\byte-servidor\internet`, lo deja corriendo sin ventana en el puerto 8805 (solo en tu PC) y en el Inicio de Windows, crea `data\.mcp_server_settings.json` para que la central lo use, ajusta la personalidad y reinicia. No necesita claves: usa DuckDuckGo y Open-Meteo. Registro: `$HOME\byte-servidor\internet\registro.txt`.

## Spotify (Byte como control remoto)
Necesita Spotify Premium y haber corrido `activar-internet.ps1`.
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/activar-spotify.ps1?v=$(Get-Random)" | iex
```
Te guía para crear una app gratis en developer.spotify.com (Redirect URI `http://127.0.0.1:8806/callback`), inicia sesión una vez y suma las herramientas `spotify_poner`, `spotify_control`, `spotify_volumen` y `spotify_que_suena`. La música suena donde tengas Spotify abierto (PC, celular o TV), no en el parlante de Byte. El permiso queda en `internet\spotify_token.json`: no lo compartas.

## Botón para encender todo
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/crear-boton.ps1?v=$(Get-Random)" | iex
```
Crea en el escritorio **Byte** (la nube), **Revisar Byte** y **Apagar Byte**. "Byte" primero revisa todo (internet, Docker, archivos, claves de Groq, Gemini y ElevenLabs sin gastar créditos, IP del PC, herramientas y puertos); si hay una falla grave no arranca y dice cómo arreglarla. Si la IP del PC cambió, la actualiza sola. Luego abre Docker Desktop si está cerrado, prende la central y las herramientas, espera a que la central conteste y abre el programa de Byte en el PC (Byte.bat). Con la placa, basta con encenderla después del botón.

## Memoria
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/activar-memoria.ps1?v=$(Get-Random)" | iex
```
Al terminar cada conversación, Gemini resume lo importante (nombres, gustos, fechas, pendientes) en `data\.memory.yaml`, que se queda solo en tu PC, y Byte lo lee en la siguiente. Cada dispositivo tiene su propia memoria: la placa empieza en blanco. Para que olvide todo, borra ese archivo y reinicia la central.

## Arreglos de la central (`parche_byte.py`)
`docker-compose.yml` corre `data/parche_byte.py` antes de arrancar. Arregla tres cosas de la versión 0.9.8: las herramientas propias no cargaban (`'Tool' object has no attribute 'inputSchema'`), Gemini 3 rechazaba las herramientas (`missing a thought_signature`) y Whisper no sabía que hablas español. Si ya tenías la central instalada:
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/arreglar-central.ps1?v=$(Get-Random)" | iex
```

## Conectar Byte
- **py-xiaozhi (PC):** en `%LOCALAPPDATA%\py-xiaozhi\py-xiaozhi\config\config.json` pon `OTA_VERSION_URL = http://TU-IP:8003/xiaozhi/ota/` y `WEBSOCKET_URL = ws://TU-IP:8000/xiaozhi/v1/`.
- **Placa:** al configurar el WiFi, en opciones avanzadas, pon la URL OTA. Si no aparece, cámbiala en `idf.py menuconfig` → *Default OTA URL* y vuelve a flashear.

## Comandos útiles
- Ver errores: `docker logs --since 3m byte-servidor 2>&1 | Select-String -NotMatch "inputSchema|mcp" | Select-Object -Last 30`
- Reiniciar después de editar la configuración: `docker restart byte-servidor`
- Apagar: `cd $HOME\byte-servidor; docker compose down`

## Problemas que ya vimos
| Síntoma en el registro | Causa | Arreglo |
|---|---|---|
| `401 Invalid API Key` en `asr` | Clave de Groq borrada o mal pegada | Clave nueva y reemplazar `gsk_...` |
| `404 model ... does not exist` | Modelo retirado o sin acceso | Listar modelos y cambiar `model_name` |
| `429 Rate limit ... tokens per minute` | Groq gratis: 8.000 tokens/min y cada turno usa ~6.000 | Usar Gemini como cerebro |
| Byte dice "se me enredaron los cables" | Cualquier error del cerebro | Ver el registro |
| `no longer available to new users` (Gemini) | Versión vieja del modelo | Usar la que sugiere el error |
| `missing a thought_signature` (Gemini) | La central no reenvía la firma de Gemini 3 | `arreglar-central.ps1` |
| `'Tool' object has no attribute 'inputSchema'` | Error de la versión 0.9.8 | `arreglar-central.ps1` |
| Byte dice que no puede buscar | Las herramientas de internet no están corriendo | Volver a correr `activar-internet.ps1` |
