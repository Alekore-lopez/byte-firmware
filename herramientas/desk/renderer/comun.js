// comun.js — Piezas que usan la ventana grande y el panel rápido.
//   • CARAS: mismos colores que las caras del firmware (main/boards/byte/byte_faces.h)
//   • Conversacion: convierte los mensajes de la central en burbujas de chat.

/* Colores de las caras del firmware, para que Byte se vea igual en todas partes. */
const CARAS = {
  reposo: '#3ee6b0', escucha: '#f2ede1', pensando: '#a78bfa', hablando: '#ffb238',
  dormido: '#6366f1', exito: '#4ade80', feliz: '#facc15', risa: '#a3e635',
  carino: '#f472b6', cool: '#c0c7d4', sorpresa: '#e879f9', enfado: '#e11d48',
  tristeza: '#8e95b8', oops: '#fdba74', guino: '#fb7185',
};
/* Emoción que manda la central → cara (igual que kByteEmotions del firmware). */
const EMOCION_A_CARA = {
  happy: 'feliz', relaxed: 'feliz', delicious: 'feliz', laughing: 'risa', funny: 'risa',
  loving: 'carino', kissy: 'carino', cool: 'cool', surprised: 'sorpresa', shocked: 'sorpresa',
  angry: 'enfado', sad: 'tristeza', crying: 'tristeza', embarrassed: 'oops', confused: 'oops',
  winking: 'guino', silly: 'guino', thinking: 'pensando', sleepy: 'dormido', confident: 'exito',
};

// Si en 15 s la central ni siquiera empezó, algo anda mal con la conexión.
// Si empezó, le damos hasta 2 minutos: buscar en internet puede tardar.
const ESPERA_INICIO_MS = 15000;
const ESPERA_RESPUESTA_MS = 120000;

/** Pinta todas las caritas (.byte) según el estado y la emoción. */
function pintarCaras(estado, cara) {
  const color = CARAS[cara] || CARAS[estado] || CARAS.reposo;
  document.querySelectorAll('.byte').forEach((el) => {
    el.dataset.estado = estado;
    el.style.setProperty('--emo', color);
  });
}

const TEXTO_ESTADO = {
  'desconectado': 'sin conexión',
  'conectando': 'conectando…',
  'reposo': 'di «Byte»…',
  'pensando': 'pensando…',
  'hablando': 'hablando…',
};

/**
 * Lleva la conversación: recibe eventos y llama a `alCambiar` para repintar.
 * mensajes = [{ de: 'yo'|'byte'|'sistema', texto, emoji? }]
 */
class Conversacion {
  constructor({ alCambiar, guardarEn = null, maximo = 120 }) {
    this.alCambiar = alCambiar;
    this.guardarEn = guardarEn;
    this.maximo = maximo;
    this.mensajes = [];
    this.conexion = 'desconectado';  // estado de la conexión
    this.estado = 'desconectado';    // estado de Byte (lo que muestra la cara)
    this.cara = null;
    this.actual = null;              // burbuja de Byte que se está llenando
    this.emojiPendiente = '';
    this.vigilante = null;
    if (guardarEn) {
      try { this.mensajes = JSON.parse(localStorage.getItem(guardarEn) || '[]'); } catch { this.mensajes = []; }
    }
  }

  _guardar() {
    if (this.mensajes.length > this.maximo) this.mensajes.splice(0, this.mensajes.length - this.maximo);
    if (this.guardarEn) {
      try { localStorage.setItem(this.guardarEn, JSON.stringify(this.mensajes)); } catch { /* sin espacio */ }
    }
    this.alCambiar(this);
  }

  _ponerEstado(estado) {
    this.estado = estado;
    if (estado !== 'hablando' && estado !== 'pensando') this.cara = null;
    pintarCaras(estado, this.cara);
  }

  /** La conexión con la central cambió. */
  conexionCambio({ estado, detalle }) {
    this.conexion = estado;
    if (estado === 'en-linea') {
      if (this.estado === 'desconectado' || this.estado === 'conectando') this._ponerEstado('reposo');
    } else if (this.estado !== 'pensando') {
      // Si estaba pensando y se cayó, el vigilante avisará.
      this._ponerEstado(estado);
    }
    this.alCambiar(this);
  }

