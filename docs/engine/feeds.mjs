import { scoreMacroEvent, scoreHeadline, label, LABEL_TEXT } from './sentiment.mjs';
import { isNoise, categorize, priority, CATEGORY_LABEL } from './priority.mjs';
import { dedupe } from './dedupe.mjs';
import { tradeImpact } from './tradeimpact.mjs';
import { translateTitles } from './translate.mjs';

// Gemeinsame Sammel-Pipeline für das Node-Skript (GitHub Actions) und den
// Cloudflare Worker (Live-Betrieb). Beide rufen collectNews() auf.

export const CALENDAR = 'https://www.myfxbook.com/rss/forex-economic-calendar-events';

export const FEEDS = [
  // Schwerpunkt US-Wirtschaft und Weltlage
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html',   source: 'CNBC Economy',    tags: ['US-Wirtschaft'], fast: true },
  { url: 'https://www.cnbc.com/id/100727362/device/rss/rss.html',  source: 'CNBC World',      tags: ['Weltwirtschaft'], fast: true },
  { url: 'https://www.fxstreet.com/rss/news',                      source: 'FXStreet',        tags: ['Makro'], fast: true },
  { url: 'https://www.benzinga.com/feed',                          source: 'Benzinga',        tags: ['US-Märkte'] },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',            source: 'BBC World',       tags: ['Weltlage'] },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',              source: 'Al Jazeera',      tags: ['Weltlage'] },
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml',     source: 'Federal Reserve', tags: ['Fed'], fast: true },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',  source: 'CNBC',            tags: ['Märkte'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/',  source: 'MarketWatch',     tags: ['Märkte'] },
  // Krypto (dieselben offenen Quellen, die auch CryptoPanic aggregiert)
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',        source: 'CoinDesk',        tags: ['Krypto'], fast: true },
  { url: 'https://cointelegraph.com/rss',                          source: 'Cointelegraph',   tags: ['Krypto'], fast: true },
  { url: 'https://decrypt.co/feed',                                source: 'Decrypt',         tags: ['Krypto'] },
  { url: 'https://www.theblock.co/rss.xml',                        source: 'The Block',       tags: ['Krypto'], fast: true },

  /*
   * Nachgemessene Schnellquellen.
   *
   * Ausgewaehlt nach dem, was der Abruf selbst verraet: Wie alt liefert das
   * CDN die Datei aus, und was sagt die Cache-Vorgabe. Cointelegraph schickt
   * s-maxage=300, CryptoSlate sogar max-age=3600 - bei denen ist der
   * Rueckstand eingebaut. Die hier antworten mit Age 0 und
   * max-age=0, must-revalidate: Jede Anfrage bekommt den aktuellen Stand.
   *
   * Blockworks fiel bei der Pruefung durch: Der Feed-Kopf meldet sich als
   * eben aktualisiert, alle fuenfzig Eintraege stammen aber aus Dezember und
   * Januar. Wer nur auf den Kopf schaut, nimmt eine tote Quelle auf.
   *
   * Nicht aufgenommen wurden die Feeds des US-Arbeitsministeriums, obwohl sie
   * die Primaerquelle sind und ohne jeden Rueckstand ausliefern: Sie nennen
   * die Zahl, aber keine Prognose. "Payroll employment increases by 162,000"
   * ist ohne das erwartete Ergebnis richtungslos - erst der Vergleich mit den
   * 56.000 der Prognose macht daraus eine Aussage. Nachgeprueft: Das
   * Regelwerk bewertet diese Schlagzeilen zu Recht als neutral. Diese Arbeit
   * leistet der Wirtschaftskalender, der Prognose und Vorwert mitliefert.
   */
  { url: 'https://thedefiant.io/api/feed',                         source: 'The Defiant',     tags: ['Krypto'], fast: true },
  { url: 'https://beincrypto.com/feed/',                           source: 'BeInCrypto',      tags: ['Krypto'] },
  { url: 'https://u.today/rss',                                    source: 'U.Today',         tags: ['Krypto'] },
];

const UA = { 'user-agent': 'Mozilla/5.0 (compatible; MarketBias/1.0)' };

