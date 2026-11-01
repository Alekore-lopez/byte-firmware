// panel.js — El panel rápido que sale al tocar a Byte en la barra.
// No reproduce la voz (eso lo hace la ventana grande) para no oír a Byte dos veces.

const $ = (sel) => document.querySelector(sel);
document.body.classList.add(window.byte.plataforma === 'darwin' ? 'mac' : 'win');
$('#ondas').innerHTML = '<i></i>'.repeat(18);
$('#abrir').innerHTML = icono('abrir', 16);
$('#enviar').innerHTML = icono('enviar');

// El panel solo muestra lo de esta sesión (los últimos mensajes).
const conv = new Conversacion({ alCambiar: pintar, maximo: 6 });

function pintar() {
  document.body.dataset.estado = conv.estado;
  $('#chat').innerHTML = burbujasHTML(conv.mensajes.slice(-4), conv.estado === 'pensando');
  $('#chat').scrollTop = $('#chat').scrollHeight;
  $('#rapidos').hidden = conv.mensajes.length > 0;
  const est = $('#estado');
  est.dataset.estado = conv.conexion;
  est.textContent = conv.textoEstado();
  $('#frase').textContent = conv.estado === 'hablando' ? 'Te cuento…' : conv.estado === 'pensando' ? 'Déjame ver…' : conv.conexion === 'en-linea' ? 'Hola, Alejandro' : 'Buscando la central…';
}

window.byte.alEstado((e) => conv.conexionCambio(e));
window.byte.alPregunta((t) => conv.pregunta(t));
window.byte.alMensaje((m) => conv.mensaje(m));

$('#f-chat').addEventListener('submit', (e) => {
  e.preventDefault();
  const i = $('#texto');
  const t = i.value.trim();
  if (t) window.byte.preguntar(t);
  i.value = '';
});
$('#rapidos').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.p) window.byte.preguntar(b.dataset.p);
  if (b.dataset.ir) window.byte.abrirVentana(b.dataset.ir);
});
$('#abrir').addEventListener('click', () => window.byte.abrirVentana('chat'));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') window.byte.cerrarPanel(); });
window.addEventListener('focus', () => $('#texto').focus());

window.byte.estado().then((e) => { conv.conexionCambio({ estado: e.estado }); pintar(); });
pintar();
