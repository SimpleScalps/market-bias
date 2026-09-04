import { collectNews, loadCalendar, enrich } from '../docs/engine/feeds.mjs';
import { dedupe } from '../docs/engine/dedupe.mjs';
import { profilPassung, STANDARD_PROFIL } from '../docs/engine/profile.mjs';
import { label } from '../docs/engine/sentiment.mjs';
import { IMPACT_TEXT, DURATION_TEXT } from '../docs/engine/tradeimpact.mjs';
import { sendeAn } from './notify.mjs';

// Cloudflare Worker: holt die Quellen serverseitig (RSS-Feeds senden keine
// CORS-Header, der Browser kann sie also nicht selbst laden), bewertet sie mit
// derselben Engine wie die App und liefert das Ergebnis mit CORS aus. Der
// Cron-Trigger verschickt dabei Benachrichtigungen — auch dann, wenn die App
// geschlossen ist. Das ist der eigentliche Zweck des Workers.
//
// Rechenzeit: Der Gratisplan erlaubt 10 ms pro Aufruf, alle Feeds zusammen
// brauchen rund 19 ms. Deshalb arbeitet der Cron rollierend eine Gruppe pro
// Minute ab (rund 4 ms) und führt das Ergebnis mit dem Bestand zusammen. Der
// Wirtschaftskalender läuft in jedem Durchgang mit, weil NFP und CPI auf die
// Sekunde zählen — er kostet nur 0,4 ms.

const KEY = 'https://market-bias.internal/news';
const ABO_KEY = 'https://market-bias.internal/abo';
const GRUPPEN = 3;
const KAL_MS = 20_000;      // Kalender im Livebetrieb höchstens alle 20 s
const BESTAND_TTL = 86_400; // Bestand einen Tag halten, nicht zehn Minuten
const GESEHEN_KEY = 'https://market-bias.internal/gesehen';
const GESEHEN_MAX = 3000;   // deutlich mehr als die 300 angezeigten Meldungen
const SPERRE_KEY = 'https://market-bias.internal/letzterVersand';
const RUHE_MS = 10 * 60_000;  // Mindestabstand zwischen Benachrichtigungen

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
  if (env.STORE) return (await env.STORE.get(key, 'json')) ?? null;
  const hit = await caches.default.match(key);
  return hit ? hit.json() : null;
}

/**
 * Ablegen. Die Verfallszeit gilt fuer KV: Sie muss deutlich laenger sein als
 * der Cron-Takt, sonst verschwindet der Bestand in ruhigen Phasen und der
 * naechste Lauf haelt jede Meldung fuer neu.
 */
async function schreiben(env, ctx, key, data, ttl = 86400) {
  if (env.STORE) return env.STORE.put(key, JSON.stringify(data), { expirationTtl: ttl });
  const res = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
  });
  ctx.waitUntil(caches.default.put(key, res));
}

const alterMs = (d) => (d?.updated ? Date.now() - new Date(d.updated).getTime() : Infinity);

/**
 * Führt frische Meldungen mit dem Bestand zusammen.
 *
 * Der Zeitstempel einer bereits bekannten Meldung bleibt stehen. Redaktionen
 * überarbeiten Artikel im Lauf des Tages und setzen dabei das
 * Veröffentlichungsdatum neu — dieselbe Meldung wanderte dadurch im Feed nach
 * oben und wirkte Stunden jünger, als sie war. Für den Handel zählt, wann eine
 * Nachricht zuerst da war.
 */
