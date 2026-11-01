# Byte Desk

Byte en tu escritorio, para **Windows** y **Mac**. Vive en la barra (junto al reloj en Windows, arriba en la barra de menú del Mac), y desde ahí le escribes a Byte y él te responde **en vivo** con su voz, usando **la misma central** que la placa y el programa del PC: misma memoria, mismos gustos y misma personalidad.

> Fase 1 (esta versión): chat por texto en tiempo real, caritas con la emoción de cada respuesta, voz de Byte, panel rápido desde la barra, Tareas, Enfoque, Mi PC / Mi Mac en vivo y Ajustes.
> Más adelante: hablarle con el micrófono (fase 2), ordenar archivos con tu permiso (fase 3) y enviar mensajes con tu permiso (fase 4).

---

## Cómo funciona (para entenderlo)

```
 Byte Desk (Electron)                                   Central de Byte (Docker en el HP)
 ┌───────────────────────────────┐   WebSocket          ┌─────────────────────────────┐
 │ renderer/  (lo que ves)       │   ws://IP:8000/      │ Oído (Groq) · Cerebro       │
 │   app.js   ventana grande     │   xiaozhi/v1/        │ (Gemini) · Voz (Edge/11Labs)│
 │   panel.js panel de la barra  │ ───── texto ───────▶ │ Memoria · Spotify · Internet│
 │   voz.js   reproduce la voz   │ ◀── frases, emoción, │                             │
 │        ▲  window.byte         │      voz (Opus) ──── │                             │
 │ src/preload.js (mostrador)    │                      └─────────────────────────────┘
 │        ▼                      │
 │ src/main.js   bandeja, ventanas, atajo
 │ src/central.js  habla con la central
 └───────────────────────────────┘
```

| Archivo | Qué hace |
|---|---|
| `src/main.js` | Arranca la app, pone a Byte en la barra, crea la ventana y el panel rápido. Cerrar la ventana **no** apaga a Byte. |
| `src/central.js` | El "teléfono" con la central: se conecta, saluda, manda tus preguntas y recibe las respuestas. Se reconecta solo si se cae. |
| `src/preload.js` | La lista cerrada de cosas que la interfaz puede pedir. La página **no** puede tocar tus archivos ni tus claves. |
| `src/ajustes.js` | Guarda tus preferencias (dirección de la central, voz, tareas) en tu computador. **No guarda claves** de Groq/Gemini/ElevenLabs. |
| `src/sistema.js` | Lee (sin cambiar nada) procesador, memoria, disco y las carpetas autorizadas. |
| `renderer/` | La interfaz: HTML, CSS y JavaScript, igual que la pantalla de Byte. |
| `test/central-falsa.js` | Una central de mentira para probar sin Docker. |

El protocolo es el de XiaoZhi: Byte Desk manda `{"type":"listen","state":"detect","text":"tu pregunta"}` y la central responde con `tts start` → `llm` (emoción) → `sentence_start` (cada frase) + paquetes de voz Opus → `tts stop`.

---

## Instalarlo en el HP (Windows)

1. **Instala Node.js** (solo una vez): entra a <https://nodejs.org>, descarga la versión **LTS** y dale Siguiente a todo.
2. Abre **PowerShell** y trae lo último del repo:
   ```powershell
   cd $HOME\byte-firmware
   git pull
   cd herramientas\desk
   npm install
   ```
   (`npm install` descarga Electron, unos 100 MB, solo la primera vez.)
3. Prende la central como siempre (ícono **Byte** del escritorio) y luego:
   ```powershell
   npm start
   ```
4. Byte aparece junto al reloj. **Clic** = panel rápido · **doble clic** = ventana grande · **clic derecho** = menú.
   Atajo desde cualquier app: **Ctrl + Shift + B**.

En el HP la dirección de la central ya viene bien: `ws://127.0.0.1:8000/xiaozhi/v1/`.

## Instalarlo en la MacBook Air (M1, macOS Tahoe)

