#include "byte_face_display.h"

#include <algorithm>
#include <cstring>
#include <esp_app_desc.h>
#include <esp_log.h>
#include <esp_wifi.h>

#include "application.h"
#include "assets/lang_config.h"
#include "board.h"

#define TAG "ByteFace"

namespace {

constexpr uint32_t kFrameMs = 33;                     // ~30 cuadros por segundo
constexpr uint32_t kExpressionLingerMs = 4000;        // la expresión se queda 4 s al terminar de hablar
// Modo juego: qué hace Byte cuando nadie le habla ni lo toca
constexpr uint32_t kPlayAfterMs = 45 * 1000;          // a los 45 s se pone a jugar
constexpr uint32_t kSleepyAfterMs = 3 * 60 * 1000;    // a los 3 min le da sueño
constexpr uint32_t kSleepAfterMs = 4 * 60 * 1000;     // a los 4 min se duerme
constexpr uint32_t kGameGapMinMs = 8000;              // un juego nuevo cada 8 a 15 s
constexpr uint32_t kGameGapMaxMs = 15000;
constexpr int kSleepBrightness = 15;                  // brillo (%) mientras duerme

const char* PhaseName(int phase) {
    static const char* kNames[] = {"atento", "jugando", "con sueño", "dormido"};
    return kNames[phase];
}

const byte_face_t* FindFace(const char* id) {
    for (const auto& face : kByteFaces) {
        if (strcmp(face.id, id) == 0) {
            return &face;
        }
    }
    return nullptr;
}

}  // namespace

ByteFaceDisplay::~ByteFaceDisplay() {
    if (timer_ != nullptr) {
        lv_timer_delete(timer_);
    }
    if (touch_ != nullptr) {
        lv_indev_delete(touch_);
    }
}

