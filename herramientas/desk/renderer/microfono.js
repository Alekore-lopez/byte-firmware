// microfono.js — Lleva tu voz a la central de Byte, con un filtro de voz humana.
//
// La central entiende el mismo audio que manda la placa: Opus, 16 000 muestras
// por segundo, un solo canal, paquetes de 60 ms. Chromium trae un codificador
// de Opus: WebCodecs → AudioEncoder.
//
//   micrófono → filtro de voz (120–3800 Hz) → ¿es alguien hablando cerca? → Opus → central
//
// Byte Desk decide SOLO cuándo empiezas y cuándo terminas de hablar (modo
// "manual" de XiaoZhi), así no te corta a mitad de frase:
//   • Empieza: la voz tiene que sonar fuerte y seguida ~0,2 s por encima del
//     ruido de fondo. El ruido de fondo (TV, ventilador, celular lejos) se mide
//     solo y va subiendo el umbral: lo que suena lejos no lo abre.
//   • Termina: 1,6 s seguidos sin voz. Si solo hubo un ruidito corto, se descarta.
//   • Se guarda un poquito de audio de antes (0,3 s) para no comerse la primera sílaba.
//
// Mientras Byte habla, "pausar()" no manda nada: así Byte no se oye a sí mismo.

const VOZ = {
  pedazoMs: 64,            // cada cuánto medimos (1024 muestras a 16 kHz)
  arranqueMs: 192,         // voz seguida necesaria para empezar
  silencioFinMs: 1600,     // silencio para dar por terminada la frase
  vozMinimaMs: 450,        // menos que esto = ruido, se descarta
  maximoMs: 15000,         // nadie habla 15 s sin respirar: si pasa, es TV o música → se descarta
  previoMs: 320,           // audio de antes que se manda al empezar
  factorRuido: 3.2,        // la voz debe estar ~10 dB por encima del ruido de fondo
  minimo: 0.012,           // y nunca por debajo de este nivel (≈ -38 dBFS): lo lejano no entra
};

class MicrofonoDeByte {
  constructor({ alPaquete, alEmpezarFrase, alTerminarFrase, alError, opciones = {} } = {}) {
    this.alPaquete = alPaquete || (() => {});
    this.alEmpezarFrase = alEmpezarFrase || (() => {});
    this.alTerminarFrase = alTerminarFrase || (() => {});
    this.alError = alError || (() => {});
    this.cfg = { ...VOZ, ...opciones };
    this.flujo = null;
    this.ctx = null;
    this.nodo = null;
    this.encoder = null;
    this.marca = 0;
    this.pausado = false;
    this.enviando = false;   // ¿los paquetes que salen del codificador van a la central?
    this._reiniciarFrase();
    this.ruido = 0;          // nivel del ruido de fondo (se aprende solo)
    this.disponible = typeof AudioEncoder !== 'undefined' && Boolean(navigator.mediaDevices);
  }

  get activo() { return Boolean(this.flujo); }

  _reiniciarFrase() {
    this.hablando = false;   // ¿estamos mandando una frase?
    this.seguidosMs = 0;     // voz seguida antes de arrancar
    this.silencioMs = 0;
    this.vozMs = 0;          // voz total dentro de la frase
    this.fraseMs = 0;
    this.previo = [];        // pedazos guardados de antes de arrancar
  }

  async empezar() {
    if (!this.disponible) { this.alError('Este computador no puede codificar la voz (falta Opus).'); return false; }
    if (this.flujo) { this.reanudar(); return true; }
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({
        // Sin ganancia automática: así lo que está lejos (TV, celular) suena bajito y no abre el filtro.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: false },
      });
    } catch (e) {
      this.flujo = null;
      this.alError('No tengo permiso para el micrófono. Actívalo en Configuración del Sistema → Privacidad y seguridad → Micrófono.');
      return false;
    }
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.encoder = new AudioEncoder({
      output: (chunk) => {
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        if (this.enviando) this.alPaquete(bytes);
      },
      error: (e) => this.alError(`Error del micrófono: ${e.message}`),
    });
    this.encoder.configure({
      codec: 'opus', sampleRate: 16000, numberOfChannels: 1, bitrate: 24000,
      opus: { frameDuration: 60000, application: 'voip' },
    });

