#pragma once

// Motor de la cara de Byte: guarda dónde están los ojos ahora, los acerca a
// la cara destino en cada cuadro y los dibuja con LVGL. Solo usa LVGL, así
// que se puede probar fuera del ESP32.

#include <lvgl.h>
#include <cstdint>

#include "byte_faces.h"

class ByteFaceRenderer {
public:
    // width/height: tamaño de la pantalla en píxeles
    void Init(int width, int height, const byte_face_t* face, uint32_t now_ms);

    // Cambia de cara con una transición suave
    void SetFace(const byte_face_t* face, uint32_t now_ms);
    const byte_face_t* face() const { return target_; }

    // Mientras Byte habla se añade la boca de barras a cualquier expresión
    void SetTalking(bool talking) { talking_ = talking; }

    // Avanza la animación. Devuelve true y el área a repintar si algo cambió.
    bool Update(uint32_t now_ms, lv_area_t* dirty);

    // Pinta la cara; layer viene del evento LV_EVENT_DRAW_MAIN
    void Draw(lv_layer_t* layer);

private:
    struct Eye {
        EyeShape shape;
        float w, h, r, dx, dy, lid_top, lid_bot;
    };

    // Pantalla
    float screen_cx_ = 160, screen_cy_ = 92, scale_ = 1.15f;

    // Transición
    const byte_face_t* target_ = nullptr;
    Eye from_[2] = {}, eye_[2] = {};
    lv_color_t from_color_ = {}, color_ = {};
    uint16_t acc_out_ = ACC_NONE;
    uint32_t transition_start_ = 0;
    float k_ = 1;

    // Vida
    uint32_t now_ = 0;
    float blink_ = 1;
    uint32_t next_blink_ = 0, blink_start_ = 0;
    bool blinking_ = false;
    float gaze_x_ = 0, gaze_y_ = 0, gaze_to_x_ = 0, gaze_to_y_ = 0;
    uint32_t next_gaze_ = 0;
    bool talking_ = false;

    // Lo que se pintó en el cuadro anterior
    lv_area_t last_area_ = {};
    uint32_t last_signature_ = 0;
    uint16_t last_acc_ = 0;
    bool first_frame_ = true;

    // Datos del cuadro actual, calculados en Update() y usados en Draw()
    struct EyeOnScreen {
        EyeShape shape;
        float cx, cy, w, h, r, lid_top, lid_bot, beat, blink;
    } frame_eyes_[2] = {};
    uint16_t frame_acc_in_ = 0, frame_acc_out_ = 0;

    static Eye ToEye(const byte_eye_t& e);
    uint16_t EffectiveAcc(const byte_face_t* face) const;
    void ComputeFrame();
    void EyesArea(lv_area_t* area) const;
    void AccArea(int index, lv_area_t* area) const;

    // Dibujo en coordenadas del diseño (240x240) convertidas a la pantalla
    float X(float x) const { return screen_cx_ + (x - 120) * scale_; }
    float Y(float y) const { return screen_cy_ + (y - 108) * scale_; }
    void DrawEye(lv_layer_t* layer, const EyeOnScreen& e, int side) const;
    void DrawAcc(lv_layer_t* layer, uint16_t acc, lv_opa_t opa) const;
};
