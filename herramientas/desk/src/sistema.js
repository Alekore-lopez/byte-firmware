// sistema.js — Datos reales del computador para la sección "Mi PC" / "Mi Mac".
// Solo LEE información; no cambia nada.

const os = require('node:os');
const fs = require('node:fs');

let cpuAnterior = os.cpus();

/** % de uso del procesador desde la última llamada. */
function usoCpu() {
  const ahora = os.cpus();
  let ocupado = 0;
  let total = 0;
  ahora.forEach((c, i) => {
    const a = cpuAnterior[i] ? cpuAnterior[i].times : { user: 0, nice: 0, sys: 0, irq: 0, idle: 0 };
    const d = {};
    for (const k of Object.keys(c.times)) d[k] = c.times[k] - (a[k] || 0);
    const t = d.user + d.nice + d.sys + d.irq + d.idle;
    total += t;
    ocupado += t - d.idle;
  });
  cpuAnterior = ahora;
  return total > 0 ? Math.round((ocupado / total) * 100) : 0;
}

function discoLibre(carpeta) {
  try {
    const s = fs.statfsSync(carpeta);
    return { libre: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch {
    return null;
  }
}

/** Carpetas que Byte podrá ordenar en la fase 3 (las que Alejandro autorizó). */
function carpetasAutorizadas(app) {
  const nombres = { downloads: 'Descargas', documents: 'Documentos', desktop: 'Escritorio' };
  return Object.entries(nombres).map(([clave, nombre]) => {
    const ruta = app.getPath(clave);
    let archivos = null;
    try {
      archivos = fs.readdirSync(ruta, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.startsWith('.')).length;
    } catch { /* sin permiso todavía (en Mac lo pide la primera vez) */ }
    return { nombre, ruta, archivos };
  });
}

function resumen() {
  const mem = { total: os.totalmem(), libre: os.freemem() };
  return {
    nombre: os.hostname(),
    plataforma: process.platform,           // 'win32' | 'darwin' | 'linux'
    sistema: `${os.type()} ${os.release()}`,
    arquitectura: process.arch,             // 'arm64' en la Mac M1
    procesador: (os.cpus()[0] || {}).model || '',
    nucleos: os.cpus().length,
    cpu: usoCpu(),
    memoria: mem,
    disco: discoLibre(os.homedir()),
    encendidoDesde: os.uptime(),
  };
}

module.exports = { resumen, carpetasAutorizadas };
