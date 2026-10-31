#include "byte_ui.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iterator>

#include <material_symbols.h>

#include "byte_faces.h"

LV_FONT_DECLARE(font_noto_sans_basic_16_4);
LV_FONT_DECLARE(font_noto_sans_basic_20_4);
LV_FONT_DECLARE(font_noto_sans_basic_30_4);
LV_FONT_DECLARE(font_material_symbols_20_4);
LV_FONT_DECLARE(font_material_symbols_30_4);

namespace {

// Colores: los mismos del simulador
constexpr uint32_t kText = 0xe6eaee, kMuted = 0x8a939b, kDim = 0x5b636b;
constexpr uint32_t kPanel = 0x14171b, kChip = 0x1e2228, kTrack = 0x2a2f36, kLine = 0x1f2329;
constexpr uint32_t kCyan = 0x22d3ee, kOrange = 0xfb923c, kOnCyan = 0x04252b;

const lv_font_t* const kFont = &font_noto_sans_basic_20_4;
const lv_font_t* const kSmall = &font_noto_sans_basic_16_4;
const lv_font_t* const kIcon = &font_material_symbols_20_4;
const lv_font_t* const kIconBig = &font_material_symbols_30_4;
const lv_font_t* const kNumbers = &font_noto_sans_basic_30_4;
// Números grandes del reloj: Montserrat 48 si está activada en sdkconfig
#if LV_FONT_MONTSERRAT_48
const lv_font_t* const kHuge = &lv_font_montserrat_48;
#else
const lv_font_t* const kHuge = &font_noto_sans_basic_30_4;
#endif

constexpr int kSwipePx = 30;                 // arrastre mínimo para que cuente como deslizar
constexpr int kTopEdge = 40;                 // deslizar hacia abajo desde aquí abre los ajustes rápidos
constexpr uint32_t kTapMs = 600;             // más corto que esto es un toque
constexpr uint32_t kLongPressMs = 3000;      // 3 s sobre la cara: modo Wi-Fi
constexpr uint32_t kBackHomeMs = 30000;      // menú olvidado: vuelve a la cara
constexpr uint32_t kQuickCloseMs = 15000;    // ajustes rápidos olvidados: se cierran
constexpr uint32_t kRingMs = 15000;          // la alarma suena hasta 15 s
constexpr uint32_t kBeepEveryMs = 1500;
constexpr uint32_t kRebootArmMs = 3000;      // "toca otra vez" para reiniciar
constexpr int kQuickH = 156;                 // alto del panel (20 px quedan escondidos arriba)

// Nombre bonito de cada cara para la galería
struct FaceName {
    const char* id;
    const char* name;
};
constexpr FaceName kFaceNames[] = {
    {"reposo", "Reposo"}, {"escucha", "Escucha"}, {"pensando", "Pensando"},
    {"hablando", "Hablando"}, {"dormido", "Dormido"}, {"wifi", "Sin Wi-Fi"},
    {"mute", "Sin micrófono"}, {"exito", "Éxito"}, {"feliz", "Feliz"}, {"risa", "Risa"},
    {"carino", "Cariño"}, {"cool", "Cool"}, {"sorpresa", "Sorpresa"}, {"enfado", "Enfado"},
    {"tristeza", "Tristeza"}, {"oops", "Oops"}, {"guino", "Guiño"},
};

const char* FaceLabel(const char* id) {
    for (const auto& f : kFaceNames) {
        if (strcmp(f.id, id) == 0) {
            return f.name;
        }
    }
    return id;
}

constexpr const char* kWeekdays[] = {"domingo", "lunes", "martes", "miércoles",
                                     "jueves", "viernes", "sábado"};
constexpr const char* kMonths[] = {"enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
                                   "agosto", "septiembre", "octubre", "noviembre", "diciembre"};

// Objeto vacío, sin estilos del tema y sin recibir toques
lv_obj_t* Plain(lv_obj_t* parent) {
    lv_obj_t* o = lv_obj_create(parent);
    lv_obj_remove_style_all(o);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
    return o;
}

void Fill(lv_obj_t* o, uint32_t color, int32_t radius) {
    lv_obj_set_style_bg_color(o, lv_color_hex(color), 0);
    lv_obj_set_style_bg_opa(o, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(o, radius, 0);
}

lv_obj_t* Text(lv_obj_t* parent, const char* text, const lv_font_t* font, uint32_t color) {
    lv_obj_t* l = lv_label_create(parent);
    lv_label_set_text(l, text);
    lv_obj_set_style_text_font(l, font, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
    return l;
}

// Centra o en el punto (cx, cy) de un padre de 320x240
void Place(lv_obj_t* o, int cx, int cy) {
    lv_obj_align(o, LV_ALIGN_CENTER, cx - 160, cy - 120);
}

// Pone el texto solo si cambió (así LVGL no repinta de más)
void SetText(lv_obj_t* label, const char* text) {
    if (strcmp(lv_label_get_text(label), text) != 0) {
        lv_label_set_text(label, text);
    }
}

void Show(lv_obj_t* o, bool show) {
    if (show == lv_obj_has_flag(o, LV_OBJ_FLAG_HIDDEN)) {
        if (show) {
            lv_obj_remove_flag(o, LV_OBJ_FLAG_HIDDEN);
        } else {
            lv_obj_add_flag(o, LV_OBJ_FLAG_HIDDEN);
        }
    }
}

void SetY(void* obj, int32_t y) {
    lv_obj_set_y(static_cast<lv_obj_t*>(obj), y);
}

}  // namespace

/* ---------- Construcción ---------- */

void ByteUi::Init(lv_obj_t* parent, int width, int height, const ByteUiHost& host) {
    host_ = host;
    w_ = width;
    h_ = height;

    // Contenedor de todo. No recibe toques: en la cara, el dedo "lo atraviesa".
    root_ = Plain(parent);
    lv_obj_set_size(root_, w_, h_);

    BuildMenu();
    BuildClock();
    BuildTimer();
    BuildFaces();
    BuildSettings();
    BuildAbout();
    BuildQuickPanel();

    last_touch_ = lv_tick_get();
    tick_ = lv_timer_create(OnTick, 100, this);
}

lv_obj_t* ByteUi::NewScreen(Screen s, bool opaque) {
    lv_obj_t* screen = Plain(root_);
    lv_obj_set_size(screen, w_, h_);
    if (opaque) {
        Fill(screen, 0x000000, 0);
    }
    lv_obj_add_flag(screen, LV_OBJ_FLAG_CLICKABLE);  // que el toque no llegue a la cara
    lv_obj_add_flag(screen, LV_OBJ_FLAG_HIDDEN);
    screens_[s] = screen;
    return screen;
}

lv_obj_t* ByteUi::Button(lv_obj_t* parent, Action action) {
    lv_obj_t* b = Plain(parent);
    lv_obj_add_flag(b, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_user_data(b, reinterpret_cast<void*>(static_cast<intptr_t>(action)));
    lv_obj_add_event_cb(b, OnClick, LV_EVENT_CLICKED, this);
    return b;
}

void ByteUi::Header(lv_obj_t* screen, const char* title) {
    lv_obj_t* back = Button(screen, kActBack);
    lv_obj_set_size(back, 56, 40);
    lv_obj_set_pos(back, 0, 28);
    lv_obj_t* arrow = Text(back, MATERIAL_SYMBOLS_ARROW_BACK, kIcon, kText);
    lv_obj_align(arrow, LV_ALIGN_LEFT_MID, 14, 0);
    if (title != nullptr) {
        lv_obj_t* t = Text(screen, title, kFont, kText);
        Place(t, 160, 47);
    }
}

void ByteUi::BuildMenu() {
    lv_obj_t* s = NewScreen(kMenu, true);
    Header(s, "Menú");

    struct Item {
        const char* icon;
        const char* label;
        Action action;
    };
    const Item items[] = {
        {MATERIAL_SYMBOLS_SCHEDULE, "Reloj", kActClock},
        {MATERIAL_SYMBOLS_ALARM, "Temporizador", kActTimer},
        {nullptr, "Caras", kActFaces},  // el ícono son los ojitos de Byte
        {MATERIAL_SYMBOLS_SETTINGS, "Ajustes", kActSettings},
    };
    for (int i = 0; i < 4; i++) {
        int cx = 40 + i * 80, cy = 118;
        lv_obj_t* b = Button(s, items[i].action);
        lv_obj_set_size(b, 80, 96);
        lv_obj_set_pos(b, cx - 40, cy - 32);
        lv_obj_set_style_radius(b, 14, 0);
        lv_obj_set_style_bg_color(b, lv_color_hex(kChip), LV_STATE_PRESSED);
        lv_obj_set_style_bg_opa(b, LV_OPA_70, LV_STATE_PRESSED);

        lv_obj_t* circle = Plain(b);
        lv_obj_set_size(circle, 54, 54);
        Fill(circle, kChip, LV_RADIUS_CIRCLE);
        lv_obj_align(circle, LV_ALIGN_TOP_MID, 0, 5);
        if (items[i].icon != nullptr) {
            lv_obj_center(Text(circle, items[i].icon, kIconBig, kCyan));
        } else {
            for (int side = -1; side <= 1; side += 2) {
                lv_obj_t* eye = Plain(circle);
                lv_obj_set_size(eye, 10, 16);
                Fill(eye, kCyan, 4);
                lv_obj_align(eye, LV_ALIGN_CENTER, side * 8, 0);
            }
        }
        // El nombre va en la pantalla y no dentro del botón: LVGL recorta lo que
        // se sale de su padre, y "Temporizador" es más ancho que el botón.
        // La etiqueta no recibe toques, así que el toque sigue llegando al botón.
        Place(Text(s, items[i].label, kSmall, kText), cx, cy + 46);
    }

    lv_obj_t* hint = Text(s, "Desliza desde arriba: volumen y brillo", kSmall, kDim);
    lv_obj_align(hint, LV_ALIGN_BOTTOM_MID, 0, -10);
}

void ByteUi::BuildClock() {
    lv_obj_t* s = NewScreen(kClock, true);
    Header(s, nullptr);

    // Ojitos de Byte arriba, para que el reloj tenga su personalidad
    for (int i = 0; i < 2; i++) {
        clock_eyes_[i] = Plain(s);
        lv_obj_set_size(clock_eyes_[i], 14, 14);
        Fill(clock_eyes_[i], kCyan, 5);
        Place(clock_eyes_[i], 148 + i * 24, 60);
    }
    clock_time_ = Text(s, "--:--", kHuge, kText);
    Place(clock_time_, 160, 120);
    clock_date_ = Text(s, "", kSmall, kMuted);
    Place(clock_date_, 160, 170);
    clock_ampm_ = Text(s, "", kSmall, kDim);
    Place(clock_ampm_, 160, 194);
}

void ByteUi::BuildTimer() {
    lv_obj_t* s = NewScreen(kTimer, true);
    Header(s, "Temporizador");

    // Anillo: la parte cian es el tiempo que falta
    timer_arc_ = lv_arc_create(s);
    lv_obj_set_size(timer_arc_, 108, 108);
    Place(timer_arc_, 160, 126);
    lv_arc_set_rotation(timer_arc_, 270);
    lv_arc_set_bg_angles(timer_arc_, 0, 360);
    lv_arc_set_range(timer_arc_, 0, 1000);
    lv_arc_set_value(timer_arc_, 1000);
    lv_obj_remove_style(timer_arc_, nullptr, LV_PART_KNOB);
    lv_obj_remove_flag(timer_arc_, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_style_arc_width(timer_arc_, 6, LV_PART_MAIN);
    lv_obj_set_style_arc_width(timer_arc_, 6, LV_PART_INDICATOR);
    lv_obj_set_style_arc_color(timer_arc_, lv_color_hex(kChip), LV_PART_MAIN);
    lv_obj_set_style_arc_color(timer_arc_, lv_color_hex(kCyan), LV_PART_INDICATOR);
    lv_obj_set_style_arc_rounded(timer_arc_, true, LV_PART_INDICATOR);

    timer_label_ = Text(s, "2:00", kNumbers, kText);
    Place(timer_label_, 160, 126);

    // - y + cambian de a un minuto (solo con el temporizador quieto)
    for (int i = 0; i < 2; i++) {
        lv_obj_t* b = Button(s, i == 0 ? kActTimerMinus : kActTimerPlus);
        lv_obj_set_size(b, 44, 44);
        Fill(b, kChip, LV_RADIUS_CIRCLE);
        lv_obj_set_style_bg_color(b, lv_color_hex(kTrack), LV_STATE_PRESSED);
        Place(b, i == 0 ? 52 : 268, 122);
        lv_obj_center(Text(b, i == 0 ? "-" : "+", kNumbers, kText));
        timer_adjust_[i] = b;
        timer_adjust_min_[i] = Text(s, "min", kSmall, kDim);
        Place(timer_adjust_min_[i], i == 0 ? 52 : 268, 156);
    }

    auto pill = [&](Action action, int cx, int w, bool primary, const char* label) {
        lv_obj_t* b = Button(s, action);
        lv_obj_set_size(b, w, 34);
        Fill(b, primary ? kCyan : kChip, 17);
        lv_obj_set_style_bg_opa(b, LV_OPA_80, LV_STATE_PRESSED);
        Place(b, cx, 207);
        lv_obj_t* l = Text(b, label, kSmall, primary ? kOnCyan : kText);
        lv_obj_center(l);
        return b;
    };
    timer_reset_ = pill(kActTimerReset, 104, 96, false, "Reiniciar");
    timer_main_ = pill(kActTimerStartPause, 214, 104, true, "Iniciar");
    timer_main_label_ = lv_obj_get_child(timer_main_, 0);
    timer_stop_ = pill(kActTimerStop, 160, 130, true, "Detener");
    lv_obj_add_flag(timer_stop_, LV_OBJ_FLAG_HIDDEN);

    // Chip sobre la cara mientras el temporizador corre; al tocarlo abre el temporizador
    timer_chip_ = Button(root_, kActTimer);
    lv_obj_set_size(timer_chip_, LV_SIZE_CONTENT, LV_SIZE_CONTENT);
    Fill(timer_chip_, kPanel, 12);
    lv_obj_set_style_pad_hor(timer_chip_, 8, 0);
    lv_obj_set_style_pad_ver(timer_chip_, 2, 0);
    lv_obj_set_style_pad_column(timer_chip_, 4, 0);
    lv_obj_set_flex_flow(timer_chip_, LV_FLEX_FLOW_ROW);
    lv_obj_set_flex_align(timer_chip_, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);
    Text(timer_chip_, MATERIAL_SYMBOLS_ALARM, kIcon, kCyan);
    timer_chip_label_ = Text(timer_chip_, "", kSmall, kCyan);
    lv_obj_align(timer_chip_, LV_ALIGN_BOTTOM_MID, 0, -12);  // abajo, lejos de los ojos
    lv_obj_add_flag(timer_chip_, LV_OBJ_FLAG_HIDDEN);
}

void ByteUi::BuildFaces() {
    // Transparente: se ve la cara de verdad, dibujada por ByteFaceDisplay
    lv_obj_t* s = NewScreen(kFaces, false);
    Header(s, nullptr);
    for (int i = 0; i < 2; i++) {
        lv_obj_t* b = Button(s, i == 0 ? kActFacePrev : kActFaceNext);
        lv_obj_set_size(b, 70, 150);
        lv_obj_set_pos(b, i == 0 ? 0 : w_ - 70, 70);
        lv_obj_t* arrow = Text(b, i == 0 ? MATERIAL_SYMBOLS_KEYBOARD_ARROW_LEFT
                                         : MATERIAL_SYMBOLS_KEYBOARD_ARROW_RIGHT,
                               kIconBig, kDim);
        lv_obj_align(arrow, i == 0 ? LV_ALIGN_LEFT_MID : LV_ALIGN_RIGHT_MID, i == 0 ? 10 : -10, 0);
    }
    face_name_ = Text(s, "", kSmall, kMuted);
    lv_obj_align(face_name_, LV_ALIGN_BOTTOM_MID, 0, -10);
}

lv_obj_t* ByteUi::SettingsRow(lv_obj_t* screen, int index, const char* icon, const char* text,
                              Action action) {
    int y = 64 + index * 36;
    lv_obj_t* row = Button(screen, action);
    lv_obj_set_size(row, w_, 34);
    lv_obj_set_pos(row, 0, y);
    lv_obj_set_style_bg_color(row, lv_color_hex(kChip), LV_STATE_PRESSED);
    lv_obj_set_style_bg_opa(row, LV_OPA_COVER, LV_STATE_PRESSED);
    lv_obj_align(Text(row, icon, kIcon, kMuted), LV_ALIGN_LEFT_MID, 18, 0);
    lv_obj_align(Text(row, text, kSmall, kText), LV_ALIGN_LEFT_MID, 50, 0);
    lv_obj_t* value = Text(row, "", kSmall, kMuted);
    lv_obj_align(value, LV_ALIGN_RIGHT_MID, -16, 0);
    if (index > 0) {
        lv_obj_t* line = Plain(screen);
        lv_obj_set_size(line, w_ - 32, 1);
        Fill(line, kLine, 0);
        lv_obj_set_pos(line, 16, y - 1);
    }
    return value;
}

void ByteUi::BuildSettings() {
    lv_obj_t* s = NewScreen(kSettings, true);
    Header(s, "Ajustes");
    settings_volume_ = SettingsRow(s, 0, MATERIAL_SYMBOLS_VOLUME_UP, "Volumen", kActQuickOpen);
    settings_brightness_ = SettingsRow(s, 1, MATERIAL_SYMBOLS_BRIGHTNESS_6, "Brillo", kActQuickOpen);
    settings_wifi_ = SettingsRow(s, 2, MATERIAL_SYMBOLS_WIFI, "Wi-Fi", kActNone);
    lv_obj_t* more = SettingsRow(s, 3, MATERIAL_SYMBOLS_INFO, "Acerca de", kActAbout);
    lv_obj_set_style_text_font(more, kIcon, 0);
    lv_label_set_text(more, MATERIAL_SYMBOLS_KEYBOARD_ARROW_RIGHT);
}

void ByteUi::BuildAbout() {
    lv_obj_t* s = NewScreen(kAbout, true);
    Header(s, "Acerca de");
    const char* rows[][2] = {
        {"Nombre", "Byte"}, {"Carcasa", "Nube"}, {"Firmware", ""}, {"Pantalla", "320 × 240, táctil"},
    };
    for (int i = 0; i < 4; i++) {
        int y = 82 + i * 27;
        lv_obj_t* k = Text(s, rows[i][0], kSmall, kMuted);
        lv_obj_align(k, LV_ALIGN_TOP_LEFT, 24, y - 10);
        lv_obj_t* v = Text(s, rows[i][1], kSmall, kText);
        lv_obj_align(v, LV_ALIGN_TOP_RIGHT, -24, y - 10);
        if (i == 2) {
            about_version_ = v;
        }
    }
    reboot_button_ = Button(s, kActReboot);
    lv_obj_set_size(reboot_button_, 120, 34);
    Fill(reboot_button_, kChip, 17);
    Place(reboot_button_, 160, 207);
    reboot_label_ = Text(reboot_button_, "Reiniciar", kSmall, kText);
    lv_obj_center(reboot_label_);
}

lv_obj_t* ByteUi::QuickSlider(int y, const char* icon, lv_obj_t** value_label) {
    lv_obj_align(Text(qp_panel_, icon, kIcon, kText), LV_ALIGN_TOP_LEFT, 16, y - 12);

    lv_obj_t* slider = lv_slider_create(qp_panel_);
    lv_obj_set_size(slider, 216, 22);
    lv_obj_set_pos(slider, 50, y - 11);
    lv_obj_set_style_bg_color(slider, lv_color_hex(kTrack), LV_PART_MAIN);
    lv_obj_set_style_bg_opa(slider, LV_OPA_COVER, LV_PART_MAIN);
    lv_obj_set_style_radius(slider, 11, LV_PART_MAIN);
    lv_obj_set_style_pad_all(slider, 0, LV_PART_MAIN);
    lv_obj_set_style_bg_color(slider, lv_color_hex(kCyan), LV_PART_INDICATOR);
    lv_obj_set_style_radius(slider, 11, LV_PART_INDICATOR);
    // Sin perilla: toda la barra se arrastra
    lv_obj_set_style_bg_opa(slider, LV_OPA_TRANSP, LV_PART_KNOB);
    lv_obj_set_style_shadow_width(slider, 0, LV_PART_KNOB);
    lv_obj_set_style_outline_width(slider, 0, LV_PART_KNOB);
    lv_obj_set_style_pad_all(slider, 0, LV_PART_KNOB);
    lv_obj_set_ext_click_area(slider, 12);
    lv_obj_add_event_cb(slider, OnSlider, LV_EVENT_ALL, this);

    *value_label = Text(qp_panel_, "", kSmall, kMuted);
    lv_obj_align(*value_label, LV_ALIGN_TOP_RIGHT, -14, y - 10);
    return slider;
}

void ByteUi::BuildQuickPanel() {
    // Fondo oscuro: tocarlo cierra el panel
    qp_backdrop_ = Button(root_, kActQuickClose);
    lv_obj_set_size(qp_backdrop_, w_, h_);
    lv_obj_set_style_bg_color(qp_backdrop_, lv_color_black(), 0);
    lv_obj_set_style_bg_opa(qp_backdrop_, LV_OPA_60, 0);
    lv_obj_add_flag(qp_backdrop_, LV_OBJ_FLAG_HIDDEN);

    // El panel baja desde arriba; los 20 px de arriba quedan fuera de la pantalla
    // para que solo se vean redondeadas las esquinas de abajo
    qp_panel_ = Plain(root_);
    lv_obj_add_flag(qp_panel_, LV_OBJ_FLAG_CLICKABLE);  // tocar el panel no lo cierra
    lv_obj_set_size(qp_panel_, w_, kQuickH);
    Fill(qp_panel_, kPanel, 18);
    lv_obj_set_pos(qp_panel_, 0, -kQuickH);
    lv_obj_add_flag(qp_panel_, LV_OBJ_FLAG_HIDDEN);

    qp_volume_ = QuickSlider(20 + 52, MATERIAL_SYMBOLS_VOLUME_UP, &qp_volume_value_);
    qp_brightness_ = QuickSlider(20 + 96, MATERIAL_SYMBOLS_BRIGHTNESS_6, &qp_brightness_value_);
    lv_slider_set_range(qp_brightness_, 5, 100);  // en 0 no se vería nada

    lv_obj_t* handle = Plain(qp_panel_);
    lv_obj_set_size(handle, 36, 4);
    Fill(handle, kDim, 2);
    lv_obj_align(handle, LV_ALIGN_BOTTOM_MID, 0, -10);
}

/* ---------- Navegación ---------- */

void ByteUi::Do(Action action) {
    switch (action) {
        case kActNone: break;
        case kActHome: Go(kHome); break;
        case kActMenu: Go(kMenu); break;
        case kActClock: Go(kClock); break;
        case kActTimer: Go(kTimer); break;
        case kActFaces: Go(kFaces); break;
        case kActSettings: Go(kSettings); break;
        case kActAbout: Go(kAbout); break;
        case kActBack: Back(); break;
        case kActQuickOpen: OpenQuick(); break;
        case kActQuickClose: CloseQuick(); break;
        case kActTimerMinus: AdjustTimer(-1); break;
        case kActTimerPlus: AdjustTimer(+1); break;
        case kActTimerReset: StopTimer(); break;
        case kActTimerStartPause:
            if (running_) {
                PauseTimer();
            } else {
                StartTimer(0);
            }
            break;
        case kActTimerStop: StopRing(); break;
        case kActFacePrev: ShowFace(-1); break;
        case kActFaceNext: ShowFace(+1); break;
        case kActReboot:
            if (reboot_armed_until_ != 0) {
                SetText(reboot_label_, "Reiniciando...");
                if (host_.reboot) host_.reboot();
            } else {
                // Primero pide confirmación, para no reiniciar por un toque sin querer
                reboot_armed_until_ = lv_tick_get() + kRebootArmMs;
                lv_obj_set_width(reboot_button_, 250);
                lv_obj_set_style_bg_color(reboot_button_, lv_color_hex(kOrange), 0);
                lv_obj_set_style_text_color(reboot_label_, lv_color_hex(kOnCyan), 0);
                SetText(reboot_label_, "Toca otra vez para reiniciar");
            }
            break;
    }
}

void ByteUi::Go(Screen s) {
    if (s == screen_) {
        return;
    }
    if (screen_ == kFaces && host_.preview_face) {
        host_.preview_face(-1);  // al salir de la galería vuelve la cara normal
    }
    if (screens_[screen_] != nullptr) {
        lv_obj_add_flag(screens_[screen_], LV_OBJ_FLAG_HIDDEN);
    }
    screen_ = s;
    if (screens_[s] != nullptr) {
        lv_obj_remove_flag(screens_[s], LV_OBJ_FLAG_HIDDEN);
    }
    switch (s) {
        case kClock: RefreshClock(true); break;
        case kTimer: RefreshTimer(); break;
        case kFaces: ShowFace(0); break;
        case kSettings: RefreshSettings(); break;
        case kAbout:
            ResetRebootButton();
            if (host_.firmware_version) {
                SetText(about_version_, host_.firmware_version().c_str());
            }
            break;
        default: break;
    }
    Show(timer_chip_, s == kHome && running_);
    last_touch_ = lv_tick_get();
}

void ByteUi::Back() {
    switch (screen_) {
        case kAbout: Go(kSettings); break;
        case kMenu: Go(kHome); break;
        case kHome: break;
        default: Go(kMenu); break;
    }
}

void ByteUi::OpenQuick() {
    if (qp_open_) {
        return;
    }
    qp_open_ = true;
    RefreshQuick();
    lv_obj_remove_flag(qp_backdrop_, LV_OBJ_FLAG_HIDDEN);
    lv_obj_remove_flag(qp_panel_, LV_OBJ_FLAG_HIDDEN);
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, qp_panel_);
    lv_anim_set_exec_cb(&a, SetY);
    lv_anim_set_values(&a, lv_obj_get_y(qp_panel_), -20);
    lv_anim_set_duration(&a, 220);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_out);
    lv_anim_start(&a);
}

void ByteUi::CloseQuick() {
    if (!qp_open_) {
        return;
    }
    qp_open_ = false;
    if (screen_ == kSettings) {
        RefreshSettings();
    }
    lv_obj_add_flag(qp_backdrop_, LV_OBJ_FLAG_HIDDEN);
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, qp_panel_);
    lv_anim_set_exec_cb(&a, SetY);
    lv_anim_set_values(&a, lv_obj_get_y(qp_panel_), -kQuickH);
    lv_anim_set_duration(&a, 200);
    lv_anim_set_path_cb(&a, lv_anim_path_ease_in);
    lv_anim_set_user_data(&a, this);
    lv_anim_set_completed_cb(&a, [](lv_anim_t* a) {
        auto self = static_cast<ByteUi*>(lv_anim_get_user_data(a));
        if (!self->qp_open_) {
            lv_obj_add_flag(self->qp_panel_, LV_OBJ_FLAG_HIDDEN);
        }
    });
    lv_anim_start(&a);
}

void ByteUi::ShowFace(int step) {
    int n = static_cast<int>(std::size(kByteFaces));
    face_index_ = (face_index_ + step + n) % n;
    if (host_.preview_face) {
        host_.preview_face(face_index_);
    }
    char buf[48];
    snprintf(buf, sizeof(buf), "%s  ·  %d/%d", FaceLabel(kByteFaces[face_index_].id), face_index_ + 1, n);
    SetText(face_name_, buf);
}

void ByteUi::ResetRebootButton() {
    reboot_armed_until_ = 0;
    lv_obj_set_width(reboot_button_, 120);
    lv_obj_set_style_bg_color(reboot_button_, lv_color_hex(kChip), 0);
    lv_obj_set_style_text_color(reboot_label_, lv_color_hex(kText), 0);
    SetText(reboot_label_, "Reiniciar");
}

/* ---------- Toques y deslizamientos ---------- */

void ByteUi::Feed(lv_indev_t* indev, bool pressed, int x, int y) {
    uint32_t now = lv_tick_get();
    if (pressed && !down_) {
        // Empieza un toque
        down_ = true;
        swiped_ = long_done_ = false;
        x0_ = x;
        y0_ = y;
        t0_ = now;
        last_touch_ = now;
        if (host_.activity) host_.activity();
        if (ringing_) {
            // Cualquier toque apaga la alarma (y no hace nada más)
            StopRing();
            swiped_ = true;
            lv_indev_wait_release(indev);
        }
        return;
    }
    if (pressed) {
        last_touch_ = now;
        if (swiped_ || long_done_ || slider_pressed_) {
            return;  // ya se decidió qué es este toque, o está moviendo una barra
        }
        int dx = x - x0_, dy = y - y0_;
        if (abs(dx) > kSwipePx || abs(dy) > kSwipePx) {
            swiped_ = true;
            lv_indev_wait_release(indev);  // así el botón que estaba debajo no se "presiona"
            if (abs(dx) > abs(dy)) {
                OnSwipe(dx > 0 ? LV_DIR_RIGHT : LV_DIR_LEFT);
            } else {
                OnSwipe(dy > 0 ? LV_DIR_BOTTOM : LV_DIR_TOP);
            }
        } else if (screen_ == kHome && !qp_open_ && now - t0_ > kLongPressMs) {
            long_done_ = true;
            lv_indev_wait_release(indev);
            if (host_.home_long_press) host_.home_long_press();
        }
        return;
    }
    if (down_) {
        // Se levantó el dedo
        down_ = false;
        if (!swiped_ && !long_done_ && screen_ == kHome && !qp_open_ && now - t0_ < kTapMs) {
            if (host_.home_tap) host_.home_tap();
        }
    }
}

void ByteUi::OnSwipe(lv_dir_t dir) {
    if (qp_open_) {
        if (dir == LV_DIR_TOP) {
            CloseQuick();
        }
        return;
    }
    if (dir == LV_DIR_BOTTOM && y0_ < kTopEdge) {
        OpenQuick();
        return;
    }
    switch (screen_) {
        case kHome:
            if (dir == LV_DIR_TOP) Go(kMenu);
            break;
        case kMenu:
            if (dir == LV_DIR_BOTTOM || dir == LV_DIR_RIGHT) Go(kHome);
            break;
        case kFaces:
            // En la galería, deslizar cambia de cara (se sale con la flecha de atrás)
            if (dir == LV_DIR_LEFT) ShowFace(+1);
            if (dir == LV_DIR_RIGHT) ShowFace(-1);
            break;
        default:
            if (dir == LV_DIR_RIGHT) Back();
            break;
    }
}

/* ---------- Temporizador ---------- */

int32_t ByteUi::TimerLeftMs(uint32_t now) const {
    if (!running_) {
        return left_ms_;
    }
    int32_t left = static_cast<int32_t>(end_tick_ - now);
    return left > 0 ? left : 0;
}

int ByteUi::TimerSecondsLeft() const {
    return (TimerLeftMs(lv_tick_get()) + 999) / 1000;
}

void ByteUi::StartTimer(int seconds) {
    if (seconds > 0) {
        total_s_ = seconds > 24 * 3600 ? 24 * 3600 : seconds;
        left_ms_ = total_s_ * 1000;
    }
    if (left_ms_ <= 0) {
        left_ms_ = total_s_ * 1000;
    }
    running_ = true;
    ringing_ = false;
    end_tick_ = lv_tick_get() + left_ms_;
    Show(timer_chip_, screen_ == kHome);
    RefreshTimer();
}

void ByteUi::PauseTimer() {
    left_ms_ = TimerLeftMs(lv_tick_get());
    running_ = false;
    RefreshTimer();
}

void ByteUi::StopTimer() {
    running_ = false;
    ringing_ = false;
    left_ms_ = total_s_ * 1000;
    Show(timer_chip_, false);
    RefreshTimer();
}

void ByteUi::AdjustTimer(int minutes) {
    int m = (left_ms_ + 30000) / 60000 + minutes;  // redondea a minutos y suma o resta uno
    m = m < 1 ? 1 : (m > 60 ? 60 : m);
    total_s_ = m * 60;
    left_ms_ = total_s_ * 1000;
    RefreshTimer();
}

void ByteUi::FinishTimer(uint32_t now) {
    running_ = false;
    left_ms_ = 0;
    ringing_ = true;
    ring_until_ = now + kRingMs;
    next_beep_ = now;
    if (host_.notify) host_.notify("¡Tiempo!");
    CloseQuick();
    Go(kTimer);
    Show(timer_chip_, false);
    RefreshTimer();
}

void ByteUi::StopRing() {
    ringing_ = false;
    left_ms_ = total_s_ * 1000;
    RefreshTimer();
}

/* ---------- Refrescos ---------- */

void ByteUi::RefreshTimer() {
    int32_t left = TimerLeftMs(lv_tick_get());
    int s = (left + 999) / 1000;
    char buf[16];
    if (s >= 3600) {
        snprintf(buf, sizeof(buf), "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60);
    } else {
        snprintf(buf, sizeof(buf), "%d:%02d", s / 60, s % 60);
    }
    SetText(timer_label_, buf);
    if (running_) {
        SetText(timer_chip_label_, buf);
    }

    int32_t value = total_s_ > 0 ? static_cast<int32_t>(static_cast<int64_t>(left) * 1000 / (total_s_ * 1000)) : 0;
    if (lv_arc_get_value(timer_arc_) != value) {
        lv_arc_set_value(timer_arc_, value);
    }
    lv_obj_set_style_arc_color(timer_arc_, lv_color_hex(ringing_ ? kOrange : kCyan), LV_PART_INDICATOR);

    bool idle = !running_ && !ringing_;
    for (int i = 0; i < 2; i++) {
        Show(timer_adjust_[i], idle);
        Show(timer_adjust_min_[i], idle);
    }
    Show(timer_reset_, !ringing_);
    Show(timer_main_, !ringing_);
    Show(timer_stop_, ringing_);
    SetText(timer_main_label_, running_ ? "Pausar" : "Iniciar");
}

void ByteUi::RefreshClock(bool force) {
    time_t t = time(nullptr);
    struct tm tm_now;
    localtime_r(&t, &tm_now);
    if (tm_now.tm_year < 2025 - 1900) {
        // Todavía no llegó la hora de internet
        SetText(clock_time_, "--:--");
        SetText(clock_date_, "Esperando la hora de internet");
        SetText(clock_ampm_, "");
        clock_shown_min_ = -1;
        return;
    }
    int minute = tm_now.tm_hour * 60 + tm_now.tm_min;
    if (!force && minute == clock_shown_min_) {
        return;
    }
    clock_shown_min_ = minute;
    char buf[48];
    int h12 = tm_now.tm_hour % 12 == 0 ? 12 : tm_now.tm_hour % 12;
    snprintf(buf, sizeof(buf), "%d:%02d", h12, tm_now.tm_min);
    SetText(clock_time_, buf);
    snprintf(buf, sizeof(buf), "%s, %d de %s", kWeekdays[tm_now.tm_wday], tm_now.tm_mday, kMonths[tm_now.tm_mon]);
    SetText(clock_date_, buf);
    SetText(clock_ampm_, tm_now.tm_hour < 12 ? "a. m." : "p. m.");
}

void ByteUi::RefreshSettings() {
    char buf[16];
    if (host_.get_volume) {
        snprintf(buf, sizeof(buf), "%d %%", host_.get_volume());
        SetText(settings_volume_, buf);
    }
    if (host_.get_brightness) {
        snprintf(buf, sizeof(buf), "%d %%", host_.get_brightness());
        SetText(settings_brightness_, buf);
    }
    std::string ssid = host_.wifi_name ? host_.wifi_name() : "";
    SetText(settings_wifi_, ssid.empty() ? "Sin conexión" : ssid.c_str());
}

void ByteUi::RefreshQuick() {
    char buf[8];
    if (host_.get_volume) {
        int v = host_.get_volume();
        lv_slider_set_value(qp_volume_, v, LV_ANIM_OFF);
        snprintf(buf, sizeof(buf), "%d", v);
        SetText(qp_volume_value_, buf);
    }
    if (host_.get_brightness) {
        int v = host_.get_brightness();
        lv_slider_set_value(qp_brightness_, v, LV_ANIM_OFF);
        snprintf(buf, sizeof(buf), "%d", v);
        SetText(qp_brightness_value_, buf);
    }
}

void ByteUi::Tick() {
    uint32_t now = lv_tick_get();
    if (running_ && TimerLeftMs(now) == 0) {
        FinishTimer(now);
    }
    if (ringing_) {
        if (static_cast<int32_t>(now - next_beep_) >= 0) {
            if (host_.play_alarm) host_.play_alarm();
            next_beep_ = now + kBeepEveryMs;
        }
        if (static_cast<int32_t>(now - ring_until_) >= 0) {
            StopRing();
        }
    }
    if (screen_ == kTimer || (running_ && screen_ == kHome)) {
        RefreshTimer();
    }
    if (screen_ == kClock) {
        RefreshClock(false);
        // Parpadeo de los ojitos cada 4,2 s
        int32_t eye_h = now % 4200 < 140 ? 3 : 14;
        if (lv_obj_get_height(clock_eyes_[0]) != eye_h) {
            for (auto eye : clock_eyes_) {
                lv_obj_set_height(eye, eye_h);
            }
        }
    }
    if (reboot_armed_until_ != 0 && static_cast<int32_t>(now - reboot_armed_until_) >= 0) {
        ResetRebootButton();
    }

    // Lo que quedó abierto sin tocar vuelve solo a la cara
    uint32_t quiet = now - last_touch_;
    if (!down_ && qp_open_ && quiet > kQuickCloseMs) {
        CloseQuick();
    }
    if (!down_ && quiet > kBackHomeMs &&
        (screen_ == kMenu || screen_ == kFaces || screen_ == kSettings || screen_ == kAbout)) {
        Go(kHome);
    }
}

/* ---------- Eventos de LVGL ---------- */

void ByteUi::OnClick(lv_event_t* e) {
    auto self = static_cast<ByteUi*>(lv_event_get_user_data(e));
    lv_obj_t* obj = lv_event_get_current_target_obj(e);
    auto action = static_cast<Action>(reinterpret_cast<intptr_t>(lv_obj_get_user_data(obj)));
    self->Do(action);
}

void ByteUi::OnSlider(lv_event_t* e) {
    auto self = static_cast<ByteUi*>(lv_event_get_user_data(e));
    lv_obj_t* slider = lv_event_get_target_obj(e);
    bool volume = slider == self->qp_volume_;
    int v = lv_slider_get_value(slider);
    char buf[8];
    switch (lv_event_get_code(e)) {
        case LV_EVENT_PRESSED:
            self->slider_pressed_ = true;
            break;
        case LV_EVENT_VALUE_CHANGED:
            snprintf(buf, sizeof(buf), "%d", v);
            SetText(volume ? self->qp_volume_value_ : self->qp_brightness_value_, buf);
            if (!volume && self->host_.set_brightness) {
                self->host_.set_brightness(v, false);  // se ve al instante, se guarda al soltar
            }
            break;
        case LV_EVENT_RELEASED:
        case LV_EVENT_PRESS_LOST:
            self->slider_pressed_ = false;
            if (volume && self->host_.set_volume) {
                self->host_.set_volume(v);
            } else if (!volume && self->host_.set_brightness) {
                self->host_.set_brightness(v, true);
            }
            break;
        default:
            break;
    }
}

void ByteUi::OnTick(lv_timer_t* t) {
    static_cast<ByteUi*>(lv_timer_get_user_data(t))->Tick();
}
