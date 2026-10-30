#pragma once

// Autoprueba de hardware de Byte: revisa en unos milisegundos que cada pieza
// de la placa responda. No toca el audio ni la pantalla, así que se puede
// llamar en cualquier momento sin molestar a XiaoZhi.

#include <driver/i2c_master.h>
#include <cstdint>
#include <string>

class AdcBatteryMonitor;

struct ByteHwCheck {
    bool codec = false;     // códec de audio ES8311 (micrófono y parlante), I2C 0x18
    bool touch = false;     // controlador táctil FT6336, I2C 0x38
    uint32_t psram_mb = 0;  // memoria PSRAM; XiaoZhi necesita al menos 2 MB
    uint32_t flash_mb = 0;  // memoria flash; el firmware usa 16 MB
    int battery = -1;       // % de batería; -1 si no hay monitor
    bool charging = false;

    bool psram_ok() const { return psram_mb >= 2; }
    bool flash_ok() const { return flash_mb >= 16; }
    bool all_ok() const { return codec && touch && psram_ok() && flash_ok(); }

    // Ejecuta todas las pruebas
    static ByteHwCheck Run(i2c_master_bus_handle_t i2c_bus, AdcBatteryMonitor* battery);

    // Resumen corto para la pantalla, p. ej. "Falla: táctil, códec"
    std::string FailureSummary() const;
    // Resultado completo en JSON para la herramienta MCP
    std::string ToJson() const;
    // Tabla en el monitor serie (idf.py monitor)
    void Log() const;
};
