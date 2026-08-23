/* ═══════════════════════════════════════════════════════════════════════════
   COMANDERO 2 · Service Worker
   Cachea el shell de camarero2 para funcionar sin conexión. La cola de
   pedidos offline vive en IndexedDB (camarero2.js) y se sincroniza al volver.
   ═══════════════════════════════════════════════════════════════════════════ */
const CACHE = 'camarero2-shell-v1';

// Shell de la app (mismo origen)
const SHELL = [
  './camarero2.html',
  './camarero2.js',
  './camarero2.css',
  './firebase.js',
  './manifest-camarero2.webmanifest',
  './icons/camarero-192.png',
  './icons/camarero-180.png',
  './icons/camarero-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // SDK de Firebase y fuentes (URLs versionadas → cache-first seguro)
  if (url.hostname === 'www.gstatic.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(resp => {
        const copy = resp.clone();
        if (resp.ok) caches.open(CACHE).then(cache => cache.put(req, copy));
        return resp;
      }).catch(() => hit))
    );
    return;
  }

  // Solo mismo origen y solo archivos del shell de camarero2
  if (url.origin !== location.origin) return;
  const esShell = SHELL.some(p => url.pathname.endsWith(p.replace('./', '')));
  if (!esShell) return;

  // Network-first: siempre lo más reciente; cache como respaldo offline
  event.respondWith(
    fetch(req).then(resp => {
      const copy = resp.clone();
      if (resp.ok) caches.open(CACHE).then(cache => cache.put(req, copy));
      return resp;
    }).catch(() => caches.match(req).then(hit => {
      if (hit) return hit;
      // Última defensa para navegación: la página cacheada
      if (req.mode === 'navigate') return caches.match('./camarero2.html');
      return Response.error();
    }))
  );
});
