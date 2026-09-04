// Ordnet jede Meldung einer Kategorie zu, wirft Rauschen weg und vergibt eine
// Relevanz von 0-100. Der Fokus liegt auf US-Wirtschaftsdaten und
// weltwirtschaftlich brisanten Ereignissen; Ratgeber- und Lifestyle-Artikel
// der großen Portale gehören nicht in einen Handels-Newsfeed.

const NOISE = [
  /\b(how (to|i)|should i|why i|what i|i'?m \d{2}|my (husband|wife|son|daughter|mom|dad|boss))\b/i,
  /\b(dear (quentin|tax)|retirement plan|social security|401\(?k\)?|credit card|student loan)\b/i,
  /\b(best (deals?|gifts?|laptops?|phones?)|holiday shopping|black friday|cyber monday)\b/i,
  /\b(recipe|celebrity|royal family|box office|super bowl|world cup|olympics|oscars?)\b/i,
  /\b(horoscope|weather forecast|travel guide|things to do)\b/i,
  /\bis the (stock market|bond market) (open|closed)\b/i,
  /\b(obituary|died at \d+|wedding|divorce)\b/i,
];

export function isNoise(title) {
  return NOISE.some((re) => re.test(title));
}

// --- Kategorien -----------------------------------------------------------
const GEO = /\b(iran|israel|gaza|hezbollah|houthi|russia|ukraine|china|taiwan|north korea|nato|opec|strait of hormuz|red sea|sanction|tariff|trade war|missile|airstrike|invasion|ceasefire|war|military|nuclear|escalat\w+|troops|conflict)\b/i;
const FED = /\b(fed|fomc|powell|federal reserve|rate (cut|hike|decision)|monetary policy|treasury yields?)\b/i;
const CRYPTO = /\b(bitcoin|btc|ethereum|eth|crypto|solana|xrp|stablecoin|defi|altcoin|binance|coinbase|blockchain|token)\b/i;
const US = /\b(u\.?s\.?a?|united states|american|fed)\b/i;

export function categorize(item) {
  if (item.kind === 'macro') {
    return item.region === 'USA' ? 'us-data' : 'global-data';
  }
  const t = item.title;
  if (GEO.test(t)) return 'geopolitics';
  if (FED.test(t)) return 'fed';
  if (CRYPTO.test(t)) return 'crypto';
  if (US.test(t)) return 'us-markets';
  return 'markets';
}

export const CATEGORY_LABEL = {
  'us-data': 'US-Daten',
  'global-data': 'Weltdaten',
  'geopolitics': 'Geopolitik',
  'fed': 'Notenbank',
  'crypto': 'Krypto',
  'us-markets': 'US-Märkte',
  'markets': 'Märkte',
};

// --- Relevanz -------------------------------------------------------------
// Eskalationsbegriffe, die eine geopolitische Meldung hochbrisant machen.
const HOT = /\b(strike|attack|missile|invasion|nuclear|retaliat\w+|killed|emergency|shutdown|default|collapse|breaking|halts?|suspend\w*|blockade)\b/i;

const BASE = {
  'us-data': 78, 'fed': 72, 'geopolitics': 62, 'crypto': 52,
  'us-markets': 45, 'global-data': 35, 'markets': 32,
};

/** 0-100. Bestimmt die Sortierung: US-Daten und brisante Weltlage zuerst. */
export function priority(item, category) {
  let p = BASE[category] ?? 30;

  if (category === 'us-data' && item.impact === 'high') p += 18;
  if (category === 'us-data' && item.impact === 'low') p -= 12;
  if (category === 'geopolitics' && HOT.test(item.title)) p += 22;
  if (HOT.test(item.title)) p += 4;

  // Eine klare Richtung ist wertvoller als eine neutrale Meldung.
  p += Math.abs(item.scores?.crypto ?? 0) * 16;

  // Frische zählt: nach 12 Stunden verliert eine Meldung deutlich an Gewicht.
  const stunden = (Date.now() - new Date(item.date)) / 3.6e6;
  p -= Math.min(stunden * 1.6, 26);

  return Math.max(0, Math.min(100, Math.round(p)));
}
