// puente.js — El "puente" de Byte para el celular. Corre en el HP (y luego en el mini PC).
//
// Qué hace, en tres partes:
//   1. Sirve la app del celular (la PWA de la carpeta app/).
//   2. Conecta el chat del celular con la central de Byte (Docker, puerto 8000).
//      El iPhone no siempre trae un codificador de Opus, así que el puente
//      traduce la voz: celular ⇄ audio PCM ⇄ PUENTE ⇄ Opus ⇄ central.
//   3. Da una pequeña API de administración (ver estado, encender, reiniciar,
//      ver el registro) protegida con una CLAVE que solo conoce tu celular.
//
// Seguridad:
//   • Escucha SOLO en 127.0.0.1 (este mismo computador). Nadie de la red lo ve.
//   • El iPhone llega por Tailscale ("tailscale serve"), que pone HTTPS
//     y solo deja entrar a TUS equipos.
//   • La página para emparejar (con el código QR) vive en otro puerto que
//     Tailscale NO comparte: solo se abre desde el propio HP.
//   • Las claves de Groq/Gemini nunca pasan por aquí; el registro se limpia
//     de cualquier cosa que parezca una clave antes de mandarlo al celular.
//
// Uso:  node puente.js                (normal)
//       node puente.js --nueva-clave  (desempareja todos los celulares)

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { WebSocketServer, WebSocket } = require('ws');

const PUERTO = Number(process.env.BYTE_MOVIL_PUERTO) || 8810;          // lo comparte Tailscale
const PUERTO_EMPAREJAR = Number(process.env.BYTE_MOVIL_EMPAREJAR) || 8811; // solo este PC
const CENTRAL = process.env.BYTE_CENTRAL || 'ws://127.0.0.1:8000/xiaozhi/v1/';
const CONTENEDOR = process.env.BYTE_CONTENEDOR || 'byte-servidor';
const CARPETA_SERVIDOR = process.env.BYTE_SERVIDOR_DIR || path.join(os.homedir(), 'byte-servidor');

// Opus: el micrófono va a 16 kHz en paquetes de 60 ms (igual que la placa).
const MIC_HZ = 16000;
const MIC_MUESTRAS = 960;          // 60 ms a 16 kHz
const MAX_MENSAJE = 256 * 1024;    // nada legítimo pesa más que esto

// ---------------------------------------------------------------- Clave

function cargarClave(carpeta, { nueva = false } = {}) {
  fs.mkdirSync(carpeta, { recursive: true });
  const archivo = path.join(carpeta, 'movil.json');
  let datos = {};
  try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch { /* primera vez */ }
  if (nueva || typeof datos.clave !== 'string' || datos.clave.length < 32) {
    datos = { clave: crypto.randomBytes(24).toString('base64url'), creada: new Date().toISOString() };
    fs.writeFileSync(archivo, JSON.stringify(datos, null, 2), { mode: 0o600 });
  }
  return datos.clave;
}

