// app.js — Byte en el iPhone.
//
// Habla con el "puente" del HP (puente.js) por la misma dirección https de Tailscale:
//   • wss://.../ws         → chat en vivo con la central (texto y voz)
//   • https://.../api/...  → estado y administración (encender, reiniciar, registro)
// Las dos cosas piden la CLAVE que el celular recibió al escanear el QR.
// Las piezas del chat (Conversacion, caras, burbujas) son las mismas de Byte Desk (comun.js).

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
ICONOS.pulso = '<path d="M3 12h4l2-6 4 12 2-6h6"/>';

// ---------- Guardado local (a prueba de modo privado) ----------
const guardado = {
  leer(k, d = null) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  poner(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio o modo privado */ } },
  quitar(k) { try { localStorage.removeItem(k); } catch { /* nada */ } },
};

// ---------- Clave: llega en el enlace del QR (#clave=...) ----------
(function tomarClave() {
  const m = location.hash.match(/clave=([A-Za-z0-9_-]{20,})/);
  if (m) {
    guardado.poner('byte-clave', m[1]);
    history.replaceState(null, '', location.pathname);   // que no quede a la vista
  }
})();
let clave = guardado.leer('byte-clave');

/** Un id fijo para este celular, con forma de MAC (02: = inventado localmente). */
function idDelCelular() {
  let id = guardado.leer('byte-device');
  if (!id) {
    const b = crypto.getRandomValues(new Uint8Array(5));
    id = ['02', ...[...b].map((x) => x.toString(16).padStart(2, '0'))].join(':');
    guardado.poner('byte-device', id);
  }
  return id;
}
const deviceId = idDelCelular();

// ---------- Pantallas ----------
let seccion = 'chat';
function mostrar(s) {
  seccion = s;
  ['chat', 'estado', 'ajustes'].forEach((x) => { $(`#s-${x}`).hidden = x !== s; });
  $('#zona-entrada').hidden = s !== 'chat';
  $$('.pestanas button').forEach((b) => { if (b.dataset.s === s) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  if (s === 'estado') cargarEstado();
}
$$('.pestanas button').forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.s)));
$$('[data-ic]').forEach((el) => { el.innerHTML = icono(el.dataset.ic, 22); });

function pintarEmparejado() {
  $('#s-emparejar').hidden = Boolean(clave);
  $('#principal').hidden = !clave;
}

// ---------- Conversación ----------
const voz = new VozPcm();
let vozActiva = guardado.leer('byte-voz', true);
const conv = new Conversacion({ guardarEn: 'byte-movil-chat', alCambiar: pintarChat });

function pintarChat() {
  const chat = $('#chat');
  const caja = $('#s-chat');
  if (!conv.mensajes.length) {
    chat.innerHTML = `<div class="vacio"><div class="byte grande" data-estado="${conv.estado}"><i class="ojo"></i><i class="ojo"></i></div>
      <div>Escríbele a Byte o toca el micrófono.<br><span class="nota">Es la misma central: misma memoria y personalidad.</span></div></div>`;
  } else {
    chat.innerHTML = burbujasHTML(conv.mensajes, conv.estado === 'pensando');
    caja.scrollTop = caja.scrollHeight;
  }
  pintarCaras(conv.estado, conv.cara);
  const est = $('#estado');
  est.dataset.estado = conv.conexion;
  est.textContent = micro.activo ? 'te escucho…' : (conv.estado === 'reposo' ? 'en línea' : conv.textoEstado());
  const b = $('#boton-enviar');
  const hablando = conv.estado === 'hablando';
  b.classList.toggle('parar', hablando);
  b.innerHTML = icono(hablando ? 'parar' : 'enviar', 20);
  b.setAttribute('aria-label', hablando ? 'Detener a Byte' : 'Enviar');
  b.type = hablando ? 'button' : 'submit';
}

// ---------- Conexión con el puente (WebSocket) ----------
let ws = null;
let enLinea = false;
let sessionId = null;
let reintento = 1500;
let temporizador = null;
let pendientes = [];
let porVoz = false;        // la próxima respuesta 'stt' es lo que dijiste en voz

