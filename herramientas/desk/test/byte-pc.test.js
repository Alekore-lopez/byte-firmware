// Prueba BytePc contra un programa del PC "de mentira" (mismas rutas que byte_pantalla.py).
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { once } = require('node:events');
const { BytePc, normalizar } = require('../src/byte-pc');

function programaFalso({ preguntar = true, viejo = false } = {}) {
  const recibidas = [];
  let sse = null;
  const srv = http.createServer((req, res) => {
    if (req.url === '/estado') {
      if (viejo) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ byte: 'pc', estado: 'idle', preguntar }));
    }
    if (req.url === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"type":"state","state":"idle"}\n\n');
      sse = res;
      return;
    }
    if (req.url === '/preguntar' && req.method === 'POST') {
      let c = '';
      req.on('data', (d) => { c += d; });
      req.on('end', () => {
        recibidas.push(JSON.parse(c).texto);
        res.writeHead(204); res.end();
        sse.write('data: {"type":"tts","state":"sentence_start","text":"Hola Alejandro"}\n\n');
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  return { srv, recibidas, cerrar: () => { if (sse) sse.end(); srv.closeAllConnections(); srv.close(); } };
}

async function arrancar(op) {
  const p = programaFalso(op);
  p.srv.listen(0, '127.0.0.1');
  await once(p.srv, 'listening');
  const pc = new BytePc({ base: { host: '127.0.0.1', port: p.srv.address().port } });
  return { p, pc };
}

test('detecta el programa del PC, le pasa la pregunta y recibe la respuesta', async () => {
  const { p, pc } = await arrancar();
  pc.iniciar();
  await once(pc, 'estado');
  assert.ok(pc.disponible);
  const respuesta = new Promise((ok) => pc.on('mensaje', (m) => { if (m.type === 'tts') ok(m); }));
  await new Promise((r) => setTimeout(r, 100)); // que se abra /events
  assert.strictEqual(await pc.preguntar('¿Qué clima hace?'), true);
  assert.deepStrictEqual(p.recibidas, ['¿Qué clima hace?']);
  assert.strictEqual((await respuesta).text, 'Hola Alejandro');
  pc.detener(); p.cerrar();
});

test('versión vieja del programa: abierto pero no recibe preguntas', async () => {
  const { p, pc } = await arrancar({ viejo: true });
  pc.iniciar();
  await once(pc, 'estado');
  assert.ok(pc.abierto);
  assert.ok(!pc.disponible);
  assert.strictEqual(await pc.preguntar('hola'), false);
  pc.detener(); p.cerrar();
});

test('programa cerrado: Byte Desk contesta solo', async () => {
  const pc = new BytePc({ base: { host: '127.0.0.1', port: 1 } });
  await pc._revisar();
  assert.ok(!pc.abierto);
  assert.strictEqual(await pc.preguntar('hola'), false);
});

test('normalizar ignora tildes, mayúsculas y signos', () => {
  assert.strictEqual(normalizar('¿Qué clima hace?'), normalizar('que clima hace'));
});
