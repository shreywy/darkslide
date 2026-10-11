// Offline cache for the app shell. Bump VERSION when shipping changes so phones
// pick up the new files on the next launch.
const VERSION = 'darkslide-2';
const CAMS = ['funsaver', 'sx70', 'instax', 'ixus', 'm6', 'k1000', 'mju2', 'lca', 'holga', 'hassel', 'super8', 'gbcam', 'mavica', 'ae1', 't2', 'trip'];
const FILES = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/app.js', 'js/encoder.js', 'js/camera.js', 'js/dom.js', 'js/gallery.js', 'js/interval.js', 'js/level.js', 'js/looks.js', 'js/render.js', 'js/store.js', 'js/vendor/mp4-muxer.mjs',
  'fonts/plex-mono-400.woff2', 'fonts/plex-mono-500.woff2', 'fonts/plex-sans.woff2',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png',
  ...CAMS.map((c) => `cameras/${c}.jpg`),
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Network first so updates show up when online; cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
