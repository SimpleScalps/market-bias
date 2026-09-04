// Nicht jedes Wirtschaftsdatum bewegt den Krypto-Markt. Entscheidend ist,
// ob es die Zinserwartung an die US-Notenbank verschiebt. Irisches BIP oder
// albanische Erzeugerpreise tun das nicht.

export const COUNTRY_WEIGHT = [
  { re: /^(united states|us\b|u\.s\.)/i, loose: /\b(u\.?s\.?a?|united states|american|fed)\b/i, weight: 1.00, region: 'USA' },
  { re: /^(euro ?zone|euro area|european union)/i, loose: /\b(euro ?zone|euro area|ecb)\b/i, weight: 0.40, region: 'Eurozone' },
  { re: /^(germany|china|japan|united kingdom)/i, loose: /\b(germany|german|china|chinese|japan|japanese|uk|britain|british)\b/i, weight: 0.35, region: 'Global' },
  { re: /^(france|italy|spain|canada|australia|switzerland)/i, loose: /\b(france|italy|spain|canada|australia|swiss)\b/i, weight: 0.20, region: 'Global' },
];

/**
 * Gewicht und Region eines Events, oder null wenn irrelevant.
 * Kalendertitel beginnen mit dem Land ("United States Non Farm Payrolls") und
 * werden verankert geprüft. Schlagzeilen nennen es irgendwo ("Breaking: US
 * Nonfarm Payrolls rise ...") und brauchen die lockere Prüfung.
 */
export function countryRelevance(title, loose = false) {
  for (const c of COUNTRY_WEIGHT) {
    if (loose ? c.loose.test(title) : c.re.test(title)) return c;
  }
  return null;
}

// Zentralbank-Relevanz für Schlagzeilen: die Fed bewegt Krypto, die
// Reserve Bank of New Zealand praktisch nicht.
export const CB_WEIGHT = [
  { re: /\b(fed|fomc|powell|federal reserve)\b/i, weight: 1.0 },
  { re: /\b(ecb|lagarde)\b/i, weight: 0.45 },
  { re: /\b(boe|bailey|bank of england|boj|ueda|bank of japan)\b/i, weight: 0.35 },
  { re: /\b(snb|rba|rbnz|boc)\b/i, weight: 0.15 },
];

export function centralBankWeight(title) {
  for (const c of CB_WEIGHT) if (c.re.test(title)) return c.weight;
  return null;
}

// Schwellenlaender-Notenbanken bewegen den Krypto-Markt kaum. Enthaelt eine
// Schlagzeile geldpolitische Signalwoerter, bezieht sich aber auf einen
// solchen Markt, wird das Signal stark gedaempft.
const EM_MARKETS = /\b(india|indian rupee|inr|turkey|lira|brazil|real|mexico|peso|indonesia|rupiah|south africa|rand|russia|rouble|ruble|nigeria|argentina|philippines|thailand|baht|vietnam|egypt|pakistan|colombia|chile|peru)\b/i;

export function emergingMarketDamping(title) {
  return EM_MARKETS.test(title) ? 0.2 : 1;
}
