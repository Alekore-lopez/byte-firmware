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
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, screen, shell, Notification } = require('electron');
const { Central } = require('./central');
const { Ajustes, normalizarUrl } = require('./ajustes');
const sistema = require('./sistema');

const ES_MAC = process.platform === 'darwin';
const ES_WIN = process.platform === 'win32';
const ATAJO = ES_MAC ? 'Alt+Space' : 'Control+Shift+B'; // ⌥ Espacio en Mac
const RAIZ = path.join(__dirname, '..');

let ventana = null;     // ventana grande
let panel = null;       // panel rápido que cae desde la barra
let bandeja = null;
let central = null;
let ajustes = null;
let saliendo = false;

// Solo una copia de Byte Desk a la vez: si la abren de nuevo, mostramos la que ya está.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => mostrarVentana());
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
  ventana.loadFile(path.join(RAIZ, 'renderer', 'index.html'));
  ventana.once('ready-to-show', () => {
    // Si arrancó con el computador, empieza escondido en la barra.
    if (!process.argv.includes('--oculto')) ventana.show();
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
  app.setLoginItemSettings({ openAtLogin: Boolean(activo), args: ['--oculto'], openAsHidden: true });
}

// ---------- Central ----------

function enviarATodas(canal, datos) {
  for (const w of [ventana, panel]) {
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
    enviarATodas('central:estado', e);
    if (bandeja) {
      bandeja.setImage(iconoBandeja(e.estado));
      bandeja.setToolTip(e.estado === 'en-linea' ? 'Byte Desk · en línea' : 'Byte Desk · sin conexión');
    }
  });
  central.on('mensaje', (m) => enviarATodas('central:mensaje', m));
  central.on('error-conexion', (texto) => enviarATodas('central:error', texto));
  central.on('reintento', (r) => enviarATodas('central:reintento', r));
  // La voz solo suena en la ventana grande (para no oír a Byte dos veces).
  central.on('audio', (buf) => {
    if (ventana && !ventana.isDestroyed() && ajustes.get('vozActiva')) ventana.webContents.send('central:audio', buf);
  });
  central.conectar();
}

// ---------- Lo que la interfaz puede pedir (lista cerrada) ----------

function registrarPeticiones() {
  ipcMain.handle('byte:preguntar', (_e, texto) => {
    if (typeof texto !== 'string' || texto.length > 2000 || !texto.trim()) return false;
    // Todas las ventanas muestran la pregunta (la grande y el panel rápido).
    enviarATodas('central:pregunta', texto.trim());
    return central.preguntar(texto);
  });
  ipcMain.handle('byte:interrumpir', () => central.interrumpir());
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
  ipcMain.handle('ventana:cerrar-panel', () => panel && panel.hide());
}

// ---------- Arranque ----------

app.whenReady().then(() => {
  ajustes = new Ajustes(app.getPath('userData'));
  registrarPeticiones();
  crearVentana();
  crearPanel();
  crearBandeja();
  iniciarCentral();
  if (ajustes.get('abrirAlIniciar') && (ES_MAC || ES_WIN)) aplicarInicio(true);
  if (!globalShortcut.register(ATAJO, alternarPanel)) console.warn(`El atajo ${ATAJO} ya lo usa otra app`);
  if (ES_MAC) app.on('activate', () => mostrarVentana());
});

app.on('before-quit', () => { saliendo = true; });
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (central) central.cerrar();
});
// Cerrar todas las ventanas NO apaga a Byte (vive en la barra).
app.on('window-all-closed', (e) => e.preventDefault());
