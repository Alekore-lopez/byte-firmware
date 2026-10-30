# Byte 🤖

Byte es un asistente de voz de escritorio. Te escucha cuando dices **"Byte"**, habla contigo en español y muestra caras en su pantalla.

Este repositorio es una copia (fork) de [XiaoZhi ESP32](https://github.com/78/xiaozhi-esp32), un firmware libre con licencia MIT. Aquí guardamos el código de Byte, el historial de cambios y los `.bin` listos para cargar. La documentación original en inglés está en [README.md](../README.md).

## Hardware

| Pieza | Detalle |
|---|---|
| Placa | Freenove ESP32-S3 Display 2.8" (FNK0104), ESP32-S3 con 16 MB de flash y 8 MB de PSRAM |
| Pantalla | 2,8" IPS táctil, 320×240, controlador ILI9341 |
| Audio | Códec ES8311 con micrófono y parlante integrados |
| Energía | USB-C o batería LiPo de 3,7 V |

La placa no necesita cables ni protoboard: todo viene integrado. Los pines están en [`main/boards/byte/config.h`](../main/boards/byte/config.h).

## Cómo funciona

- **El firmware va en la placa.** Escucha la palabra "Byte", graba tu voz, la envía al servidor y reproduce la respuesta.
- **El servidor de IA está en internet.** Usamos [xiaozhi.me](https://xiaozhi.me). Ahí se configuran la personalidad, la voz y el modelo de IA.

## Compilar

Necesitas Visual Studio Code con la extensión **ESP-IDF** de Espressif, usando la rama `release/v6.1` de ESP-IDF (mínimo v6.0.1; la 5.x ya no sirve).

```bash
python scripts/build.py byte --language es-ES
```

El `.bin` queda en la carpeta `build/`. Para cargarlo, conecta la placa por USB-C y ejecuta `idf.py -p COMx flash` (cambia `COMx` por el puerto de tu placa).

## Primer arranque

1. Al encender, Byte crea una red Wi-Fi propia. Conéctate a ella desde el celular y elige tu Wi-Fi de casa.
2. En la pantalla aparece un código de 6 dígitos. Entra a [xiaozhi.me](https://xiaozhi.me) → Consola → Agregar dispositivo y escribe el código.
3. Di "Byte" y empieza a hablar. Mientras la palabra propia no esté lista, toca la pantalla una vez para hablar.

## Controles táctiles

- **Un toque:** empieza o termina la conversación.
- **Doble toque:** empieza a escuchar.
- **Mantener 3 segundos:** vuelve a configurar el Wi-Fi.

## Estado

| Paso | Estado |
|---|---|
| Configuración de la placa Byte | ✅ Listo |
| Entorno de compilación en el PC | ⏳ Pendiente |
| Palabra de activación "Byte" | ⏳ Pendiente |
| Caras de Byte a pantalla completa | ⏳ Pendiente |
| Personalidad y voz en xiaozhi.me | ⏳ Pendiente |
| Compilación automática del `.bin` en GitHub | ⏳ Pendiente |
| Prueba en la placa real (llega el 8 de noviembre de 2026) | ⏳ Pendiente |

## Licencia

MIT, igual que el proyecto original. Ver [LICENSE](../LICENSE).