    // Filtro de voz humana: quita retumbos graves (aire, golpes, bajos de la TV)
    // y siseos agudos (música, platillos). La voz vive entre ~120 y ~3800 Hz.
    const fuente = this.ctx.createMediaStreamSource(this.flujo);
    const graves = this.ctx.createBiquadFilter();
    graves.type = 'highpass'; graves.frequency.value = 120; graves.Q.value = 0.7;
    const agudos = this.ctx.createBiquadFilter();
    agudos.type = 'lowpass'; agudos.frequency.value = 3800; agudos.Q.value = 0.7;
    this.nodo = this.ctx.createScriptProcessor(1024, 1, 1);
    this.nodo.onaudioprocess = (ev) => this._pedazo(new Float32Array(ev.inputBuffer.getChannelData(0)));
    fuente.connect(graves).connect(agudos).connect(this.nodo);
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    this.nodo.connect(mudo).connect(this.ctx.destination);
    this.pausado = false;
    this._reiniciarFrase();
    return true;
  }

  /** ¿Este pedazo parece voz de alguien cerca? (nivel + ritmo de voz) */
  _esVoz(datos) {
    let suma = 0; let cruces = 0;
    for (let i = 0; i < datos.length; i++) {
      suma += datos[i] * datos[i];
      if (i && (datos[i] >= 0) !== (datos[i - 1] >= 0)) cruces++;
    }
    const nivel = Math.sqrt(suma / datos.length);
    const zcr = cruces / datos.length;   // la voz cruza el cero ni muy poco (zumbido) ni demasiado (siseo)
    if (!this.ruido) this.ruido = nivel || 0.002;
    const umbral = Math.max(this.ruido * this.cfg.factorRuido, this.cfg.minimo);
    const voz = nivel > umbral && zcr > 0.01 && zcr < 0.32;
    // El ruido de fondo se aprende: baja rápido cuando hay silencio y sube despacio
    // si hay un sonido parejo y constante (TV, ventilador).
    if (!voz) this.ruido = this.ruido * 0.9 + nivel * 0.1;
    else if (!this.hablando) this.ruido = this.ruido * 0.995 + nivel * 0.005;
    this.ruido = Math.min(Math.max(this.ruido, 0.0005), 0.2);
    return voz;
  }

  _codificar(datos) {
    if (!this.encoder || this.encoder.state !== 'configured') return;
    const audio = new AudioData({
      format: 'f32-planar', sampleRate: this.ctx.sampleRate, numberOfChannels: 1,
      numberOfFrames: datos.length, timestamp: this.marca, data: datos,
    });
    this.marca += Math.round((datos.length / this.ctx.sampleRate) * 1e6);
    this.encoder.encode(audio);
    audio.close();
  }

  _pedazo(datos) {
    if (this.pausado) return;
    const ms = (datos.length / this.ctx.sampleRate) * 1000;
    const voz = this._esVoz(datos);

    if (!this.hablando) {
      this.previo.push(datos);
      while (this.previo.length * ms > this.cfg.previoMs) this.previo.shift();
      this.seguidosMs = voz ? this.seguidosMs + ms : 0;
      if (this.seguidosMs < this.cfg.arranqueMs) return;
      // ¡Alguien está hablando cerca! Empieza la frase con lo de antes incluido.
      this.hablando = true;
      this.enviando = true;
      this.vozMs = this.seguidosMs; this.fraseMs = 0; this.silencioMs = 0;
      this.alEmpezarFrase();
      this.previo.splice(0).forEach((p) => this._codificar(p));
      return;
    }

    this._codificar(datos);
    this.fraseMs += ms;
    this.ultimoNivel = Math.sqrt(datos.reduce((a, x) => a + x * x, 0) / datos.length);
    if (voz) { this.vozMs += ms; this.silencioMs = 0; } else { this.silencioMs += ms; }
    if (this.silencioMs >= this.cfg.silencioFinMs || this.fraseMs >= this.cfg.maximoMs) {
      const muyLarga = this.fraseMs >= this.cfg.maximoMs;
      const valida = this.vozMs >= this.cfg.vozMinimaMs && !muyLarga;
      // Sonido parejo y sin pausas (TV, música): lo aprendemos como ruido de fondo.
      if (muyLarga) this.ruido = Math.min(Math.max(this.ruido, this.ultimoNivel || 0), 0.2);
      // Dejamos salir los últimos paquetes del codificador antes de avisar.
      const fin = () => { this.enviando = false; this.alTerminarFrase(valida); };
      if (this.encoder && this.encoder.state === 'configured') this.encoder.flush().then(fin, fin); else fin();
      this.hablando = false;
      this.pausado = true;   // hasta que Byte conteste y main diga "reanudar"
      this._reiniciarFrase();
    }
  }

  pausar() { this.pausado = true; this.enviando = false; this._reiniciarFrase(); }
  reanudar() { if (this.flujo) { this._reiniciarFrase(); this.pausado = false; } }

  detener() {
    this.pausado = true;
    this.enviando = false;
    this._reiniciarFrase();
    if (this.nodo) { this.nodo.onaudioprocess = null; try { this.nodo.disconnect(); } catch { /* ya */ } }
    if (this.flujo) this.flujo.getTracks().forEach((t) => t.stop());
    if (this.encoder && this.encoder.state !== 'closed') { try { this.encoder.close(); } catch { /* ya */ } }
    if (this.ctx) this.ctx.close().catch(() => {});
    this.flujo = null; this.nodo = null; this.encoder = null; this.ctx = null; this.marca = 0;
  }
}

if (typeof module !== 'undefined') module.exports = { MicrofonoDeByte, VOZ };
