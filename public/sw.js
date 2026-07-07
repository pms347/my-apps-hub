// My Apps Hub — Service Worker v2
// Strategy: cache-first for the app shell, NETWORK-ONLY for ALL auth + Firebase traffic.
// IMPORTANT: Never cache auth-related requests — doing so breaks Firebase session persistence
// and causes the app to ask for login on every visit.
const CACHE_VERSION = 'hub-v3';
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

// ALL of these must bypass the cache entirely — any interception breaks auth sessions.
const NETWORK_ONLY_PATTERNS = [
  /firestore\.googleapis\.com/,
  /firebaseapp\.com/,           // covers auth domain: my-apps-dashboard-a2fbe.firebaseapp.com
  /googleapis\.com/,            // covers all Google APIs including token refresh
  /gstatic\.com/,               // Firebase JS SDK scripts
  /identitytoolkit\.googleapis\.com/,  // Firebase Auth REST API
  /securetoken\.googleapis\.com/,      // Firebase token refresh
  /accounts\.google\.com/,      // Google OAuth
  /cdnjs\.cloudflare\.com/,     // Chart.js, jsPDF etc — always load fresh
  /fonts\.googleapis\.com/,
  /fonts\.gstatic\.com/
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
      Promise.all(keys.filter((k) => k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only handle GET requests — never intercept POST/PUT/DELETE (Firebase writes)
  if (request.method !== 'GET') return;

  const url = request.url;

  // Pass ALL auth + API traffic straight to the network, no caching whatsoever
  if (NETWORK_ONLY_PATTERNS.some((re) => re.test(url))) {
    event.respondWith(fetch(request));
    return;
  }

  // App shell: cache-first, update cache in background on each successful fetch
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(SHELL_CACHE).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
