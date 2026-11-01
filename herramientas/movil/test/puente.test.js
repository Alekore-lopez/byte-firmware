// Pruebas del puente: npm test
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocket } = require('ws');
const { crearPuente, limpiarRegistro } = require('../puente.js');
const { crearCentralFalsa } = require('./central-falsa.js');

async function preparar(t) {
  const central = crearCentralFalsa();
  await new Promise((r) => central.on('listening', r));
  const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'byte-movil-'));
  const ordenes = [];
  const comandos = {
    estado: async () => [{ id: 'docker', nombre: 'Docker', ok: true, detalle: 'ok' }],
    encender: async () => { ordenes.push('encender'); return { ok: true, salida: 'listo api_key: gsk_SECRETO123' }; },
    reiniciar: async () => { ordenes.push('reiniciar'); return { ok: true, salida: '' }; },
    apagar: async () => { ordenes.push('apagar'); return { ok: true, salida: '' }; },
    registro: async () => ({ ok: true, salida: limpiarRegistro('usando gsk_abcDEF123 y AQ.xyz-123') }),
  };
  const puente = crearPuente({ puerto: 0, puertoEmparejar: 0, carpeta, comandos,
    central: `ws://127.0.0.1:${central.address().port}/xiaozhi/v1/`, direccion: async () => 'hp.tail123.ts.net' });
  const { puerto, puertoEmparejar } = await puente.iniciar();
  t.after(async () => { await puente.cerrar(); central.close(); fs.rmSync(carpeta, { recursive: true, force: true }); });
  return { central, puente, puerto, puertoEmparejar, ordenes, base: `http://127.0.0.1:${puerto}` };
}

const abrirWs = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.once('open', () => resolve(ws));
  ws.once('unexpected-response', (_req, res) => reject(new Error(String(res.statusCode))));
  ws.once('error', reject);
});

