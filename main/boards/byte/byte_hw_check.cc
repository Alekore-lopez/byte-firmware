#include "byte_hw_check.h"

#include <esp_flash.h>
#include <esp_log.h>
#include <esp_psram.h>
#include <cJSON.h>

#include "adc_battery_monitor.h"

#define TAG "ByteHwCheck"

namespace {

// Direcciones I2C de 7 bits. (ES8311_CODEC_DEFAULT_ADDR vale 0x30 porque
// esp_codec_dev la guarda en formato de 8 bits; el bus usa 0x18.)
constexpr uint16_t kCodecAddr = 0x18;
constexpr uint16_t kTouchAddr = 0x38;
constexpr int kProbeTimeoutMs = 50;

// Pregunta "¿hay alguien en esta dirección?": el chip responde con un ACK
bool Probe(i2c_master_bus_handle_t bus, uint16_t addr) {
    return bus != nullptr && i2c_master_probe(bus, addr, kProbeTimeoutMs) == ESP_OK;
}

const char* Mark(bool ok) { return ok ? "OK" : "FALLA"; }

}  // namespace

ByteHwCheck ByteHwCheck::Run(i2c_master_bus_handle_t i2c_bus, AdcBatteryMonitor* battery) {
    ByteHwCheck r;
    r.codec = Probe(i2c_bus, kCodecAddr);
    r.touch = Probe(i2c_bus, kTouchAddr);
    r.psram_mb = esp_psram_get_size() / (1024 * 1024);

    uint32_t flash_size = 0;
    if (esp_flash_get_size(nullptr, &flash_size) == ESP_OK) {
        r.flash_mb = flash_size / (1024 * 1024);
    }
    if (battery != nullptr) {
        r.battery = battery->GetBatteryLevel();
        r.charging = battery->IsCharging();
    }
    return r;
}

std::string ByteHwCheck::FailureSummary() const {
    std::string s;
    auto add = [&s](bool ok, const char* name) {
        if (!ok) {
            s += s.empty() ? "Falla: " : ", ";
            s += name;
        }
    };
    add(codec, "audio (ES8311)");
    add(touch, "táctil (FT6336)");
    add(psram_ok(), "PSRAM");
    add(flash_ok(), "flash");
    return s;
}

std::string ByteHwCheck::ToJson() const {
    cJSON* root = cJSON_CreateObject();
    cJSON_AddBoolToObject(root, "all_ok", all_ok());
    cJSON_AddBoolToObject(root, "audio_codec_es8311", codec);
    cJSON_AddBoolToObject(root, "touch_ft6336", touch);
    cJSON_AddNumberToObject(root, "psram_mb", psram_mb);
    cJSON_AddNumberToObject(root, "flash_mb", flash_mb);
    if (battery >= 0) {
        cJSON_AddNumberToObject(root, "battery_percent", battery);
        cJSON_AddBoolToObject(root, "charging", charging);
    }
    char* text = cJSON_PrintUnformatted(root);
    std::string json = text != nullptr ? text : "{}";
    cJSON_free(text);
    cJSON_Delete(root);
    return json;
}

void ByteHwCheck::Log() const {
    ESP_LOGI(TAG, "---- Autoprueba de hardware ----");
    ESP_LOGI(TAG, "Audio ES8311 (I2C 0x18) : %s", Mark(codec));
    ESP_LOGI(TAG, "Táctil FT6336 (I2C 0x38): %s", Mark(touch));
    ESP_LOGI(TAG, "PSRAM                   : %s (%lu MB)", Mark(psram_ok()), (unsigned long)psram_mb);
    ESP_LOGI(TAG, "Flash                   : %s (%lu MB)", Mark(flash_ok()), (unsigned long)flash_mb);
    if (battery >= 0) {
        ESP_LOGI(TAG, "Batería                 : %d %%%s", battery, charging ? " (cargando)" : "");
    }
    ESP_LOGI(TAG, "Resultado               : %s", all_ok() ? "TODO OK" : "HAY FALLAS");
}