La central **se queda en el HP**; la Mac solo se conecta a ella por el WiFi de la casa.

1. **Instala Node.js**: <https://nodejs.org> → versión **LTS** para macOS (instalador `.pkg`).
2. Abre **Terminal** (Cmd + Espacio, escribe "Terminal") y descarga el proyecto:
   ```bash
   cd ~
   git clone https://github.com/alekore-lopez/byte-firmware.git
   cd byte-firmware/herramientas/desk
   npm install
   npm start
   ```
   Si la Mac pide instalar "herramientas de línea de comandos" para `git`, acepta y repite el comando.
3. macOS va a preguntar si Electron puede **buscar dispositivos en tu red local**: dale **Permitir** (sin eso no encuentra al HP).
4. En Byte Desk ve a **Ajustes → Central de Byte**, escribe la IP del HP (por ejemplo `192.168.1.50`) y **Guardar y conectar**.
   La IP la ves en el HP con el ícono **Revisar Byte** o con `ipconfig` → "Dirección IPv4".
5. Byte queda arriba en la barra de menú. **Clic** = panel de vidrio · atajo **⌥ Opción + Espacio**.

Para actualizar después: `cd ~/byte-firmware && git pull && cd herramientas/desk && npm install && npm start`.

### Si la Mac no se conecta al HP

- Los dos deben estar en **el mismo WiFi**.
- En el HP, la central debe estar prendida (Docker con Byte).
- El **firewall de Windows** puede bloquear el puerto 8000. En el HP, abre PowerShell **como administrador** y ejecuta una sola vez:
  ```powershell
  New-NetFirewallRule -DisplayName "Byte central" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
  ```
  (Abre el puerto solo en redes privadas, como la de tu casa.)
- En Byte Desk → Ajustes verás el motivo exacto en español y cuándo vuelve a intentar.

---

## Probar sin la central (central de mentira)

En una terminal: `npm run central-falsa` · en otra: `npm start`. Responde frases de prueba y manda voz en silencio, para practicar sin gastar créditos.

## Pruebas automáticas

```bash
npm test
```
Comprueban que se conecta, que la pregunta llega, que llegan emoción, frases y voz, que se reconecta sola y que los errores salen en español.

## Seguridad

- La interfaz corre aislada (`contextIsolation`, `sandbox`, sin `nodeIntegration`) y solo puede usar lo que está en `src/preload.js`.
- Las claves de Groq, Gemini y ElevenLabs **siguen solo en la central** (`.config.yaml` del HP). Byte Desk nunca las ve.
- Las fases 3 y 4 (archivos y mensajes) siempre mostrarán **qué va a hacer** y esperarán tu "Sí, hazlo". Solo en Descargas, Documentos y Escritorio, y sin borrar nada.

## Dejarlo instalado para siempre (sin comandos)

### Windows (HP) — una sola vez
```powershell
cd $HOME\byte-firmware\herramientas\desk
git pull
npm install
npm run dist:win
start dist
```
Se abre la carpeta `dist`: doble clic en **Byte-Desk-…-win-x64.exe**. Si Windows muestra "Windows protegió su PC", da clic en **Más información → Ejecutar de todas formas** (sale porque la app no tiene firma de pago).

Queda instalado como cualquier programa: ícono en el escritorio y en el menú Inicio, y **arranca solo al prender el PC** (escondido junto al reloj). Ya no necesitas `npm start`.

### Mac
Igual, pero con `npm run dist:mac` y abriendo el `.dmg` de `dist`: arrastra Byte Desk a **Aplicaciones**. La primera vez macOS dirá que no puede verificar al desarrollador: ve a **Configuración del Sistema → Privacidad y seguridad → Abrir de todos modos**.

## Crear el instalador (resumen)

- Windows: `npm run dist:win` → `dist/Byte Desk Setup.exe`
- Mac (en la Mac): `npm run dist:mac` → `dist/Byte Desk.dmg`. Sin cuenta de desarrollador de Apple, la primera vez se abre con **clic derecho → Abrir**.
