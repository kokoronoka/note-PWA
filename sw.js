const CACHE = 'welovenote-v3';
const ASSETS = [
  '/note-PWA/',
  '/note-PWA/index.html',
  '/note-PWA/manifest.json',
  '/note-PWA/sw.js',
  '/note-PWA/icons/icon-192.png',
  '/note-PWA/icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache core assets; fonts may fail cross-origin, that's OK
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Cache API only supports GET — Supabase's POST/PATCH calls (and any
  // other non-GET request) must go straight to the network, uncached, or
  // cache.put() below throws ("Request method 'POST' is unsupported")
  if (e.request.method !== 'GET') return;

  // Network-first for navigation; cache-first for static assets
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/note-PWA/index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.url.startsWith('http')) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
    })
  );
});
