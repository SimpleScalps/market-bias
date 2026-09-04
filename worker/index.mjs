import { collectNews, loadCalendar, enrich } from '../docs/engine/feeds.mjs';
import { dedupe } from '../docs/engine/dedupe.mjs';
import { profilPassung, STANDARD_PROFIL } from '../docs/engine/profile.mjs';
import { label } from '../docs/engine/sentiment.mjs';
import { IMPACT_TEXT, DURATION_TEXT } from '../docs/engine/tradeimpact.mjs';
import { sendeAn } from './notify.mjs';

// Cloudflare Worker: holt die Quellen serverseitig (RSS-Feeds senden keine
// CORS-Header, der Browser kann sie also nicht selbst laden) und liefert das
// bewertete Ergebnis mit CORS aus. Der Cron-Trigger hält den Cache im
// Minutentakt warm und verschickt dabei Benachrichtigungen — auch dann, wenn
// die App gerade geschlossen ist.

const KEY = 'https://market-bias.internal/news';
const ABO_KEY = 'https://market-bias.internal/abo';
const VOLL_MS = 90_000;   // Vollabgleich höchstens alle 90 s
const KAL_MS = 20_000;    // Kalender im Livebetrieb alle 20 s

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: CORS });

// --- Ablage: KV wenn gebunden, sonst der flüchtige Cache ------------------
async function lesen(env, key) {
  if (env.STORE) {
    const v = await env.STORE.get(key, 'json');
    return v ?? null;
  }
  const hit = await caches.default.match(key);
  return hit ? hit.json() : null;
}

async function schreiben(env, ctx, key, data, ttl = 86400) {
  if (env.STORE) return env.STORE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  const res = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
  });
  ctx.waitUntil(caches.default.put(key, res));
}

const alterMs = (d) => (d?.updated ? Date.now() - new Date(d.updated).getTime() : Infinity);

/**
 * Zieht nur den Wirtschaftskalender nach. Das ist der zeitkritische Teil:
 * NFP, CPI und Zinsentscheide erscheinen dort Sekunden nach der Veröffentlichung.
 */
async function kalenderNachziehen(bestand, regime) {
  const frisch = enrich(await loadCalendar(regime));
  const bekannt = new Map(bestand.items.map((n) => [n.id, n]));
  for (const n of frisch) if (!bekannt.has(n.id)) bekannt.set(n.id, n);

  const items = dedupe([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  return { ...bestand, items, count: items.length, updated: new Date().toISOString() };
}

async function aktualisieren(env, ctx, regime, vorhanden) {
  if (!vorhanden || alterMs(vorhanden) > VOLL_MS) {
    const data = await collectNews({ regime });
    await schreiben(env, ctx, KEY, data, 600);
    return data;
  }
  if (alterMs(vorhanden) > KAL_MS) {
    const data = await kalenderNachziehen(vorhanden, regime);
    await schreiben(env, ctx, KEY, data, 600);
    return data;
  }
  return vorhanden;
}

// --- Benachrichtigungen aus dem Cron heraus -------------------------------
/** Welche der neuen Meldungen verdienen eine Push-Nachricht? */
function meldenswert(items, abo) {
  const profil = abo.profil || STANDARD_PROFIL;
  const asset = abo.asset || 'crypto';

  return items.filter((n) => {
    if (profil.aktiv && profilPassung(n, profil) === null) return false;
    const l = label(n.scores?.[asset] ?? 0);
    if (abo.stufe === 'strong') return l.startsWith('strong');
    return l !== 'neutral';
  });
}

async function pushen(env, ctx, neueItems) {
  const abo = await lesen(env, ABO_KEY);
  if (!abo?.ziele?.length || abo.stufe === 'off' || !neueItems.length) return;

  const treffer = meldenswert(neueItems, abo);
  if (!treffer.length) return;

  const sprache = abo.lang === 'en' ? 'en' : 'de';
  const asset = abo.asset || 'crypto';
  const top = treffer.sort(
    (a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]))[0];

  const richtung = label(top.scores[asset]).replace('strong_', '').toUpperCase();
  const stark = label(top.scores[asset]).startsWith('strong') ? 'STARK ' : '';
  const titelText = `${stark}${richtung} · ${asset.toUpperCase()}`;
  const body = [
    sprache === 'de' ? (top.titleDe || top.title) : top.title,
    `${IMPACT_TEXT[sprache][top.impactLevel]} · ${DURATION_TEXT[sprache][top.duration]}`,
    treffer.length > 1 ? `+${treffer.length - 1} weitere` : '',
  ].filter(Boolean).join('\n');

  ctx.waitUntil(sendeAn(abo.ziele, titelText, body));
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const regime = env.REGIME || 'policy';

    if (url.pathname === '/health') {
      return json({ ok: true, zeit: new Date().toISOString(), ablage: env.STORE ? 'kv' : 'cache' });
    }

    // Sofortversand, ausgelöst von der geöffneten App.
    if (url.pathname === '/notify' && request.method === 'POST') {
      try {
        const { titel, text, ziele } = await request.json();
        const r = await sendeAn(ziele, titel || 'Market Bias', text || '');
        return json(r, r.gesendet ? 200 : 502);
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    // Abo hinterlegen, damit der Cron auch bei geschlossener App verschickt.
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        const abo = await request.json();
        await schreiben(env, ctx, ABO_KEY, abo, 30 * 86400);
        return json({ ok: true, dauerhaft: !!env.STORE });
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    try {
      const vorhanden = await lesen(env, KEY);
      const data = await aktualisieren(env, ctx, regime, vorhanden);
      return json({ ...data, quelle: 'worker' });
    } catch (err) {
      const fallback = await lesen(env, KEY);
      if (fallback) return json({ ...fallback, quelle: 'worker-cache', fehler: err.message });
      return json({ fehler: err.message, items: [] }, 502);
    }
  },

  // Cron: Cache warm halten und über neue Meldungen benachrichtigen.
  async scheduled(event, env, ctx) {
    const vorher = await lesen(env, KEY);
    const bekannt = new Set((vorher?.items || []).map((n) => n.id));

    const data = await collectNews({ regime: env.REGIME || 'policy' });
    await schreiben(env, ctx, KEY, data, 600);

    if (vorher) {
      const neue = data.items.filter((n) => !bekannt.has(n.id));
      await pushen(env, ctx, neue);
    }
  },
};