void ByteFaceDisplay::SetupUI() {
    SpiLcdDisplay::SetupUI();  // primero la interfaz normal de XiaoZhi

    DisplayLockGuard lock(this);
    auto screen = lv_screen_active();

    // Lienzo negro a pantalla completa, encima del emoji de XiaoZhi (que queda
    // tapado) y debajo de la barra de estado y los subtítulos
    face_ = lv_obj_create(screen);
    lv_obj_remove_style_all(face_);
    lv_obj_set_size(face_, LV_HOR_RES, LV_VER_RES);
    lv_obj_set_style_bg_color(face_, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(face_, LV_OPA_COVER, 0);
    lv_obj_remove_flag(face_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_remove_flag(face_, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_t* below = emoji_box_ != nullptr ? emoji_box_ : container_;
    if (below != nullptr) {
        lv_obj_move_to_index(face_, lv_obj_get_index(below) + 1);
    }

    uint32_t now = lv_tick_get();
    renderer_.Init(width_, height_, FindFace("reposo"), now);
    lv_obj_add_event_cb(face_, OnDraw, LV_EVENT_DRAW_MAIN, this);
    timer_ = lv_timer_create(OnTimer, kFrameMs, this);

    // Pantallas táctiles justo encima de la cara (debajo de la barra de estado)
    ui_.Init(screen, width_, height_, MakeUiHost());
    lv_obj_move_to_index(ui_.root(), lv_obj_get_index(face_) + 1);
}

// Lo que las pantallas táctiles necesitan del aparato
ByteUiHost ByteFaceDisplay::MakeUiHost() {
    ByteUiHost host;
    host.get_volume = [] { return Board::GetInstance().GetAudioCodec()->output_volume(); };
    host.set_volume = [](int volume) { Board::GetInstance().GetAudioCodec()->SetOutputVolume(volume); };
    host.get_brightness = [] {
        auto backlight = Board::GetInstance().GetBacklight();
        return backlight != nullptr ? static_cast<int>(backlight->brightness()) : 100;
    };
    host.set_brightness = [](int brightness, bool save) {
        if (auto backlight = Board::GetInstance().GetBacklight()) {
            backlight->SetBrightness(brightness, save);
        }
    };
    host.notify = [this](const char* text) { ShowNotification(text, 3000); };
    host.play_alarm = [] {
        auto& app = Application::GetInstance();
        app.Schedule([&app] { app.PlaySound(Lang::Sounds::OGG_POPUP); });
    };
    host.reboot = [] {
        auto& app = Application::GetInstance();
        app.Schedule([&app] { app.Reboot(); });
    };
    host.wifi_name = [] {
        wifi_ap_record_t ap = {};
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
            return std::string(reinterpret_cast<const char*>(ap.ssid));
        }
        return std::string();
    };
    host.firmware_version = [] { return std::string(esp_app_get_description()->version); };
    host.preview_face = [this](int index) { preview_ = index >= 0 ? &kByteFaces[index] : nullptr; };
    host.home_tap = [this] { OnHomeTap(); };
    host.home_long_press = [this] {
        if (long_press_) {
            long_press_();
        }
    };
    host.activity = [this] { last_touch_ = lv_tick_get(); };
    return host;
}

void ByteFaceDisplay::AttachTouch(std::function<bool(int&, int&)> read, std::function<void()> long_press) {
    DisplayLockGuard lock(this);
    touch_read_ = std::move(read);
    long_press_ = std::move(long_press);
    // El táctil pasa a ser una entrada de LVGL: así los botones de las pantallas
    // reciben los toques, y ByteUi ve cada muestra para detectar deslizamientos
    touch_ = lv_indev_create();
    lv_indev_set_type(touch_, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(touch_, OnTouchRead);
    lv_indev_set_user_data(touch_, this);
    lv_indev_set_display(touch_, display_);
}

// Corre en la tarea de LVGL unas 30 veces por segundo
void ByteFaceDisplay::OnTouchRead(lv_indev_t* indev, lv_indev_data_t* data) {
    auto self = static_cast<ByteFaceDisplay*>(lv_indev_get_user_data(indev));
    int x = 0, y = 0;
    bool pressed = self->touch_read_ && self->touch_read_(x, y);
    if (pressed) {
        self->touch_x_ = x;
        self->touch_y_ = y;
    }
    // Al soltar, LVGL quiere el último punto donde estaba el dedo
    data->point.x = self->touch_x_;
    data->point.y = self->touch_y_;
    data->state = pressed ? LV_INDEV_STATE_PRESSED : LV_INDEV_STATE_RELEASED;
    if (self->ui_.root() != nullptr) {
        self->ui_.Feed(indev, pressed, self->touch_x_, self->touch_y_);
    }
}

// Toque corto sobre la cara
void ByteFaceDisplay::OnHomeTap() {
    auto& app = Application::GetInstance();
    DeviceState state = app.GetDeviceState();
    if (state == kDeviceStateListening || state == kDeviceStateSpeaking) {
        app.ToggleChatState();  // tocarlo mientras escucha o habla lo interrumpe
        return;
    }
    if (state != kDeviceStateIdle) {
        return;
    }
    // Cosquillas: una reacción distinta cada vez, que dura como una expresión
    static constexpr const char* kTickles[] = {"feliz", "risa", "guino", "carino"};
    expression_ = FindFace(kTickles[tickle_++ % 4]);
    idle_since_ = lv_tick_get();
}

void ByteFaceDisplay::StartTimer(int seconds) {
    DisplayLockGuard lock(this);
    ui_.StartTimer(seconds);
}

void ByteFaceDisplay::StopTimer() {
    DisplayLockGuard lock(this);
    ui_.StopTimer();
}

int ByteFaceDisplay::TimerSecondsLeft() {
    DisplayLockGuard lock(this);
    return ui_.TimerRunning() ? ui_.TimerSecondsLeft() : 0;
}

bool ByteFaceDisplay::SetEmotion(const char* emotion) {
    if (emotion == nullptr) {
        return false;
    }
    DisplayLockGuard lock(this);
    // "neutral" no borra la expresión: XiaoZhi la manda en cada cambio de
    // estado y la cara se elige en ChooseFace()
    if (strcmp(emotion, "neutral") == 0) {
        return true;
    }
    for (const auto& m : kByteEmotions) {
        if (strcmp(m.emotion, emotion) == 0) {
            expression_ = FindFace(m.face);
            return true;
        }
    }
    // También se puede pedir una cara de Byte por su nombre ("feliz", "cool"...)
    if (auto face = FindFace(emotion)) {
        expression_ = face;
        return true;
    }
    ESP_LOGW(TAG, "Emoción sin cara: %s", emotion);
    return false;
}

const byte_face_t* ByteFaceDisplay::ChooseFace(uint32_t now) {
    DeviceState state = Application::GetInstance().GetDeviceState();
    if (state != last_state_) {
        if (state == kDeviceStateListening || state == kDeviceStateConnecting) {
            expression_ = nullptr;  // turno nuevo: olvidar la emoción anterior
        }
        if (state == kDeviceStateIdle) {
            idle_since_ = now;
        }
        last_state_ = state;
    }

    phase_ = kAwake;  // si no está quieto en reposo, está atento

    // En la galería manda la cara elegida
    if (preview_ != nullptr) {
        renderer_.SetTalking(false);
        return preview_;
    }

    renderer_.SetTalking(state == kDeviceStateSpeaking);
    switch (state) {
        case kDeviceStateWifiConfiguring:
            return FindFace("wifi");
        case kDeviceStateStarting:
        case kDeviceStateConnecting:
        case kDeviceStateActivating:
        case kDeviceStateUpgrading:
            return FindFace("pensando");
        case kDeviceStateListening:
        case kDeviceStateAudioTesting:
            return FindFace("escucha");
        case kDeviceStateSpeaking:
        case kDeviceStateNotifying:
            return expression_ != nullptr ? expression_ : FindFace("hablando");
        case kDeviceStateFatalError:
            return FindFace("oops");
        default: {
            uint32_t idle = now - idle_since_;
            if (expression_ != nullptr && idle < kExpressionLingerMs) {
                return expression_;
            }
            expression_ = nullptr;
            // Modo juego: cuenta desde lo último que pasó (hablarle o tocarlo)
            quiet_ms_ = std::min(idle, now - last_touch_);
            if (quiet_ms_ >= kSleepAfterMs) {
                phase_ = kAsleep;
            } else if (quiet_ms_ >= kSleepyAfterMs) {
                phase_ = kSleepy;
            } else if (quiet_ms_ >= kPlayAfterMs) {
                phase_ = kPlaying;
            }
            return FindFace(phase_ == kAsleep ? "dormido" : "reposo");
        }
    }
}

// Corre en la tarea de LVGL (con la pantalla ya bloqueada) cada kFrameMs
void ByteFaceDisplay::OnTimer(lv_timer_t* timer) {
    auto self = static_cast<ByteFaceDisplay*>(lv_timer_get_user_data(timer));
    uint32_t now = lv_tick_get();
    IdlePhase before = self->phase_;
    self->renderer_.SetFace(self->ChooseFace(now), now);
    if (self->phase_ != before) {
        ESP_LOGI(TAG, "Modo juego: %s -> %s", PhaseName(before), PhaseName(self->phase_));
    }
    self->UpdateIdleLife(now);

    lv_area_t dirty;
    if (self->renderer_.Update(now, &dirty)) {
        lv_obj_invalidate_area(self->face_, &dirty);
    }
}

// Modo juego: elige juegos al azar, baja los párpados con el sueño y baja
// el brillo cuando se duerme. Corre en cada cuadro, después de ChooseFace().
void ByteFaceDisplay::UpdateIdleLife(uint32_t now) {
    // 1. Juegos: solo en la pantalla de la cara (si hay un menú encima no se verían)
    if (phase_ == kPlaying && ui_.screen() == ByteUi::kHome) {
        if (next_game_ == 0 || (int32_t)(now - next_game_) >= 0) {
            // Al azar, pero nunca el mismo dos veces seguidas
            ByteGame game;
            do {
                game = static_cast<ByteGame>(1 + lv_rand(0, kGameCount - 1));
            } while (game == last_game_);
            last_game_ = game;
            renderer_.StartGame(game, now);
            next_game_ = now + lv_rand(kGameGapMinMs, kGameGapMaxMs);
        }
    } else {
        next_game_ = 0;  // al volver a jugar, el primer juego empieza de una
        if (phase_ == kAwake) {
            renderer_.StopGame();  // le hablaron o lo tocaron: deja de jugar ya
        }
        // Si le está dando sueño, el juego que iba se termina solo
    }

    // 2. Sueño: entre los 3 y los 4 min los párpados bajan poco a poco
    float sleepy = 0;
    if (phase_ == kSleepy) {
        sleepy = 0.95f * (quiet_ms_ - kSleepyAfterMs) / (float)(kSleepAfterMs - kSleepyAfterMs);
    }
    renderer_.SetSleepy(sleepy);

    // 3. Brillo: dormido baja la luz para ahorrar batería; al despertar vuelve
    // el brillo guardado. SetBrightness(..., false) no lo guarda en la memoria.
    bool asleep = phase_ == kAsleep;
    if (asleep != dimmed_) {
        dimmed_ = asleep;
        if (auto backlight = Board::GetInstance().GetBacklight()) {
            if (asleep) {
                int dim = std::min<int>(backlight->brightness(), kSleepBrightness);
                backlight->SetBrightness(dim, false);
            } else {
                backlight->RestoreBrightness();
            }
        }
    }
}

void ByteFaceDisplay::OnDraw(lv_event_t* e) {
    auto self = static_cast<ByteFaceDisplay*>(lv_event_get_user_data(e));
    self->renderer_.Draw(lv_event_get_layer(e));
}
