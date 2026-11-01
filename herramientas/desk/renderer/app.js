// app.js — La ventana grande de Byte Desk.
// Todo lo que pide al computador pasa por window.byte (ver src/preload.js).

const $ = (sel) => document.querySelector(sel);
const ES_MAC = window.byte.plataforma === 'darwin';
document.body.classList.add(ES_MAC ? 'mac' : 'win');

const SECCIONES = [
  { id: 'inicio', nombre: 'Inicio', sub: 'Tu día de un vistazo' },
  { id: 'chat', nombre: 'Chat', sub: 'Habla o escribe con Byte' },
  { id: 'tareas', nombre: 'Tareas', sub: 'Lo que tienes pendiente' },
  { id: 'enfoque', nombre: 'Enfoque', sub: 'Trabaja sin distracciones' },
  { id: 'archivos', nombre: 'Archivos', sub: 'Byte ordena, tú apruebas' },
  { id: 'mensajes', nombre: 'Mensajes', sub: 'Siempre te muestra el texto antes' },
  { id: 'equipo', nombre: ES_MAC ? 'Mi Mac' : 'Mi PC', sub: 'Tu computador en vivo' },
  { id: 'ajustes', nombre: 'Ajustes', sub: 'Conexión y preferencias' },
];
let seccion = 'chat';
let ajustes = {};
let tareas = [];
let pc = { abierto: false, responde: false, viejo: false };
const voz = new VozDeByte();

// ---------- Conversación en vivo ----------

const conv = new Conversacion({ guardarEn: 'byte-desk-chat', alCambiar: pintarChat });

function pintarChat() {
  const chat = $('#chat');
  if (!conv.mensajes.length) {
    chat.innerHTML = `<div class="vacio"><div class="byte grande" data-estado="${conv.estado}"><i class="ojo"></i><i class="ojo"></i></div>
      <div>Escríbele a Byte o toca una sugerencia.<br><span class="nota">Usa tu misma central: misma memoria y personalidad.</span></div></div>`;
    pintarCaras(conv.estado, conv.cara);
  } else {
    const abajo = chat.parentElement.scrollHeight - chat.parentElement.scrollTop - chat.parentElement.clientHeight < 80;
    chat.innerHTML = burbujasHTML(conv.mensajes, conv.estado === 'pensando');
    if (abajo || conv.estado !== 'reposo') chat.parentElement.scrollTop = chat.parentElement.scrollHeight;
  }
  const est = $('#estado');
  est.dataset.estado = conv.conexion;
  est.textContent = conv.textoEstado() + (pc.responde && conv.estado === 'reposo' ? ' · voz en el PC' : '');
  // El botón de enviar se vuelve "Detener" mientras Byte habla.
  const b = $('#boton-enviar');
  const hablando = conv.estado === 'hablando';
  b.classList.toggle('parar', hablando);
  b.innerHTML = icono(hablando ? 'parar' : 'enviar');
  b.setAttribute('aria-label', hablando ? 'Detener a Byte' : 'Enviar');
  b.type = hablando ? 'button' : 'submit';
  if (seccion === 'inicio') pintarInicio();
}

window.byte.alEstado((e) => {
  conv.conexionCambio(e);
  if (e.estado === 'en-linea') ultimoError = '';
  pintarInfoCentral();
});
window.byte.alPregunta((t) => conv.pregunta(t));
window.byte.alPc((e) => { pc = e; pintarChat(); pintarPc(); });
window.byte.alMensaje((m) => {
  if (m.type === 'tts' && m.state === 'start') voz.siguiente = 0;
  conv.mensaje(m);
});
window.byte.alAudio((bytes) => voz.paquete(bytes));
let ultimoError = '';
let proximoIntento = 0;
window.byte.alError((t) => { ultimoError = t; pintarInfoCentral(); });
window.byte.alReintento((r) => { proximoIntento = Date.now() + r.enMs; pintarInfoCentral(); });

async function preguntar(texto) {
  const t = String(texto || '').trim();
  if (!t) return;
  if (conv.conexion !== 'en-linea') conv.sistema('Conectando con la central… te lo mando apenas responda.');
  await window.byte.preguntar(t);
}

$('#f-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#texto');
  preguntar(i.value);
  i.value = '';
});
$('#boton-enviar').addEventListener('click', () => {
  if (conv.estado === 'hablando') { voz.callar(); window.byte.interrumpir(); }
});
$('#chips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (c) { irA('chat'); preguntar(c.dataset.p); }
});

