// Hülle offline verfügbar halten; die Nachrichten selbst kommen immer frisch.
const CACHE = 'market-bias-v19';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'i18n.js', 'manifest.webmanifest', 'icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((k) => Promise.all(k.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // news.json: immer Netzwerk zuerst, Cache nur als Rückfallebene
  if (url.pathname.endsWith('news.json')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  // Programmcode immer zuerst aus dem Netz holen. Sonst haelt der
  // Zwischenspeicher nach einem Update die alte Fassung fest — auf dem iPhone
  // hartnaeckig, weil eine installierte PWA selten vollstaendig neu startet.
  if (/\.(js|mjs|css|html)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          const kopie = r.clone();
          caches.open(CACHE).then((c) => c.put(e.request, kopie));
          return r;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
