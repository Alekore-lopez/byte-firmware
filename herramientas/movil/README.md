# Byte en el celular (iPhone)

Byte en tu iPhone como **app web instalable (PWA)**: chat, voz, cara de Byte y
administración de la central. No necesita App Store ni cuenta de desarrollador.

```
iPhone (app Byte) ──HTTPS/wss por Tailscale──► HP: puente.js (127.0.0.1:8810) ──► central Docker (:8000)
                                                   │
                                                   └─ docker (estado, encender, reiniciar, apagar, registro)
```

## Qué hace cada pieza

| Pieza | Para qué |
|---|---|
| `puente.js` | Corre en el HP. Sirve la app, une el chat con la central y da la API de administración. |
| `app/` | La app del iPhone (HTML + JS). Usa el mismo chat que Byte Desk (`../desk/renderer/comun.js`). |
| `instalar-movil.ps1` | Lo instala todo en el HP en un paso. |
| `test/` | Pruebas con una central falsa (`npm test`). |

**¿Por qué el puente traduce la voz?** La central habla en Opus. El iPhone no
siempre trae codificador de Opus para páginas web, así que el puente convierte:
tu micrófono (PCM 16 kHz) → Opus para la central, y la voz de Byte (Opus) → PCM para el celular.

## Seguridad

- El puente escucha **solo en 127.0.0.1**: nadie de la WiFi lo ve. El iPhone llega por **Tailscale**, que solo deja entrar a tus equipos y pone HTTPS (el iPhone lo exige para el micrófono).
- Además pide una **clave** que el iPhone recibe al escanear el QR. 10 intentos fallidos = bloqueo de 10 minutos.
- La página del QR está en otro puerto (8811) que Tailscale **no** comparte: solo se abre desde el HP.
- Las claves de Groq/Gemini se quedan en `.config.yaml`. El registro que ves en el celular se limpia de cualquier cosa que parezca una clave.
- ¿Se te filtró el QR? `node puente.js --nueva-clave` y vuelve a emparejar.

## Instalar (una vez)

1. En el **HP**, PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File "$HOME\byte-firmware\herramientas\movil\instalar-movil.ps1"
   ```
2. Si te lo pide, inicia sesión en Tailscale y activa **HTTPS Certificates** en `login.tailscale.com/admin/dns`.
3. En el **iPhone**: instala **Tailscale** (App Store), entra con la misma cuenta y déjalo activado.
4. Escanea el QR que se abrió en el HP con la Cámara → toca el enlace → **Compartir → Agregar a inicio**.

## Límites del iPhone

- No escucha "Byte" con la app cerrada (Apple no deja usar el micrófono en segundo plano). Se usa tocando el micrófono.
- La voz suena por el parlante; si no suena, revisa el volumen y el interruptor de silencio.
- El HP tiene que estar prendido (o el mini PC, cuando llegue).

## Pasar al mini PC (Linux)

El puente es Node y funciona igual en Linux:
1. Clonar el repo, `cd herramientas/movil && npm install --omit=dev`.
2. Arrancarlo con systemd (`ExecStart=/usr/bin/node .../puente.js`).
3. `sudo tailscale serve --bg 8810` y volver a escanear el QR (la dirección cambia al nombre del mini PC).

## Probar sin el HP

```bash
npm install
npm test                         # 7 pruebas con una central falsa
node test/central-falsa.js 8000  # central de mentira
BYTE_MOVIL_DIRECCION=localhost:8810 node puente.js   # y abre http://127.0.0.1:8811
```
