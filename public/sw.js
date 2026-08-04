// Offline shell only. Network-first so you never fight a stale cache while
// developing; the cache is purely a fallback when the WiFi drops.

const CACHE = 'htfw-v16';
const SHELL = [
  '/',
  '/index.html',
  '/css/tokens.css',
  '/css/site.css',
  '/css/styles.css',
  '/js/site.js',
  '/js/intro.js',
  '/js/net.js',
  '/js/auth.js',
  '/js/theme.js',
  '/js/engine.js',
  '/js/sound.js',
  '/js/fx.js',
  '/games/_party/client.js',
  '/media/intro.mp4?v=8',
  '/media/intro-poster.png?v=8',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== location.origin ||
    url.pathname.startsWith('/socket.io/') ||
    url.pathname.startsWith('/api/')
  ) {
    return; // live traffic must never be served from cache
  }

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('/index.html')))
  );
});
