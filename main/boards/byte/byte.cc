#include <esp_lcd_panel_vendor.h>
#include <esp_lcd_panel_io.h>
#include <esp_lcd_panel_ops.h>

#include <wifi_station.h>
#include "wifi_board.h"
#include "codecs/es8311_audio_codec.h"
#include "byte_face_display.h"
#include "application.h"
#include "button.h"
#include "config.h"
#include "mcp_server.h"
#include "adc_battery_monitor.h"
#include "byte_hw_check.h"
#include "byte_audio_level.h"

#include <esp_log.h>
#include <driver/i2c_master.h>
#include <driver/spi_common.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>
#include <esp_timer.h>
#include <utility>

#include "led/single_led.h"
#include "system_reset.h"
#include "esp_lcd_ili9341.h"

#define TAG "Byte"

// El mismo codec de la placa, pero anotando qué tan fuerte suena el audio
// que entra (micrófono) y el que sale (la voz de Byte) para las ondas y el halo.
class ByteAudioCodec : public Es8311AudioCodec {
public:
    using Es8311AudioCodec::Es8311AudioCodec;

    void OutputData(std::vector<int16_t>& data) override {
        ByteAudioLevel::Speaker().Feed(data.data(), data.size(), output_channels());
        Es8311AudioCodec::OutputData(data);
    }

    bool InputData(std::vector<int16_t>& data) override {
        bool ok = Es8311AudioCodec::InputData(data);
        if (ok) {
            ByteAudioLevel::Mic().Feed(data.data(), data.size(), input_channels());
        }
        return ok;
    }
};

class TouchDriver {
public:
    TouchDriver() : dev_(nullptr) {}

    bool Init(i2c_master_bus_handle_t bus, uint8_t addr) {
        i2c_device_config_t cfg = {
            .device_address = addr,
            .scl_speed_hz = 400000,
            .scl_wait_us = 0,
        };
        return i2c_master_bus_add_device(bus, &cfg, &dev_) == ESP_OK;
    }

    bool Read(bool &touched, uint16_t &x, uint16_t &y) {
        touched = false;
        x = y = 0;
        if (!dev_) return false;

        uint8_t reg = 0x02;
        uint8_t buf[5];
        if (i2c_master_transmit_receive(dev_, &reg, 1, buf, 5, 50) != ESP_OK) return false;

        uint8_t points = buf[0] & 0x0F;
        if (points == 0) return true;

        touched = true;
        x = ((buf[1] & 0x0F) << 8) | buf[2];
        y = ((buf[3] & 0x0F) << 8) | buf[4];
        return true;
    }

private:
    i2c_master_dev_handle_t dev_;
};

class ByteBoard : public WifiBoard {
private:
    Button boot_button_;
    ByteFaceDisplay *display_;
    i2c_master_bus_handle_t codec_i2c_bus_;
    TouchDriver touch_;
    bool touch_down_ = false;
    AdcBatteryMonitor* adc_battery_monitor_;
    esp_timer_handle_t hw_check_timer_ = nullptr;

    void InitializeBatteryMonitor() {
        adc_battery_monitor_ = new AdcBatteryMonitor(ADC_UNIT_1, ADC_CHANNEL_8, 200000, 200000, GPIO_NUM_NC);
    }

    void InitializeTouch() {
        if (!touch_.Init(codec_i2c_bus_, 0x38)) return;
        display_->AttachTouch(
            [this](int& x, int& y) {
                bool touched;
                uint16_t tx, ty;
                if (!touch_.Read(touched, tx, ty) || !touched) {
                    touch_down_ = false;
                    return false;
                }
                // El táctil cuenta en vertical (240x320) y la pantalla está acostada
                if (TOUCH_SWAP_XY) {
                    std::swap(tx, ty);
                }
                x = TOUCH_MIRROR_X ? DISPLAY_WIDTH - 1 - tx : tx;
                y = TOUCH_MIRROR_Y ? DISPLAY_HEIGHT - 1 - ty : ty;
                if (!touch_down_) {
                    // Para revisar la orientación: tocar las esquinas y mirar el monitor
                    ESP_LOGI(TAG, "Toque en x=%d y=%d", x, y);
                    touch_down_ = true;
                }
                return true;
            },
            // 3 s sobre la cara: modo de configuración Wi-Fi
            [this]() {
                Application::GetInstance().Schedule([this]() { EnterWifiConfigMode(); });
            });
    }

