import { writeFileSync, mkdirSync } from 'node:fs';
import { scoreMacroEvent, scoreHeadline, label, LABEL_TEXT } from '../src/sentiment.mjs';

const REGIME = process.env.REGIME || 'policy';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; NewsPortal/1.0)' };

const FEEDS = [
  { url: 'https://www.fxstreet.com/rss/news',                 source: 'FXStreet',      tags: ['Makro', 'Forex'] },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',   source: 'CoinDesk',      tags: ['Krypto'] },
  { url: 'https://cointelegraph.com/rss',                     source: 'Cointelegraph', tags: ['Krypto'] },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC',      tags: ['Märkte'] },
  { url: 'https://feeds.marketwatch.com/marketwatch/topstories/', source: 'MarketWatch', tags: ['Märkte'] },
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml', source: 'Federal Reserve', tags: ['Fed'] },
];
const CALENDAR = 'https://www.myfxbook.com/rss/forex-economic-calendar-events';

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const tag = (item, name) => {
  const m = item.match(new RegExp('<' + name + '[^>]*>([^]*?)</' + name + '>', 'i'));
  return m ? decode(m[1]).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
};

async function get(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

const items = (xml) => [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);

/** Wirtschaftskalender: liefert Actual/Consensus/Previous je Event. */
async function loadCalendar() {
  const xml = await get(CALENDAR);
  const out = [];
  for (const it of items(xml)) {
    const title = tag(it, 'title');
    const desc = decode((it.match(/<description>([\s\S]*?)<\/description>/i) || [])[1] || '');
    const impact = (desc.match(/sprite-(high|medium|low)-impact/) || [])[1] || 'low';
    const cells = [...desc.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
    const [, , previous, consensus, actual] = cells;
    if (!actual) continue;                       // noch nicht veröffentlicht
    const date = new Date(tag(it, 'pubDate'));
    if (isNaN(date)) continue;

    const scored = scoreMacroEvent({ title, actual, consensus, previous, impact }, REGIME);
    if (!scored) continue;
    out.push({
      id: `cal:${title}:${date.toISOString()}`,
      title: `${title}: ${actual} (Prognose ${consensus || '—'}, zuvor ${previous || '—'})`,
      source: 'Wirtschaftskalender',
      url: (it.match(/<link>([\s\S]*?)<\/link>/i) || [])[1]?.trim() || '',
      date: date.toISOString(),
      tags: ['Daten', impact === 'high' ? 'Market Moving' : 'Makro'],
      impact,
      ...scored,
    });
  }
  return out;
}

async function loadFeed(feed) {
  const xml = await get(feed.url);
  const out = [];
  for (const it of items(xml).slice(0, 30)) {
    const title = tag(it, 'title');
    if (!title) continue;
    const date = new Date(tag(it, 'pubDate') || tag(it, 'dc:date') || Date.now());
    const scored = scoreHeadline(title, REGIME);
    out.push({
      id: `${feed.source}:${title}`.slice(0, 200),
      title,
      source: feed.source,
      url: tag(it, 'link'),
      date: (isNaN(date) ? new Date() : date).toISOString(),
      tags: feed.tags,
      impact: 'low',
      ...(scored || { kind: 'headline', scores: { crypto: 0, stocks: 0, gold: 0, usd: 0 }, signals: [], why: 'Keine eindeutigen Richtungssignale in der Schlagzeile — Einordnung neutral.' }),
    });
  }
  return out;
}

const results = await Promise.allSettled([loadCalendar(), ...FEEDS.map(loadFeed)]);
const errors = [];
let all = [];
results.forEach((r, i) => {
  const name = i === 0 ? 'Wirtschaftskalender' : FEEDS[i - 1].source;
  if (r.status === 'fulfilled') all.push(...r.value);
  else errors.push(`${name}: ${r.reason.message}`);
});

// Duplikate entfernen, neueste zuerst, auf 250 begrenzen
const seen = new Set();
all = all
  .filter((n) => (seen.has(n.id) ? false : seen.add(n.id)))
  .sort((a, b) => new Date(b.date) - new Date(a.date))
  .slice(0, 250)
  .map((n) => ({ ...n, label: label(n.scores.crypto), labelText: LABEL_TEXT[label(n.scores.crypto)] }));

mkdirSync('docs/data', { recursive: true });
writeFileSync('docs/data/news.json', JSON.stringify({
  updated: new Date().toISOString(),
  regime: REGIME,
  count: all.length,
  errors,
  items: all,
}, null, 1));

console.log(`${all.length} Meldungen geschrieben.`);
if (errors.length) console.log('Fehlerhafte Quellen:', errors.join(' | '));
const strong = all.filter((n) => n.label.startsWith('strong'));
console.log(`Davon stark gewertet: ${strong.length}`);
strong.slice(0, 5).forEach((n) => console.log(`  [${n.labelText}] ${n.title.slice(0, 90)}`));
