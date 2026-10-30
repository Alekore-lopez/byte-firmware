#include "byte_face_display.h"

#include <cstring>
#include <esp_log.h>

#include "application.h"

#define TAG "ByteFace"

namespace {

constexpr uint32_t kFrameMs = 33;                     // ~30 cuadros por segundo
constexpr uint32_t kExpressionLingerMs = 4000;        // la expresión se queda 4 s al terminar de hablar
constexpr uint32_t kSleepAfterMs = 5 * 60 * 1000;     // a los 5 min sin uso, Byte se duerme

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
            return FindFace(idle > kSleepAfterMs ? "dormido" : "reposo");
        }
    }
}

// Corre en la tarea de LVGL (con la pantalla ya bloqueada) cada kFrameMs
void ByteFaceDisplay::OnTimer(lv_timer_t* timer) {
    auto self = static_cast<ByteFaceDisplay*>(lv_timer_get_user_data(timer));
    uint32_t now = lv_tick_get();
    self->renderer_.SetFace(self->ChooseFace(now), now);

    lv_area_t dirty;
    if (self->renderer_.Update(now, &dirty)) {
        lv_obj_invalidate_area(self->face_, &dirty);
    }
}

void ByteFaceDisplay::OnDraw(lv_event_t* e) {
    auto self = static_cast<ByteFaceDisplay*>(lv_event_get_user_data(e));
    self->renderer_.Draw(lv_event_get_layer(e));
}
