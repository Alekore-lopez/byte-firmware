# Plan B: servidor propio de Byte (voz tipo caricatura)

## La idea en una analogía
Hoy Byte es como un teléfono que llama a una central en China (xiaozhi.me). La central tiene tres trabajadores: un **oído** (convierte tu voz en texto), un **cerebro** (piensa la respuesta) y una **boca** (convierte la respuesta en voz). Tú no puedes elegir a la boca, por eso solo hay dos voces.

Con el plan B montamos **nuestra propia central en tu PC**. Ahí sí elegimos cada trabajador:

| Trabajo | Pieza | Costo |
|---|---|---|
| Oído (ASR) | Whisper en Groq | Gratis con límite diario |
| Cerebro (LLM) | Llama en Groq | Gratis con límite diario |
| Boca (TTS) | Edge TTS de Microsoft, con tono y velocidad ajustables | Gratis, sin clave |

El programa de la central es **xiaozhi-esp32-server**, un proyecto libre hecho justo para XiaoZhi.

## Lo que cambia (léelo antes de empezar)
- **Tu PC tiene que estar prendido** para que Byte funcione, también cuando llegue la placa. Si lo apagas, Byte se queda sin central.
- La consola de xiaozhi.me deja de usarse: la personalidad y la voz ahora viven en el archivo `data/.config.yaml`.
- Las herramientas de internet (`byte_internet.py`) hoy van conectadas a xiaozhi.me. Con la central propia hay que conectarlas de otra forma; eso lo hacemos en un paso posterior.
- **Para volver atrás** basta con apuntar Byte otra vez a xiaozhi.me. No se pierde nada.

## Paso 1: bajar todo y escuchar voces (5 minutos)
Abre **PowerShell** y pega esta sola línea:
```
iwr -useb "https://raw.githubusercontent.com/alekore-lopez/byte-firmware/main/herramientas/servidor-propio/instalar.ps1?v=$(Get-Random)" | iex
```
Eso crea la carpeta `C:\Users\aleja\byte-servidor` con todos los archivos y después genera 8 audios en la carpeta `byte-voces`. Escúchalos y dime qué número te gustó.

**Qué hace esa línea:** `iwr` (Invoke-WebRequest) descarga el instalador desde tu GitHub, e `iex` lo ejecuta. Es como pedirle a PowerShell "baja esta receta y cocínala". Solo hazlo con scripts en los que confíes, como los de tu propio repositorio.

**Qué aprendes aquí:** el *tono* (pitch) se mide en Hz. Subirlo hace la voz más aguda, como un muñeco animado. La *velocidad* (rate) va en %, y un poco más rápido suena más animado.

## Paso 2: sacar la clave de Groq (gratis)
1. Entra a console.groq.com e inicia sesión (puedes usar GitHub o Google).
2. Ve a **API Keys** y luego **Create API Key**. Ponle de nombre `byte`.
3. Copia la clave (empieza por `gsk_`). **Es secreta, como una contraseña:** no la pegues en el chat ni en GitHub.

## Paso 3: instalar Docker Desktop
**Qué es Docker:** una "caja" que trae el programa ya armado con todo lo que necesita, para que no tengas que instalar Python, librerías, etc.
1. Descarga Docker Desktop desde docker.com e instálalo. Acepta usar **WSL 2** si te lo pregunta.
2. Reinicia el PC y abre Docker Desktop hasta que diga *Engine running*.

## Paso 4: poner tus datos en la configuración
El instalador ya creó la carpeta `byte-servidor` con `docker-compose.yml` y `data\.config.yaml`. Abre `data\.config.yaml` con VS Code (`code $HOME\byte-servidor\data\.config.yaml`) y cambia tres cosas:
- Las dos líneas `PEGA_AQUI_TU_CLAVE_DE_GROQ` por tu clave.
- `192.168.1.50` por la IP de tu PC. La ves con el comando `ipconfig`, en la línea "Dirección IPv4".
- `voice`, `pitch` y `rate` por los de la voz que elegiste en el paso 1.

Si vuelves a correr el instalador, tu `.config.yaml` no se borra.

## Paso 5: arrancar
En PowerShell:
```
cd $HOME\byte-servidor
docker compose up -d
docker logs -f byte-servidor
```
En el registro (log) debe aparecer una dirección **OTA** como `http://TU-IP:8003/xiaozhi/ota/`. Ábrela en el navegador: si responde, la central está viva. Para salir del log presiona Ctrl+C (la central sigue corriendo).

## Paso 6: conectar Byte a tu central
- **Hoy, con Byte en el PC (py-xiaozhi):** en su `config.json` cambia la dirección OTA (`OTA_VERSION_URL`) por la de tu central. Mándame captura del archivo y te señalo la línea exacta.
- **El 8-nov, con la placa:** al configurar el WiFi de Byte, en opciones avanzadas, pon la misma dirección OTA. Si no aparece esa opción, la cambiamos en el firmware (`idf.py menuconfig`, luego *Xiaozhi Assistant* y *Default OTA URL*) y lo volvemos a flashear.

## Si algo falla
- `docker` no se reconoce: Docker Desktop no está abierto, o falta reiniciar el PC.
- Byte responde en chino: revisa que `language: "Español"` esté en EdgeTTS y que la personalidad esté pegada.
- Error de modelo en Groq: cambia `model_name` por uno de la lista en console.groq.com/docs/models.
- Edge TTS falla seguido: apaga cualquier VPN.

Fuente del servidor: github.com/xinnan-tech/xiaozhi-esp32-server (configuración basada en su `config.yaml` actual).
