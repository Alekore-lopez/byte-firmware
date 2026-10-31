#pragma once

// Motor de la cara de Byte: guarda dónde están los ojos ahora, los acerca a
// la cara destino en cada cuadro y los dibuja con LVGL. Solo usa LVGL, así
// que se puede probar fuera del ESP32.

#include <lvgl.h>
#include <cstdint>

#include "byte_faces.h"

// Modo juego: lo que hace Byte cuando nadie le habla (mismos juegos del taller de ojos)
enum ByteGame : uint8_t {
    GAME_NONE,
    GAME_MOSCA,     // un puntito vuela y los ojos lo persiguen
    GAME_PONG,      // una pelotita rebota de un ojo al otro
    GAME_SALTITOS,  // los ojos saltan y caen aplastaditos
    GAME_BIZCO,     // junta los ojos en el centro y los suelta de golpe
    GAME_VUELTA,    // los ojos dan una vuelta completa
    GAME_SILBANDO,  // mira hacia arriba y salen notas musicales
};
constexpr int kGameCount = 6;
constexpr uint32_t kGameMs = 6000;  // cada juego dura 6 s y se acaba solo

class ByteFaceRenderer {
public:
    // width/height: tamaño de la pantalla en píxeles
    void Init(int width, int height, const byte_face_t* face, uint32_t now_ms);

    // Cambia de cara con una transición suave
    void SetFace(const byte_face_t* face, uint32_t now_ms);
    const byte_face_t* face() const { return target_; }

    // Mientras Byte habla se añade la boca de barras a cualquier expresión
    void SetTalking(bool talking) { talking_ = talking; }

    // Modo juego: empieza un juego (dura kGameMs y se acaba solo) o lo corta ya
    void StartGame(ByteGame game, uint32_t now_ms);
    void StopGame() { game_ = GAME_NONE; }
    ByteGame game() const { return game_; }

    // Sueño: 0 = despierto, 1 = párpados cerrados (y bosteza de vez en cuando)
    void SetSleepy(float sleepy) { sleepy_ = sleepy; }

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

    // Modo juego y sueño
    ByteGame game_ = GAME_NONE;
    uint32_t game_start_ = 0;
    float sleepy_ = 0;
    bool last_play_ = false;  // ¿el cuadro anterior tenía juego o sueño? (para borrarlo)
    // Lo que el juego le hace a la cara en este cuadro (coordenadas del diseño)
    struct Play {
        float env = 0;                    // 0..1: entra y sale suave
        float t = 0;                      // segundos desde que empezó el juego
        float dx[2] = {}, dy[2] = {};     // cuánto se mueve cada ojo
        float sx[2] = {1, 1}, sy[2] = {1, 1};  // cuánto se estira o aplasta
        float fly_x = 0, fly_y = 0;       // la mosca
        float ball_x = 0, ball_y = 0;     // la pelotita
        float yawn = 0;                   // 0..1 qué tan abierta la boca del bostezo
        float lid = 0;                    // 0..1 cuánto tapan los párpados
    } play_;

    // Lo que se pintó en el cuadro anterior
    lv_area_t last_area_ = {};
    uint32_t last_signature_ = 0;
    uint16_t last_acc_ = 0;
    bool first_frame_ = true;

    // Datos del cuadro actual, calculados en Update() y usados en Draw()
    struct EyeOnScreen {
        EyeShape shape;
        float cx, cy, w, h, r, lid_top, lid_bot, beat, blink;
        float moon;    // Eclipse: cuánto se corre la luna (px, con signo)
        float corona;  // Eclipse: latido de la corona (1 = normal)
        float sleep;   // Sueño: cuánto del ojo tapa el párpado (0..1)
    } frame_eyes_[2] = {};
    uint16_t frame_acc_in_ = 0, frame_acc_out_ = 0;

    static Eye ToEye(const byte_eye_t& e);
    uint16_t EffectiveAcc(const byte_face_t* face) const;
    void ComputePlay();
    void ComputeFrame();
    void PlayArea(lv_area_t* area) const;
    void EyesArea(lv_area_t* area) const;
    void AccArea(int index, lv_area_t* area) const;

    // Dibujo en coordenadas del diseño (240x240) convertidas a la pantalla
    float X(float x) const { return screen_cx_ + (x - 120) * scale_; }
    float Y(float y) const { return screen_cy_ + (y - 108) * scale_; }
    void DrawEye(lv_layer_t* layer, const EyeOnScreen& e, int side) const;
    void DrawEclipse(lv_layer_t* layer, const EyeOnScreen& e, float h) const;
    void DrawAcc(lv_layer_t* layer, uint16_t acc, lv_opa_t opa) const;
    void DrawPlay(lv_layer_t* layer) const;
};
