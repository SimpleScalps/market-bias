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
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml',     source: 'Federal Reserve', tags: ['Fed'] },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html',  source: 'CNBC',            tags: ['Märkte'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/',  source: 'MarketWatch',     tags: ['Märkte'] },
  // Krypto (dieselben offenen Quellen, die auch CryptoPanic aggregiert)
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',        source: 'CoinDesk',        tags: ['Krypto'], fast: true },
  { url: 'https://cointelegraph.com/rss',                          source: 'Cointelegraph',   tags: ['Krypto'] },
  { url: 'https://decrypt.co/feed',                                source: 'Decrypt',         tags: ['Krypto'] },
  { url: 'https://www.theblock.co/rss.xml',                        source: 'The Block',       tags: ['Krypto'] },
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

export const items = (xml) => [...xml.matchAll(/<item>([^]*?)<\/item>/gi)].map((m) => m[1]);

async function get(url, timeoutMs = 12000) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(timeoutMs) });
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

export async function loadFeed(feed, regime = 'policy') {
  const xml = await get(feed.url);
  const out = [];
  for (const it of items(xml).slice(0, 30)) {
    const title = tag(it, 'title');
    if (!title || isNoise(title)) continue;
    const date = new Date(tag(it, 'pubDate') || tag(it, 'dc:date') || Date.now());
    const scored = scoreHeadline(title, regime);
    out.push({
      id: `${feed.source}:${title}`.slice(0, 200),
      title,
      source: feed.source,
      url: tag(it, 'link'),
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
    return { ...mitRang, ...tradeImpact(mitRang) };
  });
}

/**
 * Holt alle Quellen, bewertet, entdoppelt und sortiert.
 * `onlyFast` beschränkt auf die schnellen Quellen — dafür im Live-Betrieb.
 */
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

  all = dedupe(all)
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
