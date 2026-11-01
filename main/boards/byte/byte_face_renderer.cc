#include "byte_face_renderer.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace {

constexpr float kPi = 3.14159265f;
constexpr float kGap = 88;              // distancia entre los centros de los ojos (diseño)
constexpr uint32_t kTransitionMs = 260; // duración del cambio de cara
constexpr uint32_t kBlinkMs = 150;      // duración de un parpadeo
// Encendido: cuándo pasa cada cosa (ms desde que arranca)
constexpr float kBootLineMs = 450;      // 1. la línea de energía se estira
constexpr float kBootEyesMs = 1000;     // 2. los anillos se cierran; 3. se encienden los ojos
constexpr float kBootAccMs = 1600;      // 4. aparecen los accesorios
constexpr uint32_t kMoon = 0xf2ede1;    // blanco luna, el color de marca

float Lerp(float a, float b, float k) { return a + (b - a) * k; }
float EaseOut(float k) { return 1 - powf(1 - k, 3); }  // rápido al inicio, suave al final
int32_t R(float v) { return (int32_t)lroundf(v); }

// Rectángulo que cubre a los dos (lv_area_join es privado en LVGL 9)
void Join(lv_area_t* res, const lv_area_t* a, const lv_area_t* b) {
    lv_area_t r = {std::min(a->x1, b->x1), std::min(a->y1, b->y1), std::max(a->x2, b->x2),
                   std::max(a->y2, b->y2)};
    *res = r;
}

lv_opa_t Opa(float f, lv_opa_t opa) {
    return (lv_opa_t)std::clamp(f * opa, 0.0f, 255.0f);
}

// --- Primitivas de dibujo en píxeles de pantalla ---

void FillRect(lv_layer_t* layer, float x1, float y1, float x2, float y2, int32_t radius,
              lv_color_t color, lv_opa_t opa) {
    lv_draw_rect_dsc_t dsc;
    lv_draw_rect_dsc_init(&dsc);
    dsc.bg_color = color;
    dsc.bg_opa = opa;
    dsc.radius = radius;
    lv_area_t a = {R(x1), R(y1), R(x2) - 1, R(y2) - 1};
    lv_draw_rect(layer, &dsc, &a);
}

void FillEllipse(lv_layer_t* layer, float cx, float cy, float rx, float ry, lv_color_t color,
                 lv_opa_t opa) {
    FillRect(layer, cx - rx, cy - ry, cx + rx, cy + ry, LV_RADIUS_CIRCLE, color, opa);
}

void FillTriangle(lv_layer_t* layer, float x0, float y0, float x1, float y1, float x2, float y2,
                  lv_color_t color, lv_opa_t opa) {
    lv_draw_triangle_dsc_t dsc;
    lv_draw_triangle_dsc_init(&dsc);
    dsc.color = color;
    dsc.opa = opa;
    dsc.p[0].x = R(x0); dsc.p[0].y = R(y0);
    dsc.p[1].x = R(x1); dsc.p[1].y = R(y1);
    dsc.p[2].x = R(x2); dsc.p[2].y = R(y2);
    lv_draw_triangle(layer, &dsc);
}

void Line(lv_layer_t* layer, float x1, float y1, float x2, float y2, float width,
          lv_color_t color, lv_opa_t opa, bool round = true) {
    lv_draw_line_dsc_t dsc;
    lv_draw_line_dsc_init(&dsc);
    dsc.color = color;
    dsc.opa = opa;
    dsc.width = std::max<int32_t>(1, R(width));
    dsc.round_start = round;
    dsc.round_end = round;
    dsc.p1.x = R(x1); dsc.p1.y = R(y1);
    dsc.p2.x = R(x2); dsc.p2.y = R(y2);
    lv_draw_line(layer, &dsc);
}

// radius = centro del trazo (como en el canvas del visor); ángulos en grados,
// 0 = derecha y aumentan en sentido horario
void Arc(lv_layer_t* layer, float cx, float cy, float radius, float width, float a1, float a2,
         lv_color_t color, lv_opa_t opa) {
    lv_draw_arc_dsc_t dsc;
    lv_draw_arc_dsc_init(&dsc);
    dsc.color = color;
    dsc.opa = opa;
    dsc.width = std::max<int32_t>(1, R(width));
    dsc.center.x = R(cx);
    dsc.center.y = R(cy);
    dsc.radius = (uint16_t)std::max<int32_t>(1, R(radius + width / 2));
    dsc.start_angle = a1;
    dsc.end_angle = a2;
    dsc.rounded = 1;
    lv_draw_arc(layer, &dsc);
}

// Gota (lágrima o sudor): punta arriba y panza redonda abajo
void Drop(lv_layer_t* layer, float x, float y, float s, lv_color_t color, lv_opa_t opa) {
    FillEllipse(layer, x, y + s * 0.3f, s * 0.62f, s * 0.62f, color, opa);
    FillTriangle(layer, x, y - s, x - s * 0.55f, y + s * 0.2f, x + s * 0.55f, y + s * 0.2f,
                 color, opa);
}

// Movimiento de toda la cara según la animación (igual que animOf() del visor)
struct AnimOffset {
    float dx = 0, dy = 0, s = 1, beat = 1;
};

