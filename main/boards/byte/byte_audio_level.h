#pragma once

// Medidor de volumen para las ondas de voz y el halo de la pantalla.
// El codec de audio anota qué tan fuerte suena cada pedacito de audio que
// pasa (lo que oye el micrófono y lo que dice Byte) y la pantalla lo lee
// unas 30 veces por segundo. No guarda audio: solo un número de 0 a 255.

#include <atomic>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <esp_timer.h>

class ByteAudioLevel {
public:
    static ByteAudioLevel& Mic() {
        static ByteAudioLevel mic(-52, -16);  // el micrófono llega más bajito
        return mic;
    }
    static ByteAudioLevel& Speaker() {
        static ByteAudioLevel speaker(-42, -6);
        return speaker;
    }

    // Lo llama el codec con cada bloque de audio. channels > 1: solo mira el primero.
    void Feed(const int16_t* data, size_t samples, int channels) {
        int peak = 0;
        size_t step = channels > 0 ? channels : 1;
        for (size_t i = 0; i < samples; i += step) {
            int v = std::abs((int)data[i]);
            if (v > peak) {
                peak = v;
            }
        }
        // En decibeles, como el oído: así la voz bajita también se ve
        float db = peak > 0 ? 20 * log10f(peak / 32768.0f) : -96;
        float k = (db - floor_db_) / (top_db_ - floor_db_);
        k = k < 0 ? 0 : (k > 1 ? 1 : k);
        level_.store((uint8_t)(k * 255), std::memory_order_relaxed);
        stamp_ms_.store(NowMs(), std::memory_order_relaxed);
    }

    // 0..1. Si hace rato que no llega audio, es silencio.
    float Level() const {
        if (NowMs() - stamp_ms_.load(std::memory_order_relaxed) > 150) {
            return 0;
        }
        return level_.load(std::memory_order_relaxed) / 255.0f;
    }

private:
    ByteAudioLevel(float floor_db, float top_db) : floor_db_(floor_db), top_db_(top_db) {}
    static uint32_t NowMs() { return (uint32_t)(esp_timer_get_time() / 1000); }

    const float floor_db_, top_db_;  // de aquí (silencio) a aquí (muy fuerte)
    std::atomic<uint8_t> level_{0};
    std::atomic<uint32_t> stamp_ms_{0};
};
