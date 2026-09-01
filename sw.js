const CACHE = 'welovenote-v4';
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

  const url = new URL(e.request.url);

  // Network-first for HTML and JS (code — never allowed to go stale) and any
  // navigation request. Cache is only the offline fallback here, updated
  // with whatever the network just returned so it stays current on every
  // successful load. This is what the old cache-first-for-static-assets
  // policy got wrong for db.js: a static-asset .js file cached once could
  // silently go stale for as long as its cache entry survived, even though
  // the file's actual content had moved on — see the now-deleted db.js and
  // the "safeGetLocal is not defined" bug that staleness caused. Everything
  // this app ships as code now lives in index.html itself, so this mainly
  // guards index.html and supabase.js today, but it's the right default for
  // any future .html/.js asset too.
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(cached => cached || caches.match('/note-PWA/index.html')))
    );
    return;
  }

  // Cache-first for everything else (fonts, icons, images)
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