test('sirve la app y nada fuera de la lista', async (t) => {
  const { base } = await preparar(t);
  const r = await fetch(`${base}/`);
  assert.strictEqual(r.status, 200);
  assert.match(await r.text(), /<title>Byte<\/title>/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.strictEqual((await fetch(`${base}/comun.js`)).status, 200);
  assert.strictEqual((await fetch(`${base}/../puente.js`)).status, 404);
  assert.strictEqual((await fetch(`${base}/movil.json`)).status, 404);
});

test('la API pide la clave', async (t) => {
  const { base, puente, ordenes } = await preparar(t);
  assert.strictEqual((await fetch(`${base}/api/estado`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/estado`, { headers: { Authorization: 'Bearer mala' } })).status, 401);
  const ok = await fetch(`${base}/api/estado`, { headers: { Authorization: `Bearer ${puente.clave}` } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json()).servicios[0].ok, true);
  const e = await fetch(`${base}/api/central/encender`, { method: 'POST', headers: { Authorization: `Bearer ${puente.clave}` } });
  assert.strictEqual(e.status, 200);
  assert.doesNotMatch((await e.json()).texto, /SECRETO/);
  assert.deepStrictEqual(ordenes, ['encender']);
  // GET no enciende nada
  assert.strictEqual((await fetch(`${base}/api/central/apagar`, { headers: { Authorization: `Bearer ${puente.clave}` } })).status, 404);
});

test('el registro llega sin claves', async (t) => {
  const { base, puente } = await preparar(t);
  const r = await (await fetch(`${base}/api/registro`, { headers: { Authorization: `Bearer ${puente.clave}` } })).json();
  assert.doesNotMatch(r.texto, /abcDEF|xyz-123/);
  assert.strictEqual(limpiarRegistro('Authorization: Bearer abc.def'), 'Authorization: Bearer ••••');
  assert.strictEqual(limpiarRegistro('"api_key": "AIzaSyABCDEFGHIJKLMN"'), '"api_key": "••••"');
});

test('bloquea a quien adivina claves', async (t) => {
  const { base, puente } = await preparar(t);
  for (let i = 0; i < 10; i++) await fetch(`${base}/api/estado`, { headers: { Authorization: `Bearer mala${i}` } });
  const r = await fetch(`${base}/api/estado`, { headers: { Authorization: `Bearer ${puente.clave}` } });
  assert.strictEqual(r.status, 401, 'aun con la clave buena, queda bloqueado un rato');
});

test('la página del QR solo está en el puerto local y trae el enlace', async (t) => {
  const { base, puertoEmparejar, puente } = await preparar(t);
  const html = await (await fetch(`http://127.0.0.1:${puertoEmparejar}/`)).text();
  assert.match(html, /<svg/);
  assert.ok(!html.includes(puente.clave), 'la clave va dentro del QR, no como texto');
  assert.strictEqual((await fetch(`${base}/emparejar`)).status, 404);
});

test('el chat por WebSocket pide clave y un device válido', async (t) => {
  const { puerto, puente } = await preparar(t);
  await assert.rejects(abrirWs(`ws://127.0.0.1:${puerto}/ws?device=02:aa:bb:cc:dd:ee`), /401/);
  await assert.rejects(abrirWs(`ws://127.0.0.1:${puerto}/ws?clave=${puente.clave}&device=nada`), /400/);
});

test('texto y voz pasan por el puente (Opus ⇄ PCM)', async (t) => {
  const { puerto, puente, central } = await preparar(t);
  const ws = await abrirWs(`ws://127.0.0.1:${puerto}/ws?clave=${puente.clave}&device=02:aa:bb:cc:dd:ee`);
  const recibidos = []; const audio = [];
  ws.on('message', (d, bin) => (bin ? audio.push(d) : recibidos.push(JSON.parse(d.toString()))));
  const esperar = async (cond, ms = 3000) => {
    const fin = Date.now() + ms;
    while (!cond()) { if (Date.now() > fin) throw new Error('tiempo agotado'); await new Promise((r) => setTimeout(r, 20)); }
  };
  ws.send(JSON.stringify({ type: 'hello', version: 1, audio_params: { format: 'pcm16', sample_rate: 16000 } }));
  await esperar(() => recibidos.some((m) => m.type === 'hello'));
  const hello = recibidos.find((m) => m.type === 'hello');
  assert.strictEqual(hello.audio_params.format, 'pcm16');
  const c = central.conexiones[0];
  assert.strictEqual(c.headers['device-id'], '02:aa:bb:cc:dd:ee');
  assert.strictEqual(c.helloRecibido.audio_params.format, 'opus', 'la central siempre ve Opus');

  ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: 'hola' }));
  await esperar(() => recibidos.some((m) => m.type === 'tts' && m.state === 'stop') && audio.length >= 8);
  assert.strictEqual(audio[0].length, 1440 * 2, 'cada paquete llega como 60 ms de PCM a 24 kHz');

  // Micrófono: 0,25 s de PCM 16 kHz en pedazos raros → paquetes Opus de 60 ms
  ws.send(JSON.stringify({ type: 'listen', state: 'start', mode: 'manual' }));
  for (let i = 0; i < 4; i++) ws.send(Buffer.alloc(1000 * 2), { binary: true });
  ws.send(JSON.stringify({ type: 'listen', state: 'stop' }));
  await esperar(() => c.mic.length >= 5);
  assert.strictEqual(c.mic.length, 5, '4000 muestras = 4 paquetes llenos + 1 final');
  ws.close();
});

test('lee el nombre de Tailscale aunque haya avisos antes del JSON', () => {
  const { nombreDesdeEstado } = require('../puente.js');
  const salida = 'Warning: client version "1.104.4" != tailscaled server version "1.104.2"\n{"Self":{"DNSName":"alejandro-lopez.tail1234.ts.net."}}';
  assert.strictEqual(nombreDesdeEstado(salida), 'alejandro-lopez.tail1234.ts.net');
  assert.strictEqual(nombreDesdeEstado('sin json'), null);
});
