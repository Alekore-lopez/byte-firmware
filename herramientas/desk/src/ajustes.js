// ajustes.js — Guarda las preferencias de Byte Desk en un archivo JSON
// dentro de la carpeta de datos de la app (no en el repo):
//   Windows: %APPDATA%\Byte Desk\ajustes.json
//   Mac:     ~/Library/Application Support/Byte Desk/ajustes.json
// Aquí NO se guardan claves de Groq/Gemini/ElevenLabs: esas viven solo en la central.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { nuevoDeviceId } = require('./central');

const POR_DEFECTO = {
  // En el HP la central está en el mismo computador. En la Mac hay que poner
  // la IP del HP (Ajustes → Central). Ej: ws://192.168.1.50:8000/xiaozhi/v1/
  centralUrl: 'ws://127.0.0.1:8000/xiaozhi/v1/',
  token: '',
  vozActiva: true,
  abrirAlIniciar: true,
  tareas: [],
};

class Ajustes {
  constructor(carpeta) {
    this.archivo = path.join(carpeta, 'ajustes.json');
    this.datos = { ...POR_DEFECTO };
    try {
      Object.assign(this.datos, JSON.parse(fs.readFileSync(this.archivo, 'utf8')));
    } catch { /* primera vez: usamos los valores por defecto */ }
    // Identidad fija de este computador ante la central.
    if (!this.datos.deviceId) this.datos.deviceId = nuevoDeviceId();
    if (!this.datos.clientId) this.datos.clientId = crypto.randomUUID();
    this.guardar();
  }

  get(clave) { return this.datos[clave]; }

  /** Solo deja cambiar claves conocidas y con el tipo correcto. */
  set(clave, valor) {
    if (!(clave in POR_DEFECTO)) throw new Error(`Ajuste desconocido: ${clave}`);
    if (typeof valor !== typeof POR_DEFECTO[clave] && !(Array.isArray(POR_DEFECTO[clave]) && Array.isArray(valor))) {
      throw new Error(`Tipo inválido para ${clave}`);
    }
    if (clave === 'centralUrl' && !/^wss?:\/\/[^\s]+$/i.test(valor)) {
      throw new Error('La dirección debe empezar con ws:// (ejemplo: ws://192.168.1.50:8000/xiaozhi/v1/)');
    }
    this.datos[clave] = valor;
    this.guardar();
    return valor;
  }

  /** Lo que la interfaz puede ver (sin el token). */
  publicos() {
    const { token, ...resto } = this.datos;
    return { ...resto, tieneToken: Boolean(token) };
  }

  guardar() {
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      fs.writeFileSync(this.archivo, JSON.stringify(this.datos, null, 2));
    } catch (e) {
      console.error('No pude guardar los ajustes:', e.message);
    }
  }
}

/** Convierte lo que escriba Alejandro ("192.168.1.50") en una URL completa. */
function normalizarUrl(texto) {
  let t = String(texto || '').trim();
  if (!t) return POR_DEFECTO.centralUrl;
  if (!/^wss?:\/\//i.test(t)) t = `ws://${t}`;
  const u = new URL(t);
  if (!u.port) u.port = '8000';
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/xiaozhi/v1/';
  return u.toString();
}

module.exports = { Ajustes, normalizarUrl, POR_DEFECTO };
