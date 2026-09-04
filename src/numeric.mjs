import { matchEvent } from './events.mjs';

// Viele Redaktionen schreiben die Überraschung direkt in die Schlagzeile:
//   "US Nonfarm Payrolls rise by 162K in August vs. 56K forecast"
//   "CPI 3.8% vs 3.2% expected"
// Solche Meldungen lassen sich mit derselben Genauigkeit bewerten wie ein
// Kalendereintrag, statt nur über Signalwörter geraten zu werden.

const VS = /(-?[\d.,]+\s*[kmb%]?)(?:\s+[a-z]+){0,3}?\s*(?:vs\.?|versus|against|compared with)\s*(-?[\d.,]+\s*[kmb%]?)\s*(?:forecast|expected|expectations|estimate[sd]?|consensus|exp\b|f'?cast)/i;

// Auch das FinancialJuice-Format: "Actual 162k (Forecast 55k, Previous -23k)"
const ACTUAL_FORECAST = /actual\s*(-?[\d.,]+\s*[kmb%]?)\s*\(?\s*forecast\s*(-?[\d.,]+\s*[kmb%]?)/i;

/** Zieht Actual und Forecast aus einer Schlagzeile, wenn beide genannt sind. */
export function extractNumbers(title) {
  const m = title.match(ACTUAL_FORECAST) || title.match(VS);
  if (!m) return null;
  if (!matchEvent(title)) return null;   // nur bei bekanntem Wirtschaftsindikator
  return { actual: m[1].trim(), consensus: m[2].trim() };
}
