import { matchEvent } from './events.mjs';
import { KEYWORDS, GEOPOLITICS, DEESKALATION, DEESKALATION_GESCHEITERT } from './keywords.mjs';
import { extractNumbers } from './numeric.mjs';
import { countryRelevance, centralBankWeight, emergingMarketDamping } from './relevance.mjs';

// Wörter, die eine Erwartung daempfen statt bestaetigen: "Bailey tames rate
// hike hopes" ist dovish, obwohl "rate hike" darin vorkommt.
const NEGATORS = /\b(no|not|nicht|kein|denies|denied|rules out|unlikely|won't|without|tames?|dampens?|cools?|plays? down|downplays?|pushes? back on|dismisses?|pares?|trims?|scales? back|doubts?|fades?)\s*$/;

/*
 * Krypto-Signalwörter gelten nur für Meldungen, die auch von Krypto handeln.
 *
 * Ohne diese Prüfung schlug jedes "hack", "indicted" oder "crackdown" voll
 * durch: Ein Strafverfahren gegen einen Influencer, ein gehacktes deutsches
 * Webportal und eine Altersprüfung für VPNs in Utah galten allesamt als stark
 * bearish für Bitcoin. Das Stichwort allein sagt nichts - erst der Gegenstand
 * der Meldung macht es zum Signal.
 */
const KRYPTO_BEZUG = /\b(bitcoin|btc|ethereum|eth\b|ether|crypto\w*|coin\b|coins\b|altcoin|memecoin|token\w*|blockchain|defi|dao\b|wallet|stablecoin|usdt|usdc|tether|binance|coinbase|kraken|okx|bybit|bitfinex|solana|\bsol\b|\bxrp\b|ripple|cardano|dogecoin|litecoin|miner\w*|mining|hashrate|satoshi|ledger|trezor|metamask|onchain|on-chain|halving|etf)\b/i;

const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));

// "162.0K" -> 162 | "1.2M" -> 1200 | "4.1%" -> 4.1 | "-23K" -> -23
export function parseNumber(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/,/g, '').trim();
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KMB%])?/i);
  if (!m) return null;
  let v = parseFloat(m[1]);
  const unit = (m[2] || '').toUpperCase();
  if (unit === 'M') v *= 1000;      // auf K normalisieren
  else if (unit === 'B') v *= 1e6;
  return v;
}

/**
 * Übersetzt eine Datenüberraschung in einen geldpolitischen Impuls.
 * Ergebnis > 0 = hawkisch (Fed restriktiver), < 0 = dovish (Fed lockerer).
 */
function hawkishImpulse(ev, actual, consensus) {
  const surprise = actual - consensus;
  if (!ev.scale) return 0;
  const z = (surprise / ev.scale) * ev.polarity;

  // Die Fed reagiert schärfer auf Inflation als auf Wachstum.
  const channelGain = { inflation: 1.15, growth: 0.9, policy: 1.3, none: 0 }[ev.channel] ?? 0;

  return clamp(z * channelGain * 0.42) * ev.weight;
}

/**
 * Verteilt den geldpolitischen Impuls auf die Anlageklassen.
 *
 * regime 'policy' (Standard): Der Zinskanal dominiert. Starke Daten bedeuten
 *   höhere Zinsen für längere Zeit -> weniger Liquidität -> Risk-Assets fallen.
 *   Das ist der Fall, den viele falsch lesen: gute Wirtschaftsdaten sind für
 *   Krypto schlecht.
 * regime 'growth': Der Wachstumskanal dominiert (z. B. bei Rezessionsangst).
 *   Dann sind starke Daten für Risk-Assets gut.
 */
function assetScores(hawkish, regime = 'policy') {
  const sign = regime === 'growth' ? -1 : 1;
  const h = hawkish * sign;
  return {
    crypto: clamp(-h),
    stocks: clamp(-h * 0.85),
    gold:   clamp(-h * 0.8),
    usd:    clamp(h),
  };
}

export function label(score) {
  if (score >= 0.55) return 'strong_bullish';
  if (score >= 0.16) return 'bullish';
  if (score <= -0.55) return 'strong_bearish';
  if (score <= -0.16) return 'bearish';
  return 'neutral';
}

export const LABEL_TEXT = {
  strong_bullish: 'Stark Bullish',
  bullish: 'Bullish',
  neutral: 'Neutral',
  bearish: 'Bearish',
  strong_bearish: 'Stark Bearish',
};

const fmt = (n) => (Number.isInteger(n) ? n : n.toFixed(1));