AnimOffset AnimOf(FaceAnim anim, float t) {
    AnimOffset o;
    switch (anim) {
        case ANIM_BREATHE: o.dy = sinf(t / 1300) * 2; break;
        case ANIM_LISTEN:  o.s = 1 + 0.035f * sinf(t / 220); break;
        case ANIM_THINK:   o.dx = sinf(t / 800) * 3; break;
        case ANIM_TALK:    o.dy = -fabsf(sinf(t / 170)) * 3; break;
        case ANIM_SLEEP:   o.dy = sinf(t / 2000) * 3; break;
        case ANIM_HOP:     o.dy = -fabsf(sinf(t / 260)) * 5; break;
        case ANIM_LAUGH:   o.dy = sinf(t / 55) * 2.5f; break;
        case ANIM_BEAT: {
            float p = fmodf(t, 900) / 900;
            o.beat = 1 + 0.12f * std::max(0.0f, sinf(p * kPi * 4)) * (p < 0.5f ? 1 : 0);
            break;
        }
        case ANIM_SHAKE:   o.dx = sinf(t / 38) * 1.3f; break;
        case ANIM_SAD:     o.dy = sinf(t / 1800) * 2; break;
        case ANIM_WOBBLE:  o.dx = sinf(t / 500) * 3; break;
        default: break;
    }
    return o;
}

}  // namespace

ByteFaceRenderer::Eye ByteFaceRenderer::ToEye(const byte_eye_t& e) {
    return {e.shape, (float)e.w, (float)e.h, (float)e.r, (float)e.dx, (float)e.dy,
            (float)e.lid_top, (float)e.lid_bot};
}

void ByteFaceRenderer::Init(int width, int height, const byte_face_t* face, uint32_t now_ms) {
    // El diseño es de 240x240. Se centra a lo ancho y se agranda un 25 %: los
    // ojos quedan debajo de la barra de estado y la boca encima de la barra de
    // subtítulos (unos 40 px abajo, donde salen el código de activación y el wifi).
    width_ = width;
    height_ = height;
    screen_cx_ = width / 2.0f;
    screen_cy_ = height * 0.32f;
    scale_ = 1.25f * height / 240.0f;

    target_ = face;
    eye_[0] = from_[0] = ToEye(face->left);
    eye_[1] = from_[1] = ToEye(face->right);
    color_ = from_color_ = lv_color_hex(face->color);
    transition_start_ = now_ms;
    k_ = 1;
    now_ = now_ms;
    next_blink_ = now_ms + 1500;
    first_frame_ = true;
}

uint16_t ByteFaceRenderer::EffectiveAcc(const byte_face_t* face) const {
    uint16_t acc = face->acc;
    if (talking_) {
        acc |= ACC_RING;  // el halo late con la voz de Byte
        if (!(acc & ACC_ANY_MOUTH)) {
            acc |= ACC_MOUTH;  // y si la cara no trae boca, ondas de voz
        }
    }
    if (booting_ && boot_ms_ < kBootAccMs) {
        acc = ACC_NONE;  // mientras se enciende, solo los ojos
    }
    return acc;
}

void ByteFaceRenderer::StartBoot(uint32_t now_ms) {
    booting_ = true;
    boot_beep_ = false;
    boot_start_ = now_ms;
    boot_ms_ = 0;
}

bool ByteFaceRenderer::TakeBootBeep() {
    if (booting_ && !boot_beep_ && boot_ms_ >= kBootEyesMs) {
        boot_beep_ = true;
        return true;
    }
    return false;
}

void ByteFaceRenderer::SetFace(const byte_face_t* face, uint32_t now_ms) {
    if (face == nullptr || face == target_) {
        return;
    }
    // La transición sale de donde están los ojos AHORA, aunque haya otra a medias
    from_[0] = eye_[0];
    from_[1] = eye_[1];
    from_color_ = color_;
    acc_out_ = frame_acc_in_;
    target_ = face;
    transition_start_ = now_ms;
    k_ = 0;
}

void ByteFaceRenderer::StartGame(ByteGame game, uint32_t now_ms) {
    game_ = game;
    game_start_ = now_ms;
}

