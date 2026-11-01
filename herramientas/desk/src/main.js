// main.js — El "cerebro" de la app de escritorio (proceso principal de Electron).
//
// Qué hace:
//   • Crea la ventana grande de Byte Desk y el panel rápido.
//   • Pone a Byte en la bandeja (Windows, junto al reloj) o en la barra de menú (Mac).
//   • Mantiene la conexión con la central y reenvía todo a la interfaz.
//   • Al cerrar la ventana, Byte NO se apaga: queda vivo en la barra.
//
// Seguridad: la interfaz (renderer) no tiene acceso a Node ni a tus archivos.
// Solo puede pedir cosas concretas a través de preload.js (lista cerrada).

const path = require('node:path');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, shell, Notification, systemPreferences } = require('electron');
const { Central } = require('./central');
const { BytePc, normalizar } = require('./byte-pc');
const { Ajustes, normalizarUrl } = require('./ajustes');
const sistema = require('./sistema');

const ES_MAC = process.platform === 'darwin';
const ES_WIN = process.platform === 'win32';
const ATAJO = ES_MAC ? 'Alt+Space' : 'Control+Shift+B'; // ⌥ Espacio en Mac
const RAIZ = path.join(__dirname, '..');

let ventana = null;     // ventana grande
let panel = null;       // panel rápido que cae desde la barra
let cara = null;        // ventana con la cara de Byte (la misma pantalla del PC y la placa)
let bandeja = null;
let central = null;
let bytePc = null;     // el programa de Byte del PC, si está abierto
let ultimaPregunta = ''; // para no repetir en el chat lo que ya escribimos
let ajustes = null;
let saliendo = false;

// Micrófono: como en la placa, tocas la cara y Byte escucha. Después de que
// contesta vuelve a escuchar un rato por si sigues hablando, y luego descansa.
const ESPERA_VOZ_MS = 12000;
const mic = { activo: false, temporizador: null };

// Solo una copia de Byte Desk a la vez: si la abren de nuevo, mostramos la que ya está.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Si el botón "Byte" la abre otra vez con --oculto, no mostramos la ventana.
  app.on('second-instance', (_e, argv) => {
    if (argv.includes('--cara')) mostrarCara();      // acceso directo "Cara de Byte"
    else if (!argv.includes('--oculto')) mostrarVentana();
  });
}

// ---------- Ventanas ----------

const preferenciasSeguras = {
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,      // la página no ve las variables de Electron
  nodeIntegration: false,      // la página no puede usar require()
  sandbox: true,
  backgroundThrottling: false, // la voz de Byte suena aunque la ventana esté oculta
};

function crearVentana() {
  const opciones = {
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Byte Desk',
    icon: path.join(RAIZ, 'assets', 'icono.png'),
    webPreferences: preferenciasSeguras,
  };
  if (ES_MAC) {
    // Mac premium: vidrio esmerilado nativo y semáforos dentro de la ventana.
    Object.assign(opciones, {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      backgroundColor: '#00000000',
    });
  } else {
    // Windows 11: barra de título oscura propia + material Mica.
    Object.assign(opciones, {
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: '#0e0e13', symbolColor: '#f2ede1', height: 36 },
      backgroundColor: '#07070b',
      ...(ES_WIN ? { backgroundMaterial: 'mica' } : {}),
    });
  }

  ventana = new BrowserWindow(opciones);
  // Mac: Byte vive arriba en la barra de menú (junto al WiFi). El ícono del Dock
  // solo aparece mientras la ventana grande está abierta, como las apps de la barra.
  if (ES_MAC && app.dock) {
    ventana.on('show', () => app.dock.show());
    ventana.on('hide', () => { if (!cara || cara.isDestroyed() || !cara.isVisible()) app.dock.hide(); });
  }
  ventana.loadFile(path.join(RAIZ, 'renderer', 'index.html'));
  ventana.once('ready-to-show', () => {
    // Si arrancó con el computador, empieza escondido en la barra.
    if (!process.argv.includes('--oculto') && !process.argv.includes('--cara')) ventana.show();
  });
  // Cerrar = esconder. Byte sigue en la barra.
  ventana.on('close', (e) => {
    if (!saliendo) {
      e.preventDefault();
      ventana.hide();
    }
  });
  protegerNavegacion(ventana);
}