  /** Alguien (esta ventana o la otra) le preguntó algo a Byte. */
  pregunta(texto) {
    this.mensajes.push({ de: 'yo', texto });
    this.actual = null;
    this.emojiPendiente = '';
    this._ponerEstado('pensando');
    this.empezo = false;
    this._vigilar(ESPERA_INICIO_MS);
    this._guardar();
  }

  /** Si Byte no contesta a tiempo, lo decimos (sin borrar nada: si contesta tarde, igual se ve). */
  _vigilar(ms) {
    clearTimeout(this.vigilante);
    this.vigilante = setTimeout(() => {
      if (this.estado !== 'pensando') return;
      if (this.conexion !== 'en-linea') {
        this.sistema('No hay conexión con la central. Te lo mando apenas vuelva.');
        this._ponerEstado(this.conexion);
      } else if (!this.empezo) {
        this.sistema('La central no empezó a responder. Mira que Docker esté prendido; si tarda, vuelve a preguntar.');
        this._ponerEstado('reposo');
      } else {
        this.sistema('Byte se demoró demasiado. Puede ser internet o la voz; vuelve a intentarlo.');
        this._ponerEstado('reposo');
      }
    }, ms);
  }

  sistema(texto) {
    const ultimo = this.mensajes[this.mensajes.length - 1];
    if (ultimo && ultimo.de === 'sistema' && ultimo.texto === texto) return;
    this.mensajes.push({ de: 'sistema', texto });
    this._guardar();
  }

  /** Mensajes JSON de la central (protocolo XiaoZhi). */
  mensaje(m) {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'llm' && m.emotion) {
      this.cara = EMOCION_A_CARA[m.emotion] || null;
      if (m.text && /\p{Extended_Pictographic}/u.test(m.text)) this.emojiPendiente = m.text.trim();
      pintarCaras(this.estado, this.cara);
      if (this.actual && !this.actual.emoji) { this.actual.emoji = this.emojiPendiente; this._guardar(); }
      return;
    }
    if (m.type !== 'tts') return;   // 'stt' es el eco de lo que escribimos: ya lo mostramos
    if (m.state === 'start') {
      // La central ya está trabajando: le damos más tiempo (herramientas, internet).
      this.empezo = true;
      this._vigilar(ESPERA_RESPUESTA_MS);
      this._ponerEstado('pensando');
    } else if (m.state === 'sentence_start' && m.text) {
      clearTimeout(this.vigilante);
      if (!this.actual) {
        this.actual = { de: 'byte', texto: '', emoji: this.emojiPendiente };
        this.mensajes.push(this.actual);
      }
      this.actual.texto = (this.actual.texto ? `${this.actual.texto} ` : '') + m.text.trim();
      this._ponerEstado('hablando');
      this._guardar();
    } else if (m.state === 'stop') {
      clearTimeout(this.vigilante);
      this.actual = null;
      this.emojiPendiente = '';
      this._ponerEstado(this.conexion === 'en-linea' ? 'reposo' : this.conexion);
      this.alCambiar(this);
    }
  }

  borrar() {
    this.mensajes = [];
    this.actual = null;
    this._guardar();
  }

  textoEstado() {
    return TEXTO_ESTADO[this.estado] || TEXTO_ESTADO[this.conexion] || '';
  }
}

/** Escapa texto para meterlo en HTML sin riesgo. */
function esc(t) {
  return String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function burbujasHTML(mensajes, pensando) {
  const html = mensajes.map((m) => {
    if (m.de === 'yo') return `<div class="msg yo">${esc(m.texto)}</div>`;
    if (m.de === 'sistema') return `<div class="msg sistema">${esc(m.texto)}</div>`;
    return `<div class="msg byte-dice">${m.emoji ? `<span class="emo">${esc(m.emoji)}</span>` : ''}${esc(m.texto)}</div>`;
  }).join('');
  return html + (pensando ? '<div class="msg byte-dice escribiendo" aria-label="Byte está pensando"><i></i><i></i><i></i></div>' : '');
}

const ICONOS = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  tareas: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  enfoque: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
  archivos: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  mensajes: '<path d="M3 6h18v12H3z"/><path d="M3 7l9 6 9-6"/>',
  equipo: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>',
  enviar: '<path d="M4 12l16-8-6 16-2-6z"/>',
  parar: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  abrir: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};
function icono(nombre, tam = 18) {
  return `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre]}</svg>`;
}