bool ByteFaceRenderer::Update(uint32_t now_ms, lv_area_t* dirty) {
    now_ = now_ms;

    // 0. Encendido y voz
    bool was_booting = booting_;
    if (booting_) {
        boot_ms_ = (float)(now_ms - boot_start_);
        if (boot_ms_ >= kBootMs) {
            booting_ = false;
            boot_clear_ = true;  // un cuadro más a pantalla completa para borrar el destello
        }
    }
    // La voz sube rápido y baja despacio, como la aguja de un medidor
    voice_ += (voice_in_ - voice_) * (voice_in_ > voice_ ? 0.55f : 0.14f);
    if (voice_ < 0.005f) {
        voice_ = 0;
    }

    // 1. Transición: interpolar cada número del ojo hacia la cara destino
    float k = std::min(1.0f, (float)(now_ms - transition_start_) / kTransitionMs);
    k_ = EaseOut(k);
    const Eye to[2] = {ToEye(target_->left), ToEye(target_->right)};
    for (int i = 0; i < 2; i++) {
        Eye& e = eye_[i];
        e.w = Lerp(from_[i].w, to[i].w, k_);
        e.h = Lerp(from_[i].h, to[i].h, k_);
        e.r = Lerp(from_[i].r, to[i].r, k_);
        e.dx = Lerp(from_[i].dx, to[i].dx, k_);
        e.dy = Lerp(from_[i].dy, to[i].dy, k_);
        e.lid_top = Lerp(from_[i].lid_top, to[i].lid_top, k_);
        e.lid_bot = Lerp(from_[i].lid_bot, to[i].lid_bot, k_);
        e.shape = k < 0.5f ? from_[i].shape : to[i].shape;  // la forma cambia a mitad de camino
    }
    color_ = lv_color_mix(lv_color_hex(target_->color), from_color_, (uint8_t)(k_ * 255));
    if (k >= 1) {
        acc_out_ = ACC_NONE;
    }

    // 2. Parpadeo: cerrar y abrir en 150 ms; a veces dos seguidos
    if (booting_) {
        next_blink_ = std::max(next_blink_, now_ms + 800);  // no parpadea mientras se enciende
    }
    if (!blinking_ && now_ms >= next_blink_) {
        blinking_ = true;
        blink_start_ = now_ms;
    }
    if (blinking_) {
        float p = (float)(now_ms - blink_start_) / kBlinkMs;
        if (p < 1) {
            blink_ = std::max(0.08f, fabsf(1 - 2 * p));
        } else {
            blink_ = 1;
            blinking_ = false;
            next_blink_ = now_ms + 2200 + lv_rand(0, 3200);
            if (lv_rand(0, 99) < 20) {
                next_blink_ = now_ms + 220;
            }
        }
    }

    // 3. Mirada: cada pocos segundos elige un punto y los ojos lo siguen despacio
    if (target_->gaze && game_ == GAME_NONE) {  // mientras juega, mira lo que pide el juego
        if (now_ms >= next_gaze_) {
            if (lv_rand(0, 99) < 40) {
                gaze_to_x_ = gaze_to_y_ = 0;
            } else {
                gaze_to_x_ = (float)lv_rand(0, 22) - 11;
                gaze_to_y_ = (float)lv_rand(0, 12) - 6;
            }
            next_gaze_ = now_ms + 1200 + lv_rand(0, 2400);
        }
    } else {
        gaze_to_x_ = gaze_to_y_ = 0;
    }
    gaze_x_ += (gaze_to_x_ - gaze_x_) * 0.18f;
    gaze_y_ += (gaze_to_y_ - gaze_y_) * 0.18f;

    ComputePlay();
    ComputeFrame();

    // Encendido: los ojos nacen en blanco luna y pasan a su color
    if (booting_) {
        float k = std::clamp((boot_ms_ - 1500) / 700, 0.0f, 1.0f);
        color_ = lv_color_mix(color_, lv_color_hex(kMoon), (uint8_t)(k * 255));
    }
    if (was_booting || boot_clear_) {
        // Toda la pantalla: la línea y el destello pasan por todas partes
        boot_clear_ = booting_;
        *dirty = {0, 0, width_ - 1, height_ - 1};
        last_area_ = *dirty;
        first_frame_ = false;
        last_acc_ = frame_acc_in_ | frame_acc_out_;
        return true;
    }

    // 4. Solo repintar lo que cambió: redibujar los 320x240 por SPI tarda ~60 ms
    uint32_t sig = lv_color_to_u32(color_);
    for (const auto& e : frame_eyes_) {
        // Todos los valores ya vienen redondeados de ComputeFrame(): si la firma no
        // cambia, el dibujo sería idéntico al anterior y no hay que repintar
        for (float v : {e.cx, e.cy, e.w, e.h, e.r, e.lid_top, e.lid_bot, e.beat * 100, e.blink * 64,
                        (float)e.shape, e.moon, e.corona * 32}) {
            sig = sig * 31 + (uint32_t)R(v);
        }
    }
    uint16_t acc = frame_acc_in_ | frame_acc_out_;
    // Con juego o sueño todo se mueve en cada cuadro; y un cuadro más al terminar,
    // para borrar la mosca o las notas que quedaron pintadas
    bool play = game_ != GAME_NONE || sleepy_ > 0;
    bool changed = first_frame_ || sig != last_signature_ || acc != 0 || acc != last_acc_ || play ||
                   last_play_;
    last_play_ = play;
    if (!changed) {
        return false;
    }

    lv_area_t area;
    EyesArea(&area);
    if (play) {
        PlayArea(&area);
    }
    for (int i = 0; i < kAccCount; i++) {
        if (acc & (1 << i)) {
            lv_area_t a;
            AccArea(i, &a);
            Join(&area, &area, &a);
        }
    }
    if (first_frame_) {
        *dirty = area;
    } else {
        Join(dirty, &area, &last_area_);
    }
    last_area_ = area;
    last_signature_ = sig;
    last_acc_ = acc;
    first_frame_ = false;
    return true;
}

void ByteFaceRenderer::ComputeFrame() {
    AnimOffset anim = AnimOf(target_->anim, (float)now_);
    for (int i = 0; i < 2; i++) {
        const Eye& e = eye_[i];
        float side = i == 0 ? -1 : 1;
        // Posición en el diseño, con la mirada
        float x = 120 + side * kGap / 2 + e.dx + gaze_x_ + play_.dx[i];
        // Con sueño mira un poco hacia abajo
        float y = 108 + e.dy + gaze_y_ + play_.dy[i] + sleepy_ * 4;
        // Animación: escala alrededor del centro y desplaza
        x = 120 + (x - 120) * anim.s + anim.dx;
        y = 108 + (y - 108) * anim.s + anim.dy;

        EyeOnScreen& o = frame_eyes_[i];
        // Redondeado a píxeles enteros: así se sabe con exactitud cuándo cambia algo
        o.shape = e.shape;
        o.cx = roundf(X(x));
        o.cy = roundf(Y(y));
        o.w = roundf(e.w * anim.s * play_.sx[i] * scale_);
        o.h = roundf(e.h * anim.s * play_.sy[i] * scale_);
        o.r = roundf(e.r * anim.s * scale_);
        o.lid_top = roundf(e.lid_top);
        o.lid_bot = roundf(e.lid_bot);
        o.beat = roundf(anim.beat * 100) / 100;
        o.blink = target_->blink ? roundf(blink_ * 64) / 64 : 1;
        // Eclipse: la luna va y viene despacio; al escuchar se corre para mostrar más sol
        float sun = o.w * 0.27f;
        bool listening = strcmp(target_->id, "escucha") == 0;
        float swing = listening ? 0.55f : 0.25f * sinf(now_ * 0.0004f + i * 0.6f);
        o.moon = roundf(sun * swing * (i == 0 ? -1 : 1));
        o.corona = roundf((1 + 0.06f * sinf(now_ * 0.002f)) * 32) / 32;
        o.sleep = play_.lid;
        if (booting_) {
            // Los ojos se encienden de una rayita a su alto normal
            float g = EaseOut(std::clamp((boot_ms_ - kBootEyesMs) / 450, 0.0f, 1.0f));
            o.h = roundf(std::max(4.0f, o.h * g));
            o.blink = 1;
        }
    }
    frame_acc_in_ = EffectiveAcc(target_);
    frame_acc_out_ = acc_out_ & ~frame_acc_in_;
}