// ---------- Navegación ----------

function pintarMenu() {
  $('#menu').innerHTML = SECCIONES.map((s) => `<button class="nav" data-s="${s.id}" ${s.id === seccion ? 'aria-current="page"' : ''} title="${s.nombre}">
    ${icono(s.id)}<span>${s.nombre}</span>${s.id === 'tareas' && pendientes() ? `<span class="n">${pendientes()}</span>` : ''}</button>`).join('');
}
$('#menu').addEventListener('click', (e) => { const b = e.target.closest('.nav'); if (b) irA(b.dataset.s); });

function irA(id) {
  if (!SECCIONES.some((s) => s.id === id)) return;
  seccion = id;
  const s = SECCIONES.find((x) => x.id === id);
  $('#titulo').textContent = s.nombre;
  $('#subtitulo').textContent = s.sub;
  SECCIONES.forEach((x) => { $(`#s-${x.id}`).hidden = x.id !== id; });
  $('#zona-entrada').classList.toggle('oculto', !(id === 'chat' || id === 'inicio'));
  pintarMenu();
  if (id === 'inicio') pintarInicio();
  if (id === 'chat') { pintarChat(); $('#texto').focus(); }
  if (id === 'tareas') pintarTareas();
  if (id === 'archivos') pintarCarpetas();
  if (id === 'equipo') pintarEquipo();
  if (id === 'ajustes') pintarAjustes();
}
window.byte.alIrA((id) => irA(id));

// ---------- Inicio ----------

function saludo() {
  const h = new Date().getHours();
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}
function pintarInicio() {
  const ultimo = [...conv.mensajes].reverse().find((m) => m.de === 'byte');
  const siguiente = tareas.find((t) => !t.hecha);
  $('#s-inicio').innerHTML = `<div class="rejilla">
    <div class="caja"><span class="k">${saludo()}</span><span class="v">Alejandro</span><span class="nota">${new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })}</span></div>
    <div class="caja"><span class="k">Central</span><span class="v chico" style="color:${conv.conexion === 'en-linea' ? 'var(--neon)' : 'var(--ambar)'}">${conv.conexion === 'en-linea' ? 'En línea' : conv.conexion === 'conectando' ? 'Conectando…' : 'Sin conexión'}</span><span class="nota">${esc(ajustes.centralUrl || '')}</span></div>
    <div class="caja"><span class="k">Tareas</span><span class="v">${tareas.filter((t) => t.hecha).length} de ${tareas.length}</span><span class="nota">${siguiente ? `Siguiente: ${esc(siguiente.texto)}` : 'Nada pendiente'}</span></div>
    <div class="caja"><span class="k">Lo último que dijo Byte</span><span class="v chico">${ultimo ? esc(ultimo.texto.slice(0, 120)) : '—'}</span></div>
  </div>`;
}

// ---------- Tareas (se guardan en este computador) ----------

const pendientes = () => tareas.filter((t) => !t.hecha).length;
function pintarTareas() {
  $('#lista-tareas').innerHTML = tareas.map((t) => `<li class="${t.hecha ? 'hecha' : ''}" data-id="${esc(t.id)}">
    <input type="checkbox" id="t-${esc(t.id)}" ${t.hecha ? 'checked' : ''}><label for="t-${esc(t.id)}">${esc(t.texto)}</label>
    <button class="btn d" data-borrar="${esc(t.id)}" aria-label="Borrar tarea">Quitar</button></li>`).join('');
  $('#tareas-vacio').hidden = tareas.length > 0;
  pintarMenu();
}
async function guardarTareas() { await window.byte.guardarTareas(tareas); pintarTareas(); }
$('#f-tarea').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#nueva-tarea');
  const texto = i.value.trim();
  if (!texto) return;
  tareas.push({ id: Date.now().toString(36), texto, hecha: false });
  i.value = '';
  guardarTareas();
});
$('#lista-tareas').addEventListener('change', (e) => {
  const li = e.target.closest('li');
  const t = li && tareas.find((x) => x.id === li.dataset.id);
  if (t) { t.hecha = e.target.checked; guardarTareas(); }
});
$('#lista-tareas').addEventListener('click', (e) => {
  const id = e.target.dataset && e.target.dataset.borrar;
  if (id) { tareas = tareas.filter((t) => t.id !== id); guardarTareas(); }
});

