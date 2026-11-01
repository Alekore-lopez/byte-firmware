// microfono.js — Lleva tu voz a la central de Byte.
//
// La central entiende el mismo audio que manda la placa: Opus, 16 000 muestras
// por segundo, un solo canal, paquetes de 60 ms. Chromium (el motor de Electron)
// trae un codificador de Opus: WebCodecs → AudioEncoder.
//
//   micrófono → AudioContext a 16 kHz → pedazos de sonido → AudioEncoder (Opus) → central
//
// Mientras Byte habla, "pausar()" deja de mandar audio: así Byte no se oye a sí mismo.

class MicrofonoDeByte {
  constructor({ alPaquete, alError } = {}) {
    this.alPaquete = alPaquete || (() => {});
    this.alError = alError || (() => {});
    this.flujo = null;
    this.ctx = null;
    this.nodo = null;
    this.encoder = null;
    this.marca = 0;          // tiempo (µs) de cada pedazo para el codificador
    this.pausado = false;
    this.disponible = typeof AudioEncoder !== 'undefined' && Boolean(navigator.mediaDevices);
  }

  get activo() { return Boolean(this.flujo); }

  async empezar() {
    if (!this.disponible) { this.alError('Este computador no puede codificar la voz (falta Opus).'); return false; }
    if (this.flujo) { this.pausado = false; return true; }
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      this.flujo = null;
      this.alError('No tengo permiso para el micrófono. Actívalo en Configuración del Sistema → Privacidad y seguridad → Micrófono.');
      return false;
    }
    this.ctx = new AudioContext({ sampleRate: 16000 });
    this.encoder = new AudioEncoder({
      output: (chunk) => {
        if (this.pausado) return;
        const bytes = new Uint8Array(chunk.byteLength);
        chunk.copyTo(bytes);
        this.alPaquete(bytes);
      },
      error: (e) => this.alError(`Error del micrófono: ${e.message}`),
    });
    this.encoder.configure({
      codec: 'opus',
      sampleRate: 16000,
      numberOfChannels: 1,
      bitrate: 24000,
      opus: { frameDuration: 60000, application: 'voip' },
    });
    const fuente = this.ctx.createMediaStreamSource(this.flujo);
    // ScriptProcessor es viejo pero sencillo y no necesita archivos extra.
    this.nodo = this.ctx.createScriptProcessor(2048, 1, 1);
    this.nodo.onaudioprocess = (ev) => {
      if (this.pausado || !this.encoder || this.encoder.state !== 'configured') return;
      const datos = new Float32Array(ev.inputBuffer.getChannelData(0));
      const audio = new AudioData({
        format: 'f32-planar', sampleRate: this.ctx.sampleRate, numberOfChannels: 1,
        numberOfFrames: datos.length, timestamp: this.marca, data: datos,
      });
      this.marca += Math.round((datos.length / this.ctx.sampleRate) * 1e6);
      this.encoder.encode(audio);
      audio.close();
    };
    fuente.connect(this.nodo);
    // El nodo tiene que ir a algún lado para que el navegador lo ejecute (sale en silencio).
    const mudo = this.ctx.createGain();
    mudo.gain.value = 0;
    this.nodo.connect(mudo).connect(this.ctx.destination);
    this.pausado = false;
    return true;
  }

  pausar() { this.pausado = true; }
  reanudar() { if (this.flujo) this.pausado = false; }

  detener() {
    this.pausado = true;
    if (this.nodo) { this.nodo.onaudioprocess = null; try { this.nodo.disconnect(); } catch { /* ya */ } }
    if (this.flujo) this.flujo.getTracks().forEach((t) => t.stop());
    if (this.encoder && this.encoder.state !== 'closed') { try { this.encoder.close(); } catch { /* ya */ } }
    if (this.ctx) this.ctx.close().catch(() => {});
    this.flujo = null; this.nodo = null; this.encoder = null; this.ctx = null; this.marca = 0;
  }
}
