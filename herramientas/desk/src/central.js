// central.js — El "teléfono" entre Byte Desk y la central de Byte (Docker).
//
// La central habla el protocolo de XiaoZhi por WebSocket:
//   1. Nos conectamos a ws://IP:8000/xiaozhi/v1/ diciendo quiénes somos (device-id).
//   2. Mandamos un saludo {"type":"hello"} y la central responde con otro hello.
//   3. Para preguntar por texto mandamos {"type":"listen","state":"detect","text":"..."}.
//   4. La central responde con mensajes JSON (estado, emoción, frases) y con
//      paquetes binarios de audio Opus (la voz de Byte).
//
// Esta clase NO sabe nada de ventanas: solo emite eventos. main.js los reenvía
// a la interfaz. Así se puede probar sola (ver test/central.test.js).

const { EventEmitter } = require('node:events');
const WebSocket = require('ws');

const ESPERA_HELLO_MS = 8000;      // si la central no saluda en 8 s, algo anda mal
const REINTENTO_MIN_MS = 1500;     // primer reintento
const REINTENTO_MAX_MS = 30000;    // nunca esperar más de 30 s entre intentos

class Central extends EventEmitter {
  /**
   * @param {object} opciones
   * @param {string} opciones.url       ws://IP:8000/xiaozhi/v1/
   * @param {string} opciones.deviceId  identificador fijo de este computador
   * @param {string} opciones.clientId  identificador de esta instalación
   * @param {string} [opciones.token]   solo si la central tiene auth activada
   */
  constructor({ url, deviceId, clientId, token = '' }) {
    super();
    this.url = url;
    this.deviceId = deviceId;
    this.clientId = clientId;
    this.token = token;
    this.ws = null;
    this.estado = 'desconectado';   // desconectado | conectando | en-linea
    this.sessionId = null;
    this.pendientes = [];           // textos escritos mientras se conectaba
    this.reintento = REINTENTO_MIN_MS;
    this.temporizador = null;
    this.apagada = false;           // true cuando la app se cierra a propósito
  }

  /** Cambia el estado y avisa a quien escuche. */
  _estado(estado, detalle = '') {
    this.estado = estado;
    this.emit('estado', { estado, detalle });
  }

  conectar() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(this.temporizador);
    this.apagada = false;
    this._estado('conectando', this.url);

    let ws;
    try {
      ws = new WebSocket(this.url, {
        headers: {
          'Device-Id': this.deviceId,
          'Client-Id': this.clientId,
          'Protocol-Version': '1',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        handshakeTimeout: ESPERA_HELLO_MS,
      });
    } catch (e) {
      // URL mal escrita, por ejemplo "192.168..." sin ws://
      this._estado('desconectado', `Dirección no válida: ${e.message}`);
      return;
    }
    this.ws = ws;

    const sinHello = setTimeout(() => {
      if (this.estado !== 'en-linea') ws.terminate();
    }, ESPERA_HELLO_MS);

    ws.on('open', () => {
      // Le decimos a la central cómo es nuestro audio. Por ahora solo
      // escuchamos su voz; el micrófono llega en la fase 2.
      ws.send(JSON.stringify({
        type: 'hello',
        version: 1,
        transport: 'websocket',
        audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 },
      }));
    });

    ws.on('message', (datos, esBinario) => {
      if (esBinario) {
        // Un paquete de voz de Byte (Opus, 60 ms). La interfaz lo reproduce.
        this.emit('audio', datos);
        return;
      }
      let msg;
      try { msg = JSON.parse(datos.toString('utf8')); } catch { return; }

      if (msg.type === 'hello') {
        clearTimeout(sinHello);
        this.sessionId = msg.session_id || null;
        this.reintento = REINTENTO_MIN_MS;
        this._estado('en-linea', this.url);
        this.emit('hello', msg);
        // Mandamos lo que el usuario escribió mientras conectábamos.
        const cola = this.pendientes.splice(0);
        cola.forEach((t) => this._enviarTexto(t));
        return;
      }
      this.emit('mensaje', msg);
    });

    ws.on('close', (codigo) => {
      clearTimeout(sinHello);
      if (this.ws !== ws) return;     // es una conexión vieja, ignorar
      this.ws = null;
      this.sessionId = null;
      if (this.apagada) { this._estado('desconectado', 'apagada'); return; }
      // La central cierra la conexión si pasan ~2 min sin hablar. Eso es
      // normal: nos reconectamos solos en silencio.
      this._estado('desconectado', `cerrada (${codigo})`);
      this._programarReintento();
    });

    ws.on('error', (e) => {
      // 'close' llega justo después; aquí solo guardamos el motivo.
      this.emit('error-conexion', explicarError(e));
    });
  }

  _programarReintento() {
    clearTimeout(this.temporizador);
    const espera = this.reintento;
    this.reintento = Math.min(this.reintento * 2, REINTENTO_MAX_MS);
    this.temporizador = setTimeout(() => this.conectar(), espera);
    this.emit('reintento', { enMs: espera });
  }

  /** Pregunta algo a Byte por texto. Si no hay conexión, conecta y lo manda después. */
  preguntar(texto) {
    const t = String(texto || '').trim();
    if (!t) return false;
    if (this.estado === 'en-linea' && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._enviarTexto(t);
    } else {
      this.pendientes.push(t);
      this.reintento = REINTENTO_MIN_MS;
      this.conectar();
    }
    return true;
  }

  _enviarTexto(texto) {
    this.ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: texto }));
  }

  /** Interrumpe a Byte mientras habla (botón "Detener"). */
  interrumpir() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'abort', session_id: this.sessionId, reason: 'wake_word_detected' }));
    }
  }

  /** Cambia de dirección (por ejemplo al pasar del HP a la Mac). */
  cambiarUrl(url) {
    this.url = url;
    this.reconectar();
  }

  reconectar() {
    this.cerrar();
    this.apagada = false;
    this.reintento = REINTENTO_MIN_MS;
    this.conectar();
  }

  cerrar() {
    this.apagada = true;
    clearTimeout(this.temporizador);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      try { ws.close(); } catch { /* ya estaba cerrada */ }
    }
    this._estado('desconectado', 'apagada');
  }
}

/** Traduce los errores de red a algo que Alejandro entienda. */
function explicarError(e) {
  const c = e && e.code;
  if (c === 'ECONNREFUSED') return 'La central no responde en esa dirección. ¿Está prendido Docker con Byte?';
  if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH') return 'No encuentro ese computador en la red. ¿Están en el mismo WiFi?';
  if (c === 'ETIMEDOUT') return 'La central tardó demasiado. Revisa la IP y el firewall de Windows.';
  if (c === 'ENOTFOUND') return 'Esa dirección no existe. Revisa que esté bien escrita.';
  return (e && e.message) || 'Error de conexión';
}

/** Un device-id con forma de MAC, fijo para cada computador (02: = inventado localmente). */
function nuevoDeviceId() {
  const b = require('node:crypto').randomBytes(5);
  return ['02', ...[...b].map((x) => x.toString(16).padStart(2, '0'))].join(':');
}

module.exports = { Central, explicarError, nuevoDeviceId };
