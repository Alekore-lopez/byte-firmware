# OmniRoute para Byte

OmniRoute es un "enchufe único" para muchos modelos de IA (Gemini, Groq, Claude, Kimi...).
Byte y la terminal le hablan a OmniRoute con UNA clave, y OmniRoute elige el modelo.

## Instalar los botones (una sola vez)

```powershell
cd $HOME\byte-firmware; git checkout main; git pull
powershell -ExecutionPolicy Bypass -File herramientas\omniroute\instalar-omniroute.ps1
```

Te pide la clave de OmniRoute (con asteriscos, se guarda cifrada en `~\byte-omniroute\clave.dat`)
y el nombre del modelo. Crea en el escritorio:

| Botón | Qué hace |
|---|---|
| **OmniRoute** | Lo enciende escondido (si estaba apagado) y abre el panel |
| **Programar con IA** | Enciende OmniRoute, abre una terminal en `byte-firmware` y arranca **aider** con tu modelo |
| **Apagar OmniRoute** | Lo apaga |

## Seguridad

- Los scripts encienden OmniRoute con `REQUIRE_API_KEY=true`: sin la clave nadie en tu WiFi puede usar tus modelos.
- Cambia la contraseña `CHANGEME` del panel.
- No abras el puerto 20128 a internet.

## Byte usando OmniRoute

Cuando el `.config.yaml` de la central tenga `:20128`, el botón **Byte** enciende OmniRoute antes de la central.
Desde Docker la dirección es `http://host.docker.internal:20128/v1` (no `localhost`).