/** Compara la clave sin dar pistas por el tiempo que tarda. */
function claveCorrecta(dada, clave) {
  if (typeof dada !== 'string') return false;
  const a = crypto.createHash('sha256').update(dada).digest();
  const b = crypto.createHash('sha256').update(clave).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- Registro sin claves

/** Tapa todo lo que parezca una clave o un token antes de mostrar el registro. */
function limpiarRegistro(texto) {
  return String(texto || '')
    .replace(/gsk_[A-Za-z0-9]+/g, 'gsk_••••')
    .replace(/\bAQ\.[A-Za-z0-9._-]+/g, 'AQ.••••')
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, 'AIza••••')
    .replace(/\bsk[-_][A-Za-z0-9_-]{8,}/g, 'sk-••••')
    .replace(/(Bearer\s+)[^\s"',]+/gi, '$1••••')
    .replace(/((?:api[_-]?key|token|secret|password|clave|access_token|refresh_token)["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1••••')
    .replace(/([?&](?:key|token|clave)=)[^&\s"']+/gi, '$1••••');
}

// ---------------------------------------------------------------- Comandos del PC

function ejecutar(cmd, args, { cwd, timeout = 60000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: !error, codigo: error ? (error.code ?? 1) : 0, salida: `${stdout || ''}${stderr || ''}`, stdout: stdout || '' });
    });
  });
}

/** ¿Hay algo escuchando en ese puerto de este computador? */
function puertoAbierto(puerto, host = '127.0.0.1', ms = 1500) {
  return new Promise((resolve) => {
    const s = net.connect({ port: puerto, host });
    const fin = (ok) => { s.destroy(); resolve(ok); };
    s.setTimeout(ms, () => fin(false));
    s.once('connect', () => fin(true));
    s.once('error', () => fin(false));
  });
}

/** Lo que el celular puede pedir. Se puede reemplazar en las pruebas. */
function comandosReales() {
  return {
    async estado() {
      const docker = await ejecutar('docker', ['inspect', '-f', '{{.State.Status}}|{{.State.StartedAt}}', CONTENEDOR], { timeout: 8000 });
      const [estadoDocker, desde] = docker.ok ? docker.salida.trim().split('|') : ['', ''];
      const [central, ota, internet, spotify, pc] = await Promise.all(
        [8000, 8003, 8805, 8806, 8765].map((p) => puertoAbierto(p)));
      return [
        { id: 'docker', nombre: 'Docker y la central', ok: estadoDocker === 'running',
          detalle: estadoDocker ? `contenedor ${estadoDocker}` : 'Docker cerrado o sin la central', desde: estadoDocker === 'running' ? desde : null },
        { id: 'central', nombre: 'Conversación (puerto 8000)', ok: central, detalle: central ? 'responde' : 'no responde' },
        { id: 'ota', nombre: 'Dirección para la placa (8003)', ok: ota, detalle: ota ? 'responde' : 'no responde' },
        { id: 'internet', nombre: 'Internet: clima y noticias', ok: internet, detalle: internet ? 'activo' : 'apagado (opcional)', opcional: true },
        { id: 'spotify', nombre: 'Spotify', ok: spotify, detalle: spotify ? 'activo' : 'apagado (opcional)', opcional: true },
        { id: 'pc', nombre: 'Byte del PC (cara y voz)', ok: pc, detalle: pc ? 'abierto' : 'cerrado (opcional)', opcional: true },
      ];
    },
    encender: () => ejecutar('docker', ['compose', 'up', '-d'], { cwd: CARPETA_SERVIDOR, timeout: 180000 }),
    reiniciar: () => ejecutar('docker', ['restart', CONTENEDOR], { timeout: 120000 }),
    apagar: () => ejecutar('docker', ['stop', CONTENEDOR], { timeout: 120000 }),
    registro: async () => {
      const r = await ejecutar('docker', ['logs', '--tail', '80', CONTENEDOR], { timeout: 15000 });
      return { ...r, salida: limpiarRegistro(r.salida) };
    },
  };
}

/** Dónde puede estar el programa de Tailscale (si no está en el PATH del arranque). */
const TAILSCALE = [
  'tailscale',
  path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe'),
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
];

/** Lee el nombre DNS de la salida de "tailscale status --json" (ignora avisos sueltos). */
function nombreDesdeEstado(texto) {
  const t = String(texto || '');
  const i = t.indexOf('{');
  if (i < 0) return null;
  try {
    const dns = (JSON.parse(t.slice(i)).Self || {}).DNSName || '';
    return dns.replace(/\.$/, '') || null;
  } catch { return null; }
}

/**
 * La dirección HTTPS de este computador en Tailscale (ej. alejandro-lopez.tail1234.ts.net).
 * 1) variable BYTE_MOVIL_DIRECCION, 2) "tailscale status", 3) lo que guardó el instalador.
 */
async function direccionTailscale(carpeta = path.join(CARPETA_SERVIDOR, 'movil')) {
  if (process.env.BYTE_MOVIL_DIRECCION) return process.env.BYTE_MOVIL_DIRECCION;
  for (const exe of TAILSCALE) {
    const r = await ejecutar(exe, ['status', '--json'], { timeout: 6000 });
    const dns = nombreDesdeEstado(r.stdout);
    if (dns) return dns;
  }
  try {
    const guardada = fs.readFileSync(path.join(carpeta, 'direccion.txt'), 'utf8').trim();
    if (/^[a-z0-9.-]+\.ts\.net$/i.test(guardada)) return guardada;
  } catch { /* el instalador aún no la guardó */ }
  return null;
}

// ---------------------------------------------------------------- Archivos de la app

const APP = path.join(__dirname, 'app');
const COMUN = path.join(__dirname, '..', 'desk', 'renderer', 'comun.js'); // mismo chat que Byte Desk
// Lista cerrada: solo estos archivos se pueden pedir (nada de rutas raras).
const ARCHIVOS = {
  '/': [path.join(APP, 'index.html'), 'text/html; charset=utf-8'],
  '/index.html': [path.join(APP, 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(APP, 'app.js'), 'text/javascript; charset=utf-8'],
  '/audio.js': [path.join(APP, 'audio.js'), 'text/javascript; charset=utf-8'],
  '/estilos.css': [path.join(APP, 'estilos.css'), 'text/css; charset=utf-8'],
  '/sw.js': [path.join(APP, 'sw.js'), 'text/javascript; charset=utf-8'],
  '/manifest.webmanifest': [path.join(APP, 'manifest.webmanifest'), 'application/manifest+json'],
  '/icono-180.png': [path.join(APP, 'icono-180.png'), 'image/png'],
  '/icono-192.png': [path.join(APP, 'icono-192.png'), 'image/png'],
  '/icono-512.png': [path.join(APP, 'icono-512.png'), 'image/png'],
  '/comun.js': [COMUN, 'text/javascript; charset=utf-8'],
};

function cabecerasSeguras(req) {
  const host = String(req.headers.host || '').replace(/[^A-Za-z0-9.:-]/g, '');
  return {
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://${host} ws://${host}; frame-ancestors 'none'; base-uri 'none'`,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
  };
}

function responderJSON(res, codigo, datos, extra = {}) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(datos));
}

// ---------------------------------------------------------------- Puente de voz

/**
 * Une un celular con la central. Los mensajes de texto (JSON) pasan tal cual;
 * el audio se traduce: PCM del celular → Opus para la central, y al revés.
 */
function unirConCentral(celular, { central, deviceId, clientId, registrar }) {
  const OpusScript = require('opusscript');
  let codificador = null;
  let decodificador = null;
  let resto = Buffer.alloc(0);      // muestras del micrófono que aún no llenan 60 ms
  const cola = [];                  // lo que mandó el celular antes de que la central contestara
  let cerrado = false;

  const arriba = new WebSocket(central, {
    headers: { 'Device-Id': deviceId, 'Client-Id': clientId, 'Protocol-Version': '1' },
    handshakeTimeout: 8000,
    maxPayload: MAX_MENSAJE,
  });

  const liberar = () => {
    if (cerrado) return;
    cerrado = true;
    try { codificador && codificador.delete(); } catch { /* ya */ }
    try { decodificador && decodificador.delete(); } catch { /* ya */ }
    codificador = null; decodificador = null;
    try { arriba.close(); } catch { /* ya */ }
    try { celular.close(); } catch { /* ya */ }
  };

  const aCentral = (datos, binario) => {
    if (arriba.readyState === WebSocket.OPEN) arriba.send(datos, { binary: binario });
    else if (arriba.readyState === WebSocket.CONNECTING && cola.length < 200) cola.push([datos, binario]);
  };

  /** Convierte PCM de 16 bits del micrófono en paquetes Opus de 60 ms. */
  const codificar = (pcm, final = false) => {
    if (!codificador) codificador = new OpusScript(MIC_HZ, 1, OpusScript.Application.VOIP);
    resto = Buffer.concat([resto, pcm]);
    const tam = MIC_MUESTRAS * 2;
    while (resto.length >= tam) {
      aCentral(Buffer.from(codificador.encode(resto.subarray(0, tam), MIC_MUESTRAS)), true);
      resto = resto.subarray(tam);
    }
    if (final && resto.length) {
      const ultimo = Buffer.alloc(tam);
      resto.copy(ultimo);
      aCentral(Buffer.from(codificador.encode(ultimo, MIC_MUESTRAS)), true);
      resto = Buffer.alloc(0);
    }
  };

  arriba.on('open', () => {
    cola.splice(0).forEach(([d, b]) => arriba.send(d, { binary: b }));
  });

  arriba.on('message', (datos, binario) => {
    if (celular.readyState !== WebSocket.OPEN) return;
    if (binario) {
      if (!decodificador) decodificador = new OpusScript(24000, 1);
      try {
        const pcm = decodificador.decode(datos);
        celular.send(Buffer.from(pcm), { binary: true });
      } catch { /* paquete dañado: se salta */ }
      return;
    }
    let texto = datos.toString('utf8');
    try {
      const m = JSON.parse(texto);
      if (m.type === 'hello') {
        // La voz de Byte llega en Opus a esta frecuencia; el celular la recibe ya en PCM.
        const hz = Number(m.audio_params && m.audio_params.sample_rate) || 24000;
        if (decodificador) { try { decodificador.delete(); } catch { /* ya */ } }
        decodificador = new OpusScript([8000, 12000, 16000, 24000, 48000].includes(hz) ? hz : 24000, 1);
        m.audio_params = { ...(m.audio_params || {}), format: 'pcm16', sample_rate: hz };
        texto = JSON.stringify(m);
      }
    } catch { /* no es JSON: se pasa igual */ }
    celular.send(texto);
  });

  arriba.on('error', (e) => {
    registrar(`central: ${e.code || e.message}`);
    if (celular.readyState === WebSocket.OPEN) {
      celular.send(JSON.stringify({ type: 'puente', estado: 'sin-central',
        detalle: 'La central no responde. Mira la pestaña Estado: desde ahí la puedes encender.' }));
    }
  });
  arriba.on('close', () => { if (celular.readyState === WebSocket.OPEN) celular.close(4002, 'central cerrada'); liberar(); });

  celular.on('message', (datos, binario) => {
    if (binario) { codificar(Buffer.from(datos)); return; }
    const texto = datos.toString('utf8');
    let m = null;
    try { m = JSON.parse(texto); } catch { return; }   // solo JSON
    if (m && m.type === 'listen' && m.state === 'stop') codificar(Buffer.alloc(0), true);
    if (m && m.type === 'hello') {
      // La central siempre recibe Opus 16 kHz, aunque el celular mande PCM.
      m.audio_params = { format: 'opus', sample_rate: MIC_HZ, channels: 1, frame_duration: 60 };
      aCentral(JSON.stringify(m), false);
      return;
    }
    aCentral(texto, false);
  });
  celular.on('close', liberar);
  celular.on('error', liberar);
}

// ---------------------------------------------------------------- Servidor

function crearPuente({
  puerto = PUERTO, puertoEmparejar = PUERTO_EMPAREJAR, host = '127.0.0.1',
  central = CENTRAL, carpeta = path.join(CARPETA_SERVIDOR, 'movil'),
  comandos = comandosReales(), direccion = direccionTailscale, nuevaClave = false,
  registrar = () => {},
} = {}) {
  const clave = cargarClave(carpeta, { nueva: nuevaClave });
  const fallos = new Map();   // ip → { n, hasta }: frena a quien adivina claves
  let ocupado = false;        // una orden de Docker a la vez

  const ipDe = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const bloqueado = (ip) => { const f = fallos.get(ip); return f && f.hasta > Date.now(); };
  const autorizado = (req, dada) => {
    const ip = ipDe(req);
    if (bloqueado(ip)) return false;
    if (claveCorrecta(dada, clave)) { fallos.delete(ip); return true; }
    const f = fallos.get(ip) || { n: 0, hasta: 0 };
    f.n += 1;
    if (f.n >= 10) { f.hasta = Date.now() + 10 * 60 * 1000; f.n = 0; registrar(`demasiados intentos desde ${ip}: bloqueado 10 min`); }
    fallos.set(ip, f);
    return false;
  };

  const servidor = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const seg = cabecerasSeguras(req);

    if (url.pathname.startsWith('/api/')) {
      const dada = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!autorizado(req, dada)) return responderJSON(res, 401, { error: 'Este celular no está emparejado. Escanea el código QR del HP.' }, seg);

      if (req.method === 'GET' && url.pathname === '/api/estado') {
        return responderJSON(res, 200, { servicios: await comandos.estado(), hora: new Date().toISOString(), ocupado }, seg);
      }
      if (req.method === 'GET' && url.pathname === '/api/registro') {
        const r = await comandos.registro();
        return responderJSON(res, 200, { ok: r.ok, texto: r.salida.slice(-20000) }, seg);
      }
      const ordenes = { '/api/central/encender': 'encender', '/api/central/reiniciar': 'reiniciar', '/api/central/apagar': 'apagar' };
      if (req.method === 'POST' && ordenes[url.pathname]) {
        if (ocupado) return responderJSON(res, 409, { error: 'Ya estoy haciendo otra orden. Espera un momento.' }, seg);
        ocupado = true;
        const orden = ordenes[url.pathname];
        registrar(`orden desde el celular: ${orden}`);
        try {
          const r = await comandos[orden]();
          return responderJSON(res, r.ok ? 200 : 500, { ok: r.ok, texto: limpiarRegistro(r.salida).slice(-2000) }, seg);
        } finally { ocupado = false; }
      }
      return responderJSON(res, 404, { error: 'No conozco esa orden.' }, seg);
    }

    const archivo = ARCHIVOS[url.pathname];
    if (req.method !== 'GET' || !archivo) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...seg });
      return res.end('No existe.');
    }
    fs.readFile(archivo[0], (err, datos) => {
      if (err) { res.writeHead(404, seg); return res.end(); }
      res.writeHead(200, { 'Content-Type': archivo[1], 'Cache-Control': 'no-cache', ...seg });
      res.end(datos);
    });
  });

  // Chat en vivo: wss://.../ws?clave=...&device=02:..
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MENSAJE });
  servidor.on('upgrade', (req, socket, cabeza) => {
    const url = new URL(req.url, 'http://x');
    const origen = req.headers.origin ? new URL(req.headers.origin).host : '';
    const rechazar = (codigo) => { socket.write(`HTTP/1.1 ${codigo}\r\n\r\n`); socket.destroy(); };
    if (url.pathname !== '/ws') return rechazar('404 Not Found');
    if (origen && origen !== req.headers.host) return rechazar('403 Forbidden');
    if (!autorizado(req, url.searchParams.get('clave'))) return rechazar('401 Unauthorized');
    const deviceId = String(url.searchParams.get('device') || '').toLowerCase();
    if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(deviceId)) return rechazar('400 Bad Request');
    wss.handleUpgrade(req, socket, cabeza, (ws) => {
      registrar(`celular conectado (${deviceId})`);
      unirConCentral(ws, { central, deviceId, clientId: `byte-movil-${deviceId.replace(/:/g, '')}`, registrar });
    });
  });

  // Página para emparejar: SOLO en este computador (Tailscale no la comparte).
  const emparejar = http.createServer(async (req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/') { res.writeHead(404); return res.end(); }
    const dir = await direccion(carpeta);
    const enlace = dir ? `https://${dir}/#clave=${clave}` : null;
    let qr = '';
    if (enlace) { try { qr = await require('qrcode').toString(enlace, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }); } catch { qr = ''; } }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:", 'Referrer-Policy': 'no-referrer' });
    res.end(paginaEmparejar({ enlace, qr }));
  });

  return {
    servidor, emparejar, clave,
    async iniciar() {
      await new Promise((r, x) => servidor.once('error', x).listen(puerto, host, r));
      await new Promise((r, x) => emparejar.once('error', x).listen(puertoEmparejar, '127.0.0.1', r));
      return { puerto: servidor.address().port, puertoEmparejar: emparejar.address().port };
    },
    cerrar() {
      wss.clients.forEach((c) => c.terminate());
      servidor.closeAllConnections?.();
      emparejar.closeAllConnections?.();
      return Promise.all([new Promise((r) => servidor.close(r)), new Promise((r) => emparejar.close(r))]);
    },
  };
}