function crearPanel() {
  panel = new BrowserWindow({
    width: 340,
    height: 460,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: ES_MAC,
    backgroundColor: ES_MAC ? '#00000000' : '#16161d',
    ...(ES_MAC ? { vibrancy: 'popover', visualEffectState: 'active', roundedCorners: true } : {}),
    webPreferences: preferenciasSeguras,
  });
  panel.loadFile(path.join(RAIZ, 'renderer', 'panel.html'));
  panel.on('blur', () => { if (!panel.webContents.isDevToolsOpened()) panel.hide(); });
  protegerNavegacion(panel);
}

/** Dónde está la pantalla de Byte: en el repo (npm start) o dentro de la app instalada. */
function rutaCara() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'cara', 'byte_pantalla.html')
    : path.join(RAIZ, '..', 'pc', 'byte_pantalla.html');
}

/** Abre (o trae al frente) la ventana con la cara de Byte. */
function mostrarCara() {
  if (cara && !cara.isDestroyed()) {
    if (cara.isMinimized()) cara.restore();
    cara.show();
    cara.focus();
    return;
  }
  cara = new BrowserWindow({
    width: 480,
    height: 400,
    minWidth: 320,
    minHeight: 266,
    title: 'Byte',
    backgroundColor: '#000000',
    icon: path.join(RAIZ, 'assets', 'icono.png'),
    ...(ES_MAC ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 12 } } : { autoHideMenuBar: true }),
    webPreferences: preferenciasSeguras,
  });
  cara.setAspectRatio(4 / 3);
  cara.loadFile(rutaCara());
  protegerNavegacion(cara);
  cara.on('closed', () => {
    cara = null;
    if (ES_MAC && app.dock && ventana && !ventana.isVisible()) app.dock.hide();
  });
}

