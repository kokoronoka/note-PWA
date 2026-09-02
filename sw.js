const CACHE = 'welovenote-v5';
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

// Cache.put() throws synchronously for anything the Cache API doesn't
// support — non-GET methods (handled by the early return below) and
// non-http(s) schemes, which is what browser extensions (ad blockers,
// password managers, etc.) inject as chrome-extension:// requests that can
// still reach this fetch handler. The url.protocol check on the request
// itself already skips most of these before ever reaching a put() call, but
// this wraps every actual put() as defense in depth against any request
// that slips through that check (or a future code path that forgets it).
function safeCachePut(cache, request, response) {
  try {
    const url = new URL(request.url);
    if (!url.protocol.startsWith('http')) return;
    cache.put(request, response);
  } catch (err) {
    console.warn('Skipped caching:', request.url, err);
  }
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Only handle http/https requests — chrome-extension:, data:, blob:, etc.
  // are never ours to cache and safeCachePut() would just no-op on them
  // anyway, but bailing out here also leaves them to the browser's default
  // handling instead of routing them through our fetch/cache logic at all.
  if (!url.protocol.startsWith('http')) return;

  // Cache API only supports GET — Supabase's POST/PATCH calls (and any
  // other non-GET request) must go straight to the network, uncached, or
  // cache.put() below throws ("Request method 'POST' is unsupported")
  if (e.request.method !== 'GET') return;

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
            caches.open(CACHE).then(c => safeCachePut(c, e.request, clone));
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
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => safeCachePut(c, e.request, clone));
        }
        return res;
      });
    })
  );
});
