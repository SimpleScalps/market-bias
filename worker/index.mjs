import { collectNews, loadCalendar, enrich } from '../docs/engine/feeds.mjs';
import { dedupe } from '../docs/engine/dedupe.mjs';
import { profilPassung, STANDARD_PROFIL } from '../docs/engine/profile.mjs';
import { label } from '../docs/engine/sentiment.mjs';
import { IMPACT_TEXT, DURATION_TEXT } from '../docs/engine/tradeimpact.mjs';
import { sendeAn } from './notify.mjs';
import { deuten, widerspruch, verfuegbareModelle, tageslage } from './deuten.mjs';

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
const GESEHEN_MAX = 4000;   // Gedächtnis über die Sichtbarkeitsgrenze hinaus
const GEGENPROBE_MAX = 3;   // starke Signale je Durchlauf, die geprüft werden
const LAGE_KEY = 'https://market-bias.internal/lage';
const LAGE_FRISCH_MS = 15 * 60_000;   // Zusammenfassung eine Viertelstunde nutzen
const SPERRE_KEY = 'https://market-bias.internal/letzterVersand';

/*
 * Mindestabstand zwischen Benachrichtigungen — aber nur für Kanäle, die ihn
 * brauchen. ntfy sperrt bei erschöpftem Tageskontingent komplett, Discord
 * kennt kein Tageslimit. Wer Discord nutzt, soll Meldungen sofort bekommen;
 * dafür ist das Werkzeug da.
 */
const RUHE_MS = 10 * 60_000;
const BRAUCHT_RUHE = new Set(['ntfy']);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extra } });

/**
 * Kennzeichnet den Inhalt, damit unveraenderte Antworten nicht erneut
 * uebertragen werden muessen.
 *
 * Die App fragt alle zwoelf Sekunden nach; komprimiert sind das je 35 KB und
 * damit rund zehn Megabyte pro Stunde - auf dem Mobilfunk spuerbar. Meist hat
 * sich aber nichts geaendert. Der Zeitstempel bleibt bewusst aussen vor: Er
 * wandert bei jedem Abruf weiter und wuerde die Kennung wertlos machen.
 */