// ---------- Enfoque ----------

let enfoqueMin = 25;
let enfoqueFin = 0;
let enfoqueTimer = null;
function pintarReloj() {
  const resta = enfoqueFin ? Math.max(0, enfoqueFin - Date.now()) : enfoqueMin * 60000;
  const m = Math.floor(resta / 60000);
  const s = Math.floor((resta % 60000) / 1000);
  $('#reloj').textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  if (enfoqueFin && resta === 0) {
    clearInterval(enfoqueTimer);
    enfoqueFin = 0;
    $('#enfoque-iniciar').textContent = 'Empezar';
    $('#enfoque-nota').textContent = '¡Terminaste! Tómate un respiro.';
    window.byte.notificar('Byte Desk', `¡Listo! Terminaron tus ${enfoqueMin} minutos de enfoque.`);
  }
}
$('#s-enfoque').addEventListener('click', (e) => {
  const min = e.target.dataset && e.target.dataset.min;
  if (min && !enfoqueFin) { enfoqueMin = Number(min); pintarReloj(); }
});
$('#enfoque-iniciar').addEventListener('click', () => {
  if (enfoqueFin) {
    clearInterval(enfoqueTimer); enfoqueFin = 0;
    $('#enfoque-iniciar').textContent = 'Empezar';
    $('#enfoque-nota').textContent = 'Pausado. Elige un tiempo y vuelve a empezar.';
  } else {
    enfoqueFin = Date.now() + enfoqueMin * 60000;
    enfoqueTimer = setInterval(pintarReloj, 500);
    $('#enfoque-iniciar').textContent = 'Detener';
    $('#enfoque-nota').textContent = `Enfocado ${enfoqueMin} minutos. Byte te avisa al terminar.`;
  }
  pintarReloj();
});

// ---------- Archivos (solo muestra las carpetas autorizadas) ----------

async function pintarCarpetas() {
  const lista = await window.byte.carpetas();
  $('#lista-carpetas').innerHTML = lista.map((c) => `<li>${icono('archivos')}<div style="min-width:0"><div>${esc(c.nombre)}</div><div class="ruta">${esc(c.ruta)}</div></div>
    <span class="d">${c.archivos === null ? 'pide permiso' : `${c.archivos} archivos`}<br><span class="pill ok">permitida</span></span></li>`).join('')
    + `<li>${icono('ajustes')}<div>Sistema y programas</div><span class="d"><span class="pill no">bloqueada</span></span></li>`;
}

// ---------- Mi PC / Mi Mac (en vivo, cada 3 s) ----------

const GB = (b) => `${(b / 1024 ** 3).toFixed(b > 100 * 1024 ** 3 ? 0 : 1)} GB`;
let bateria = null;
if (navigator.getBattery) navigator.getBattery().then((b) => { bateria = b; }).catch(() => {});
async function pintarEquipo() {
  if (seccion !== 'equipo') return;
  const s = await window.byte.sistema();
  const usada = s.memoria.total - s.memoria.libre;
  const horas = Math.floor(s.encendidoDesde / 3600);
  const caja = (k, v, extra = '', barra = null) => `<div class="caja"><span class="k">${k}</span><span class="v">${v}</span>${barra !== null ? `<div class="barra"><i style="width:${barra}%"></i></div>` : ''}${extra ? `<span class="nota">${extra}</span>` : ''}</div>`;
  $('#rejilla-equipo').innerHTML = [
    caja('Procesador', `${s.cpu} %`, esc(`${s.procesador} · ${s.nucleos} núcleos`), s.cpu),
    caja('Memoria', `${GB(usada)}`, `de ${GB(s.memoria.total)}`, Math.round((usada / s.memoria.total) * 100)),
    s.disco ? caja('Disco libre', GB(s.disco.libre), `de ${GB(s.disco.total)}`, Math.round(((s.disco.total - s.disco.libre) / s.disco.total) * 100)) : '',
    bateria ? caja('Batería', `${Math.round(bateria.level * 100)} %`, bateria.charging ? 'cargando' : 'con batería', Math.round(bateria.level * 100)) : '',
    caja('Equipo', `<span style="font-size:15px">${esc(s.nombre)}</span>`, esc(`${s.sistema} · ${s.arquitectura}`)),
    caja('Encendido hace', `${horas} h`, `${Math.floor((s.encendidoDesde % 3600) / 60)} min`),
    caja('Central de Byte', `<span style="font-size:15px;color:${conv.conexion === 'en-linea' ? 'var(--neon)' : 'var(--ambar)'}">${conv.conexion === 'en-linea' ? 'En línea' : 'Sin conexión'}</span>`, esc(ajustes.centralUrl || '')),
  ].join('');
}
setInterval(pintarEquipo, 3000);

