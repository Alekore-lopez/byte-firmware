# Placa Byte

Configuración de Byte sobre la [Freenove ESP32-S3 Display 2.8" (FNK0104)](https://store.freenove.com/products/fnk0104).

Parte de la placa `freenove-esp32s3-display-2.8-lcd` de XiaoZhi. Por ahora usa el mismo hardware y los mismos pines; aquí iremos agregando lo propio de Byte (caras, palabra de activación, ajustes de pantalla) sin tocar la placa original, para poder seguir recibiendo actualizaciones de XiaoZhi sin conflictos.

## Pines

| Función | GPIO |
|---|---|
| I2S MCLK / BCLK / WS / DIN / DOUT | 4 / 5 / 7 / 6 / 8 |
| Amplificador (PA) | 1 |
| I2C del códec y táctil (SCL / SDA) | 15 / 16 |
| Pantalla SCK / MOSI / MISO / CS / DC | 12 / 11 / 13 / 10 / 46 |
| Luz de pantalla | 45 |
| Botón BOOT | 0 |
| LED | 42 |

## Compilar

```bash
python scripts/build.py byte --language es-ES --custom-wake-word byte
```

La palabra de activación "Byte" usa MultiNet7 en inglés. `build.py` la guarda en el `sdkconfig` y `build_default_assets.py` la escribe en `index.json` de la partición assets junto con el modelo `mn7_en`.

## Caras animadas

La pantalla muestra los ojos de Byte en lugar del emoji de XiaoZhi. Son las 17 caras del visor de caras, adaptadas a 320×240.

| Archivo | Qué hace |
|---|---|
| `byte_faces.h` | La tabla de caras: color, ojos, accesorios y animación de cada una, y qué emoción de XiaoZhi corresponde a cada cara. Para crear o ajustar una cara se edita solo esta tabla. |
| `byte_face_renderer.*` | El motor: mueve los ojos hacia la cara destino (transición de 260 ms), parpadea, mira alrededor y dibuja con LVGL. Solo repinta el rectángulo que cambió, porque la pantalla completa tarda unos 60 ms por SPI. |
| `byte_face_display.*` | Hereda de `SpiLcdDisplay` y elige la cara según el estado del aparato (escuchando, pensando, hablando, sin wifi) y la emoción que manda la IA. |

Cuándo sale cada cara:

- **Escucha** al oír "Byte", **Pensando** mientras conecta, **Hablando** mientras responde.
- Si la IA manda una emoción (`happy`, `sad`, `angry`…), Byte la pone mientras habla, con la boca de barras encima, y la mantiene 4 s al terminar.
- **Reposo** al esperar y **Dormido** tras 5 min sin uso. **Sin Wi-Fi** en modo configuración.

La barra de estado de arriba y los subtítulos de abajo siguen igual, porque ahí salen el código de activación y los datos del wifi.

## Autoprueba de hardware

`byte_hw_check.*` revisa en unos milisegundos que cada pieza responda:

| Prueba | Cómo | Si falla, revisar |
|---|---|---|
| Audio ES8311 (micrófono y parlante) | ¿responde en I2C 0x18? | soldaduras o pines 15/16 (SCL/SDA) |
| Táctil FT6336 | ¿responde en I2C 0x38? | cable flexible de la pantalla |
| PSRAM | tamaño ≥ 2 MB | módulo ESP32-S3 sin PSRAM o mal configurado |
| Flash | tamaño ≥ 16 MB | módulo con menos memoria |
| Batería | % y si está cargando | solo informa, no falla |

Se ejecuta de dos formas:

- **Al encender**, 3 s después de arrancar. Si algo falla, sale un aviso arriba en la pantalla durante 10 s. El detalle completo se ve siempre en `idf.py monitor`, en las líneas `ByteHwCheck`.
- **Por voz**: "Byte, revisa tu hardware". La IA llama a la herramienta MCP `self.byte.hardware_test` y te dice el resultado.

La pantalla no necesita prueba: si ves la cara de Byte, funciona. El micrófono y el parlante se prueban de verdad hablando con Byte. La autoprueba confirma que el chip de audio responde, pero no que el sonido salga bien.

## Pantallas táctiles

Encima de la cara hay pantallas que se manejan con el dedo, las mismas del simulador. Están en `byte_ui.*` y solo usan LVGL; lo que necesitan del aparato (volumen, brillo, sonido, reinicio) lo piden a `ByteUiHost`, que llena `byte_face_display.cc`.

| Gesto | Qué hace |
|---|---|
| Tocar la cara | Byte reacciona (feliz, risa, guiño, cariño). Si está escuchando o hablando, lo interrumpe. |
| Mantener 3 s sobre la cara | Modo de configuración Wi-Fi |
| Deslizar hacia abajo desde arriba | Ajustes rápidos: volumen y brillo |
| Deslizar hacia arriba sobre la cara | Menú: Reloj, Temporizador, Caras, Ajustes |
| Deslizar hacia la derecha | Volver atrás |
| Deslizar a los lados en Caras | Ver la cara anterior o la siguiente |

- **Reloj**: hora grande, fecha en español y a. m./p. m. Necesita la hora de internet.
- **Temporizador**: de 1 a 60 min con − y +. Al terminar avisa "¡Tiempo!" y pita hasta 15 s; cualquier toque lo apaga. Mientras corre, la cara muestra un chip con el tiempo. También funciona por voz: "Byte, pon un temporizador de 5 minutos" (herramientas `self.byte.timer.start`, `.stop` y `.get`).
- **Ajustes**: volumen, brillo, la red Wi-Fi y Acerca de, con un botón Reiniciar que pide tocar dos veces.
- El volumen y el brillo se guardan al soltar la barra y se mantienen al apagar.
- Si se deja abierto el menú, Ajustes o Caras, a los 30 s vuelve solo a la cara.

El tiempo grande del reloj usa la fuente Montserrat 48 de LVGL, que `config.json` activa con `CONFIG_LV_FONT_MONTSERRAT_48=y`.

### Orientación del táctil

El FT6336 entrega las coordenadas en vertical (240×320) y la pantalla está acostada, así que `byte.cc` las gira según `TOUCH_SWAP_XY`, `TOUCH_MIRROR_X` y `TOUCH_MIRROR_Y` de `config.h`. Para comprobarlo con la placa: abrir `idf.py monitor`, tocar la esquina de arriba a la izquierda (debe decir `Toque en x=0 y=0` más o menos) y la de abajo a la derecha (cerca de `x=319 y=239`). Si salen al revés, cambiar el `MIRROR` que corresponda.
