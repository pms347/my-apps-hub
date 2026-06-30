// My Apps Hub — Service Worker
// Strategy: cache-first for the app shell (HTML/CSS/JS/icons), network-only for Firebase.
// Bump CACHE_VERSION whenever index.html changes so clients pick up the new shell.
const CACHE_VERSION = 'hub-v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png'
];

// Never cache these — always go to network. Firebase Auth/Firestore/Storage,
// and any third-party CDN script that could change (Chart.js, jsPDF, XLSX).
const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebaseapp\.com/,
  /googleapis\.com/,
  /gstatic\.com\/firebasejs/,
  /cdnjs\.cloudflare\.com/
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never intercept writes

  const url = request.url;
  const isNetworkOnly = NETWORK_ONLY_PATTERNS.some((re) => re.test(url));

  if (isNetworkOnly) {
    // Always hit the network for live data and third-party libs; don't cache them.
    event.respondWith(fetch(request).catch(() => caches.match(request)));
    return;
  }

  // App shell: cache-first, falling back to network, then updating the cache.
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: serve whatever we have cached
      return cached || networkFetch;
    })
  );
});

// Allow the page to tell the SW to activate immediately after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
