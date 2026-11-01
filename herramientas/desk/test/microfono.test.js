// Pruebas del filtro de voz del micrófono (sin micrófono de verdad).
const test = require('node:test');
const assert = require('node:assert');
const { MicrofonoDeByte } = require('../renderer/microfono.js');

const N = 1024; // 64 ms a 16 kHz

/** Un pedazo de "voz": tono de 220 Hz con algo de ruido, a cierto volumen. */
function tono(nivel, hz = 220) {
  const d = new Float32Array(N);
  for (let i = 0; i < N; i++) d[i] = nivel * Math.sin((2 * Math.PI * hz * i) / 16000) + (Math.random() - 0.5) * nivel * 0.2;
  return d;
}
const silencio = () => tono(0.0008, 300);

function micDePrueba() {
  const ev = [];
  const m = new MicrofonoDeByte({
    alEmpezarFrase: () => ev.push('inicio'),
    alTerminarFrase: (v) => ev.push(v ? 'fin' : 'descartar'),
  });
  m.ctx = { sampleRate: 16000 };
  m.encoder = null;           // no codificamos en la prueba
  m.flujo = {};               // "encendido"
  m.pausado = false;
  return { m, ev };
}
const pasar = (m, f, veces) => { for (let i = 0; i < veces; i++) m._pedazo(f()); };

test('una TV lejana pareja no abre el micrófono', () => {
  const { m, ev } = micDePrueba();
  pasar(m, silencio, 20);
  pasar(m, () => tono(0.006), 80);   // ~5 s de TV bajita
  assert.deepStrictEqual(ev, []);
});

test('alguien hablando cerca abre la frase y 1,6 s de silencio la cierran', () => {
  const { m, ev } = micDePrueba();
  pasar(m, silencio, 20);
  pasar(m, () => tono(0.15), 20);     // ~1,3 s de voz
  assert.deepStrictEqual(ev, ['inicio']);
  pasar(m, silencio, 10);              // 0,64 s: una pausa normal, NO corta
  assert.deepStrictEqual(ev, ['inicio']);
  pasar(m, () => tono(0.15), 5);
  pasar(m, silencio, 30);              // ~1,9 s de silencio: termina
  assert.deepStrictEqual(ev, ['inicio', 'fin']);
  assert.strictEqual(m.pausado, true, 'queda en pausa hasta que Byte conteste');
});

test('un golpe corto se descarta', () => {
  const { m, ev } = micDePrueba();
  pasar(m, silencio, 20);
  pasar(m, () => tono(0.2), 4);        // ~0,26 s
  pasar(m, silencio, 30);
  assert.deepStrictEqual(ev, ['inicio', 'descartar']);
});

test('pausado no escucha nada', () => {
  const { m, ev } = micDePrueba();
  m.pausar();
  pasar(m, () => tono(0.2), 30);
  assert.deepStrictEqual(ev, []);
});

test('una TV fuerte sin pausas se descarta y se aprende como ruido', () => {
  const { m, ev } = micDePrueba();
  pasar(m, silencio, 20);
  pasar(m, () => tono(0.05), 260);    // ~16 s de TV sin parar
  assert.deepStrictEqual(ev, ['inicio', 'descartar']);
  m.reanudar();
  pasar(m, () => tono(0.05), 60);     // la misma TV ya no abre
  assert.deepStrictEqual(ev, ['inicio', 'descartar']);
  pasar(m, () => tono(0.3), 20);      // tú, más cerca y más fuerte, sí
  assert.deepStrictEqual(ev, ['inicio', 'descartar', 'inicio']);
});
