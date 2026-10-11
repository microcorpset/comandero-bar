const CACHE = 'comandero-unificado-v1';
const SHELL = [
  './comandero.html', './comandero.js', './manifest-comandero.webmanifest',
  './firebase.js', './auth-email.js', './verifacti.js',
  './icons/camarero-192.png', './icons/camarero-180.png', './icons/camarero-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !SHELL.some(asset => url.pathname.endsWith(asset.slice(2)))) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(async () => (await caches.match(event.request)) ||
    (await caches.match(url.pathname, { ignoreSearch: true })) || Response.error()));
});
