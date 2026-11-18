// My Apps Hub — Service Worker v5
// Features: cache-first shell, network-only auth/firebase,
// Background Sync for offline writes, Push Notifications
const CACHE_VERSION = 'hub-v8';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;

const SHELL_ASSETS = [
  './', './index.html', './manifest.json',
  './icons/icon-72.png', './icons/icon-96.png', './icons/icon-128.png',
  './icons/icon-144.png', './icons/icon-152.png', './icons/icon-192.png',
  './icons/icon-384.png', './icons/icon-512.png'
];

// NEVER cache these — auth sessions break if intercepted
const NETWORK_ONLY = [
  /firestore\.googleapis\.com/,
  /firebaseapp\.com/,
  /googleapis\.com/,
  /gstatic\.com/,
  /identitytoolkit\.googleapis\.com/,
  /securetoken\.googleapis\.com/,
  /accounts\.google\.com/,
  /cdnjs\.cloudflare\.com/
];

// ── Install ──
self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

// ── Activate: clear old caches ──
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== SHELL_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: cache-first for shell, network-only for auth/API ──
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = e.request.url;
  if (NETWORK_ONLY.some(re => re.test(url))) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => {
      const net = fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(SHELL_CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});

// ── Background Sync: replay offline writes ──
self.addEventListener('sync', e => {
  if (e.tag === 'offline-writes') {
    e.waitUntil(replayOfflineWrites());
  }
});

async function replayOfflineWrites() {
  // Notify the app to flush its offline queue when connection is restored
  const clients = await self.clients.matchAll({ type: 'window' });
  clients.forEach(client => client.postMessage({ type: 'SYNC_OFFLINE_QUEUE' }));
}

// ── Push Notifications ──
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {};
  const title = data.title || 'My Apps Hub';
  const options = {
    body: data.body || 'You have a new notification',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-72.png',
    data: data.url || '/',
    vibrate: [100, 50, 100],
    actions: data.actions || []
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clients => {
      const url = e.notification.data || '/';
      const existing = clients.find(c => c.url.includes(url) && 'focus' in c);
      if (existing) return existing.focus();
      return self.clients.openWindow(url);
    })
  );
});

// ── Messages from the app ──
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});
