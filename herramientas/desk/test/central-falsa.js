// central-falsa.js — Una central de MENTIRA para probar Byte Desk sin Docker.
// Habla el mismo protocolo que la central real, pero responde frases fijas.
//
// Uso:   npm run central-falsa      (queda en ws://127.0.0.1:8000/xiaozhi/v1/)
//        npm run central-falsa 8123 (otro puerto)
// Luego abre Byte Desk con `npm start`.

const { WebSocketServer } = require('ws');

// Paquete Opus de 20 ms de silencio: sirve para probar que la voz llega
// sin necesitar un codificador. La central real manda voz de verdad.
const SILENCIO_OPUS = Buffer.from([0xf8, 0xff, 0xfe]);

const RESPUESTAS = [
  { si: /hola|saluda/i, emocion: 'happy', emoji: '😊', frases: ['¡Hola, Alejandro!', 'Soy la central de prueba, pero ya me ves en tu escritorio.'] },
  { si: /clima/i, emocion: 'cool', emoji: '😎', frases: ['Aquí en la central falsa siempre hace 22 grados.', 'Con la central real te digo el clima de verdad.'] },
  { si: /.*/, emocion: 'thinking', emoji: '🤔', frases: ['Te escuché: “{t}”.', 'Esto es una prueba; la central real te responde con Gemini.'] },
];

function crearCentralFalsa({ puerto = 8000, retrasoMs = 120 } = {}) {
  const wss = new WebSocketServer({ port: puerto, path: '/xiaozhi/v1/' });
  wss.conexiones = [];

  wss.on('connection', (ws, req) => {
    const deviceId = req.headers['device-id'];
    wss.conexiones.push({ ws, deviceId, headers: req.headers });
    const sessionId = `prueba-${Math.random().toString(36).slice(2, 8)}`;
    const enviar = (o) => ws.readyState === 1 && ws.send(JSON.stringify({ ...o, session_id: sessionId }));
    const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

    ws.on('message', async (datos, binario) => {
      if (binario) return;
      let m;
      try { m = JSON.parse(datos.toString()); } catch { return; }
      if (m.type === 'hello') {
        ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', session_id: sessionId,
          audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 60 } }));
      } else if (m.type === 'listen' && m.state === 'detect' && m.text) {
        const r = RESPUESTAS.find((x) => x.si.test(m.text));
        enviar({ type: 'stt', text: m.text });
        enviar({ type: 'tts', state: 'start' });
        await esperar(retrasoMs * 3);
        enviar({ type: 'llm', text: r.emoji, emotion: r.emocion });
        for (const f of r.frases) {
          const frase = f.replace('{t}', m.text);
          enviar({ type: 'tts', state: 'sentence_start', text: frase });
          for (let i = 0; i < 5; i++) { if (ws.readyState === 1) ws.send(SILENCIO_OPUS); await esperar(retrasoMs / 5); }
          enviar({ type: 'tts', state: 'sentence_end', text: frase });
        }
        enviar({ type: 'tts', state: 'stop' });
      }
    });
  });
  return wss;
}

if (require.main === module) {
  const puerto = Number(process.argv[2]) || 8000;
  crearCentralFalsa({ puerto });
  console.log(`Central FALSA escuchando en ws://127.0.0.1:${puerto}/xiaozhi/v1/  (Ctrl+C para apagar)`);
}

module.exports = { crearCentralFalsa, SILENCIO_OPUS };