/** Bewertet ein Kalender-Event mit Actual/Consensus. */
export function scoreMacroEvent({ title, actual, consensus, previous, impact }, regime = 'policy', loose = false) {
  const ev = matchEvent(title);
  const a = parseNumber(actual);
  const c = parseNumber(consensus);
  if (!ev || a == null || c == null || ev.channel === 'none') return null;

  // Nur Daten, die die Zinserwartung an eine relevante Notenbank verschieben.
  const rel = countryRelevance(title, loose);
  if (!rel) return null;

  const hawkish = hawkishImpulse(ev, a, c) * rel.weight;
  const scores = assetScores(hawkish, regime);
  const beat = a - c;

  // Begründungskette, damit die Einordnung nachvollziehbar ist — zweisprachig,
  // weil die App zwischen Deutsch und Englisch umschalten kann.
  const richtung = beat > 0 ? 'über' : beat < 0 ? 'unter' : 'exakt auf';
  const staerke = ev.polarity > 0
    ? (beat > 0 ? 'stärker' : 'schwächer')
    : (beat > 0 ? 'schwächer' : 'stärker');
  const themaTxt = ev.channel === 'inflation' ? 'Inflationsdruck' : 'Konjunktur';
  const hawkTxt = hawkish > 0
    ? 'Die Fed bekommt damit Argumente für straffere Geldpolitik'
    : 'Die Fed bekommt damit Spielraum für lockerere Geldpolitik';
  const folge = hawkish > 0
    ? 'Höhere Zinserwartungen entziehen dem Markt Liquidität — das belastet Krypto und Aktien und stützt den Dollar.'
    : 'Sinkende Zinserwartungen bedeuten mehr Liquidität — das stützt Krypto und Aktien und schwächt den Dollar.';

  const why = [
    `${ev.name} (${rel.region}): ${fmt(a)} gegenüber ${fmt(c)} erwartet — ${richtung} Prognose.`,
    `${themaTxt} fällt damit ${staerke} aus als eingepreist.`,
    `${hawkTxt}. ${folge}`,
  ].join(' ');

  const dirEn = beat > 0 ? 'above' : beat < 0 ? 'below' : 'exactly at';
  const strEn = ev.polarity > 0
    ? (beat > 0 ? 'stronger' : 'weaker')
    : (beat > 0 ? 'weaker' : 'stronger');
  const topicEn = ev.channel === 'inflation' ? 'Inflation pressure' : 'Economic activity';
  const whyEn = [
    `${ev.nameEn || ev.name} (${rel.region}): ${fmt(a)} versus ${fmt(c)} expected — ${dirEn} forecast.`,
    `${topicEn} therefore comes in ${strEn} than priced in.`,
    hawkish > 0
      ? 'That hands the Fed arguments for tighter policy. Higher rate expectations drain liquidity — a drag on crypto and equities, a tailwind for the dollar.'
      : 'That gives the Fed room to ease. Falling rate expectations mean more liquidity — supportive for crypto and equities, negative for the dollar.',
  ].join(' ');

  return {
    kind: 'macro',
    event: ev.name,
    eventEn: ev.nameEn || ev.name,
    region: rel.region,
    channel: ev.channel,
    actual, consensus, previous, impact,
    surprise: beat,
    hawkish: +hawkish.toFixed(3),
    scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, +v.toFixed(3)])),
    why,
    whyEn,
  };
}


// --- Verbale Datenüberraschungen ---------------------------------------
// Viele Schlagzeilen nennen keine Zahlenfelder, sondern beschreiben die
// Überraschung in Worten: "payrolls rose 162,000, much more than expected".
// Ohne diese Erkennung bliebe genau die wichtigste Meldung des Tages neutral.

const SURPRISE_UP = /\b(more|higher|better|stronger|faster|hotter|above|bigger)\b[^.]{0,18}\bthan (expected|forecast|estimates?|consensus)\b|\b(beats?|beat|tops?|topped|exceeds?|exceeded|smashed)\b[^.]{0,18}\b(expectations?|forecasts?|estimates?|consensus)\b/;
const SURPRISE_DOWN = /\b(less|lower|weaker|worse|slower|cooler|below|smaller|fewer)\b[^.]{0,18}\bthan (expected|forecast|estimates?|consensus)\b|\b(miss(es|ed)?|disappoints?|disappointed|fell short)\b[^.]{0,18}\b(expectations?|forecasts?|estimates?|consensus)?/;