function conectar() {
  if (!clave || document.hidden) return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(temporizador);
  conv.conexionCambio({ estado: 'conectando' });
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?clave=${encodeURIComponent(clave)}&device=${encodeURIComponent(deviceId)}`;
  const s = new WebSocket(url);
  s.binaryType = 'arraybuffer';
  ws = s;
  s.onopen = () => {
    s.send(JSON.stringify({ type: 'hello', version: 1, transport: 'websocket',
      audio_params: { format: 'opus', sample_rate: 16000, channels: 1, frame_duration: 60 } }));
  };
  s.onmessage = (ev) => {
    if (typeof ev.data !== 'string') { if (vozActiva) voz.pedazo(ev.data); return; }
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === 'hello') {
      sessionId = m.session_id || null;
      voz.hz = (m.audio_params && m.audio_params.sample_rate) || 24000;
      enLinea = true; reintento = 1500;
      conv.conexionCambio({ estado: 'en-linea' });
      pendientes.splice(0).forEach(enviarTexto);
      return;
    }
    if (m.type === 'puente') { conv.sistema(m.detalle || 'El puente avisa un problema.'); return; }
    if (m.type === 'stt' && porVoz && m.text) { porVoz = false; conv.pregunta(m.text); return; }
    if (m.type === 'tts' && m.state === 'start') voz.siguiente = 0;
    conv.mensaje(m);
  };
  s.onclose = (ev) => {
    if (ws !== s) return;
    ws = null; enLinea = false; sessionId = null;
    if (micro.activo) micro.terminar(false);
    conv.conexionCambio({ estado: 'desconectado' });
    if (ev.code === 1006 && !navigator.onLine) conv.sistema('Sin internet en el celular.');
    if (document.hidden) return;   // al volver a la app se reconecta
    // 401 llega como cierre sin abrir: revisamos la clave por la API.
    comprobarClave();
    temporizador = setTimeout(conectar, reintento);
    reintento = Math.min(reintento * 2, 30000);
  };
}

async function comprobarClave() {
  try {
    const r = await fetch('/api/estado', { headers: { Authorization: `Bearer ${clave}` } });
    if (r.status === 401) { clave = null; guardado.quitar('byte-clave'); pintarEmparejado(); }
  } catch { /* sin red: ya avisamos */ }
}

function enviarTexto(t) { ws.send(JSON.stringify({ type: 'listen', state: 'detect', text: t })); }

function preguntar(texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  voz.desbloquear();
  conv.pregunta(t);
  if (enLinea && ws && ws.readyState === WebSocket.OPEN) enviarTexto(t);
  else { pendientes.push(t); conv.sistema('Conectando con Byte… te lo mando apenas responda.'); reintento = 1500; conectar(); }
}

$('#f-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#texto');
  preguntar(i.value);
  i.value = '';
});
$('#boton-enviar').addEventListener('click', () => {
  if (conv.estado !== 'hablando') return;
  voz.callar();
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'abort', session_id: sessionId, reason: 'wake_word_detected' }));
});
$('#chips').addEventListener('click', (e) => { const c = e.target.closest('.chip'); if (c) preguntar(c.dataset.p); });

// ---------- Micrófono: toca, habla, y se envía solo cuando haces silencio ----------
const micro = new MicroPcm({
  alPedazo: (buf) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(buf); },
  alNivel: (n) => $('#boton-mic').style.setProperty('--nivel', n.toFixed(2)),
  alTerminar: (valida) => {
    pintarMic();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'listen', session_id: sessionId, state: 'stop' }));
      if (valida) { porVoz = true; conv._ponerEstado('pensando'); }
    }
    if (!valida) conv.sistema('No te escuché. Toca el micrófono y habla un poquito más cerca.');
    pintarChat();
  },
  alError: (t) => { conv.sistema(t); pintarMic(); },
});
function pintarMic() {
  const b = $('#boton-mic');
  b.innerHTML = icono('mic', 20);
  b.classList.toggle('escuchando', micro.activo);
  b.setAttribute('aria-label', micro.activo ? 'Terminar y enviar' : 'Hablarle');
}
$('#boton-mic').addEventListener('click', async () => {
  voz.desbloquear();
  if (micro.activo) { micro.terminar(true); return; }
  if (!enLinea) { conv.sistema('Espera a que Byte esté en línea para hablarle.'); conectar(); return; }
  voz.callar();
  if (conv.estado === 'hablando') ws.send(JSON.stringify({ type: 'abort', session_id: sessionId, reason: 'wake_word_detected' }));
  ws.send(JSON.stringify({ type: 'listen', session_id: sessionId, state: 'start', mode: 'manual' }));
  if (!(await micro.empezar())) {
    ws.send(JSON.stringify({ type: 'listen', session_id: sessionId, state: 'stop' }));
  }
  pintarMic(); pintarChat();
});

// ---------- Estado y administración ----------
async function api(ruta, metodo = 'GET') {
  const r = await fetch(ruta, { method: metodo, headers: { Authorization: `Bearer ${clave}` } });
  if (r.status === 401) { clave = null; guardado.quitar('byte-clave'); pintarEmparejado(); throw new Error('Este celular ya no está emparejado.'); }
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(datos.error || datos.texto || `Error ${r.status}`);
  return datos;
}

async function cargarEstado() {
  const nota = $('#estado-hora');
  try {
    const d = await api('/api/estado');
    $('#lista-servicios').innerHTML = d.servicios.map((s) => `<li>
      <span class="luz ${s.ok ? 'ok' : s.opcional ? 'opcional' : ''}"></span>
      <span class="t">${esc(s.nombre)}<small>${esc(s.detalle)}${s.desde ? ` · desde ${esc(new Date(s.desde).toLocaleString('es-CO', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }))}` : ''}</small></span></li>`).join('');
    nota.textContent = `Revisado a las ${new Date(d.hora).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}. Toca "Estado" de nuevo para actualizar.`;
  } catch (e) {
    nota.textContent = navigator.onLine ? `No pude revisar: ${e.message}. ¿Está prendido el HP con el puente?` : 'Sin internet en el celular.';
  }
}

const PREGUNTAS = {
  encender: null,
  reiniciar: '¿Reiniciar la central? Byte se desconecta unos 30 segundos.',
  apagar: '¿Apagar la central? Byte deja de responder hasta que la enciendas otra vez desde aquí.',
};
$$('[data-orden]').forEach((b) => b.addEventListener('click', async () => {
  const orden = b.dataset.orden;
  if (PREGUNTAS[orden] && !confirm(PREGUNTAS[orden])) return;
  const nota = $('#orden-nota');
  $$('[data-orden]').forEach((x) => { x.disabled = true; });
  nota.textContent = orden === 'encender' ? 'Encendiendo… (puede tardar un minuto)' : orden === 'reiniciar' ? 'Reiniciando…' : 'Apagando…';
  try {
    await api(`/api/central/${orden}`, 'POST');
    nota.textContent = orden === 'apagar' ? 'Central apagada.' : 'Listo. Byte vuelve en unos segundos.';
    if (orden !== 'apagar') setTimeout(() => { reintento = 1500; conectar(); }, 8000);
  } catch (e) {
    nota.textContent = `No se pudo: ${e.message}`;
  } finally {
    $$('[data-orden]').forEach((x) => { x.disabled = false; });
    cargarEstado();
  }
}));
$('#ver-registro').addEventListener('click', async () => {
  const pre = $('#registro');
  pre.hidden = false;
  pre.textContent = 'Cargando…';
  try { pre.textContent = (await api('/api/registro')).texto || '(vacío)'; pre.scrollTop = pre.scrollHeight; }
  catch (e) { pre.textContent = e.message; }
});

// ---------- Ajustes ----------
const esApp = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
$('#instalar').hidden = esApp;
$('#voz-activa').checked = vozActiva;
$('#voz-activa').addEventListener('change', (e) => {
  vozActiva = e.target.checked; guardado.poner('byte-voz', vozActiva);
  if (vozActiva) voz.desbloquear(); else voz.callar();
});
$('#borrar-chat').addEventListener('click', () => { if (confirm('¿Borrar el chat de este celular?')) conv.borrar(); });
$('#olvidar').addEventListener('click', () => {
  if (!confirm('¿Desemparejar? Tendrás que escanear el código del HP otra vez.')) return;
  guardado.quitar('byte-clave'); clave = null;
  if (ws) ws.close();
  pintarEmparejado();
});
$('#info-dispositivo').textContent = `Este celular es ${deviceId} para la central.`;

// ---------- Ciclo de vida: iOS congela la app en segundo plano ----------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (micro.activo) micro.terminar(false);
  } else {
    reintento = 1500;
    conectar();
    if (seccion === 'estado') cargarEstado();
  }
});
window.addEventListener('online', () => { reintento = 1500; conectar(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

pintarEmparejado();
pintarMic();
pintarChat();
conectar();
