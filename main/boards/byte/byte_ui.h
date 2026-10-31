#pragma once

// Pantallas táctiles de Byte: menú, reloj, temporizador, galería de caras,
// ajustes y ajustes rápidos (volumen y brillo). Se dibujan con LVGL encima de
// la cara. ByteUi no conoce XiaoZhi: lo que necesita del aparato lo pide a
// ByteUiHost, así que también se puede probar en el PC.

#include <lvgl.h>
#include <cstdint>
#include <functional>
#include <string>

struct ByteUiHost {
    std::function<int()> get_volume;                  // 0-100
    std::function<void(int)> set_volume;              // se guarda al soltar la barra
    std::function<int()> get_brightness;              // 0-100
    std::function<void(int, bool)> set_brightness;    // (valor, guardar)
    std::function<void(const char*)> notify;          // aviso corto en la barra de arriba
    std::function<void()> play_alarm;                 // un pitido del temporizador
    std::function<void()> reboot;
    std::function<std::string()> wifi_name;           // "" si no hay conexión
    std::function<std::string()> firmware_version;
    std::function<void(int)> preview_face;            // índice de kByteFaces; -1 = cara normal
    std::function<void()> home_tap;                   // toque corto sobre la cara
    std::function<void()> home_long_press;            // 3 s sobre la cara
    std::function<void()> activity;                   // cualquier toque
};

class ByteUi {
public:
    enum Screen { kHome, kMenu, kClock, kTimer, kFaces, kSettings, kAbout };

    // Crea todas las pantallas (escondidas) dentro de parent
    void Init(lv_obj_t* parent, int width, int height, const ByteUiHost& host);

    // Objeto que contiene todo; sirve para ordenarlo encima de la cara
    lv_obj_t* root() const { return root_; }
    Screen screen() const { return screen_; }

    // Cada lectura del táctil (en la tarea de LVGL). Aquí se detectan los
    // deslizamientos, el toque largo y el toque sobre la cara.
    void Feed(lv_indev_t* indev, bool pressed, int x, int y);

    // Temporizador; también lo usan las herramientas de voz (con la pantalla bloqueada)
    void StartTimer(int seconds);  // 0 = seguir con lo que había
    void StopTimer();
    bool TimerRunning() const { return running_; }
    int TimerSecondsLeft() const;

private:
    enum Action {
        kActNone, kActHome, kActMenu, kActClock, kActTimer, kActFaces, kActSettings, kActAbout,
        kActBack, kActQuickOpen, kActQuickClose,
        kActTimerMinus, kActTimerPlus, kActTimerReset, kActTimerStartPause, kActTimerStop,
        kActFacePrev, kActFaceNext, kActReboot,
    };

    ByteUiHost host_;
    int w_ = 320, h_ = 240;
    lv_obj_t* root_ = nullptr;
    lv_obj_t* screens_[7] = {};
    Screen screen_ = kHome;

    // Ajustes rápidos
    lv_obj_t* qp_backdrop_ = nullptr;
    lv_obj_t* qp_panel_ = nullptr;
    lv_obj_t* qp_volume_ = nullptr;
    lv_obj_t* qp_volume_value_ = nullptr;
    lv_obj_t* qp_brightness_ = nullptr;
    lv_obj_t* qp_brightness_value_ = nullptr;
    bool qp_open_ = false;

    // Reloj
    lv_obj_t* clock_eyes_[2] = {};
    lv_obj_t* clock_time_ = nullptr;
    lv_obj_t* clock_date_ = nullptr;
    lv_obj_t* clock_ampm_ = nullptr;
    int clock_shown_min_ = -1;

    // Temporizador
    lv_obj_t* timer_arc_ = nullptr;
    lv_obj_t* timer_label_ = nullptr;
    lv_obj_t* timer_adjust_[2] = {};
    lv_obj_t* timer_adjust_min_[2] = {};
    lv_obj_t* timer_reset_ = nullptr;
    lv_obj_t* timer_main_ = nullptr;
    lv_obj_t* timer_main_label_ = nullptr;
    lv_obj_t* timer_stop_ = nullptr;
    lv_obj_t* timer_chip_ = nullptr;
    lv_obj_t* timer_chip_label_ = nullptr;
    int total_s_ = 120;
    int32_t left_ms_ = 120000;
    uint32_t end_tick_ = 0;
    bool running_ = false;
    bool ringing_ = false;
    uint32_t ring_until_ = 0, next_beep_ = 0;

    // Galería de caras
    lv_obj_t* face_name_ = nullptr;
    int face_index_ = 0;

    // Ajustes y Acerca de
    lv_obj_t* settings_volume_ = nullptr;
    lv_obj_t* settings_brightness_ = nullptr;
    lv_obj_t* settings_wifi_ = nullptr;
    lv_obj_t* about_version_ = nullptr;
    lv_obj_t* reboot_button_ = nullptr;
    lv_obj_t* reboot_label_ = nullptr;
    uint32_t reboot_armed_until_ = 0;

    // Toque en curso
    bool down_ = false, swiped_ = false, long_done_ = false, slider_pressed_ = false;
    int x0_ = 0, y0_ = 0;
    uint32_t t0_ = 0, last_touch_ = 0;

    lv_timer_t* tick_ = nullptr;

    // Construcción
    lv_obj_t* NewScreen(Screen s, bool opaque);
    lv_obj_t* Button(lv_obj_t* parent, Action action);
    void Header(lv_obj_t* screen, const char* title);
    lv_obj_t* SettingsRow(lv_obj_t* screen, int index, const char* icon, const char* text, Action action);
    lv_obj_t* QuickSlider(int y, const char* icon, lv_obj_t** value_label);
    void BuildMenu();
    void BuildClock();
    void BuildTimer();
    void BuildFaces();
    void BuildSettings();
    void BuildAbout();
    void BuildQuickPanel();

    // Comportamiento
    void Do(Action action);
    void Go(Screen s);
    void Back();
    void OnSwipe(lv_dir_t dir);
    void OpenQuick();
    void CloseQuick();
    void ShowFace(int step);
    void AdjustTimer(int minutes);
    void PauseTimer();
    void FinishTimer(uint32_t now);
    void StopRing();
    void ResetRebootButton();
    void Tick();
    void RefreshClock(bool force);
    void RefreshTimer();
    void RefreshSettings();
    void RefreshQuick();
    int32_t TimerLeftMs(uint32_t now) const;

    static void OnClick(lv_event_t* e);
    static void OnSlider(lv_event_t* e);
    static void OnTick(lv_timer_t* t);
};