// Worum ging es? polarity: +1 = höher bedeutet stärkere Wirtschaft/heißere Inflation
const SURPRISE_TOPIC = [
  { re: /\b(cpi|inflation|price index|ppi|pce|prices)\b/, polarity: 1, channel: 'inflation', label: 'Inflationsdaten', labelEn: 'inflation data' },
  { re: /\b(wages?|hourly earnings|average earnings|labou?r costs)\b/, polarity: 1, channel: 'inflation', label: 'Lohndaten', labelEn: 'wage data' },
  { re: /\b(unemployment rate|jobless claims|claims)\b/, polarity: -1, channel: 'growth', label: 'Arbeitslosendaten', labelEn: 'jobless data' },
  { re: /\b(payrolls?|nfp|jobs?|employment|hiring)\b/, polarity: 1, channel: 'growth', label: 'Arbeitsmarktdaten', labelEn: 'labour market data' },
  { re: /\b(gdp|growth|retail sales|ism|pmi|orders|production|confidence|sentiment)\b/, polarity: 1, channel: 'growth', label: 'Konjunkturdaten', labelEn: 'activity data' },
];

// Richtung des Verbs. "Inflation kuehlt staerker als erwartet" ist dovish,
// obwohl "mehr als erwartet" darin steht - das Verb dreht die Bedeutung.
const VERB_DOWN = /\b(cools?|cooled|eas(e|es|ed|ing)|falls?|fell|drops?|dropped|slows?|slowed|declines?|declined|shrank|shrinks?|contracts?|tumbles?|sinks?|weakens?)\b/;
const VERB_UP   = /\b(ros?e|rise[sn]?|jumps?|jumped|climbs?|climbed|surges?|surged|accelerat\w+|increas\w+|grew|grows?|gains?|gained|picks? up|heats? up)\b/;

// Quartalszahlen einzelner Unternehmen sind keine Konjunkturdaten. "Zscaler
// beats earnings expectations" darf nicht als Lohninflation gelesen werden.
const UNTERNEHMEN = /\b(stock|shares|guidance|quarterly|revenue|eps|profit|earnings (call|report|per share)|q[1-4]\b|fiscal|outlook)\b/;

/** Erkennt "besser/schlechter als erwartet" und leitet den Zinsimpuls ab. */
export function verbalSurprise(title) {
  const t = title.toLowerCase();
  if (UNTERNEHMEN.test(t)) return null;

  const up = SURPRISE_UP.test(t);
  const down = up ? false : SURPRISE_DOWN.test(t);
  if (!up && !down) return null;

  // Das Thema ist das zuerst genannte - es ist das Subjekt des Satzes.
  // "payrolls rose ...; unemployment rate at 4.1%" handelt von den Payrolls.
  let topic = null, best = Infinity;
  for (const cand of SURPRISE_TOPIC) {
    const i = t.search(cand.re);
    if (i >= 0 && i < best) { best = i; topic = cand; }
  }
  if (!topic) return null;

  // Bewegt sich die Groesse nach oben oder unten?
  const verbDir = VERB_DOWN.test(t) ? -1 : VERB_UP.test(t) ? 1 : 1;
  // "mehr als erwartet" verstaerkt die Bewegung, "weniger als erwartet" daempft sie.
  const surpriseDir = up ? verbDir : -verbDir;

  // "much more than expected" wiegt schwerer als ein blosses "misses forecasts".
  const emphasis = /\b(much|far|well|sharply|significantly|blowout|massively|way)\b/.test(t) ? 1 : 0.62;

  const gain = (topic.channel === 'inflation' ? 0.72 : 0.62) * emphasis;
  return {
    hawkish: clamp(surpriseDir * topic.polarity * gain),
    label: topic.label,
    labelEn: topic.labelEn || topic.label,
    strongerWord: surpriseDir > 0 ? 'höher' : 'niedriger',
    strongerWordEn: surpriseDir > 0 ? 'higher' : 'lower',
  };
}

