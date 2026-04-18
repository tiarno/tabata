// Cache-first service worker for offline use.
// Bump APP_VERSION whenever a cached asset changes; the old cache is
// dropped on activate, the new SW takes over via SKIP_WAITING, and the
// client reloads on controllerchange.
const APP_VERSION = '9';
const CACHE = `tabata-v${APP_VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/audio.js',
  'js/workout.js',
  'js/storage.js',
  'assets/icon-192.png',
  'assets/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(
    caches.match(req).then(hit =>
      hit || fetch(req).then(res => {
        // Opportunistically cache same-origin GETs
        if (res.ok && new URL(req.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => hit)
    )
  );
});