function paginaEmparejar({ enlace, qr }) {
  const cuerpo = enlace ? `
    <p>1. En el iPhone abre la <b>Cámara</b> y apunta a este código.</p>
    <div class="qr">${qr}</div>
    <p>2. Toca el enlace amarillo: se abre Byte en Safari y queda emparejado.</p>
    <p>3. Toca <b>Compartir</b> (el cuadrito con flecha) → <b>Agregar a inicio</b>.</p>
    <p class="nota">Este código es la llave de Byte: no lo compartas ni le tomes captura. Si se te filtra, corre <code>node puente.js --nueva-clave</code>.</p>`
    : `<p class="mal">No encuentro Tailscale en este computador, o no ha iniciado sesión.</p>
    <p>Instálalo (<code>winget install -e --id Tailscale.Tailscale</code>), inicia sesión y recarga esta página.</p>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Emparejar el celular con Byte</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070b;color:#f2ede1;font:16px/1.5 system-ui,sans-serif}
main{max-width:440px;padding:28px 20px}h1{font-size:24px;margin:0 0 12px}
.qr{background:#fff;border-radius:16px;padding:14px;width:260px;margin:12px auto}.qr svg{display:block;width:100%;height:auto}
.nota{font-size:13px;color:#b3aea3}.mal{color:#ff8b8b}code{background:#1b1b23;padding:2px 6px;border-radius:5px}
</style></head><body><main><h1>Emparejar tu celular con Byte</h1>${cuerpo}</main></body></html>`;
}

