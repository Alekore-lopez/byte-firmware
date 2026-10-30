#pragma once

// Caras de Byte como DATOS: cada cara es una fila de la tabla kByteFaces.
// Las medidas están en el sistema del visor de caras (lienzo 240x240, ojos
// centrados en x=120, y=108); ByteFaceDisplay las escala a la pantalla real.

#include <cstdint>

// Forma de cada ojo
enum EyeShape : uint8_t {
    EYE_RECT,    // rectángulo redondeado (el ojo normal)
    EYE_ARC,     // arco "^" (ojos felices o cerrados de risa)
    EYE_CLOSED,  // arco hacia abajo (dormido)
    EYE_HEART,   // corazón
};

// Accesorios alrededor de los ojos; se combinan con |
enum : uint16_t {
    ACC_NONE       = 0,
    ACC_RING       = 1 << 0,   // anillo que late (escuchando)
    ACC_DOTS       = 1 << 1,   // tres puntos (pensando)
    ACC_MOUTH      = 1 << 2,   // barras de voz (hablando)
    ACC_MOUTH_OPEN = 1 << 3,   // boca abierta (risa)
    ACC_O_MOUTH    = 1 << 4,   // boca en "o" (sorpresa)
    ACC_CHECK      = 1 << 5,   // visto bueno (éxito)
    ACC_ZZZ        = 1 << 6,   // zzz (dormido)
    ACC_WIFI       = 1 << 7,   // wifi tachado
    ACC_MIC        = 1 << 8,   // micrófono tachado
    ACC_GLASSES    = 1 << 9,   // gafas de sol
    ACC_TEAR       = 1 << 10,  // lágrima
    ACC_SWEAT      = 1 << 11,  // gota de sudor
};
constexpr int kAccCount = 12;
constexpr uint16_t ACC_ANY_MOUTH = ACC_MOUTH | ACC_MOUTH_OPEN | ACC_O_MOUTH;

// Movimiento de toda la cara mientras está quieta en pantalla
enum FaceAnim : uint8_t {
    ANIM_NONE, ANIM_BREATHE, ANIM_LISTEN, ANIM_THINK, ANIM_TALK, ANIM_SLEEP,
    ANIM_HOP, ANIM_LAUGH, ANIM_BEAT, ANIM_SHAKE, ANIM_SAD, ANIM_WOBBLE,
};

struct byte_eye_t {
    EyeShape shape;
    int16_t w, h, r;   // ancho, alto y radio de las esquinas
    int16_t dx, dy;    // desplazamiento desde su posición normal
    int8_t lid_top;    // párpado de arriba inclinado, en grados (+ enfado, - tristeza)
    uint8_t lid_bot;   // mejilla que tapa la parte de abajo, en % del alto
};

struct byte_face_t {
    const char* id;
    uint32_t color;    // 0xRRGGBB, como en el visor
    byte_eye_t left, right;
    uint16_t acc;
    FaceAnim anim;
    bool blink;        // ¿parpadea?
    bool gaze;         // ¿mira alrededor?
};

//                        forma       w   h   r   dx   dy  lid_top lid_bot
constexpr byte_eye_t kEye = {EYE_RECT, 46, 62, 16,  0,   0,   0,  0};

