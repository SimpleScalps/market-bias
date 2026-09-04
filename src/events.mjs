// Katalog der Makro-Events.
//
// polarity  = +1  wenn ein HÖHERER Actual-Wert eine STÄRKERE Wirtschaft bzw.
//                 HEISSERE Inflation bedeutet
//             -1  wenn ein höherer Wert das Gegenteil bedeutet
//                 (Arbeitslosenquote, Erstanträge: hoch = schwacher Arbeitsmarkt)
// channel   = welcher Übertragungskanal zur Geldpolitik betroffen ist
// scale     = typische Überraschung in der Einheit des Events. Die Abweichung
//             Actual-Consensus wird durch scale geteilt -> vergleichbarer z-Wert.
// weight    = Marktrelevanz des Events (NFP/CPI bewegen mehr als Baugenehmigungen)

export const EVENTS = [
  // ---------- Arbeitsmarkt ----------
  { re: /\bnon.?farm payrolls\b(?!.*private)/i, name: 'Non-Farm Payrolls', channel: 'growth', polarity: 1, scale: 45, weight: 1.0 },
  { re: /nonfarm payrolls private|private payrolls/i, name: 'Private Payrolls', channel: 'growth', polarity: 1, scale: 40, weight: 0.6 },
  { re: /\badp\b.*(employment|payroll)/i, name: 'ADP Beschäftigung', channel: 'growth', polarity: 1, scale: 40, weight: 0.6 },
  { re: /u-6 unemployment/i, name: 'U-6 Arbeitslosenquote', channel: 'growth', polarity: -1, scale: 0.2, weight: 0.4 },
  { re: /unemployment rate/i, name: 'Arbeitslosenquote', channel: 'growth', polarity: -1, scale: 0.15, weight: 0.9 },
  { re: /initial jobless claims|initial claims/i, name: 'Erstanträge Arbeitslosenhilfe', channel: 'growth', polarity: -1, scale: 15, weight: 0.6 },
  { re: /continuing (jobless )?claims/i, name: 'Fortlaufende Anträge', channel: 'growth', polarity: -1, scale: 60, weight: 0.4 },
  { re: /average (hourly )?earnings/i, name: 'Durchschnittslöhne', channel: 'inflation', polarity: 1, scale: 0.15, weight: 0.8 },
  { re: /jolts|job openings/i, name: 'JOLTS Offene Stellen', channel: 'growth', polarity: 1, scale: 250, weight: 0.5 },
  { re: /challenger job cuts/i, name: 'Challenger Stellenabbau', channel: 'growth', polarity: -1, scale: 20, weight: 0.3 },
  { re: /participation rate/i, name: 'Erwerbsquote', channel: 'growth', polarity: 0.3, scale: 0.2, weight: 0.2 },
  { re: /(manufacturing|government) payrolls/i, name: 'Payrolls (Teilbereich)', channel: 'growth', polarity: 1, scale: 15, weight: 0.3 },

  // ---------- Inflation ----------
  { re: /core (cpi|consumer price)/i, name: 'Kern-CPI', channel: 'inflation', polarity: 1, scale: 0.15, weight: 1.0 },
  { re: /\bcpi\b|consumer price index/i, name: 'CPI Inflation', channel: 'inflation', polarity: 1, scale: 0.15, weight: 1.0 },
  { re: /core (pce|personal consumption)/i, name: 'Kern-PCE', channel: 'inflation', polarity: 1, scale: 0.12, weight: 0.95 },
  { re: /\bpce\b/i, name: 'PCE Preisindex', channel: 'inflation', polarity: 1, scale: 0.12, weight: 0.8 },
  { re: /core (ppi|producer price)/i, name: 'Kern-PPI', channel: 'inflation', polarity: 1, scale: 0.2, weight: 0.6 },
  { re: /\bppi\b|producer price/i, name: 'PPI Erzeugerpreise', channel: 'inflation', polarity: 1, scale: 0.2, weight: 0.6 },
  { re: /inflation expectation/i, name: 'Inflationserwartungen', channel: 'inflation', polarity: 1, scale: 0.2, weight: 0.5 },
  { re: /import price|export price/i, name: 'Import-/Exportpreise', channel: 'inflation', polarity: 1, scale: 0.3, weight: 0.3 },

  // ---------- Wachstum / Konjunktur ----------
  { re: /\bgdp\b|gross domestic product/i, name: 'BIP', channel: 'growth', polarity: 1, scale: 0.3, weight: 0.8 },
  { re: /retail sales/i, name: 'Einzelhandelsumsätze', channel: 'growth', polarity: 1, scale: 0.3, weight: 0.75 },
  { re: /ism.*(services|non.?manufacturing)/i, name: 'ISM Dienstleistungen', channel: 'growth', polarity: 1, scale: 1.5, weight: 0.8 },
  { re: /ism.*manufacturing/i, name: 'ISM Industrie', channel: 'growth', polarity: 1, scale: 1.5, weight: 0.75 },
  { re: /(pmi|purchasing managers)/i, name: 'PMI', channel: 'growth', polarity: 1, scale: 1.5, weight: 0.6 },
  { re: /industrial production/i, name: 'Industrieproduktion', channel: 'growth', polarity: 1, scale: 0.4, weight: 0.5 },
  { re: /durable goods/i, name: 'Auftragseingang langlebige Güter', channel: 'growth', polarity: 1, scale: 1.0, weight: 0.5 },
  { re: /factory orders/i, name: 'Auftragseingang Industrie', channel: 'growth', polarity: 1, scale: 0.6, weight: 0.4 },
  { re: /consumer confidence|consumer sentiment|michigan/i, name: 'Verbrauchervertrauen', channel: 'growth', polarity: 1, scale: 2.5, weight: 0.5 },
  { re: /housing starts|building permits|home sales/i, name: 'Immobilienmarkt', channel: 'growth', polarity: 1, scale: 0.06, weight: 0.35 },
  { re: /trade balance/i, name: 'Handelsbilanz', channel: 'growth', polarity: 0.5, scale: 3, weight: 0.3 },
  { re: /crude oil inventories/i, name: 'Rohöllagerbestände', channel: 'none', polarity: 0, scale: 2, weight: 0.2 },

  // ---------- Geldpolitik direkt ----------
  { re: /interest rate decision|fed funds|rate statement/i, name: 'Zinsentscheid', channel: 'policy', polarity: 1, scale: 0.25, weight: 1.0 },
];

export function matchEvent(title) {
  for (const ev of EVENTS) if (ev.re.test(title)) return ev;
  return null;
}