// ---------------------------------------------------------------- Arranque

if (require.main === module) {
  const carpeta = path.join(CARPETA_SERVIDOR, 'movil');
  fs.mkdirSync(carpeta, { recursive: true });
  const archivoRegistro = path.join(carpeta, 'registro.txt');
  const registrar = (t) => {
    const linea = `${new Date().toISOString()}  ${t}\n`;
    process.stdout.write(linea);
    try { fs.appendFileSync(archivoRegistro, linea); } catch { /* sin espacio */ }
  };
  const puente = crearPuente({ carpeta, registrar, nuevaClave: process.argv.includes('--nueva-clave') });
  puente.iniciar().then(({ puerto, puertoEmparejar }) => {
    registrar(`Puente de Byte listo en http://127.0.0.1:${puerto} (compártelo con: tailscale serve --bg ${puerto})`);
    registrar(`Para emparejar el celular abre en ESTE PC: http://127.0.0.1:${puertoEmparejar}`);
  }).catch((e) => {
    registrar(e.code === 'EADDRINUSE' ? 'El puente ya estaba corriendo (el puerto está ocupado).' : `No pude arrancar: ${e.message}`);
    process.exit(e.code === 'EADDRINUSE' ? 0 : 1);
  });
}

module.exports = { crearPuente, limpiarRegistro, claveCorrecta, unirConCentral, nombreDesdeEstado };