/** La interfaz nunca navega a otras páginas; los enlaces se abren en el navegador. */
function protegerNavegacion(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function mostrarVentana(seccion) {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
  if (seccion) ventana.webContents.send('ir-a', seccion);
}

/** Muestra el panel rápido pegado al ícono de la barra. */
function alternarPanel() {
  if (!panel) return;
  if (panel.isVisible()) { panel.hide(); return; }
  const [ancho, alto] = panel.getSize();
  const icono = bandeja ? bandeja.getBounds() : null;
  const pantalla = screen.getDisplayNearestPoint(icono ? { x: icono.x, y: icono.y } : screen.getCursorScreenPoint());
  const area = pantalla.workArea;
  let x;
  let y;
  if (icono && icono.width) {
    x = Math.round(icono.x + icono.width / 2 - ancho / 2);
    // Mac: la barra está arriba → el panel cae hacia abajo. Windows: sube desde abajo.
    y = ES_MAC ? Math.round(icono.y + icono.height + 6) : Math.round(area.y + area.height - alto - 8);
  } else {
    x = area.x + area.width - ancho - 12;
    y = ES_MAC ? area.y + 6 : area.y + area.height - alto - 8;
  }
  x = Math.max(area.x + 8, Math.min(x, area.x + area.width - ancho - 8));
  panel.setPosition(x, y, false);
  panel.show();
  panel.focus();
}

// ---------- Bandeja / barra de menú ----------

function iconoBandeja(estado) {
  // Mac usa imágenes "Template" (negras con transparencia): macOS las pinta
  // blancas o negras según el tema. Windows usa el ícono a color.
  const nombre = ES_MAC
    ? (estado === 'en-linea' ? 'barraTemplate.png' : 'barra-dormidoTemplate.png')
    : (estado === 'en-linea' ? 'bandeja.png' : 'bandeja-dormido.png');
  const img = nativeImage.createFromPath(path.join(RAIZ, 'assets', nombre));
  if (ES_MAC) img.setTemplateImage(true);
  return img;
}

function crearBandeja() {
  bandeja = new Tray(iconoBandeja('desconectado'));
  bandeja.setToolTip('Byte Desk');
  bandeja.on('click', alternarPanel);
  bandeja.on('right-click', () => bandeja.popUpContextMenu(menuBandeja()));
  if (!ES_MAC) bandeja.on('double-click', () => mostrarVentana());
}

function menuBandeja() {
  return Menu.buildFromTemplate([
    { label: 'Abrir Byte Desk', click: () => mostrarVentana() },
    { label: 'Hablar con Byte', accelerator: ATAJO, click: alternarPanel },
    { label: 'Ver la cara de Byte', click: mostrarCara },
    { label: mic.activo ? 'Dejar de escuchar' : 'Hablarle con la voz', click: () => alternarMic() },
    { type: 'separator' },
    { label: 'Reconectar con la central', click: () => central.reconectar() },
    {
      label: `Abrir al encender ${ES_MAC ? 'la Mac' : 'el PC'}`,
      type: 'checkbox',
      checked: ajustes.get('abrirAlIniciar'),
      click: (item) => aplicarInicio(item.checked),
    },
    { type: 'separator' },
    { label: 'Salir de Byte', click: () => { saliendo = true; app.quit(); } },
  ]);
}

function aplicarInicio(activo) {
  ajustes.set('abrirAlIniciar', Boolean(activo));
  // En Linux (desarrollo) esto no hace nada; en Windows y Mac sí.
  // Si la app corre con `npm start` (no instalada), Electron necesita saber
  // también la carpeta de Byte Desk; si no, abriría un Electron vacío.
  const args = app.isPackaged ? ['--oculto'] : [app.getAppPath(), '--oculto'];
  app.setLoginItemSettings({ openAtLogin: Boolean(activo), path: process.execPath, args, openAsHidden: true, name: 'Byte Desk' });
  if (ES_WIN) limpiarInicioViejo();
}

/**
 * La versión 0.1.0 corrida con `npm start` registraba "electron.exe --oculto" sin la
 * carpeta de la app: al prender el PC abría un Electron vacío. Borramos SOLO esa
 * entrada (la del electron.exe de herramientas\desk que no lleva la carpeta).
 */
function limpiarInicioViejo() {
  try {
    const { launchItems = [] } = app.getLoginItemSettings();
    for (const item of launchItems) {
      const ruta = String(item.path || '').toLowerCase();
      const argumentos = (item.args || []).join(' ');
      const esElViejo = ruta.includes('herramientas\\desk\\node_modules\\electron') && !/herramientas[\\/]desk["']?(\s|$)/i.test(argumentos);
      if (esElViejo && item.name !== 'Byte Desk') {
        app.setLoginItemSettings({ openAtLogin: false, name: item.name, path: item.path, args: item.args });
      }
    }
  } catch (e) {
    console.warn('No pude revisar el inicio de Windows:', e.message);
  }
}

// ---------- Central ----------

function enviarATodas(canal, datos) {
  for (const w of [ventana, panel, cara]) {
    if (w && !w.isDestroyed()) w.webContents.send(canal, datos);
  }
}

function iniciarCentral() {
  central = new Central({
    url: ajustes.get('centralUrl'),
    deviceId: ajustes.get('deviceId'),
    clientId: ajustes.get('clientId'),
    token: ajustes.get('token'),
  });
  central.on('estado', (e) => {
    if (e.estado !== 'en-linea') apagarMic();
    enviarATodas('central:estado', e);
    if (bandeja) {
      bandeja.setImage(iconoBandeja(e.estado));
      bandeja.setToolTip(e.estado === 'en-linea' ? 'Byte Desk · en línea' : 'Byte Desk · sin conexión');
    }
  });
  central.on('mensaje', (m) => { micSegunCentral(m); enviarATodas('central:mensaje', m); });
  central.on('error-conexion', (texto) => enviarATodas('central:error', texto));
  central.on('reintento', (r) => enviarATodas('central:reintento', r));
  // La voz solo suena en la ventana grande (para no oír a Byte dos veces).
  central.on('audio', (buf) => {
    if (ventana && !ventana.isDestroyed() && ajustes.get('vozActiva')) ventana.webContents.send('central:audio', buf);
  });
  central.conectar();
}

function estadoPc() {
  return {
    abierto: Boolean(bytePc && bytePc.abierto),
    responde: Boolean(bytePc && bytePc.disponible && ajustes.get('usarBytePc')),
    viejo: Boolean(bytePc && bytePc.abierto && !bytePc.puedePreguntar),
  };
}

function iniciarBytePc() {
  bytePc = new BytePc();
  bytePc.on('estado', () => enviarATodas('pc:estado', estadoPc()));
  bytePc.on('mensaje', (m) => {
    if (!ajustes.get('usarBytePc') || !m || typeof m !== 'object') return;
    if (m.type === 'stt') {
      // Si lo que oyó la central no es lo que escribimos, es que le hablaste
      // por voz al programa del PC: también lo mostramos en el chat.
      if (m.text && normalizar(m.text) !== ultimaPregunta) enviarATodas('central:pregunta', `🎤 ${m.text}`);
      ultimaPregunta = '';
      return;
    }
    if (m.type === 'llm' || m.type === 'tts') enviarATodas('central:mensaje', m);
  });
  bytePc.iniciar();
}

// ---------- Micrófono ----------

function avisarMic(estado) {
  enviarATodas('mic:estado', estado);
}

function controlMic(orden) {
  if (ventana && !ventana.isDestroyed()) ventana.webContents.send('mic:control', orden);
}

/** Si nadie habla en un rato, Byte deja de escuchar (como la placa). */
function esperarVoz() {
  clearTimeout(mic.temporizador);
  mic.temporizador = setTimeout(() => apagarMic(), ESPERA_VOZ_MS);
}

async function encenderMic() {
  if (central.estado !== 'en-linea') {
    enviarATodas('central:error', 'Byte no está conectado a la central: no puedo escucharte todavía.');
    return false;
  }
  if (ES_MAC && systemPreferences.getMediaAccessStatus('microphone') !== 'granted') {
    const ok = await systemPreferences.askForMediaAccess('microphone');
    if (!ok) {
      enviarATodas('central:error', 'Sin permiso para el micrófono: Configuración del Sistema → Privacidad y seguridad → Micrófono → activa Byte Desk / Electron.');
      return false;
    }
  }
  if (!central.escuchar()) return false;
  mic.activo = true;
  controlMic('empezar');
  avisarMic('escuchando');
  esperarVoz();
  return true;
}

function apagarMic() {
  clearTimeout(mic.temporizador);
  if (!mic.activo) return;
  mic.activo = false;
  controlMic('detener');
  central.dejarDeEscuchar();
  avisarMic('apagado');
}

function alternarMic() {
  return mic.activo ? (apagarMic(), false) : encenderMic();
}

/** Lo que dice la central mueve el micrófono: callado mientras Byte habla. */
function micSegunCentral(m) {
  if (!mic.activo || !m) return;
  if (m.type === 'stt' && m.text) {
    if (m.text.startsWith('% handle_exit_intent')) { apagarMic(); return; }   // "chao Byte"
    if (!m.text.startsWith('% ')) {
      // Lo que oyó la central: también va al chat, con un micrófono.
      ultimaPregunta = normalizar(m.text);
      enviarATodas('central:pregunta', `🎤 ${m.text}`);
    }
    clearTimeout(mic.temporizador);
    controlMic('pausar');
    avisarMic('pausado');
  } else if (m.type === 'tts' && m.state === 'start') {
    clearTimeout(mic.temporizador);
    controlMic('pausar');
    avisarMic('pausado');
  } else if (m.type === 'tts' && m.state === 'stop') {
    // Dejamos terminar la última frase y volvemos a escuchar.
    setTimeout(() => {
      if (!mic.activo) return;
      if (!central.escuchar()) { apagarMic(); return; }
      controlMic('reanudar');
      avisarMic('escuchando');
      esperarVoz();
    }, 700);
  }
}

// ---------- Lo que la interfaz puede pedir (lista cerrada) ----------

function registrarPeticiones() {
  ipcMain.handle('byte:preguntar', async (_e, texto) => {
    if (typeof texto !== 'string' || texto.length > 2000 || !texto.trim()) return false;
    // Todas las ventanas muestran la pregunta (la grande y el panel rápido).
    const t = texto.trim();
    enviarATodas('central:pregunta', t);
    ultimaPregunta = normalizar(t);
    // Si el programa de Byte del PC está abierto, que conteste él (voz y cara);
    // si no, o si falla, contesta Byte Desk directo con la central.
    if (ajustes.get('usarBytePc') && bytePc && bytePc.disponible) {
      if (await bytePc.preguntar(t)) return true;
    }
    return central.preguntar(t);
  });
  ipcMain.handle('byte:interrumpir', () => central.interrumpir());
  ipcMain.handle('byte:hablar', () => alternarMic());
  ipcMain.on('mic:audio', (e, bytes) => {
    // Solo la ventana grande graba, y solo mientras Byte escucha.
    if (!mic.activo || !ventana || e.sender !== ventana.webContents) return;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4000) return;
    central.enviarAudio(Buffer.from(bytes));
  });
  ipcMain.on('mic:error', (_e, texto) => {
    apagarMic();
    enviarATodas('central:error', String(texto || 'Error del micrófono').slice(0, 300));
  });
  ipcMain.handle('pc:estado', () => estadoPc());
  ipcMain.handle('ajustes:usar-pc', (_e, activo) => { ajustes.set('usarBytePc', Boolean(activo)); enviarATodas('pc:estado', estadoPc()); return Boolean(activo); });
  ipcMain.handle('byte:reconectar', () => central.reconectar());
  ipcMain.handle('byte:estado', () => ({ estado: central.estado, url: central.url }));

  ipcMain.handle('ajustes:leer', () => ({ ...ajustes.publicos(), atajo: ATAJO, plataforma: process.platform }));
  ipcMain.handle('ajustes:central', (_e, texto) => {
    const url = normalizarUrl(texto);
    ajustes.set('centralUrl', url);
    central.cambiarUrl(url);
    return url;
  });
  ipcMain.handle('ajustes:voz', (_e, activa) => ajustes.set('vozActiva', Boolean(activa)));
  ipcMain.handle('ajustes:inicio', (_e, activo) => { aplicarInicio(activo); return Boolean(activo); });

  ipcMain.handle('tareas:leer', () => ajustes.get('tareas'));
  ipcMain.handle('tareas:guardar', (_e, lista) => {
    if (!Array.isArray(lista)) return false;
    const limpia = lista.slice(0, 200).map((t) => ({
      id: String(t.id || '').slice(0, 40),
      texto: String(t.texto || '').slice(0, 300),
      hecha: Boolean(t.hecha),
    }));
    ajustes.set('tareas', limpia);
    return true;
  });

  ipcMain.handle('sistema:resumen', () => sistema.resumen());
  ipcMain.handle('sistema:carpetas', () => sistema.carpetasAutorizadas(app));
  ipcMain.handle('sistema:notificar', (_e, titulo, cuerpo) => {
    if (Notification.isSupported()) new Notification({ title: String(titulo).slice(0, 80), body: String(cuerpo).slice(0, 200) }).show();
  });

  ipcMain.handle('ventana:abrir', (_e, seccion) => { if (panel) panel.hide(); mostrarVentana(typeof seccion === 'string' ? seccion : undefined); });
  ipcMain.handle('ventana:cara', () => { if (panel) panel.hide(); mostrarCara(); });
  ipcMain.handle('ventana:cerrar-panel', () => panel && panel.hide());
}

// ---------- Arranque ----------

app.whenReady().then(() => {
  ajustes = new Ajustes(app.getPath('userData'));
  // Mac: con `npm start` el Dock mostraría el ícono de Electron; ponemos el de Byte.
  if (ES_MAC && app.dock) {
    app.dock.setIcon(path.join(RAIZ, 'assets', 'icono.png'));
    if (process.argv.includes('--oculto') || process.argv.includes('--cara')) app.dock.hide();
  }
  registrarPeticiones();
  crearVentana();
  crearPanel();
  crearBandeja();
  iniciarCentral();
  iniciarBytePc();
  if (ajustes.get('abrirAlIniciar') && (ES_MAC || ES_WIN)) aplicarInicio(true);
  if (!globalShortcut.register(ATAJO, alternarPanel)) console.warn(`El atajo ${ATAJO} ya lo usa otra app`);
  if (ES_MAC) app.on('activate', () => mostrarVentana());
  if (process.argv.includes('--cara')) mostrarCara();
});

app.on('before-quit', () => { saliendo = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  apagarMic();
  if (central) central.cerrar();
  if (bytePc) bytePc.detener();
});
// Cerrar todas las ventanas NO apaga a Byte (vive en la barra).
app.on('window-all-closed', (e) => e.preventDefault());
