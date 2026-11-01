// central-falsa.js — Central de MENTIRA para probar el puente sin Docker.
// Habla el protocolo de XiaoZhi y manda voz Opus de verdad (un tono corto),
// y cuenta los paquetes de micrófono que recibe.
const { WebSocketServer } = require('ws');
const OpusScript = require('opusscript');

function crearCentralFalsa({ puerto = 0 } = {}) {
  const wss = new WebSocketServer({ port: puerto, host: '127.0.0.1', path: '/xiaozhi/v1/' });
  wss.conexiones = [];
  const enc = new OpusScript(24000, 1, OpusScript.Application.AUDIO);
  const tono = Buffer.alloc(1440 * 2);
  for (let i = 0; i < 1440; i++) tono.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 440 * i) / 24000)), i * 2);
  const paquete = Buffer.from(enc.encode(tono, 1440));

  wss.on('connection', (ws, req) => {
    const c = { ws, headers: req.headers, mic: [], helloRecibido: null, textos: [] };
    wss.conexiones.push(c);
    const enviar = (o) => ws.readyState === 1 && ws.send(JSON.stringify({ ...o, session_id: 'prueba' }));
    ws.on('message', (datos, binario) => {
      if (binario) { c.mic.push(Buffer.from(datos)); return; }
      const m = JSON.parse(datos.toString());
      c.textos.push(m);
      if (m.type === 'hello') {
        c.helloRecibido = m;
        ws.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket', session_id: 'prueba',
          audio_params: { format: 'opus', sample_rate: 24000, channels: 1, frame_duration: 60 } }));
      } else if (m.type === 'listen' && ((m.state === 'detect' && m.text) || m.state === 'stop')) {
        const texto = m.text || 'hola desde la voz';
        enviar({ type: 'stt', text: texto });
        enviar({ type: 'tts', state: 'start' });
        enviar({ type: 'llm', text: '😊', emotion: 'happy' });
        enviar({ type: 'tts', state: 'sentence_start', text: `¡Hola, Alejandro! Me dijiste: ${texto}` });
        for (let i = 0; i < 8; i++) ws.send(paquete);
        enviar({ type: 'tts', state: 'stop' });
      }
    });
  });
  return wss;
}

if (require.main === module) {
  const wss = crearCentralFalsa({ puerto: Number(process.argv[2]) || 8000 });
  wss.on('listening', () => console.log(`Central falsa en ws://127.0.0.1:${wss.address().port}/xiaozhi/v1/`));
}
module.exports = { crearCentralFalsa };