function zusammenfuehren(bestand, frische) {
  const bekannt = new Map((bestand?.items || []).map((n) => [n.id, n]));
  const neue = [];
  for (const n of frische) {
    const vorhanden = bekannt.get(n.id);
    if (!vorhanden) neue.push(n);
    bekannt.set(n.id, vorhanden ? { ...n, date: vorhanden.date } : n);
  }

  const items = dedupe([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  return { items, neue };
}

/** Holt eine Feed-Gruppe plus Kalender und aktualisiert den Bestand. */
async function teilAbgleich(env, ctx, regime, bestand, gruppe) {
  const teil = await collectNews({ regime, gruppe, gruppen: GRUPPEN, limit: 300 });
  const { items, neue } = zusammenfuehren(bestand, teil.items);

  const data = {
    updated: new Date().toISOString(),
    regime,
    count: items.length,
    errors: teil.errors,
    items,
  };
  await schreiben(env, ctx, KEY, data, BESTAND_TTL);
  return { data, neue };
}

/**
 * Nur den Kalender nachziehen — der billigste Weg zu frischen Zahlen.
 *
 * Fällt die Kalenderquelle aus (MyFXBook sperrt Anfragen aus Rechenzentren
 * zeitweise mit 403), ist der Bestand trotzdem aktuell: Die übrigen fünfzehn
 * Quellen pflegt der Cron weiter. Der Zeitstempel darf deshalb nicht auf dem
 * alten Stand einfrieren — sonst meldet die App fälschlich veraltete Daten.
 */
async function kalenderNachziehen(env, ctx, regime, bestand) {
  let frisch = [];
  let fehler = null;
  try {
    frisch = enrich(await loadCalendar(regime));
  } catch (err) {
    fehler = `Wirtschaftskalender: ${err.message}`;
  }

  const { items, neue } = zusammenfuehren(bestand, frisch);
  const errors = fehler
    ? [...(bestand.errors || []).filter((e) => !e.startsWith('Wirtschaftskalender')), fehler]
    : (bestand.errors || []).filter((e) => !e.startsWith('Wirtschaftskalender'));

  const data = {
    ...bestand, items, errors,
    count: items.length,
    updated: new Date().toISOString(),
  };
  await schreiben(env, ctx, KEY, data, BESTAND_TTL);
  return { data, neue };
}

/**
 * Merkt sich, welche Meldungen schon einmal da waren.
 *
 * Der angezeigte Bestand ist auf 300 Eintraege begrenzt; aeltere fallen heraus
 * und tauchen beim naechsten Lauf erneut als "neu" auf. Ohne dieses Gedaechtnis
 * wuerde derselbe Artikel immer wieder eine Benachrichtigung ausloesen - bei
 * jedem Durchlauf rund fuenfzig Stueck.
 */
async function nurWirklichNeue(env, ctx, kandidaten) {
  if (!kandidaten.length) return [];

  const gespeichert = (await lesen(env, GESEHEN_KEY)) || { ids: [] };
  const gesehen = new Set(gespeichert.ids);

  const echtNeu = kandidaten.filter((n) => !gesehen.has(n.id));
  if (!echtNeu.length) return [];

  // Neue Kennungen hinten anhaengen, aelteste verwerfen.
  const aktualisiert = [...gespeichert.ids, ...echtNeu.map((n) => n.id)].slice(-GESEHEN_MAX);
  await schreiben(env, ctx, GESEHEN_KEY, { ids: aktualisiert }, BESTAND_TTL * 3);

  return echtNeu;
}

// --- Benachrichtigungen ---------------------------------------------------
/** Welche der neuen Meldungen verdienen eine Push-Nachricht? */
function meldenswert(items, abo) {
  const profil = abo.profil || STANDARD_PROFIL;
  const asset = abo.asset || 'crypto';

  return items.filter((n) => {
    if (profil.aktiv && profilPassung(n, profil) === null) return false;
    const l = label(n.scores?.[asset] ?? 0);
    return abo.stufe === 'strong' ? l.startsWith('strong') : l !== 'neutral';
  });
}

async function pushen(env, ctx, neueItems) {
  const abo = await lesen(env, ABO_KEY);
  if (!abo?.ziele?.length) return { versucht: false, grund: 'kein Abo hinterlegt' };
  if (abo.stufe === 'off') return { versucht: false, grund: 'Benachrichtigungen aus' };
  if (!neueItems?.length) return { versucht: false, grund: 'nichts Neues' };

  const treffer = meldenswert(neueItems, abo);
  if (!treffer.length) {
    return { versucht: false, grund: `${neueItems.length} neu, aber keine mit Richtung` };
  }

  /*
   * Ruhezeit. Der Worker läuft alle zwei Minuten; ohne Abstand wären das bis zu
   * 720 Nachrichten am Tag, und kostenlose Push-Dienste sperren lange vorher.
   * Zehn Minuten Abstand halten den Kanal brauchbar, ohne dass etwas verloren
   * geht: Was in der Ruhezeit auflief, steht in der nächsten Sammelmeldung.
   * Extremereignisse - Börsen-Hack, Zinsentscheid - kommen sofort durch.
   */
  const dringend = treffer.some((n) => n.impactLevel === 'extreme');
  const sperre = await lesen(env, SPERRE_KEY);
  const seitLetztem = sperre?.zeit ? Date.now() - sperre.zeit : Infinity;

  if (!dringend && seitLetztem < RUHE_MS) {
    return {
      versucht: false,
      grund: `Ruhezeit, noch ${Math.ceil((RUHE_MS - seitLetztem) / 60000)} Min`,
      zurueckgestellt: treffer.length,
    };
  }

  const sprache = abo.lang === 'en' ? 'en' : 'de';
  const asset = abo.asset || 'crypto';
  const top = treffer.sort((a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]))[0];

  const l = label(top.scores[asset]);
  const titelText = `${l.startsWith('strong') ? 'STARK ' : ''}${l.replace('strong_', '').toUpperCase()} · ${asset.toUpperCase()}`;
  const body = [
    sprache === 'de' ? (top.titleDe || top.title) : top.title,
    `${IMPACT_TEXT[sprache][top.impactLevel]} · ${DURATION_TEXT[sprache][top.duration]}`,
    treffer.length > 1 ? `+${treffer.length - 1} ${sprache === 'de' ? 'weitere' : 'more'}` : '',
  ].filter(Boolean).join('\n');

  const ergebnis = await sendeAn(abo.ziele, titelText, body);
  if (ergebnis.gesendet) {
    await schreiben(env, ctx, SPERRE_KEY, { zeit: Date.now() }, BESTAND_TTL);
  }
  return {
    versucht: true,
    dringend,
    treffer: treffer.length,
    gesendet: ergebnis.gesendet,
    fehler: ergebnis.fehler,
    titel: titelText,
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const regime = env.REGIME || 'policy';

    if (url.pathname === '/health') {
      const bestand = await lesen(env, KEY);
      const abo = await lesen(env, ABO_KEY);
      return json({
        ok: true,
        zeit: new Date().toISOString(),
        ablage: env.STORE ? 'kv' : 'cache',
        meldungen: bestand?.items?.length ?? 0,
        alterSekunden: Math.round(alterMs(bestand) / 1000),
        // Ohne hinterlegtes Abo verschickt der Worker nichts. Zeigt nur, ob
        // und wohin - niemals Token oder Themennamen.
        abo: abo ? {
          stufe: abo.stufe,
          kanaele: (abo.ziele || []).map((z) => z.typ + (z.token ? ' (mit Token)' : ' (ohne Token)')),
          anlageklasse: abo.asset,
          profilAktiv: !!abo.profil?.aktiv,
        } : null,
      });
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

    /**
     * Ersatz für den Cron-Trigger. Cloudflares eigener Zeitgeber lief bei
     * diesem Worker nicht an und meldet Fehlläufe auch nicht, deshalb lässt
     * sich derselbe Ablauf von außen anstoßen — durch die GitHub-Action oder
     * einen kostenlosen Cron-Dienst. Macht genau das, was scheduled() tut:
     * eine Feed-Gruppe abgleichen und fällige Benachrichtigungen verschicken.
     */
    if (url.pathname === '/tick') {
      const bestand = await lesen(env, KEY);
      const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;
      const { data, neue } = await teilAbgleich(env, ctx, regime, bestand, gruppe);
      const echtNeu = await nurWirklichNeue(env, ctx, neue);
      const versand = bestand
        ? await pushen(env, ctx, echtNeu)
        : { versucht: false, grund: 'erster Lauf, alles neu' };
      return json({
        ok: true,
        gruppe,
        meldungen: data.count,
        neuImBestand: neue.length,
        davonNieGesehen: echtNeu.length,
        versand,
        errors: data.errors,
      });
    }

    /**
     * Testversand über das hinterlegte Abo. Prüft genau den Weg, den auch die
     * automatischen Meldungen nehmen — im Unterschied zum Knopf in der App,
     * der bei geöffneter App direkt aus dem Browser sendet und deshalb an
     * anderen Sperren vorbeikommt. Zugangsdaten müssen dafür nirgends
     * eingegeben werden, sie liegen bereits im Abo.
     */
    if (url.pathname === '/testpush') {
      const abo = await lesen(env, ABO_KEY);
      if (!abo?.ziele?.length) return json({ ok: false, grund: 'kein Abo hinterlegt' }, 400);

      const r = await sendeAn(
        abo.ziele,
        'BULLISH · TEST',
        'Testnachricht über den Worker.' + String.fromCharCode(10) + 'Kommt sie an, funktioniert der Versand auch bei geschlossener App.'
      );
      return json({
        ok: r.gesendet > 0,
        gesendet: r.gesendet,
        fehler: r.fehler,
        kanaele: abo.ziele.map((z) => z.typ),
      }, r.gesendet ? 200 : 502);
    }

    // Abo hinterlegen, damit der Cron auch bei geschlossener App verschickt.
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        await schreiben(env, ctx, ABO_KEY, await request.json(), 30 * 86400);
        return json({ ok: true, dauerhaft: !!env.STORE });
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    try {
      const bestand = await lesen(env, KEY);

      // Noch kein Bestand: eine Gruppe holen, den Rest übernimmt der Cron.
      if (!bestand) {
        const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;
        const { data } = await teilAbgleich(env, ctx, regime, null, gruppe);
        return json({ ...data, quelle: 'worker' });
      }

      // Sonst reicht der Kalender — er trägt die zeitkritischen Zahlen.
      if (alterMs(bestand) > KAL_MS) {
        const { data } = await kalenderNachziehen(env, ctx, regime, bestand);
        return json({ ...data, quelle: 'worker' });
      }

      return json({ ...bestand, quelle: 'worker-cache' });
    } catch (err) {
      const fallback = await lesen(env, KEY);
      if (fallback) return json({ ...fallback, quelle: 'worker-cache', fehler: err.message });
      return json({ fehler: err.message, items: [] }, 502);
    }
  },

  // Cron: rollierend eine Gruppe abarbeiten und über Neues benachrichtigen.
  async scheduled(event, env, ctx) {
    const regime = env.REGIME || 'policy';
    const bestand = await lesen(env, KEY);
    const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;

    const { neue } = await teilAbgleich(env, ctx, regime, bestand, gruppe);

    // Beim allerersten Lauf ist alles neu — dann nicht benachrichtigen.
    const echtNeu = await nurWirklichNeue(env, ctx, neue);
    if (bestand) {
      const r = await pushen(env, ctx, echtNeu);
      if (r?.fehler?.length) console.log('Versand fehlgeschlagen:', r.fehler.join(' | '));
    }
  },
};
