import { matchCryptoEvent, coinsIn } from './cryptoevents.mjs';

// Zwei Angaben, die beim Handeln zählen und die eine reine Bullish/Bearish-
// Einordnung nicht liefert:
//
//   Trading Impact   — wie stark bewegt die Meldung überhaupt?
//   Expected Duration — wie lange wirkt sie nach?
//
// Eine Whale-Bewegung ist ein Scalp-Signal: kurz, aber sofort. Eine
// ETF-Zulassung wirkt Wochen. Beides kann "bullish" sein und verlangt doch
// völlig verschiedene Trades.

export const IMPACT_STUFEN = ['ignore', 'low', 'medium', 'high', 'extreme'];

export const IMPACT_TEXT = {
  de: { ignore: 'IGNORIEREN', low: 'GERING', medium: 'MITTEL', high: 'HOCH', extreme: 'EXTREM' },
  en: { ignore: 'IGNORE', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', extreme: 'EXTREME' },
};

export const DURATION_TEXT = {
  de: { scalp: 'SCALP < 1 STD', intraday: 'INTRADAY 1–24 STD', swing: 'SWING 1–7 TAGE', long: 'LANGFRISTIG > 7 TAGE' },
  en: { scalp: 'SCALP < 1H', intraday: 'INTRADAY 1–24H', swing: 'SWING 1–7 DAYS', long: 'LONG-TERM > 7 DAYS' },
};

// Wirtschaftsdaten wirken unterschiedlich lange nach.
const MAKRO_DAUER = [
  { re: /zinsentscheid|interest rate decision|fomc/i, duration: 'swing' },
  { re: /cpi|inflation|pce|ppi/i, duration: 'intraday' },
  { re: /payroll|unemployment|jobless|arbeitslos|beschäftigung/i, duration: 'intraday' },
  { re: /gdp|bip/i, duration: 'swing' },
];

// Begriffe, die eine geopolitische Meldung zum Marktereignis machen.
const GEO_HEISS = /\b(strike|attack|missile|invasion|nuclear|retaliat\w+|killed|blockade|emergency|war breaks out)\b/i;

/**
 * Bestimmt Handelswirkung und erwartete Wirkungsdauer einer Meldung.
 * Erwartet den bereits bewerteten Eintrag (scores, category, impact, priority).
 */
export function tradeImpact(item) {
  const titel = item.title || '';
  const staerke = Math.abs(item.scores?.crypto ?? 0);
  const krypto = matchCryptoEvent(titel);

  let stufe = 1;          // Index in IMPACT_STUFEN
  let duration = 'scalp';
  let typ = null, typEn = null, scope = 'market';

  if (item.kind === 'macro' || item.kind === 'headline_numeric') {
    // Wirtschaftsdaten: die Überraschung entscheidet.
    stufe = staerke >= 0.75 ? 4 : staerke >= 0.45 ? 3 : staerke >= 0.2 ? 2 : 1;
    if (item.impact === 'low' && stufe > 2) stufe = 2;
    duration = MAKRO_DAUER.find((m) => m.re.test(item.event || titel))?.duration || 'intraday';
    typ = item.event || 'Wirtschaftsdaten';
    typEn = item.event || 'Economic data';
  } else if (krypto) {
    // Krypto-Ereignis mit eigener Grundwirkung.
    stufe = krypto.base;
    duration = krypto.duration;
    typ = krypto.typ;
    typEn = krypto.typEn;
    scope = krypto.scope;
    // Ein starkes Sentiment hebt die Stufe, ein fehlendes senkt sie.
    if (staerke >= 0.6 && stufe < 4) stufe += 1;
    else if (staerke < 0.15 && stufe > 0) stufe -= 1;
  } else if (item.category === 'geopolitics') {
    const heiss = GEO_HEISS.test(titel);
    stufe = heiss ? 3 : staerke >= 0.4 ? 2 : 1;
    duration = heiss ? 'swing' : 'intraday';
    typ = 'Geopolitik';
    typEn = 'Geopolitics';
  } else if (item.category === 'fed') {
    stufe = staerke >= 0.5 ? 3 : 2;
    duration = 'swing';
    typ = 'Notenbank';
    typEn = 'Central bank';
  } else {
    // Restliche Marktmeldungen: allein das Sentiment trägt.
    stufe = staerke >= 0.6 ? 2 : staerke >= 0.25 ? 1 : 0;
    duration = staerke >= 0.5 ? 'intraday' : 'scalp';
  }

  // Eine sehr unwichtige Quelle kann kein Extremereignis melden.
  if ((item.priority ?? 0) < 35 && stufe > 2) stufe = 2;

  return {
    impactLevel: IMPACT_STUFEN[Math.max(0, Math.min(4, stufe))],
    duration,
    eventType: typ,
    eventTypeEn: typEn,
    scope,
    coins: coinsIn(titel),
  };
}
