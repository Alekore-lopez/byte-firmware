#pragma once

#include "display/lcd_display.h"
#include "device_state.h"
#include "byte_face_renderer.h"

// Pantalla de Byte: hereda todo de SpiLcdDisplay (driver, barra de estado,
// subtítulos) y cambia el emoji del centro por los ojos animados de Byte.
class ByteFaceDisplay : public SpiLcdDisplay {
public:
    using SpiLcdDisplay::SpiLcdDisplay;  // usa el mismo constructor del padre
    ~ByteFaceDisplay();

    void SetupUI() override;                        // arma la pantalla al arrancar
    bool SetEmotion(const char* emotion) override;  // la IA pide "happy", "sad"...

private:
    lv_obj_t* face_ = nullptr;     // el lienzo LVGL donde se dibujan los ojos
    lv_timer_t* timer_ = nullptr;  // el reloj de la animación (unas 30 veces por segundo)
    ByteFaceRenderer renderer_;

    // Qué cara toca según el estado del aparato y la emoción de la IA
    const byte_face_t* expression_ = nullptr;
    DeviceState last_state_ = kDeviceStateUnknown;
    uint32_t idle_since_ = 0;

    static void OnTimer(lv_timer_t* timer);
    static void OnDraw(lv_event_t* e);
    const byte_face_t* ChooseFace(uint32_t now);
};
