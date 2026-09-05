// Hülle offline verfügbar halten; die Nachrichten selbst kommen immer frisch.
/*
 * Der Name traegt bewusst keine Versionsnummer mehr.
 *
 * Er stand auf 'market-bias-v39', waehrend die Anwendung bei v44 war - eine
 * Angabe, die niemand mitpflegt, sagt irgendwann das Gegenteil dessen, was
 * gilt. Fuer die Aufraeumlogik unten genuegt ein fester Name; welche Fassung
 * darin liegt, entscheidet ohnehin der Abruf.
 */
const CACHE = 'market-bias-huelle';
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

  // Daten: immer Netzwerk zuerst, Cache nur als Rückfallebene
  if (url.pathname.endsWith('news.json') || url.pathname.endsWith('woche.json')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => { caches.open(CACHE).then((c) => c.put(e.request, r.clone())); return r; })
        .catch(() => caches.match(e.request))
    );
    return;
  }
  /*
   * Programmcode immer zuerst aus dem Netz - und zwar wirklich.
   *
   * "Netzwerk zuerst" allein genuegte nicht: fetch() benutzt darunter den
   * HTTP-Zwischenspeicher des Browsers, und GitHub Pages setzt auf diese
   * Dateien max-age=600. Nach einem Ausrollen lief deshalb bis zu zehn
   * Minuten weiter die alte Fassung, ohne dass ein Neuladen etwas geaendert
   * haette - Fehler wirkten dann als seien sie nicht behoben.
   *
   * 'no-cache' erzwingt eine Rueckfrage beim Server. Hat sich nichts
   * geaendert, antwortet er mit 304 und schickt nichts weiter; das kostet
   * fast nichts. Angefragt wird ueber die Adresse statt ueber die Anfrage
   * selbst, weil eine Navigationsanfrage sich nicht mit anderen
   * Zwischenspeicher-Vorgaben nachbilden laesst.
   */
  if (/\.(js|mjs|css|html)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(
      fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' })
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
