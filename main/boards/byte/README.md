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
python scripts/build.py byte --language es-ES
```