/** Bewertet eine reine Text-Schlagzeile über gewichtete Signalwörter. */
export function scoreHeadline(title, regime = 'policy') {
  // Nennt die Schlagzeile konkrete Zahlen, wird exakt statt heuristisch bewertet.
  const nums = extractNumbers(title);
  if (nums) {
    const exact = scoreMacroEvent({ title, ...nums, impact: 'high' }, regime, true);
    if (exact) return { ...exact, kind: 'headline_numeric' };
  }

  const t = ' ' + title.toLowerCase().replace(/[^a-z0-9äöüß%$. -]/g, ' ') + ' ';
  let macroHawk = 0, cryptoDirect = 0, risk = 0;
  const hits = [];
  const hitsEn = [];

  const kryptoThema = KRYPTO_BEZUG.test(title);

  for (const k of KEYWORDS) {
    if (!k.re.test(t)) continue;
    // Krypto-eigene Signale zählen nur bei krypto-eigenen Meldungen.
    if (k.type === 'crypto' && !kryptoThema) continue;
    // Verneinung direkt vor dem Treffer dreht das Vorzeichen.
    const idx = t.search(k.re);
    const before = t.slice(Math.max(0, idx - 22), idx);
    const neg = NEGATORS.test(before) ? -1 : 1;
    const w = k.weight * neg;
    if (k.type === 'hawkish') macroHawk += w;
    else if (k.type === 'crypto') cryptoDirect += w;
    else if (k.type === 'risk') risk += w;
    hits.push((neg < 0 ? 'nicht ' : '') + k.label);
    hitsEn.push((neg < 0 ? 'not ' : '') + (k.labelEn || k.label));
  }

  // Geht es um das Ende eines Konflikts statt um dessen Ausbruch, dreht sich
  // die Wirkung: Der Markt liest Friedensbemühungen als Entspannung.
  const friedlich = DEESKALATION.test(title) && !DEESKALATION_GESCHEITERT.test(title);

  let geoTreffer = false;
  for (const g of GEOPOLITICS) if (g.re.test(t)) {
    geoTreffer = true;
    if (friedlich) {
      risk += g.weight * 0.7;   // Entspannung wirkt schwächer als eine Eskalation
      hits.push('Deeskalation');
      hitsEn.push('de-escalation');
    } else {
      risk -= g.weight;
      hits.push(g.label);
      hitsEn.push(g.labelEn || g.label);
    }
  }

  const vs = verbalSurprise(title);
  if (vs) {
    macroHawk += vs.hawkish * 1.4;
    hits.push(`${vs.label} ${vs.strongerWord} als erwartet`);
    hitsEn.push(`${vs.labelEn} ${vs.strongerWordEn} than expected`);
  }

  if (!hits.length) return null;

  // Eine Aussage der Fed bewegt Krypto, eine der RBNZ kaum.
  const cb = centralBankWeight(title);
  const emDaempfung = emergingMarketDamping(title);
  const hawkish = clamp(macroHawk) * (cb === null ? emDaempfung : cb);
  const base = assetScores(hawkish, regime);

  // Die Daempfung gilt auch fuer Risikosignale. "USD/MXN: Peso rally" galt
  // sonst als Kursanstieg und damit als bullish fuer Krypto, obwohl ein
  // mexikanisches Waehrungspaar dafuer ohne Belang ist. Geopolitik bleibt
  // ausgenommen: Ein Krieg wirkt weltweit, gleich wo er stattfindet.
  const riskOn = clamp(risk * (geoTreffer ? 1 : emDaempfung));

  const scores = {
    crypto: clamp(base.crypto + riskOn * 0.9 + clamp(cryptoDirect)),
    stocks: clamp(base.stocks + riskOn * 0.9),
    gold:   clamp(base.gold - riskOn * 0.45),   // Gold profitiert von Risk-off
    usd:    clamp(base.usd - riskOn * 0.3),
  };

  const parts = [];
  if (macroHawk) parts.push(macroHawk > 0
    ? 'Signalwörter deuten auf straffere Geldpolitik — negativ für Risk-Assets.'
    : 'Signalwörter deuten auf lockerere Geldpolitik — positiv für Risk-Assets.');
  if (risk) parts.push(risk < 0
    ? 'Risikoaversion im Markt: Kapital fließt aus Krypto und Aktien in sichere Häfen.'
    : 'Risikofreude im Markt: Kapital fließt in Krypto und Aktien.');
  if (cryptoDirect) parts.push(cryptoDirect > 0
    ? 'Direkt kryptopositive Nachricht.'
    : 'Direkt kryptonegative Nachricht.');

  const partsEn = [];
  if (macroHawk) partsEn.push(macroHawk > 0
    ? 'Signal words point to tighter policy — negative for risk assets.'
    : 'Signal words point to easier policy — positive for risk assets.');
  if (risk) partsEn.push(risk < 0
    ? 'Risk-off tone: capital rotates out of crypto and equities into safe havens.'
    : 'Risk-on tone: capital rotates into crypto and equities.');
  if (cryptoDirect) partsEn.push(cryptoDirect > 0
    ? 'Directly crypto-positive news.'
    : 'Directly crypto-negative news.');

  const signale = [...new Set(hits)].slice(0, 4).join(', ');
  const signalsEn = [...new Set(hitsEn)].slice(0, 4).join(', ');

  return {
    kind: 'headline',
    hawkish: +hawkish.toFixed(3),
    signals: [...new Set(hits)].slice(0, 6),
    scores: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, +v.toFixed(3)])),
    why: parts.join(' ') + ` (Signale: ${signale})`,
    whyEn: partsEn.join(' ') + ` (signals: ${signalsEn})`,
  };
}
