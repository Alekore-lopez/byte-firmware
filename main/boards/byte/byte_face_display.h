#pragma once

#include <functional>

#include "display/lcd_display.h"
#include "device_state.h"
#include "byte_face_renderer.h"
#include "byte_ui.h"

// Pantalla de Byte: hereda todo de SpiLcdDisplay (driver, barra de estado,
// subtítulos), cambia el emoji del centro por los ojos animados de Byte y
// agrega encima las pantallas táctiles (menú, reloj, temporizador...).
class ByteFaceDisplay : public SpiLcdDisplay {
public:
    using SpiLcdDisplay::SpiLcdDisplay;  // usa el mismo constructor del padre
    ~ByteFaceDisplay();

    void SetupUI() override;                        // arma la pantalla al arrancar
    bool SetEmotion(const char* emotion) override;  // la IA pide "happy", "sad"...

    // El táctil: read devuelve true y las coordenadas de pantalla si hay un
    // dedo encima. long_press se llama al dejar el dedo 3 s sobre la cara.
    void AttachTouch(std::function<bool(int& x, int& y)> read, std::function<void()> long_press);

    // Temporizador, para las herramientas de voz
    void StartTimer(int seconds);
    void StopTimer();
    int TimerSecondsLeft();

private:
    lv_obj_t* face_ = nullptr;     // el lienzo LVGL donde se dibujan los ojos
    lv_timer_t* timer_ = nullptr;  // el reloj de la animación (unas 30 veces por segundo)
    ByteFaceRenderer renderer_;
    ByteUi ui_;

    // Táctil
    lv_indev_t* touch_ = nullptr;
    std::function<bool(int&, int&)> touch_read_;
    std::function<void()> long_press_;
    int touch_x_ = 0, touch_y_ = 0;

    // Qué cara toca según el estado del aparato y la emoción de la IA
    const byte_face_t* expression_ = nullptr;
    const byte_face_t* preview_ = nullptr;  // cara elegida en la galería
    DeviceState last_state_ = kDeviceStateUnknown;
    uint32_t idle_since_ = 0;
    uint32_t last_touch_ = 0;
    int tickle_ = 0;

    static void OnTimer(lv_timer_t* timer);
    static void OnDraw(lv_event_t* e);
    static void OnTouchRead(lv_indev_t* indev, lv_indev_data_t* data);
    const byte_face_t* ChooseFace(uint32_t now);
    void OnHomeTap();
    ByteUiHost MakeUiHost();
};