// Modo juego: calcula cuánto mueve, estira o aplasta cada ojo el juego de
// ahora, y dónde van la mosca o la pelotita. Son las mismas fórmulas del
// taller de ojos, pasadas a las medidas del diseño (240x240).
void ByteFaceRenderer::ComputePlay() {
    Play p;  // todo en cero: sin juego los ojos no se mueven
    if (game_ != GAME_NONE) {
        uint32_t ms = now_ - game_start_;
        if (ms >= kGameMs) {
            game_ = GAME_NONE;  // se acabó el juego
        } else {
            const float t = ms / 1000.0f, total = kGameMs / 1000.0f;
            p.t = t;
            // Entra y sale en 0,4 s para que los ojos no peguen un salto
            p.env = std::min({1.0f, t / 0.4f, (total - t) / 0.4f});
            switch (game_) {
                case GAME_MOSCA: {
                    // La mosca dibuja un ocho por la pantalla y los ojos la siguen
                    p.fly_x = 120 + sinf(t * 1.7f) * 96;
                    p.fly_y = 100 + sinf(t * 2.9f) * 34;
                    float lx = (p.fly_x - 120) / 96, ly = (p.fly_y - 100) / 34;
                    for (int i = 0; i < 2; i++) {
                        p.dx[i] = lx * 9;
                        p.dy[i] = ly * 7;
                    }
                    break;
                }
                case GAME_PONG: {
                    // u va de 0 a 1 y vuelve: la pelotita pasa de un ojo al otro
                    float q = fmodf(t * 0.9f, 2), u = q < 1 ? q : 2 - q;
                    p.ball_x = 120 - kGap / 2 + u * kGap;
                    p.ball_y = 72 - sinf(u * kPi) * 22;
                    for (int i = 0; i < 2; i++) {
                        p.dx[i] = (p.ball_x - 120) / 60 * 5;
                        p.dy[i] = -3;
                    }
                    if (std::min(u, 1 - u) < 0.06f) {  // ¡golpe! el ojo se aplasta
                        int i = u < 0.5f ? 0 : 1;
                        p.sx[i] = 1.15f;
                        p.sy[i] = 0.8f;
                    }
                    break;
                }
                case GAME_SALTITOS:
                    for (int i = 0; i < 2; i++) {
                        float ph = fmodf(t * 2.2f + i * 0.5f, 1);
                        p.dy[i] = -sinf(ph * kPi) * 22;
                        if (ph < 0.08f || ph > 0.92f) {  // al caer se aplasta contra el piso
                            p.sx[i] = 1.2f;
                            p.sy[i] = 0.75f;
                            p.dy[i] += eye_[i].h * (1 - p.sy[i]) / 2;  // aplastado desde abajo
                        }
                    }
                    break;
                case GAME_BIZCO: {
                    // Cada 3 s: los junta poco a poco y a los 2,2 s los suelta de golpe
                    float c = fmodf(t, 3), k = c > 2.2f ? 0 : std::min(1.0f, c / 1.2f);
                    p.dx[0] = k * 18;
                    p.dx[1] = -k * 18;
                    break;
                }
                case GAME_VUELTA: {
                    float a = t * 2.2f;
                    for (int i = 0; i < 2; i++) {
                        p.dx[i] = cosf(a) * 14;
                        p.dy[i] = sinf(a) * 12;
                    }
                    break;
                }
                case GAME_SILBANDO:
                    for (int i = 0; i < 2; i++) {
                        p.dx[i] = 4;
                        p.dy[i] = -8;
                    }
                    break;
                default:
                    break;
            }
            // El "volumen" del juego: al entrar y al salir todo vuelve a su sitio
            for (int i = 0; i < 2; i++) {
                p.dx[i] *= p.env;
                p.dy[i] *= p.env;
                p.sx[i] = 1 + (p.sx[i] - 1) * p.env;
                p.sy[i] = 1 + (p.sy[i] - 1) * p.env;
            }
        }
    }
    if (sleepy_ > 0) {
        // Cada 9 s bosteza: la boca se abre y se cierra en 2,7 s y los ojos se aprietan
        float ph = fmodf((float)now_, 9000) / 9000;
        p.yawn = sleepy_ > 0.3f && ph < 0.3f ? sinf(ph / 0.3f * kPi) : 0;
        p.lid = std::min(0.95f, sleepy_ + p.yawn * 0.25f);
    }
    play_ = p;
}

// Rectángulo extra que hay que repintar por la mosca, la pelotita, las notas o el bostezo
void ByteFaceRenderer::PlayArea(lv_area_t* area) const {
    auto add = [&](float x1, float y1, float x2, float y2) {
        lv_area_t a = {R(X(x1)) - 2, R(Y(y1)) - 2, R(X(x2)) + 2, R(Y(y2)) + 2};
        Join(area, area, &a);
    };
    switch (game_) {
        case GAME_MOSCA:
            add(play_.fly_x - 8, play_.fly_y - 7, play_.fly_x + 8, play_.fly_y + 5);
            break;
        case GAME_PONG:
            add(play_.ball_x - 7, play_.ball_y - 7, play_.ball_x + 7, play_.ball_y + 7);
            break;
        case GAME_SILBANDO:
            add(112, 40, 224, 192);
            break;
        default:
            break;
    }
    if (play_.yawn > 0) {
        add(108, 170, 132, 198);
    }
}

