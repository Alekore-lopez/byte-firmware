// audio.js — La voz de Byte y tu micrófono, en el iPhone.
//
// El iPhone no siempre trae Opus (el formato de la central), así que el puente
// del HP traduce: aquí solo manejamos audio "crudo" (PCM de 16 bits).
//   • VozPcm:   recibe pedazos de la voz de Byte y los pone en fila para que no se corten.
//   • MicroPcm: graba tu voz, la baja a 16 000 muestras por segundo y la manda.
//
// Ojo con el iPhone:
//   • El audio solo puede arrancar después de que TOQUES algo (regla de Apple).
//   • El interruptor de silencio apaga los sonidos web; por eso pedimos a iOS
//     tratar la voz de Byte como "reproducción" (navigator.audioSession).

class VozPcm {
  constructor() {
    this.ctx = null;
    this.hz = 24000;
    this.siguiente = 0;
    this.fuentes = new Set();
  }

  /** Llamar dentro de un toque del usuario (iOS lo exige). */
  desbloquear() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* iOS viejo */ }
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      // Un "clic" mudo despierta el audio en iOS.
      const b = this.ctx.createBuffer(1, 1, 22050);
      const f = this.ctx.createBufferSource();
      f.buffer = b; f.connect(this.ctx.destination); f.start(0);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  get sonando() { return this.fuentes.size > 0 || Boolean(this.ctx && this.siguiente > this.ctx.currentTime); }

  /** Un pedazo de voz: PCM de 16 bits, un canal, a this.hz. */
  pedazo(buffer) {
    if (!this.ctx) return;   // aún no tocaste la pantalla: no se puede sonar
    const muestras = new Int16Array(buffer);
    if (!muestras.length) return;
    const audio = this.ctx.createBuffer(1, muestras.length, this.hz);
    const canal = audio.getChannelData(0);
    for (let i = 0; i < muestras.length; i++) canal[i] = muestras[i] / 32768;
    const f = this.ctx.createBufferSource();
    f.buffer = audio;
    f.connect(this.ctx.destination);
    const ahora = this.ctx.currentTime;
    if (this.siguiente < ahora) this.siguiente = ahora + 0.1;   // colchón para la red del celular
    f.start(this.siguiente);
    this.siguiente += audio.duration;
    this.fuentes.add(f);
    f.onended = () => this.fuentes.delete(f);
  }

  callar() {
    this.fuentes.forEach((f) => { try { f.stop(); } catch { /* ya */ } });
    this.fuentes.clear();
    this.siguiente = 0;
  }
}

/**
 * Micrófono de "toca y habla": tocas, hablas, y cuando haces silencio
 * 1,4 s (o vuelves a tocar) se termina la frase.
 */
class MicroPcm {
  constructor({ alPedazo, alTerminar, alNivel, alError } = {}) {
    this.alPedazo = alPedazo || (() => {});
    this.alTerminar = alTerminar || (() => {});
    this.alNivel = alNivel || (() => {});
    this.alError = alError || (() => {});
    this.flujo = null; this.ctx = null; this.nodo = null;
    this.activo = false;
  }

  static disponible() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext);
  }

  async empezar() {
    if (!MicroPcm.disponible()) { this.alError('El micrófono necesita abrir Byte con https:// (por Tailscale).'); return false; }
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.alError('No tengo permiso para el micrófono. En el iPhone: Ajustes → Safari → Micrófono → Permitir.');
      return false;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    const fuente = this.ctx.createMediaStreamSource(this.flujo);
    this.nodo = this.ctx.createScriptProcessor(4096, 1, 1);
    this.ratio = this.ctx.sampleRate / 16000;
    this.pos = 0;              // posición fraccional para bajar la frecuencia
    this.voz = false; this.silencioMs = 0; this.totalMs = 0; this.ruido = 0;
    this.nodo.onaudioprocess = (ev) => this._pedazo(ev.inputBuffer.getChannelData(0));
    fuente.connect(this.nodo);
    const mudo = this.ctx.createGain(); mudo.gain.value = 0;
    this.nodo.connect(mudo).connect(this.ctx.destination);
    this.activo = true;
    return true;
  }

  /** Baja de 44,1/48 kHz a 16 kHz (promediando) y convierte a 16 bits. */
  _aPcm16(datos) {
    const salida = [];
    let p = this.pos;
    while (p < datos.length) {
      const a = Math.floor(p); const b = Math.min(Math.floor(p + this.ratio), datos.length);
      let s = 0; for (let i = a; i < Math.max(b, a + 1); i++) s += datos[i];
      const v = s / Math.max(b - a, 1);
      salida.push(Math.max(-1, Math.min(1, v)) * 32767);
      p += this.ratio;
    }
    this.pos = p - datos.length;
    return Int16Array.from(salida);
  }

  _pedazo(datos) {
    if (!this.activo) return;
    let suma = 0; for (let i = 0; i < datos.length; i++) suma += datos[i] * datos[i];
    const nivel = Math.sqrt(suma / datos.length);
    this.alNivel(Math.min(1, nivel * 8));
    const ms = (datos.length / this.ctx.sampleRate) * 1000;
    this.totalMs += ms;
    // Los primeros 300 ms aprenden el ruido de fondo.
    if (this.totalMs < 300) this.ruido = Math.max(this.ruido, nivel);
    const umbral = Math.max(this.ruido * 2.5, 0.015);
    if (nivel > umbral) { this.voz = true; this.silencioMs = 0; } else if (this.voz) { this.silencioMs += ms; }

    this.alPedazo(this._aPcm16(datos).buffer);
    // Fin: 1,4 s de silencio después de hablar, 6 s sin decir nada, o 20 s en total.
    if ((this.voz && this.silencioMs >= 1400) || (!this.voz && this.totalMs > 6000) || this.totalMs > 20000) {
      this.terminar(this.voz);
    }
  }

  /** Termina la frase. `valida` = hubo voz de verdad. */
  terminar(valida = true) {
    if (!this.activo) return;
    this.activo = false;
    if (this.nodo) { this.nodo.onaudioprocess = null; try { this.nodo.disconnect(); } catch { /* ya */ } }
    // Soltamos el micrófono: así iOS vuelve a sonar por el parlante grande (y no por el auricular).
    if (this.flujo) this.flujo.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.flujo = null; this.nodo = null; this.ctx = null;
    this.alNivel(0);
    this.alTerminar(valida);
  }
}

if (typeof module !== 'undefined') module.exports = { VozPcm, MicroPcm };
