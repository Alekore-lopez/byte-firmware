# Byte 🤖

> **Tu escritorio tiene nueva personalidad.**

[![Compilar Byte](https://github.com/Alekore-lopez/byte-firmware/actions/workflows/byte.yml/badge.svg)](https://github.com/Alekore-lopez/byte-firmware/actions/workflows/byte.yml)

Byte es una nubecita negra con piecitos y un asistente de voz de escritorio. Te escucha cuando dices **"Byte"**, habla contigo en español y muestra caras en su pantalla.

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
python scripts/build.py byte --language es-ES --custom-wake-word byte
```

`--custom-wake-word byte` hace que Byte despierte al oír "Byte" (se pronuncia "bait", como en inglés). Usa el modelo MultiNet7 en inglés, el mismo método de Troko. Si quieres otra palabra, cámbiala ahí; solo letras en inglés, sin tildes.

El `.bin` queda en la carpeta `build/`. Para cargarlo, conecta la placa por USB-C y ejecuta `idf.py -p COMx flash` (cambia `COMx` por el puerto de tu placa).

### Compilación automática (CI)

Cada vez que algo llega a `main`, o se abre un pull request hacia `main`, GitHub compila Byte solo con el mismo comando de arriba (archivo [`.github/workflows/byte.yml`](workflows/byte.yml)). El resultado se ve en la pestaña **Actions** y como un check ✅ o ❌ en cada pull request. Si sale verde, el `.bin` listo para cargar se descarga desde la sección **Artifacts** de esa ejecución (se guarda 14 días).

### Bot de fusión automática

No hace falta fusionar a mano. El archivo [`.github/workflows/auto-merge.yml`](workflows/auto-merge.yml) es un bot que:

1. Espera a que el CI ("Compilar Byte") termine en un pull request de una rama `claude/...`.
2. Si salió ✅ verde, fusiona el PR a `main` solo y vuelve a compilar `main` para dejar el `.bin` final.
3. Si salió ❌ rojo, no fusiona nada.
4. Cada vez que `main` cambia, revisa los PR abiertos de Claude. Si alguno quedó con conflicto, le pone la etiqueta `conflicto` y deja un comentario con lo que hay que pedirle a Claude.

Frenos de mano: un PR en **borrador** (draft) o con la etiqueta **`no-fusionar`** nunca se fusiona solo. Los PR que cambian archivos de `.github/workflows/` tampoco: GitHub exige que esos los fusione una persona con el botón verde.

Después de fusionar, el bot borra la rama. Y el bot de limpieza [`limpiar-ramas.yml`](workflows/limpiar-ramas.yml) borra las ramas `claude/...` que ya están en `main` cada vez que se fusiona un PR (aunque sea a mano), todos los lunes, o cuando le des **Run workflow** en la pestaña Actions. Nunca toca `main`, `gh-pages` ni ramas con cambios sin fusionar.

[Dependabot](dependabot.yml) revisa una vez al mes si hay versiones nuevas de las actions de los workflows y abre un PR si las hay.

## Primer arranque

1. Al encender, Byte crea una red Wi-Fi propia. Conéctate a ella desde el celular y elige tu Wi-Fi de casa.
2. En la pantalla aparece un código de 6 dígitos. Entra a [xiaozhi.me](https://xiaozhi.me) → Consola → Agregar dispositivo y escribe el código.
3. Di "Byte" y empieza a hablar. Si no te escucha, toca la pantalla una vez para hablar.

## Controles táctiles

- **Un toque:** empieza o termina la conversación.
- **Doble toque:** empieza a escuchar.
- **Mantener 3 segundos:** vuelve a configurar el Wi-Fi.

## Estado

| Paso | Estado |
|---|---|
| Configuración de la placa Byte | ✅ Listo |
| Entorno de compilación en el PC | ✅ Listo |
| Palabra de activación "Byte" | ✅ Lista (falta probar en la placa) |
| Caras de Byte a pantalla completa | ⏳ Pendiente |
| Personalidad y voz en xiaozhi.me | ⏳ Pendiente |
| Compilación automática del `.bin` en GitHub | ✅ Listo |
| Prueba en la placa real (llega el 8 de noviembre de 2026) | ⏳ Pendiente |

## Licencia

MIT, igual que el proyecto original. Ver [LICENSE](../LICENSE).
