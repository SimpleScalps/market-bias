import { collectNews, loadCalendar, enrich } from '../docs/engine/feeds.mjs';
import { dedupe } from '../docs/engine/dedupe.mjs';

// Cloudflare Worker: holt die Quellen serverseitig (RSS-Feeds senden keine
// CORS-Header, der Browser kann sie also nicht selbst laden) und liefert das
// bewertete Ergebnis mit CORS aus. Der Cron-Trigger hält den Cache im
// Minutentakt warm; Anfragen werden dadurch sofort beantwortet.

const KEY = 'https://market-bias.internal/news';
const VOLL_MS = 90_000;   // Vollabgleich höchstens alle 90 s
const KAL_MS = 20_000;    // Kalender im Livebetrieb alle 20 s

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

async function cacheLesen() {
  const hit = await caches.default.match(KEY);
  return hit ? hit.json() : null;
}

async function cacheSchreiben(ctx, data) {
  const res = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': 'max-age=600' },
  });
  ctx.waitUntil(caches.default.put(KEY, res));
}

const alterMs = (data) => (data?.updated ? Date.now() - new Date(data.updated).getTime() : Infinity);

/**
 * Aktualisiert nur den Wirtschaftskalender und mischt ihn in den Bestand.
 * Das ist der zeitkritische Teil: NFP, CPI und Zinsentscheide erscheinen dort
 * innerhalb von Sekunden nach der Veröffentlichung.
 */
async function kalenderNachziehen(bestand, regime) {
  const frisch = enrich(await loadCalendar(regime));
  const bekannt = new Map(bestand.items.map((n) => [n.id, n]));
  let neu = 0;
  for (const n of frisch) if (!bekannt.has(n.id)) { bekannt.set(n.id, n); neu++; }

  const items = dedupe([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  return { ...bestand, items, count: items.length, updated: new Date().toISOString(), neu };
}

async function aktualisieren(ctx, regime, vorhanden) {
  // Ohne Bestand oder wenn er alt ist: alle Quellen abfragen.
  if (!vorhanden || alterMs(vorhanden) > VOLL_MS) {
    const data = await collectNews({ regime });
    await cacheSchreiben(ctx, data);
    return data;
  }
  // Sonst reicht der schnelle Kalenderabgleich.
  if (alterMs(vorhanden) > KAL_MS) {
    const data = await kalenderNachziehen(vorhanden, regime);
    await cacheSchreiben(ctx, data);
    return data;
  }
  return vorhanden;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, zeit: new Date().toISOString() });

    const regime = env.REGIME || 'policy';
    try {
      const vorhanden = await cacheLesen();
      const data = await aktualisieren(ctx, regime, vorhanden);
      return json({ ...data, quelle: 'worker' });
    } catch (err) {
      // Lieber ein veralteter Stand als gar keiner.
      const fallback = await cacheLesen();
      if (fallback) return json({ ...fallback, quelle: 'worker-cache', fehler: err.message });
      return json({ fehler: err.message, items: [] }, 502);
    }
  },

  // Cron-Trigger hält den Cache warm, damit Anfragen ohne Wartezeit antworten.
  async scheduled(event, env, ctx) {
    const data = await collectNews({ regime: env.REGIME || 'policy' });
    await cacheSchreiben(ctx, data);
  },
};