    void InitializeI2c() {
        i2c_master_bus_config_t i2c_bus_cfg = {
            .i2c_port = AUDIO_CODEC_I2C_NUM,
            .sda_io_num = AUDIO_CODEC_I2C_SDA_PIN,
            .scl_io_num = AUDIO_CODEC_I2C_SCL_PIN,
            .clk_source = I2C_CLK_SRC_DEFAULT,
            .glitch_ignore_cnt = 7,
            .intr_priority = 0,
            .trans_queue_depth = 0,
            .flags = {
                .enable_internal_pullup = 1,
            },
        };
        ESP_ERROR_CHECK(i2c_new_master_bus(&i2c_bus_cfg, &codec_i2c_bus_));
    }

    void InitializeSpi() {
        spi_bus_config_t buscfg = {};
        buscfg.mosi_io_num = DISPLAY_MOSI_PIN;
        buscfg.miso_io_num = DISPLAY_MIS0_PIN;
        buscfg.sclk_io_num = DISPLAY_SCK_PIN;
        buscfg.quadwp_io_num = GPIO_NUM_NC;
        buscfg.quadhd_io_num = GPIO_NUM_NC;
        buscfg.max_transfer_sz = DISPLAY_WIDTH * DISPLAY_HEIGHT * sizeof(uint16_t);
        ESP_ERROR_CHECK(spi_bus_initialize(LCD_SPI_HOST, &buscfg, SPI_DMA_CH_AUTO));
    }

    void InitializeButtons() {
        boot_button_.OnClick([this]() {
            auto &app = Application::GetInstance();
            if (app.GetDeviceState() == kDeviceStateStarting) {
                EnterWifiConfigMode();
            }
            app.ToggleChatState();
        });
    }

    void InitializeLcdDisplay() {
        esp_lcd_panel_io_handle_t panel_io = nullptr;
        esp_lcd_panel_handle_t panel = nullptr;
        // 液晶屏控制IO初始化
        ESP_LOGD(TAG, "Install panel IO");
        esp_lcd_panel_io_spi_config_t io_config = {};
        io_config.cs_gpio_num = DISPLAY_CS_PIN;
        io_config.dc_gpio_num = DISPLAY_DC_PIN;
        io_config.spi_mode = DISPLAY_SPI_MODE;
        io_config.pclk_hz = DISPLAY_SPI_SCLK_HZ;
        io_config.trans_queue_depth = 10;
        io_config.lcd_cmd_bits = 8;
        io_config.lcd_param_bits = 8;
        ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(LCD_SPI_HOST, &io_config, &panel_io));

        // 初始化液晶屏驱动芯片
        ESP_LOGD(TAG, "Install LCD driver");
        esp_lcd_panel_dev_config_t panel_config = {};
        panel_config.reset_gpio_num = DISPLAY_RST_PIN;
        panel_config.rgb_ele_order = DISPLAY_RGB_ORDER;
        panel_config.bits_per_pixel = 16;
        ESP_ERROR_CHECK(esp_lcd_new_panel_ili9341(panel_io, &panel_config, &panel));
        ESP_LOGI(TAG, "Install LCD driver ILI9341");
        esp_lcd_panel_reset(panel);