function inhaltsKennung(data) {
  let h = 0;
  const roh = `${data.count}|${(data.items || []).map((n) => n.id).join()}`;
  for (let i = 0; i < roh.length; i++) {
    h = (h * 31 + roh.charCodeAt(i)) | 0;
  }
  return `"${(h >>> 0).toString(36)}-${data.count}"`;
}

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
  const kandidaten = [];
  for (const n of frische) {
    const vorhanden = bekannt.get(n.id);
    if (!vorhanden) kandidaten.push(n);
    // Zeitpunkt der Erstsichtung übernehmen.
    bekannt.set(n.id, vorhanden ? { ...n, date: vorhanden.date } : n);
  }

  const items = dedupe([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  /*
   * Nur melden, was auch im Bestand landet.
   *
   * Der Bestand fasst 300 Meldungen, die Quellen liefern zusammen mehr. Eine
   * neue, aber etwas ältere Meldung fällt beim Kürzen heraus - benachrichtigt
   * wurde vorher trotzdem. Wer dann in der App danach sucht, findet nichts.
   * Auch die Zusammenfassung von Dubletten kann einen Eintrag ersetzen.
   */
  const sichtbar = new Set(items.map((n) => n.id));
  const neue = kandidaten.filter((n) => sichtbar.has(n.id));

  return { items, neue, verworfen: kandidaten.length - neue.length };
}

/**
 * Holt eine Feed-Gruppe, benachrichtigt und legt beides zusammen ab.
 *
 * Der Meldevermerk steckt bewusst im Bestand selbst statt in einem zweiten
 * Objekt: KV wird erst nach und nach über alle Rechenzentren verteilt. Zwei
 * getrennte Einträge konnten deshalb auseinanderlaufen, und dieselbe Meldung
 * ging zweimal raus. Ein Objekt, ein Schreibvorgang, ein Stand.
 */
async function teilAbgleich(env, ctx, regime, bestand, gruppe) {
  const teil = await collectNews({ regime, gruppe, gruppen: GRUPPEN, limit: 300 });
  const { items, neue } = zusammenfuehren(bestand, teil.items);

  /*
   * Das Gedächtnis überlebt die Sichtbarkeitsgrenze.
   *
   * Ein Vermerk an der Meldung selbst reicht nicht: Der angezeigte Bestand
   * fasst 300 Einträge, die Quellen liefern mehr. Eine gemeldete Nachricht
   * wird von neueren verdrängt, verschwindet samt Vermerk - und gilt beim
   * nächsten Durchlauf derselben Feed-Gruppe wieder als neu. Genau so ging
   * dieselbe Meldung dreimal raus. Die Liste der gemeldeten Kennungen liegt
   * deshalb neben den Meldungen, aber im selben Objekt: Zwei getrennte
   * Einträge liefen wegen der verzögerten Verteilung von KV auseinander.
   */
  const gesehen = new Set(bestand?.gesehen || []);

  // Neu ist, was noch nie im Bestand war - nicht bloss, was gerade fehlt.
  const kandidaten = neue.filter((n) => !gesehen.has(n.id));

  // Vor dem Versand gegenlesen lassen: Ein Widerspruch gehoert in die
  // Benachrichtigung, nicht erst in die spaetere Ansicht.
  await gegenlesen(kandidaten, env);

  const versand = bestand
    ? await pushen(env, ctx, kandidaten)
    : { versucht: false, grund: 'erster Lauf' };

  // Alles Sichtbare gilt fortan als bekannt, auch das noch nicht Gemeldete:
  // Wandert eine Meldung spaeter aus der Anzeige, soll sie beim Wiederauftauchen
  // keine zweite Benachrichtigung ausloesen.
  for (const n of items) gesehen.add(n.id);
  const gedaechtnis = [...gesehen].slice(-GESEHEN_MAX);

  const data = {
    updated: new Date().toISOString(),
    regime,
    count: items.length,
    errors: teil.errors,
    items,
    gesehen: gedaechtnis,
  };
  await schreiben(env, ctx, KEY, data, BESTAND_TTL);
  return { data, neue: kandidaten, versand };
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

  /*
   * Auch dieser Pfad pflegt das Gedaechtnis.
   *
   * Er laeuft bei jeder Anfrage der App, also alle zwoelf Sekunden, und kann
   * dabei neue Kalendereintraege in den Bestand holen. Wurden sie hier nicht
   * vermerkt, galten sie spaeter - nach dem Herausrotieren und erneutem
   * Auftauchen - als unbekannt und loesten eine Benachrichtigung aus.
   */
  const gesehen = new Set(bestand.gesehen || []);
  for (const n of items) gesehen.add(n.id);

  const data = {
    ...bestand, items, errors,
    count: items.length,
    updated: new Date().toISOString(),
    gesehen: [...gesehen].slice(-GESEHEN_MAX),
  };
  await schreiben(env, ctx, KEY, data, BESTAND_TTL);
  return { data, neue };
}

/**
 * Lässt die stärksten neuen Signale vom Sprachmodell gegenlesen.
 *
 * Betroffen sind nur wenige Meldungen am Tag, das faellt weder beim Kontingent
 * noch bei der Laufzeit ins Gewicht. Der Gewinn: Genau die Fehler, die ein
 * Regelwerk schwer fassen kann, fallen auf. Eine Notenbank-Meldung aus
 * Malaysia oder eine Reportage, in der zufaellig das Wort "stolen" vorkommt,
 * wertet das Modell anders - und die Meldung traegt dann einen Hinweis.
 */
async function gegenlesen(items, env) {
  if (!env.GROQ_KEY) return;

  const kandidaten = items
    .filter((n) => n.label?.startsWith('strong') && !n.ki)
    .sort((a, b) => Math.abs(b.scores.crypto) - Math.abs(a.scores.crypto))
    .slice(0, GEGENPROBE_MAX);

  for (const n of kandidaten) {
    const deutung = await deuten(n.title, env);
    if (!deutung) continue;
    n.ki = deutung;
    n.kiWiderspruch = widerspruch(n.scores.crypto, deutung);
  }
}

// --- Benachrichtigungen ---------------------------------------------------
/** Welche der neuen Meldungen verdienen eine Push-Nachricht? */
function meldenswert(items, abo) {
  const profil = abo.profil || STANDARD_PROFIL;
  const asset = abo.asset || 'crypto';

  return items.filter((n) => {
    // Was die Einstufung als Rauschen kennzeichnet, gehoert nie in eine
    // Benachrichtigung - Kursprognosen und Projektmeldungen etwa erschienen
    // sonst mehrfach am Tag, weil die Redaktionen sie laufend neu fassen.
    if (n.impactLevel === 'ignore') return false;
    if (profil.aktiv && profilPassung(n, profil) === null) return false;

    // Bei "nur starke Signale" zaehlt auch die Handelswirkung, nicht allein
    // die Richtung: Ein starkes Sentiment ohne Marktwirkung weckt niemanden.
    if (abo.stufe === 'strong' && n.impactLevel === 'low') return false;

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

  // Nur Kanäle mit Tageslimit werden gedrosselt; alle anderen bekommen sofort.
  const gedrosselt = abo.ziele.filter((z) => BRAUCHT_RUHE.has(z.typ));
  const sofort = abo.ziele.filter((z) => !BRAUCHT_RUHE.has(z.typ));

  let ziele = abo.ziele;
  if (gedrosselt.length && !dringend) {
    const sperre = await lesen(env, SPERRE_KEY);
    const seitLetztem = sperre?.zeit ? Date.now() - sperre.zeit : Infinity;
    if (seitLetztem < RUHE_MS) {
      if (!sofort.length) {
        return {
          versucht: false,
          grund: `Ruhezeit für ${gedrosselt.map((z) => z.typ).join(', ')}, noch ${Math.ceil((RUHE_MS - seitLetztem) / 60000)} Min`,
          zurueckgestellt: treffer.length,
        };
      }
      ziele = sofort;   // Discord und Co. bekommen die Meldung trotzdem
    }
  }

  const sprache = abo.lang === 'en' ? 'en' : 'de';
  const asset = abo.asset || 'crypto';
  const top = treffer.sort((a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]))[0];

  const l = label(top.scores[asset]);
  const titelText = `${l.startsWith('strong') ? 'STARK ' : ''}${l.replace('strong_', '').toUpperCase()} · ${asset.toUpperCase()}`;
  const body = [
    sprache === 'de' ? (top.titleDe || top.title) : top.title,
    `${IMPACT_TEXT[sprache][top.impactLevel]} · ${DURATION_TEXT[sprache][top.duration]}`,
    // Sind sich Regelwerk und Modell uneins, steht das dabei - wer danach
    // handelt, soll es vorher wissen.
    top.kiWiderspruch
      ? (sprache === 'de'
          ? `Zweitmeinung weicht ab: ${top.ki.grund}`
          : `Second opinion differs: ${top.ki.grund}`)
      : '',
    treffer.length > 1 ? `+${treffer.length - 1} ${sprache === 'de' ? 'weitere' : 'more'}` : '',
  ].filter(Boolean).join('\n');

  const ergebnis = await sendeAn(ziele, titelText, body);
  if (ergebnis.gesendet && ziele.some((z) => BRAUCHT_RUHE.has(z.typ))) {
    await schreiben(env, ctx, SPERRE_KEY, { zeit: Date.now() }, BESTAND_TTL);
  }
  return {
    versucht: true,
    dringend,
    treffer: treffer.length,
    gesendet: ergebnis.gesendet,
    fehler: ergebnis.fehler,
    titel: titelText,
    kanaele: ziele.map((z) => z.typ),
    // Woruber benachrichtigt wurde - der Aufrufer vermerkt es im Bestand.
    ids: ergebnis.gesendet ? treffer.map((n) => n.id) : [],
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
        zweitmeinung: env.GROQ_KEY ? 'eingerichtet' : 'kein Schluessel',
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
      const { data, neue, versand } = await teilAbgleich(env, ctx, regime, bestand, gruppe);
      return json({
        ok: true,
        gruppe,
        meldungen: data.count,
        nochNieGemeldet: neue.length,
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

    /**
     * Kurzer Lagebericht zum Tag.
     *
     * Die Zahlen im Dashboard zeigen, wie einseitig der Tag ist - nicht, woran
     * es liegt. Das Ergebnis wird eine Viertelstunde vorgehalten: Der Bestand
     * aendert sich langsamer, und jeder Aufruf kostet sonst eine Anfrage.
     */
    if (url.pathname === '/tageslage') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);

      const klasse = (url.searchParams.get('asset') || 'crypto').slice(0, 12);
      const vorhanden = await lesen(env, LAGE_KEY);
      if (vorhanden?.[klasse] && Date.now() - new Date(vorhanden[klasse].stand) < LAGE_FRISCH_MS) {
        return json({ ...vorhanden[klasse], gespeichert: true });
      }

      const bestand = await lesen(env, KEY);
      if (!bestand?.items?.length) return json({ fehler: 'kein Bestand' }, 503);

      // Die gewichtigsten Meldungen des Tages, nicht einfach die neuesten.
      const grenze = Date.now() - 24 * 3600 * 1000;
      const auswahl = bestand.items
        .filter((n) => new Date(n.date).getTime() > grenze && n.impactLevel !== 'ignore')
        .sort((a, b) => Math.abs(b.scores[klasse] ?? 0) * b.priority
                      - Math.abs(a.scores[klasse] ?? 0) * a.priority)
        .slice(0, 14)
        .map((n) => ({ titel: n.title, wertung: (n.scores[klasse] ?? 0).toFixed(2) }));

      const ergebnis = await tageslage(auswahl, klasse, env);
      if (ergebnis?.lage) {
        await schreiben(env, ctx, LAGE_KEY, { ...vorhanden, [klasse]: ergebnis }, BESTAND_TTL);
      }
      return json(ergebnis || { fehler: 'keine Antwort' }, ergebnis?.fehler ? 502 : 200);
    }

    // Zeigt, welche Modelle das hinterlegte Konto nutzen darf. Nuetzlich,
    // wenn Groq wieder eines ausmustert und die Zweitmeinung schweigt.
    if (url.pathname === '/modelle') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);
      try {
        return json({ modelle: await verfuegbareModelle(env) });
      } catch (err) {
        return json({ fehler: err.message }, 502);
      }
    }

    /**
     * Einschaetzung zu einer einzelnen Meldung, auf Abruf aus der App.
     * Der Zugangsschluessel liegt im Worker und verlaesst ihn nie.
     */
    if (url.pathname === '/deuten' && request.method === 'POST') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);
      try {
        const { titel } = await request.json();
        if (!titel) return json({ fehler: 'keine Schlagzeile' }, 400);
        const deutung = await deuten(titel, env);
        return json(deutung || { fehler: 'keine Antwort' }, deutung?.fehler ? 502 : 200);
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
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
      const stand = alterMs(bestand) > KAL_MS
        ? (await kalenderNachziehen(env, ctx, regime, bestand)).data
        : bestand;

      const kennung = inhaltsKennung(stand);

      // Cloudflare schwaecht die Kennung bei komprimierten Antworten ab und
      // stellt ihr W/ voran; der Browser schickt sie in dieser Form zurueck.
      const gesendet = (request.headers.get('if-none-match') || '').replace(/^W\//, '').trim();
      if (gesendet === kennung) {
        // Unveraendert: Die App uebernimmt den Zeitpunkt aus dem Kopfbereich
        // und weiss dadurch trotzdem, dass die Verbindung frisch ist.
        return new Response(null, {
          status: 304,
          headers: { ...CORS, 'etag': kennung, 'x-stand': stand.updated },
        });
      }

      return json({ ...stand, quelle: 'worker' }, 200, { 'etag': kennung });
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

    const { versand } = await teilAbgleich(env, ctx, regime, bestand, gruppe);
    if (versand?.fehler?.length) console.log('Versand fehlgeschlagen:', versand.fehler.join(' | '));
  },
};
