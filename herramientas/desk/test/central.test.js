// Pruebas de la conexión con la central (sin Electron). Correr: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { Central, explicarError, nuevoDeviceId } = require('../src/central');
const { normalizarUrl } = require('../src/ajustes');
const { crearCentralFalsa } = require('./central-falsa');

const esperarEvento = (em, nombre, cond = () => true, ms = 4000) => new Promise((ok, mal) => {
  const t = setTimeout(() => mal(new Error(`no llegó ${nombre}`)), ms);
  const fn = (d) => { if (cond(d)) { clearTimeout(t); em.off(nombre, fn); ok(d); } };
  em.on(nombre, fn);
});

function arrancar(puerto) {
  return new Promise((ok) => { const s = crearCentralFalsa({ puerto, retrasoMs: 20 }); s.on('listening', () => ok(s)); });
}

test('se conecta, saluda y queda en línea con su device-id', async () => {
  const servidor = await arrancar(0);
  const { port } = servidor.address();
  const c = new Central({ url: `ws://127.0.0.1:${port}/xiaozhi/v1/`, deviceId: '02:aa:bb:cc:dd:ee', clientId: 'prueba' });
  const enLinea = esperarEvento(c, 'estado', (e) => e.estado === 'en-linea');
  c.conectar();
  await enLinea;
  assert.equal(servidor.conexiones[0].deviceId, '02:aa:bb:cc:dd:ee');
  assert.equal(servidor.conexiones[0].headers['client-id'], 'prueba');
  assert.ok(c.sessionId.startsWith('prueba-'));
  c.cerrar();
  servidor.close();
});

test('pregunta por texto y recibe estado, emoción, frases y voz', async () => {
  const servidor = await arrancar(0);
  const { port } = servidor.address();
  const c = new Central({ url: `ws://127.0.0.1:${port}/xiaozhi/v1/`, deviceId: nuevoDeviceId(), clientId: 'x' });
  const mensajes = [];
  let paquetes = 0;
  c.on('mensaje', (m) => mensajes.push(m));
  c.on('audio', () => { paquetes += 1; });
  // Preguntar ANTES de conectar: debe quedar en cola y enviarse al conectar.
  const fin = esperarEvento(c, 'mensaje', (m) => m.type === 'tts' && m.state === 'stop');
  c.preguntar('hola byte');
  await fin;
  const tipos = mensajes.map((m) => (m.type === 'tts' ? `tts:${m.state}` : m.type));
  assert.deepEqual(tipos.slice(0, 4), ['stt', 'tts:start', 'llm', 'tts:sentence_start']);
  assert.equal(mensajes.find((m) => m.type === 'llm').emotion, 'happy');
  assert.equal(mensajes.find((m) => m.state === 'sentence_start').text, '¡Hola, Alejandro!');
  assert.ok(paquetes >= 5, 'llegaron paquetes de voz');
  c.cerrar();
  servidor.close();
});

test('si la central se cae, se reconecta sola', async () => {
  const servidor = await arrancar(0);
  const { port } = servidor.address();
  const c = new Central({ url: `ws://127.0.0.1:${port}/xiaozhi/v1/`, deviceId: nuevoDeviceId(), clientId: 'x' });
  c.conectar();
  await esperarEvento(c, 'estado', (e) => e.estado === 'en-linea');
  const reintento = esperarEvento(c, 'reintento');
  servidor.conexiones[0].ws.close();     // la central cuelga (como al pasar 2 min sin hablar)
  await reintento;
  await esperarEvento(c, 'estado', (e) => e.estado === 'en-linea', 5000);
  assert.equal(servidor.conexiones.length, 2);
  c.cerrar();
  servidor.close();
});

test('cerrar a propósito no reintenta', async () => {
  const servidor = await arrancar(0);
  const { port } = servidor.address();
  const c = new Central({ url: `ws://127.0.0.1:${port}/xiaozhi/v1/`, deviceId: nuevoDeviceId(), clientId: 'x' });
  c.conectar();
  await esperarEvento(c, 'estado', (e) => e.estado === 'en-linea');
  let reintentos = 0;
  c.on('reintento', () => { reintentos += 1; });
  c.cerrar();
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(reintentos, 0);
  assert.equal(c.estado, 'desconectado');
  servidor.close();
});

test('central apagada: explica el error en español', async () => {
  const c = new Central({ url: 'ws://127.0.0.1:1/xiaozhi/v1/', deviceId: nuevoDeviceId(), clientId: 'x' });
  const error = esperarEvento(c, 'error-conexion');
  c.conectar();
  assert.match(await error, /central no responde/);
  c.cerrar();
});

test('normaliza lo que escriba Alejandro en Ajustes', () => {
  assert.equal(normalizarUrl('192.168.1.50'), 'ws://192.168.1.50:8000/xiaozhi/v1/');
  assert.equal(normalizarUrl('ws://192.168.1.50:8000/xiaozhi/v1/'), 'ws://192.168.1.50:8000/xiaozhi/v1/');
  assert.equal(normalizarUrl(''), 'ws://127.0.0.1:8000/xiaozhi/v1/');
  assert.throws(() => normalizarUrl('no es una ip con espacios'));
});

test('device-id con forma de MAC local', () => {
  assert.match(nuevoDeviceId(), /^02(:[0-9a-f]{2}){5}$/);
  assert.match(explicarError({ code: 'EHOSTUNREACH' }), /mismo WiFi/);
});