void ByteFaceRenderer::EyesArea(lv_area_t* area) const {
    for (int i = 0; i < 2; i++) {
        const EyeOnScreen& e = frame_eyes_[i];
        float half = std::max(e.w * e.beat * 0.75f, e.h * 0.5f) + 10 * scale_;
        lv_area_t a = {R(e.cx - half), R(e.cy - half), R(e.cx + half), R(e.cy + half)};
        if (i == 0) {
            *area = a;
        } else {
            Join(area, area, &a);
        }
    }
}

void ByteFaceRenderer::AccArea(int index, lv_area_t* area) const {
    // Rectángulo que ocupa cada accesorio, en coordenadas del diseño
    float x1 = 0, y1 = 0, x2 = 240, y2 = 240;
    const float g = kGap / 2;
    switch (1 << index) {
        case ACC_RING:       x1 = 2;   y1 = -12; x2 = 238; y2 = 240; break;
        case ACC_DOTS:       x1 = 90;  y1 = 172; x2 = 150; y2 = 196; break;
        case ACC_MOUTH:      x1 = 68;  y1 = 162; x2 = 172; y2 = 208; break;
        case ACC_MOUTH_OPEN: x1 = 94;  y1 = 170; x2 = 146; y2 = 206; break;
        case ACC_O_MOUTH:    x1 = 104; y1 = 170; x2 = 136; y2 = 202; break;
        case ACC_CHECK:      x1 = 98;  y1 = 166; x2 = 144; y2 = 204; break;
        case ACC_ZZZ:        x1 = 164; y1 = 20;  x2 = 222; y2 = 86;  break;
        case ACC_WIFI:       x1 = 80;  y1 = 138; x2 = 160; y2 = 204; break;
        case ACC_MIC:        x1 = 94;  y1 = 152; x2 = 146; y2 = 210; break;
        case ACC_GLASSES:    x1 = 120 - g - 40; y1 = 108 - 34; x2 = 120 + g + 40; y2 = 108 + 40; break;
        case ACC_TEAR:       x1 = 120 - g - 26; y1 = 108 + 28; x2 = 120 - g - 2; y2 = 108 + 104; break;
        case ACC_SWEAT:      x1 = 120 + g + 22; y1 = 108 - 58; x2 = 120 + g + 46; y2 = 108 - 28; break;
    }
    *area = {R(X(x1)) - 4, R(Y(y1)) - 4, R(X(x2)) + 4, R(Y(y2)) + 4};
}

void ByteFaceRenderer::Draw(lv_layer_t* layer) {
    if (target_ == nullptr) {
        return;
    }
    // El halo va detrás de los ojos
    DrawHalo(layer, frame_acc_out_, Opa(1 - k_, LV_OPA_COVER));
    DrawHalo(layer, frame_acc_in_, Opa(k_, LV_OPA_COVER));
    if (booting_) {
        DrawBoot(layer, false);
    }
    if (!booting_ || boot_ms_ >= kBootEyesMs) {
        DrawEye(layer, frame_eyes_[0], 0);
        DrawEye(layer, frame_eyes_[1], 1);
    }
    // Los accesorios nuevos aparecen y los viejos se desvanecen durante la transición
    DrawAcc(layer, frame_acc_out_, Opa(1 - k_, LV_OPA_COVER));
    DrawAcc(layer, frame_acc_in_, Opa(k_, LV_OPA_COVER));
    DrawPlay(layer);
    if (booting_) {
        DrawBoot(layer, true);
    }
}

void ByteFaceRenderer::DrawEye(lv_layer_t* layer, const EyeOnScreen& e, int side) const {
    const lv_color_t bg = lv_color_black();
    const float s = scale_;

    switch (e.shape) {
        case EYE_RECT: {
            // El parpadeo encoge el alto del ojo
            float h = std::max(5 * s, e.h * e.blink);
            float x1 = e.cx - e.w / 2, x2 = e.cx + e.w / 2;
            DrawEclipse(layer, e, h);

            // Párpado de arriba: un trapecio negro inclinado (enfado o tristeza)
            if (fabsf(e.lid_top) > 0.5f) {
                // Un solo triángulo con la punta muy arriba: su base es la línea del
                // párpado (dos triángulos dejarían una costura visible en la diagonal)
                float t = tanf(e.lid_top * kPi / 180) * (side == 0 ? 1 : -1);
                float y0 = e.cy - e.h / 2 + e.h * 0.28f;
                float xl = x1 - 2, xr = x2 + 2;
                FillTriangle(layer, xl, y0 + t * (xl - e.cx), xr, y0 + t * (xr - e.cx),
                             e.cx, e.cy - e.h * 20, bg, LV_OPA_COVER);
            }
            // Mejillas: una elipse negra que sube desde abajo (feliz)
            if (e.lid_bot > 1) {
                float ry = e.w * 0.55f;
                float cy = e.cy + h / 2 + ry + 2 * s - e.lid_bot / 100 * e.h;
                FillEllipse(layer, e.cx, cy, e.w * 0.8f, ry, bg, LV_OPA_COVER);
            }
            // Sueño: el párpado baja desde arriba como una cortina negra
            if (e.sleep > 0.01f) {
                float top = e.cy - h / 2;
                FillRect(layer, x1 - 2, top - 2, x2 + 2, top + h * e.sleep, 0, bg, LV_OPA_COVER);
            }
            break;
        }
        case EYE_ARC:  // "^"
            Arc(layer, e.cx, e.cy + e.w * 0.32f, e.w * 0.46f, 11 * s, 212, 328, color_, LV_OPA_COVER);
            break;
        case EYE_CLOSED:  // arco hacia abajo, como un ojo dormido
            Arc(layer, e.cx, e.cy - e.w * 0.1f, e.w * 0.4f, 7 * s, 36, 144, color_, LV_OPA_COVER);
            break;
        case EYE_HEART: {
            // Dos círculos arriba y un triángulo abajo
            float z = e.w * 1.15f * e.beat;
            FillEllipse(layer, e.cx - z * 0.25f, e.cy - z * 0.18f, z * 0.27f, z * 0.27f, color_, LV_OPA_COVER);
            FillEllipse(layer, e.cx + z * 0.25f, e.cy - z * 0.18f, z * 0.27f, z * 0.27f, color_, LV_OPA_COVER);
            FillTriangle(layer, e.cx - z * 0.51f, e.cy - z * 0.1f, e.cx + z * 0.51f, e.cy - z * 0.1f,
                         e.cx, e.cy + z * 0.42f, color_, LV_OPA_COVER);
            break;
        }
    }
}

