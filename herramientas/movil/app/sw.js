// sw.js — Guarda la "cáscara" de la app para que abra rápido.
// Siempre intenta primero la red (así recibes las mejoras), y si no hay,
// usa la copia guardada. El chat y la administración NUNCA se guardan.
const CACHE = 'byte-movil-v1';
const CASCARA = ['./', 'index.html', 'estilos.css', 'comun.js', 'audio.js', 'app.js', 'manifest.webmanifest', 'icono-180.png', 'icono-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CASCARA)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname === '/ws') return;
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
