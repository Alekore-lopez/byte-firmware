// byte-pc.js — Habla con el programa de Byte del PC (py-xiaozhi + pantalla en vivo).
//
// Cuando ese programa está abierto, tiene un pequeño servidor en
// http://127.0.0.1:8765 (herramientas/pc/byte_pantalla.py). Byte Desk:
//   • pregunta cada 3 s si está abierto (GET /estado),
//   • le pasa lo que escribes (POST /preguntar) → Byte contesta con su voz y su cara,
//   • escucha sus eventos (GET /events) para mostrar la respuesta en el chat.
// Si el programa está cerrado (o en la Mac), Byte Desk contesta solo, como siempre.

const { EventEmitter } = require('node:events');
const http = require('node:http');

const BASE = { host: '127.0.0.1', port: 8765 };
const CADA_MS = 3000;

function pedir({ base = BASE, metodo = 'GET', ruta, cuerpo = null, esperaMs = 1500 }) {
  return new Promise((ok, mal) => {
    const datos = cuerpo ? Buffer.from(JSON.stringify(cuerpo)) : null;
    const req = http.request({
      ...base,
      method: metodo,
      path: ruta,
      headers: datos ? { 'Content-Type': 'application/json', 'Content-Length': datos.length } : {},
      timeout: esperaMs,
    }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { texto += c; });
      res.on('end', () => ok({ codigo: res.statusCode, texto }));
    });
    req.on('timeout', () => req.destroy(new Error('sin respuesta')));
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}

class BytePc extends EventEmitter {
  constructor({ base = BASE } = {}) {
    super();
    this.base = base;
    this.abierto = false;      // el programa del PC está corriendo
    this.puedePreguntar = false; // y es una versión que acepta preguntas de Byte Desk
    this.eventos = null;
    this.timer = null;
  }

  iniciar() {
    this._revisar();
    this.timer = setInterval(() => this._revisar(), CADA_MS);
  }

  detener() {
    clearInterval(this.timer);
    this._cerrarEventos();
  }

  get disponible() { return this.abierto && this.puedePreguntar; }

  async _revisar() {
    let abierto = false;
    let puede = false;
    try {
      const r = await pedir({ base: this.base, ruta: '/estado', esperaMs: 800 });
      if (r.codigo === 200) {
        const d = JSON.parse(r.texto);
        abierto = d.byte === 'pc';
        puede = Boolean(d.preguntar);
      } else if (r.codigo === 404) {
        abierto = true;          // versión vieja de la pantalla: abierta, pero no recibe preguntas
      }
    } catch { /* cerrado */ }
    const cambio = abierto !== this.abierto || puede !== this.puedePreguntar;
    this.abierto = abierto;
    this.puedePreguntar = puede;
    if (this.disponible && !this.eventos) this._abrirEventos();
    if (!this.disponible) this._cerrarEventos();
    if (cambio) this.emit('estado', { abierto, puedePreguntar: puede });
  }

  _abrirEventos() {
    const req = http.get({ ...this.base, path: '/events', headers: { Accept: 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); this.eventos = null; return; }
      res.setEncoding('utf8');
      let resto = '';
      res.on('data', (trozo) => {
        resto += trozo;
        let corte;
        while ((corte = resto.indexOf('\n\n')) >= 0) {
          const bloque = resto.slice(0, corte);
          resto = resto.slice(corte + 2);
          for (const linea of bloque.split('\n')) {
            if (!linea.startsWith('data:')) continue;
            try { this.emit('mensaje', JSON.parse(linea.slice(5).trim())); } catch { /* línea rara */ }
          }
        }
      });
      res.on('end', () => { this.eventos = null; });
    });
    req.on('error', () => { this.eventos = null; });
    this.eventos = req;
  }

  _cerrarEventos() {
    if (this.eventos) { this.eventos.destroy(); this.eventos = null; }
  }

  /** Pasa la pregunta al programa del PC. Devuelve false si no se pudo. */
  async preguntar(texto) {
    if (!this.disponible) return false;
    try {
      const r = await pedir({ base: this.base, metodo: 'POST', ruta: '/preguntar', cuerpo: { texto }, esperaMs: 3000 });
      return r.codigo === 204;
    } catch {
      return false;
    }
  }
}

/** Para comparar lo que escribimos con lo que la central dice que oyó (sin tildes ni signos). */
function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

module.exports = { BytePc, normalizar };