inline constexpr byte_face_t kByteFaces[] = {
    // --- Estados del sistema ---
    {"reposo",   0x22d3ee, kEye, kEye, ACC_NONE, ANIM_BREATHE, true, true},
    {"escucha",  0x22d3ee, {EYE_RECT, 50, 70, 18, 0, 0, 0, 0}, {EYE_RECT, 50, 70, 18, 0, 0, 0, 0},
                 ACC_RING, ANIM_LISTEN, true, false},
    {"pensando", 0x22d3ee, {EYE_RECT, 46, 44, 16, 12, -16, 0, 0}, {EYE_RECT, 46, 44, 16, 12, -16, 0, 0},
                 ACC_DOTS, ANIM_THINK, true, false},
    {"hablando", 0x22d3ee, {EYE_RECT, 46, 56, 16, 0, 0, 0, 0}, {EYE_RECT, 46, 56, 16, 0, 0, 0, 0},
                 ACC_MOUTH, ANIM_TALK, true, true},
    {"dormido",  0x0e7490, {EYE_CLOSED, 46, 62, 16, 0, 0, 0, 0}, {EYE_CLOSED, 46, 62, 16, 0, 0, 0, 0},
                 ACC_ZZZ, ANIM_SLEEP, false, false},
    {"wifi",     0xfb923c, {EYE_RECT, 40, 48, 14, 0, -10, 0, 0}, {EYE_RECT, 40, 48, 14, 0, -10, 0, 0},
                 ACC_WIFI, ANIM_BREATHE, true, false},
    {"mute",     0xef4444, {EYE_RECT, 46, 30, 12, 0, -6, 0, 0}, {EYE_RECT, 46, 30, 12, 0, -6, 0, 0},
                 ACC_MIC, ANIM_BREATHE, false, false},
    {"exito",    0x4ade80, {EYE_ARC, 46, 62, 16, 0, 0, 0, 0}, {EYE_ARC, 46, 62, 16, 0, 0, 0, 0},
                 ACC_CHECK, ANIM_HOP, true, false},
    // --- Expresiones ---
    {"feliz",    0xfacc15, {EYE_RECT, 46, 56, 16, 0, 0, 0, 42}, {EYE_RECT, 46, 56, 16, 0, 0, 0, 42},
                 ACC_NONE, ANIM_BREATHE, true, true},
    {"risa",     0xfacc15, {EYE_ARC, 50, 62, 16, 0, 0, 0, 0}, {EYE_ARC, 50, 62, 16, 0, 0, 0, 0},
                 ACC_MOUTH_OPEN, ANIM_LAUGH, true, false},
    {"carino",   0xf472b6, {EYE_HEART, 50, 62, 16, 0, 0, 0, 0}, {EYE_HEART, 50, 62, 16, 0, 0, 0, 0},
                 ACC_NONE, ANIM_BEAT, true, false},
    {"cool",     0x22d3ee, {EYE_RECT, 46, 40, 16, 0, -4, 0, 0}, {EYE_RECT, 46, 40, 16, 0, -4, 0, 0},
                 ACC_GLASSES, ANIM_BREATHE, false, false},
    {"sorpresa", 0xe5f9ff, {EYE_RECT, 56, 56, 28, 0, 0, 0, 0}, {EYE_RECT, 56, 56, 28, 0, 0, 0, 0},
                 ACC_O_MOUTH, ANIM_NONE, true, false},
    {"enfado",   0xef4444, {EYE_RECT, 46, 62, 16, 0, 0, 24, 0}, {EYE_RECT, 46, 62, 16, 0, 0, 24, 0},
                 ACC_NONE, ANIM_SHAKE, true, false},
    {"tristeza", 0x60a5fa, {EYE_RECT, 46, 56, 16, 0, 8, -20, 0}, {EYE_RECT, 46, 56, 16, 0, 8, -20, 0},
                 ACC_TEAR, ANIM_SAD, true, false},
    {"oops",     0xfb923c, {EYE_RECT, 46, 62, 16, -4, 0, 0, 0}, {EYE_RECT, 42, 38, 16, -4, 8, 0, 0},
                 ACC_SWEAT, ANIM_WOBBLE, true, false},
    {"guino",    0x22d3ee, kEye, {EYE_ARC, 46, 62, 16, 0, 0, 0, 0},
                 ACC_NONE, ANIM_BREATHE, false, false},
};

// Emociones que manda el servidor de XiaoZhi -> cara de Byte
struct byte_emotion_map_t {
    const char* emotion;
    const char* face;
};

inline constexpr byte_emotion_map_t kByteEmotions[] = {
    {"happy", "feliz"},       {"relaxed", "feliz"},     {"delicious", "feliz"},
    {"laughing", "risa"},     {"funny", "risa"},
    {"loving", "carino"},     {"kissy", "carino"},
    {"cool", "cool"},
    {"surprised", "sorpresa"}, {"shocked", "sorpresa"},
    {"angry", "enfado"},
    {"sad", "tristeza"},      {"crying", "tristeza"},
    {"embarrassed", "oops"},  {"confused", "oops"},
    {"winking", "guino"},     {"silly", "guino"},
    {"thinking", "pensando"},
    {"sleepy", "dormido"},
    {"confident", "exito"},
};