// Ojo "Eclipse": la píldora queda oscura con un toque del color, adentro brilla
// un sol con su corona y una luna negra lo tapa casi entero. Todo son círculos
// que caben dentro de la píldora, así que no hace falta recortar nada.
void ByteFaceRenderer::DrawEclipse(lv_layer_t* layer, const EyeOnScreen& e, float h) const {
    const lv_color_t bg = lv_color_black();
    float x1 = e.cx - e.w / 2, x2 = e.cx + e.w / 2;
    // Fondo de la píldora: el color muy apagado (10 %)
    FillRect(layer, x1, e.cy - h / 2, x2, e.cy + h / 2, R(e.r), lv_color_mix(color_, bg, 26),
             LV_OPA_COVER);
    float room = std::min(e.w, h) / 2 - 1;  // radio máximo que cabe en la píldora
    float sun = std::min(e.w * 0.27f, room);
    if (room < 6 * scale_) {
        return;  // a mitad de un parpadeo no se ve el sol
    }
    // Corona: anillos del color, más transparentes hacia afuera, que laten
    static const float kRing[] = {1.0f, 0.8f, 0.6f, 0.42f};
    static const lv_opa_t kOpa[] = {36, 72, 128, 200};
    for (int i = 0; i < 4; i++) {
        float r = std::min(room, sun + (room - sun) * kRing[i] * e.corona);
        FillEllipse(layer, e.cx, e.cy, r, r, color_, kOpa[i]);
    }
    // Sol: el color, con el centro un poco más claro
    FillEllipse(layer, e.cx, e.cy, sun, sun, color_, LV_OPA_COVER);
    FillEllipse(layer, e.cx, e.cy, sun * 0.8f, sun * 0.8f, lv_color_mix(lv_color_white(), color_, 70),
                LV_OPA_COVER);
    // Luna: un círculo negro un poco más grande que el sol, corrido a un lado
    float moon = sun * 1.02f;
    FillEllipse(layer, e.cx + e.moon, e.cy, moon, moon, bg, LV_OPA_COVER);
}

void ByteFaceRenderer::DrawAcc(lv_layer_t* layer, uint16_t acc, lv_opa_t opa) const {
    if (acc == ACC_NONE || opa == LV_OPA_TRANSP) {
        return;
    }
    const float t = (float)now_;
    const float s = scale_;
    const float cy = 108;
    const float g = kGap / 2;
    const lv_color_t c = color_;
    const lv_color_t bg = lv_color_black();

    if (acc & ACC_DOTS) {
        for (int i = 0; i < 3; i++) {
            float b = std::max(0.0f, sinf(t / 180 - i * 0.9f));
            FillEllipse(layer, X(100 + i * 20), Y(186 - b * 6), 6 * s, 6 * s, c,
                        Opa(0.35f + 0.65f * b, opa));
        }
    }
    if (acc & ACC_MOUTH) {
        DrawWaves(layer, opa);
    }
    if (acc & ACC_MOUTH_OPEN) {
        float o = 1 + 0.08f * sinf(t / 70);
        float r = 11 * o * s;  // media luna rellena: arco tan grueso como su radio
        Arc(layer, X(120), Y(176), r, 2 * r, 0, 180, c, opa);
    }
    if (acc & ACC_O_MOUTH) {
        lv_draw_rect_dsc_t dsc;
        lv_draw_rect_dsc_init(&dsc);
        dsc.bg_opa = LV_OPA_TRANSP;
        dsc.border_color = c;
        dsc.border_opa = opa;
        dsc.border_width = R(6 * s);
        dsc.radius = LV_RADIUS_CIRCLE;
        lv_area_t a = {R(X(107)), R(Y(171)), R(X(133)), R(Y(201))};
        lv_draw_rect(layer, &dsc, &a);
    }
    if (acc & ACC_CHECK) {
        Line(layer, X(106), Y(186), X(116), Y(196), 7 * s, c, opa);
        Line(layer, X(116), Y(196), X(136), Y(174), 7 * s, c, opa);
    }
    if (acc & ACC_ZZZ) {
        for (int i = 0; i < 3; i++) {
            float p = fmodf(t / 2200 + i / 3.0f, 1);
            float z = (12 + p * 12) * 0.7f;
            float x = 170 + p * 30, y = 80 - p * 44;
            lv_opa_t zo = Opa(sinf(p * kPi), opa);
            Line(layer, X(x), Y(y - z), X(x + z), Y(y - z), 3 * s, c, zo);
            Line(layer, X(x + z), Y(y - z), X(x), Y(y), 3 * s, c, zo);
            Line(layer, X(x), Y(y), X(x + z), Y(y), 3 * s, c, zo);
        }
    }
    if (acc & ACC_WIFI) {
        // 12 px más arriba que en el visor para no quedar bajo los subtítulos
        for (int i = 1; i <= 3; i++) {
            Arc(layer, X(120), Y(194), i * 11 * s, 5 * s, 225, 315, c, opa);
        }
        FillEllipse(layer, X(120), Y(192), 3.5f * s, 3.5f * s, c, opa);
        Line(layer, X(98), Y(150), X(142), Y(198), 5 * s, c, Opa(0.55f + 0.45f * sinf(t / 300), opa));
    }
    if (acc & ACC_MIC) {
        FillRect(layer, X(112), Y(160), X(128), Y(186), R(8 * s), c, opa);
        Arc(layer, X(120), Y(178), 14 * s, 4 * s, 0, 180, c, opa);
        Line(layer, X(120), Y(192), X(120), Y(200), 4 * s, c, opa);
        Line(layer, X(110), Y(200), X(130), Y(200), 4 * s, c, opa);
        Line(layer, X(100), Y(158), X(140), Y(204), 9 * s, bg, opa);
        Line(layer, X(100), Y(158), X(140), Y(204), 4 * s, c, opa);
    }
    if (acc & ACC_GLASSES) {
        for (float side : {-1.0f, 1.0f}) {
            float x = 120 + side * g;
            // Cristal = rectángulo + dos triángulos en los lados (sin diagonales que dejen costura)
            FillRect(layer, X(x - 28), Y(cy - 26), X(x + 28), Y(cy + 14), 0, c, opa);
            FillTriangle(layer, X(x - 34), Y(cy - 26), X(x - 28), Y(cy - 26), X(x - 28), Y(cy + 14), c, opa);
            FillTriangle(layer, X(x + 28), Y(cy - 26), X(x + 34), Y(cy - 26), X(x + 28), Y(cy + 14), c, opa);
            FillEllipse(layer, X(x), Y(cy + 14), 28 * s, 13 * s, c, opa);
        }
        Line(layer, X(120 - g + 30), Y(cy - 22), X(120 + g - 30), Y(cy - 22), 6 * s, c, opa);
        // Brillo que cruza el cristal cada 3,6 s
        float p = fmodf(t, 3600) / 3600 * 2 - 0.3f;
        if (p < 1.1f) {
            float x = 20 + p * 200;
            Line(layer, X(x), Y(cy + 24), X(x + 26), Y(cy - 22), 7 * s, bg, opa);
        }
    }
    if (acc & ACC_TEAR) {
        float p = fmodf(t, 1800) / 1800;
        Drop(layer, X(120 - g - 14), Y(cy + 40 + p * 50), 7 * s, lv_color_hex(0x93c5fd),
             Opa(1 - p * 0.7f, opa));
    }
    if (acc & ACC_SWEAT) {
        Drop(layer, X(120 + g + 34), Y(cy - 44 + sinf(t / 400) * 3), 8 * s, lv_color_hex(0x7dd3fc), opa);
    }
}

