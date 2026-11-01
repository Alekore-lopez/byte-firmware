// voz.js — Reproduce la voz de Byte que manda la central.
//
// La central manda la voz en paquetes Opus de 60 ms (24 000 muestras por segundo).
// Chromium (el motor de Electron) trae un decodificador de Opus listo:
// WebCodecs → AudioDecoder. Lo usamos para convertir cada paquete en sonido
// y los ponemos en fila con la Web Audio API para que no se corten.

class VozDeByte {
  constructor({ frecuencia = 24000 } = {}) {
    this.frecuencia = frecuencia;
    this.ctx = null;
    this.decoder = null;
    this.siguiente = 0;      // en qué segundo del reloj de audio suena el próximo pedazo
    this.marca = 0;          // tiempo (µs) de cada paquete para el decodificador
    this.fuentes = new Set();
    this.disponible = typeof AudioDecoder !== 'undefined';
  }

  _preparar() {
    if (!this.disponible) return false;
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this.decoder || this.decoder.state === 'closed') {
      this.decoder = new AudioDecoder({
        output: (datos) => this._sonar(datos),
        error: (e) => { console.warn('Voz: error al decodificar', e); this.decoder = null; },
      });
      this.decoder.configure({ codec: 'opus', sampleRate: this.frecuencia, numberOfChannels: 1 });
    }
    return true;
  }

  /** Recibe un paquete Opus (Uint8Array) de la central. */
  paquete(bytes) {
    if (!bytes || !bytes.byteLength || !this._preparar()) return;
    try {
      this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp: this.marca, data: bytes }));
      this.marca += 60000;
    } catch (e) {
      console.warn('Voz: paquete descartado', e);
    }
  }

  _sonar(datos) {
    const n = datos.numberOfFrames;
    const buffer = this.ctx.createBuffer(1, n, datos.sampleRate);
    const canal = new Float32Array(n);
    datos.copyTo(canal, { planeIndex: 0, format: 'f32-planar' });
    datos.close();
    buffer.copyToChannel(canal, 0);

    const fuente = this.ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(this.ctx.destination);
    const ahora = this.ctx.currentTime;
    // Si se vació la fila, dejamos 80 ms de colchón para que no tartamudee.
    if (this.siguiente < ahora) this.siguiente = ahora + 0.08;
    fuente.start(this.siguiente);
    this.siguiente += buffer.duration;
    this.fuentes.add(fuente);
    fuente.onended = () => this.fuentes.delete(fuente);
  }

  /** Calla a Byte de inmediato (botón Detener o voz desactivada). */
  callar() {
    this.fuentes.forEach((f) => { try { f.stop(); } catch { /* ya terminó */ } });
    this.fuentes.clear();
    this.siguiente = 0;
    if (this.decoder && this.decoder.state === 'configured') {
      try { this.decoder.reset(); this.decoder.configure({ codec: 'opus', sampleRate: this.frecuencia, numberOfChannels: 1 }); } catch { this.decoder = null; }
    }
  }
}