        esp_lcd_panel_init(panel);
        esp_lcd_panel_invert_color(panel, DISPLAY_INVERT_COLOR);
        esp_lcd_panel_swap_xy(panel, DISPLAY_SWAP_XY);
        esp_lcd_panel_mirror(panel, DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y);
        display_ = new ByteFaceDisplay(panel_io, panel,
            DISPLAY_WIDTH, DISPLAY_HEIGHT,
            DISPLAY_OFFSET_X, DISPLAY_OFFSET_Y,
            DISPLAY_MIRROR_X, DISPLAY_MIRROR_Y, DISPLAY_SWAP_XY);
    }

    void InitializeTools() {
        // "Byte, revisa tu hardware": la IA llama a esta herramienta y lee el resultado
        auto& mcp_server = McpServer::GetInstance();
        mcp_server.AddTool("self.byte.hardware_test",
            "Run Byte's hardware self-test and return which parts respond: audio codec "
            "(microphone and speaker), touch controller, PSRAM, flash and battery. Use it when "
            "the user asks to check, test or diagnose the device hardware.",
            PropertyList(),
            [this](const PropertyList& properties) -> ReturnValue {
                auto result = ByteHwCheck::Run(codec_i2c_bus_, adc_battery_monitor_);
                result.Log();
                return result.ToJson();
            });

        // "Byte, pon un temporizador de 5 minutos": el mismo de la pantalla
        mcp_server.AddTool("self.byte.timer.start",
            "Start Byte's countdown timer, shown on the screen with an alarm when it ends. "
            "Convert minutes or hours to seconds. Starting it again replaces the current timer.",
            PropertyList({Property("seconds", kPropertyTypeInteger, 1, 24 * 3600)}),
            [this](const PropertyList& properties) -> ReturnValue {
                display_->StartTimer(properties["seconds"].value<int>());
                return true;
            });
        mcp_server.AddTool("self.byte.timer.stop",
            "Stop and reset Byte's countdown timer.",
            PropertyList(),
            [this](const PropertyList& properties) -> ReturnValue {
                display_->StopTimer();
                return true;
            });
        mcp_server.AddTool("self.byte.timer.get",
            "Get how many seconds are left on Byte's countdown timer (0 if it is not running).",
            PropertyList(),
            [this](const PropertyList& properties) -> ReturnValue {
                return display_->TimerSecondsLeft();
            });
    }

    // Autoprueba al encender: unos segundos después del arranque, cuando la
    // pantalla ya está lista. Solo avisa en pantalla si algo falla.
    void ScheduleBootHardwareCheck() {
        esp_timer_create_args_t args = {
            .callback = [](void* arg) {
                // El temporizador solo agenda la prueba; corre en la tarea principal,
                // que tiene más memoria de pila que la del temporizador
                auto* self = static_cast<ByteBoard*>(arg);
                Application::GetInstance().Schedule([self]() {
                    auto result = ByteHwCheck::Run(self->codec_i2c_bus_, self->adc_battery_monitor_);
                    result.Log();
                    if (!result.all_ok()) {
                        self->display_->ShowNotification(result.FailureSummary(), 10000);
                    }
                });
            },
            .arg = this,
            .dispatch_method = ESP_TIMER_TASK,
            .name = "byte_hw_check",
            .skip_unhandled_events = true,
        };
        ESP_ERROR_CHECK(esp_timer_create(&args, &hw_check_timer_));
        ESP_ERROR_CHECK(esp_timer_start_once(hw_check_timer_, 3 * 1000 * 1000));
    }

public:
    ByteBoard(): boot_button_(BOOT_BUTTON_GPIO)
    {
        InitializeI2c();
        InitializeBatteryMonitor();
        InitializeSpi();
        InitializeLcdDisplay();
        InitializeTouch();
        InitializeButtons();
        InitializeTools();
        ScheduleBootHardwareCheck();
        GetBacklight()->RestoreBrightness();  // el brillo que se eligió en la pantalla
    }

    virtual Led *GetLed() override {
        static SingleLed led(BUILTIN_LED_GPIO);
        return &led;
    }

    virtual AudioCodec* GetAudioCodec() override {
        static ByteAudioCodec audio_codec(codec_i2c_bus_, AUDIO_CODEC_I2C_NUM,
            AUDIO_INPUT_SAMPLE_RATE, AUDIO_OUTPUT_SAMPLE_RATE, AUDIO_I2S_GPIO_MCLK, AUDIO_I2S_GPIO_BCLK,
            AUDIO_I2S_GPIO_WS, AUDIO_I2S_GPIO_DOUT, AUDIO_I2S_GPIO_DIN, AUDIO_CODEC_PA_PIN,
            AUDIO_CODEC_ES8311_ADDR, true, true);
        return &audio_codec;
    }

    virtual Display *GetDisplay() override { return display_; }

    virtual Backlight *GetBacklight() override {
        static PwmBacklight backlight(DISPLAY_BACKLIGHT_PIN, DISPLAY_BACKLIGHT_OUTPUT_INVERT);
        return &backlight;
    }

    virtual bool GetBatteryLevel(int &level, bool& charging, bool& discharging) override {
        charging = adc_battery_monitor_->IsCharging();
        discharging = adc_battery_monitor_->IsDischarging();
        level = adc_battery_monitor_->GetBatteryLevel();
        return true;
    }
};

DECLARE_BOARD(ByteBoard);