// Lo que dibuja el modo juego encima de los ojos
void ByteFaceRenderer::DrawPlay(lv_layer_t* layer) const {
    const float s = scale_;
    const lv_color_t white = lv_color_white();
    const lv_opa_t opa = Opa(play_.env, LV_OPA_COVER);
    switch (game_) {
        case GAME_MOSCA: {
            // Cuerpo blanco y dos alitas transparentes que aletean
            float fx = play_.fly_x, fy = play_.fly_y;
            float wing = (1.2f + 0.6f * fabsf(sinf(now_ / 25.0f))) * s;
            FillEllipse(layer, X(fx - 3), Y(fy - 3), 3 * s, wing, white, Opa(play_.env, 110));
            FillEllipse(layer, X(fx + 3), Y(fy - 3), 3 * s, wing, white, Opa(play_.env, 110));
            FillEllipse(layer, X(fx), Y(fy), 2.6f * s, 2.6f * s, white, opa);
            break;
        }
        case GAME_PONG:
            FillEllipse(layer, X(play_.ball_x), Y(play_.ball_y), 5 * s, 5 * s, white, opa);
            break;
        case GAME_SILBANDO: {
            // Boquita de silbar y tres notas que suben y se desvanecen
            FillEllipse(layer, X(120), Y(182), 5 * s, 5 * s, color_, opa);
            for (int k = 0; k < 3; k++) {
                float q = fmodf(play_.t * 0.6f + k * 0.33f, 1);
                float x = 176 + q * 30 + k * 5, y = 150 - q * 90;
                lv_opa_t no = Opa((1 - q) * play_.env, LV_OPA_COVER);
                // Cabeza, palito y banderita
                FillEllipse(layer, X(x), Y(y), 4.5f * s, 3.5f * s, color_, no);
                Line(layer, X(x + 4), Y(y), X(x + 4), Y(y - 14), 2 * s, color_, no);
                Line(layer, X(x + 4), Y(y - 14), X(x + 10), Y(y - 10), 2 * s, color_, no);
            }
            break;
        }
        default:
            break;
    }
    if (play_.yawn > 0) {
        // Bostezo: una boca ovalada que se abre y se cierra
        FillEllipse(layer, X(120), Y(182), 9 * s, (4 + 9 * play_.yawn) * s, color_,
                    Opa(play_.yawn, LV_OPA_COVER));
    }
}