export const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export const tag = (item, name) => {
  const m = item.match(new RegExp('<' + name + '[^>]*>([^]*?)</' + name + '>', 'i'));
  return m ? decode(m[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

/*
 * Ein Eintrag heisst je nach Format <item> (RSS) oder <entry> (Atom).
 *
 * Bis hierher kannte der Parser nur RSS und lieferte fuer Atom-Feeds stumm
 * eine leere Liste - kein Fehler, keine Meldungen, nichts zu sehen. Genau so
 * waeren Blockworks und die Feeds des US-Arbeitsministeriums durchgefallen,
 * und letztere sind die Primaerquelle fuer die Zahlen, um die es hier geht.
 */
export const items = (xml) => [
  ...[...xml.matchAll(/<item[\s>][^]*?<\/item>/gi)].map((m) => m[0]),
  ...[...xml.matchAll(/<entry[\s>][^]*?<\/entry>/gi)].map((m) => m[0]),
];

/*
 * Zeitstempel: RSS nennt ihn pubDate, Atom published oder updated.
 * Ohne den Erscheinungszeitpunkt landet eine Meldung mit "jetzt" im Bestand
 * und draengt sich faelschlich an die Spitze.
 */
export const zeitstempel = (it) =>
  tag(it, 'pubDate') || tag(it, 'published') || tag(it, 'updated') || tag(it, 'dc:date');

/*
 * Adresse: RSS schreibt sie in den Inhalt des Elements, Atom in ein Attribut.
 * Atom kennt mehrere Verweise; gesucht ist der auf die Meldung selbst, also
 * rel="alternate" oder gar kein rel.
 */
export const verweis = (it) => {
  // tag() loest CDATA und Entitaeten auf - Cointelegraph verpackt die Adresse
  // in <![CDATA[...]]>, ein Muster auf den blossen Inhalt scheitert daran.
  const rss = tag(it, 'link');
  if (rss) return rss;
  const atom = it.match(/<link\b(?![^>]*rel=["'](?:self|edit|replies)["'])[^>]*href=["']([^"']+)["']/i);
  return atom ? atom[1].trim() : '';
};

/*
 * Feed holen - und zwar den aktuellen, nicht den zwischengespeicherten.
 *
 * Ein blosses fetch() laeuft in Cloudflare Workers durch deren Cache, und der
 * haelt sich an die Vorgaben der Quelle. Cointelegraph schickt s-maxage=300,
 * The Block max-age=60 und lieferte trotzdem eine 385 Sekunden alte Fassung.
 * Der Worker fragte also jede Minute und bekam minutenlang dieselbe Datei:
 * Eine Meldung von 08:03 erreichte die Benachrichtigung erst um 08:19.
 *
 * Was hilft: Cloudflares eigener Zwischenspeicher laesst sich per cf
 * abschalten, das nimmt bis zu fuenf Minuten heraus.
 *
 * Was nicht hilft: Eine wechselnde Kennzahl in der Adresse. Gemessen an beiden
 * Quellen - der Rueckstand blieb auf die Sekunde gleich, cf-cache-status
 * meldete weiter HIT. Ihre CDNs vereinheitlichen den Parameter. Der Anteil,
 * den die Quelle selbst zurueckhaelt, ist von hier aus nicht zu verkuerzen;
 * die Kopfzeilen unten bittet man trotzdem, es kostet nichts.
 */
async function get(url, timeoutMs = 12000) {
  const res = await fetch(url, {
    headers: { ...UA, 'cache-control': 'no-cache', 'pragma': 'no-cache' },
    cf: { cacheTtl: 0, cacheEverything: false },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

/** Wirtschaftskalender: Actual, Prognose und Vorwert je Event. */
export async function loadCalendar(regime = 'policy') {
  const xml = await get(CALENDAR, 15000);
  const out = [];
  for (const it of items(xml)) {
    const title = tag(it, 'title');
    const desc = decode((it.match(/<description>([^]*?)<\/description>/i) || [])[1] || '');
    const impact = (desc.match(/sprite-(high|medium|low)-impact/) || [])[1] || 'low';
    const cells = [...desc.matchAll(/<td[^>]*>([^]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]*>/g, '').trim());
    const [, , previous, consensus, actual] = cells;
    if (!actual) continue;                       // noch nicht veröffentlicht
    const date = new Date(tag(it, 'pubDate'));
    if (isNaN(date)) continue;

    const scored = scoreMacroEvent({ title, actual, consensus, previous, impact }, regime);
    if (!scored) continue;
    const zahlen = `${actual} (${'{F}'} ${consensus || '—'}, ${'{P}'} ${previous || '—'})`;
    out.push({
      id: `cal:${title}:${date.toISOString()}`,
      // Der Kalendertitel wird selbst gebaut und ist damit in beiden Sprachen exakt.
      title: `${scored.eventEn} (${scored.region}): ` + zahlen.replace('{F}', 'forecast').replace('{P}', 'previous'),
      titleDe: `${scored.event} (${scored.region}): ` + zahlen.replace('{F}', 'Prognose').replace('{P}', 'zuvor'),
      source: 'Wirtschaftskalender',
      url: (it.match(/<link>([^]*?)<\/link>/i) || [])[1]?.trim() || '',
      date: date.toISOString(),
      tags: ['Daten', impact === 'high' ? 'Market Moving' : 'Makro'],
      impact,
      ...scored,
    });
  }
  return out;
}

/*
 * Werbe- und Verweistexte, die viele Feeds an die Zusammenfassung haengen.
 * Ohne diese Bereinigung bekaeme das Sprachmodell "Visit Benzinga to get more
 * great content" als Teil der Nachricht zu lesen.
 */
const ANHANGSEL = [
  // Ganze Verweisbloecke, nicht nur ihre Anfaenge: Sonst bleiben Reste wie
  // "Benzinga . like this." stehen und landen beim Sprachmodell als Inhalt.
  /The post\s[^]*?appeared first on[^.]*\.\s*/gi,
  /Visit\s+[A-Za-z ]{2,20}\s+to get more[^.]*\.\s*/gi,
  /(Read|Continue reading|Learn|Find out)\s+(more|the full story|here)[^.]*\.?\s*/gi,
  /Click here[^.]*\.?\s*/gi,
  /Subscribe to[^.]*\.?\s*/gi,
  /Sign up (for|to)[^.]*\.?\s*/gi,
  /This (article|story) (was|first|originally)[^.]*\.?\s*/gi,
  /\((Bloomberg|Reuters|AP|AFP)\)\s*(--|—)?\s*/gi,
  /(Photo|Image|Getty Images|REUTERS)[:/][^.]*\.?\s*/gi,
  /Follow us on[^.]*\.?\s*/gi,
  /Get an edge[^.]*\.?\s*/gi,
];

/** Holt die Zusammenfassung aus einem Eintrag und raeumt sie auf. */
function beschreibung(eintrag) {
  const roh = (eintrag.match(/<description>([^]*?)<\/description>/i) || [])[1]
    || (eintrag.match(/<content:encoded>([^]*?)<\/content:encoded>/i) || [])[1]
    // Atom nennt dasselbe summary oder content.
    || (eintrag.match(/<summary[^>]*>([^]*?)<\/summary>/i) || [])[1]
    || (eintrag.match(/<content[^>]*>([^]*?)<\/content>/i) || [])[1]
    || '';
  if (!roh) return '';

  let text = decode(roh)
    .replace(/<script[^>]*>[^]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');

  for (const muster of ANHANGSEL) text = text.replace(muster, ' ');

  text = text.replace(/\s+/g, ' ').trim();

  // Was nach der Bereinigung uebrig bleibt, muss noch ein Satz sein. Bei
  // manchen Quellen besteht die Zusammenfassung fast nur aus Eigenwerbung;
  // dann ist ein leeres Feld ehrlicher als ein Fragment.
  if (text.length < 40) return '';
  if (!/[a-z]{3,}\s+[a-z]{3,}\s+[a-z]{3,}/i.test(text)) return '';
  return text.slice(0, 500);
}

export async function loadFeed(feed, regime = 'policy') {
  const xml = await get(feed.url);
  const out = [];
  /*
   * Erst sortieren, dann kuerzen.
   *
   * Nicht jeder Feed liefert die neuesten Eintraege zuerst - Blockworks
   * beginnt mit Meldungen aus dem Januar. Wer stumpf die ersten dreissig
   * nimmt, bekommt dort ausschliesslich alte Ware und verpasst genau das,
   * wofuer die Quelle aufgenommen wurde.
   */
  const sortiert = items(xml)
    .map((it) => ({ it, t: new Date(zeitstempel(it) || 0).getTime() || 0 }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 30)
    .map((x) => x.it);

  for (const it of sortiert) {
    const title = tag(it, 'title');
    if (!title || isNoise(title)) continue;
    const date = new Date(zeitstempel(it) || Date.now());
    const scored = scoreHeadline(title, regime);
    const text = beschreibung(it);
    out.push({
      id: `${feed.source}:${title}`.slice(0, 200),
      title,
      // Die Zusammenfassung erklaert oft, was die Ueberschrift verschweigt -
      // das Sprachmodell liest sie mit, und aufgeklappt steht sie auch da.
      ...(text ? { text } : {}),
      source: feed.source,
      url: verweis(it),
      date: (isNaN(date) ? new Date() : date).toISOString(),
      tags: feed.tags,
      impact: 'low',
      ...(scored || {
        kind: 'headline',
        scores: { crypto: 0, stocks: 0, gold: 0, usd: 0 },
        signals: [],
        why: 'Keine eindeutigen Richtungssignale in der Schlagzeile — Einordnung neutral.',
      }),
    });
  }
  return out;
}

/** Ergänzt Kategorie, Relevanz und Sentiment-Label. */
export function enrich(list) {
  return list.map((n) => {
    const category = categorize(n);
    const mitRang = {
      ...n,
      category,
      categoryLabel: CATEGORY_LABEL[category],
      priority: priority(n, category),
      label: label(n.scores.crypto),
      labelText: LABEL_TEXT[label(n.scores.crypto)],
    };
    const fertig = { ...mitRang, ...tradeImpact(mitRang) };

    /*
     * Was als Rauschen eingestuft ist, bekommt keine Handelsrichtung.
     *
     * Eine Kursprognose zu einem Währungspaar stand sonst mit "IGNORIEREN" und
     * "BULLISH" zugleich da - das eine sagt, die Meldung sei bedeutungslos, das
     * andere legt einen Trade nahe. Für den Leser bleibt nur Verwirrung.
     */
    if (fertig.impactLevel === 'ignore') {
      const neutral = Object.fromEntries(Object.keys(fertig.scores).map((k) => [k, 0]));
      return { ...fertig, scores: neutral, label: 'neutral', labelText: LABEL_TEXT.neutral };
    }
    return fertig;
  });
}

/**
 * Holt alle Quellen, bewertet, entdoppelt und sortiert.
 * `onlyFast` beschränkt auf die schnellen Quellen — dafür im Live-Betrieb.
 */
/*
 * Wie weit der Bestand zurueckreicht.
 *
 * Was aelter als einen Tag ist, taugt nicht mehr zum Handeln - es verwaessert
 * nur die Uebersicht und blaeht die Uebertragung auf. Die Zahl der Meldungen
 * bleibt als Obergrenze bestehen, greift aber in der Regel nicht mehr.
 */
export const FENSTER_MS = 24 * 3600 * 1000;

/** Verwirft, was aus dem Zeitfenster gefallen ist. */
export function imFenster(items, jetzt = Date.now()) {
  return items.filter((n) => jetzt - new Date(n.date).getTime() < FENSTER_MS);
}

export async function collectNews({
  regime = 'policy', onlyFast = false, limit = 300, translate = null,
  gruppe = null, gruppen = 1,
} = {}) {
  let feeds = onlyFast ? FEEDS.filter((f) => f.fast) : FEEDS;

  // Auf dem Cloudflare-Gratisplan stehen pro Aufruf nur 10 ms Rechenzeit zur
  // Verfügung; alle Feeds zusammen brauchen rund das Doppelte. Deshalb lässt
  // sich die Arbeit auf mehrere Läufe verteilen: jeder Lauf nimmt eine Gruppe,
  // der Wirtschaftskalender kommt immer mit, weil er zeitkritisch ist.
  if (gruppe !== null && gruppen > 1) {
    /*
     * `fast` heisst: bei jedem Durchgang, nicht nur wenn die Gruppe dran ist.
     *
     * Die Rotation kostet bis zu drei Minuten, und die fallen genau dort an,
     * wo es weh tut. Eine ETF-Meldung von Cointelegraph erreichte die
     * Benachrichtigung sechzehn Minuten nach Erscheinen; ein Teil davon war
     * diese Wartezeit auf die eigene Gruppe. Notenbank und die grossen
     * Krypto-Redaktionen laufen deshalb immer mit - dort entscheidet sich, ob
     * ein Scalp noch etwas bringt. Weltlage und Marktkommentar rotieren
     * weiter; die halbe Stunde Unterschied macht dort niemanden aermer.
     */
    feeds = feeds.filter((f, i) => i % gruppen === gruppe || f.fast);
  }
  const results = await Promise.allSettled([
    loadCalendar(regime),
    ...feeds.map((f) => loadFeed(f, regime)),
  ]);

  const errors = [];
  let all = [];
  results.forEach((r, i) => {
    const name = i === 0 ? 'Wirtschaftskalender' : feeds[i - 1].source;
    if (r.status === 'fulfilled') all.push(...r.value);
    else errors.push(`${name}: ${r.reason.message}`);
  });

  const seen = new Set();
  all = enrich(all.filter((n) => (seen.has(n.id) ? false : seen.add(n.id))));

  all = imFenster(dedupe(all))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, limit);

  // Deutsche Titel ergänzen. Fehlschläge sind unkritisch: dann bleibt der
  // englische Titel stehen, die Bewertung arbeitet ohnehin auf dem Original.
  let uebersetzung = null;
  if (translate) {
    const r = await translateTitles(all, translate.cache || {}, translate);
    uebersetzung = { uebersetzt: r.uebersetzt, fehler: r.fehler };
    if (r.fehler) errors.push(`Übersetzung: ${r.fehler}`);
  }

  return {
    updated: new Date().toISOString(),
    regime, count: all.length, errors, items: all, uebersetzung,
  };
}