// ---------- Ajustes ----------

function pintarInfoCentral() {
  const info = $('#central-info');
  if (!info) return;
  if (conv.conexion === 'en-linea') info.innerHTML = '<span class="pill ok">en línea</span> Byte Desk está conectado a la central.';
  else if (ultimoError) {
    const seg = Math.max(0, Math.round((proximoIntento - Date.now()) / 1000));
    info.innerHTML = `<span class="pill no">sin conexión</span> ${esc(ultimoError)}${seg ? ` Reintento en ${seg} s.` : ''}`;
  } else info.innerHTML = `<span class="pill pide">${esc(conv.conexion)}</span>`;
  if (seccion === 'inicio') pintarInicio();
}

function pintarAjustes() {
  $('#central-url').value = ajustes.centralUrl || '';
  $('#ayuda-central').textContent = ES_MAC
    ? 'En la Mac escribe la IP del HP donde corre Docker (en el HP: ícono "Revisar Byte" o el comando ipconfig). Ejemplo: 192.168.1.50'
    : 'En el HP déjalo en 127.0.0.1 (la central está en este mismo computador). Para la Mac usarás la IP de este PC.';
  $('#voz-activa').checked = ajustes.vozActiva;
  $('#voz-nota').textContent = voz.disponible ? 'Si en el HP ya escuchas a Byte por otro programa, puedes apagarla aquí para no oírlo dos veces.' : 'Este computador no puede reproducir la voz (falta el decodificador Opus).';
  $('#abrir-inicio').checked = ajustes.abrirAlIniciar;
  pintarPc();
  $('#texto-inicio').textContent = `Abrir Byte al encender ${ES_MAC ? 'la Mac' : 'el PC'}`;
  $('#atajo').textContent = ES_MAC ? '⌥ Opción + Espacio' : 'Ctrl + Shift + B';
  pintarInfoCentral();
}
$('#f-central').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    ajustes.centralUrl = await window.byte.cambiarCentral($('#central-url').value);
    $('#central-url').value = ajustes.centralUrl;
    ultimoError = '';
  } catch (err) {
    ultimoError = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }
  pintarInfoCentral();
});
$('#reconectar').addEventListener('click', () => { ultimoError = ''; window.byte.reconectar(); });
function pintarPc() {
  const nota = $('#pc-nota');
  if (!nota) return;
  $('#usar-pc').checked = ajustes.usarBytePc !== false;
  nota.innerHTML = pc.responde ? '<span class="pill ok">ahora</span> El programa del PC está abierto: él contesta lo que escribas aquí.'
    : pc.viejo ? '<span class="pill pide">actualizar</span> El programa del PC está abierto pero es una versión vieja. Corre otra vez py_xiaozhi_es.py.'
    : pc.abierto ? 'El programa del PC está abierto, pero lo apagaste aquí: contesta Byte Desk.'
    : 'El programa del PC está cerrado: contesta Byte Desk.';
}
$('#usar-pc').addEventListener('change', async (e) => { ajustes.usarBytePc = await window.byte.cambiarUsarPc(e.target.checked); pintarPc(); });
$('#voz-activa').addEventListener('change', async (e) => {
  ajustes.vozActiva = await window.byte.cambiarVoz(e.target.checked);
  if (!ajustes.vozActiva) voz.callar();
});
$('#abrir-inicio').addEventListener('change', async (e) => { ajustes.abrirAlIniciar = await window.byte.cambiarInicio(e.target.checked); });
$('#borrar-chat').addEventListener('click', () => { conv.borrar(); pintarChat(); });

// ---------- Arranque ----------

(async function arrancar() {
  ajustes = await window.byte.leerAjustes();
  tareas = (await window.byte.leerTareas()) || [];
  pc = await window.byte.estadoPc();
  const e = await window.byte.estado();
  conv.conexionCambio({ estado: e.estado });
  irA('chat');
  pintarChat();
})();
