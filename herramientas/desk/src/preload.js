// preload.js — El "mostrador" entre la interfaz y el proceso principal.
// La página solo puede usar lo que está en window.byte, nada más.

const { contextBridge, ipcRenderer } = require('electron');

const escuchar = (canal) => (fn) => {
  const manejador = (_e, datos) => fn(datos);
  ipcRenderer.on(canal, manejador);
  return () => ipcRenderer.removeListener(canal, manejador);
};

contextBridge.exposeInMainWorld('byte', {
  plataforma: process.platform,

  // Hablar con Byte
  preguntar: (texto) => ipcRenderer.invoke('byte:preguntar', texto),
  interrumpir: () => ipcRenderer.invoke('byte:interrumpir'),
  hablar: () => ipcRenderer.invoke('byte:hablar'),          // tocar la cara: empieza o deja de escuchar
  enviarAudio: (bytes) => ipcRenderer.send('mic:audio', bytes),
  alMic: escuchar('mic:estado'),                              // 'escuchando' | 'pausado' | 'apagado'
  alControlMic: escuchar('mic:control'),                      // solo la ventana grande: 'empezar' | 'pausar' | 'reanudar' | 'detener'
  micError: (texto) => ipcRenderer.send('mic:error', texto),
  reconectar: () => ipcRenderer.invoke('byte:reconectar'),
  estado: () => ipcRenderer.invoke('byte:estado'),

  // Lo que llega de la central
  alEstado: escuchar('central:estado'),
  alPregunta: escuchar('central:pregunta'),
  alMensaje: escuchar('central:mensaje'),
  alAudio: escuchar('central:audio'),
  alError: escuchar('central:error'),
  alReintento: escuchar('central:reintento'),
  alIrA: escuchar('ir-a'),
  alPc: escuchar('pc:estado'),
  estadoPc: () => ipcRenderer.invoke('pc:estado'),
  cambiarUsarPc: (activo) => ipcRenderer.invoke('ajustes:usar-pc', activo),

  // Ajustes
  leerAjustes: () => ipcRenderer.invoke('ajustes:leer'),
  cambiarCentral: (texto) => ipcRenderer.invoke('ajustes:central', texto),
  cambiarVoz: (activa) => ipcRenderer.invoke('ajustes:voz', activa),
  cambiarInicio: (activo) => ipcRenderer.invoke('ajustes:inicio', activo),

  // Tareas
  leerTareas: () => ipcRenderer.invoke('tareas:leer'),
  guardarTareas: (lista) => ipcRenderer.invoke('tareas:guardar', lista),

  // Mi PC / Mi Mac (solo lectura)
  sistema: () => ipcRenderer.invoke('sistema:resumen'),
  carpetas: () => ipcRenderer.invoke('sistema:carpetas'),
  notificar: (titulo, cuerpo) => ipcRenderer.invoke('sistema:notificar', titulo, cuerpo),

  // Ventanas
  abrirVentana: (seccion) => ipcRenderer.invoke('ventana:abrir', seccion),
  cerrarPanel: () => ipcRenderer.invoke('ventana:cerrar-panel'),
  abrirCara: () => ipcRenderer.invoke('ventana:cara'),
});