// Halo: dos arcos a los lados de la cara, como los de un reactor, que se
// agrandan y brillan más cuanto más fuerte suena la voz. Detrás va un brillo
// ancho y transparente (el "neón") y por fuera un arco fino que se mece.
void ByteFaceRenderer::DrawHalo(lv_layer_t* layer, uint16_t acc, lv_opa_t opa) const {
    if (!(acc & ACC_RING) || opa == LV_OPA_TRANSP) {
        return;
    }
    const float s = scale_, v = voice_;
    const float cx = X(120), cy = Y(132);
    const float r = (92 + v * 9) * s;
    const float span = 36 + 22 * v;                    // medio arco, en grados
    const float sway = 8 * sinf(now_ / 900.0f);        // el arco de afuera se mece
    const lv_color_t c = color_;
    const lv_color_t core = lv_color_mix(lv_color_hex(kMoon), c, 128);
    for (float mid : {0.0f, 180.0f}) {                 // derecha e izquierda
        float a1 = mid - span + 360, a2 = mid + span + 360;  // LVGL quiere ángulos positivos
        Arc(layer, cx, cy, r, (6 + 6 * v) * s, a1, a2, c, Opa((30 + 50 * v) / 255.0f, opa));
        Arc(layer, cx, cy, r, 2.4f * s, a1, a2, core, Opa((150 + 105 * v) / 255.0f, opa));
        float o = mid == 0 ? sway : -sway, half = span * 0.55f;
        Arc(layer, cx, cy, r + 9 * s, 1.4f * s, mid + o - half + 360, mid + o + half + 360, c,
            Opa(0.45f, opa));
    }
}

// Ondas de voz (tipo Siri): tres curvas que se cruzan donde va la boca. Su
// alto sigue a la voz; en silencio quedan como una línea que respira.
void ByteFaceRenderer::DrawWaves(lv_layer_t* layer, lv_opa_t opa) const {
    struct Wave {
        float freq, speed, height, width;
        bool moon;
        float alpha;
    };
    static const Wave kWaves[] = {
        {1.5f, 0.0035f, 0.45f, 2.0f, false, 0.45f},  // la ancha de atrás, suave
        {3.2f, -0.0047f, 0.65f, 2.0f, true, 0.70f},  // la de blanco luna
        {2.2f, 0.0062f, 1.00f, 3.0f, false, 1.00f},  // la principal, del color de la cara
    };
    constexpr int kSegments = 16;
    const float amp = 1.5f + 15 * voice_;  // en px del diseño
    const float t = (float)now_;
    for (const auto& w : kWaves) {
        lv_color_t col = w.moon ? lv_color_hex(kMoon) : color_;
        lv_opa_t o = Opa(w.alpha, opa);
        float px = 0, py = 0;
        for (int i = 0; i <= kSegments; i++) {
            float u = -1 + 2.0f * i / kSegments;
            float att = (1 - u * u) * (1 - u * u);  // los extremos quedan quietos
            float x = X(120 + u * 48);
            float y = Y(185 + w.height * amp * att * sinf(w.freq * kPi * u + t * w.speed));
            if (i > 0) {
                // Sin puntas redondas: con transparencia se verían bolitas en cada unión
                Line(layer, px, py, x, y, w.width * scale_, col, o, false);
            }
            px = x;
            py = y;
        }
    }
}

// Encendido tipo JARVIS. front = false se pinta detrás de los ojos y
// front = true encima (el destello).
void ByteFaceRenderer::DrawBoot(lv_layer_t* layer, bool front) const {
    const float ms = boot_ms_, s = scale_;
    const lv_color_t moon = lv_color_hex(kMoon);
    const float cx = X(120), ey = Y(108);
    const float eyes_x[2] = {X(120 - kGap / 2), X(120 + kGap / 2)};

    if (front) {
        // 3. Destello: un aro de neón que sale del centro y se apaga
        float q = (ms - kBootEyesMs) / 800;
        if (q > 0 && q < 1) {
            float e = EaseOut(q);
            float r = (44 + e * 130) * s;
            Arc(layer, cx, Y(124), r, (10 - 5 * e) * s, 0, 360, moon, Opa(1 - q, 35));
            Arc(layer, cx, Y(124), r, (3 - 1.5f * e) * s, 0, 360, moon, Opa(1 - q, 220));
        }
        return;
    }

    // 1. Línea de energía: nace en el centro y se estira a lo ancho
    if (ms < kBootEyesMs) {
        float k = EaseOut(std::min(1.0f, ms / kBootLineMs));
        float fade = ms < kBootLineMs ? 1 : 1 - (ms - kBootLineMs) / (kBootEyesMs - kBootLineMs);
        float half = k * 112 * s;
        Line(layer, cx - half, ey, cx + half, ey, 12 * s, moon, Opa(fade, 30));
        Line(layer, cx - half, ey, cx + half, ey, 5 * s, moon, Opa(fade, 80));
        Line(layer, cx - half, ey, cx + half, ey, 1.8f * s, moon, Opa(fade, 255));
        FillEllipse(layer, cx, ey, (3 + 3 * k) * s, (3 + 3 * k) * s, moon, Opa(fade, 255));
    }
    // 2. Dos chispas viajan a los ojos y dibujan un anillo alrededor de cada uno
    if (ms >= kBootLineMs && ms < kBootAccMs) {
        float q = std::min(1.0f, (ms - kBootLineMs) / (kBootEyesMs - kBootLineMs));
        float e = EaseOut(q);
        // Al encenderse los ojos el anillo se encoge hasta ellos y se apaga
        float shrink = std::clamp((ms - kBootEyesMs) / (kBootAccMs - kBootEyesMs), 0.0f, 1.0f);
        float r = (40 - 8 * shrink) * s;
        lv_opa_t fade = Opa(1 - shrink, 255);
        for (int i = 0; i < 2; i++) {
            float x = Lerp(cx, eyes_x[i], e);
            if (q < 1) {
                FillEllipse(layer, x, ey, 4 * s, 4 * s, moon, LV_OPA_COVER);  // la chispa
            }
            float sweep = 360 * e;  // el anillo se cierra empezando arriba
            float start = i == 0 ? 270 : 270 - sweep + 360;
            if (sweep > 2) {
                Arc(layer, eyes_x[i], ey, r, 9 * s, start, start + sweep, moon, Opa(1 - shrink, 45));
                Arc(layer, eyes_x[i], ey, r, 2.2f * s, start, start + sweep, moon, fade);
            }
        }
    }
}
