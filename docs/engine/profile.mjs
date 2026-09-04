import { IMPACT_STUFEN } from './tradeimpact.mjs';

// "Zeig mir nur, was für meinen Handel zählt."
//
// Ein Scalper auf dem 1-Minuten-Chart braucht andere Meldungen als jemand, der
// über Wochen hält. Eine ETF-Zulassung ist historisch bedeutsam und für den
// nächsten 5-Minuten-Trade trotzdem meist wertlos — umgekehrt ist eine
// Whale-Bewegung für den Langfristanleger Rauschen.
//
// Das Profil entscheidet deshalb an drei Stellen: welche Wirkungsdauer zählt,
// welche Mindestwirkung nötig ist und welche Coins überhaupt interessieren.

export const STIL_REGELN = {
  scalping: {
    // Sekunden bis Minuten: nur was sofort einschlägt.
    dauern: { scalp: 1.0, intraday: 0.85, swing: 0.3, long: 0.1 },
    minImpact: 'medium',
    // Ein Extremereignis wird nie ausgeblendet, egal wie lang es nachwirkt.
    immerZeigen: ['extreme'],
  },
  intraday: {
    dauern: { scalp: 0.7, intraday: 1.0, swing: 0.8, long: 0.35 },
    minImpact: 'low',
    immerZeigen: ['extreme', 'high'],
  },
  swing: {
    dauern: { scalp: 0.3, intraday: 0.7, swing: 1.0, long: 0.9 },
    minImpact: 'low',
    immerZeigen: ['extreme', 'high'],
  },
  longterm: {
    dauern: { scalp: 0.15, intraday: 0.4, swing: 0.85, long: 1.0 },
    minImpact: 'low',
    immerZeigen: ['extreme', 'high'],
  },
};

export const STANDARD_PROFIL = {
  aktiv: false,
  stil: 'scalping',
  timeframe: '5m',
  coins: ['BTC', 'ETH'],
};

const rang = (stufe) => IMPACT_STUFEN.indexOf(stufe);

/**
 * Passt die Meldung zum Profil? Liefert null, wenn sie ausgeblendet gehört,
 * sonst einen Faktor für die Sortierung (höher = wichtiger für dieses Profil).
 */
export function profilPassung(item, profil = STANDARD_PROFIL) {
  if (!profil.aktiv) return 1;

  const regeln = STIL_REGELN[profil.stil] || STIL_REGELN.scalping;
  const impact = item.impactLevel || 'low';

  // Reines Projektrauschen fliegt immer raus.
  if (impact === 'ignore') return null;

  // Extremereignisse überspringen jede weitere Prüfung.
  if (regeln.immerZeigen.includes(impact)) {
    return 1.6 * (regeln.dauern[item.duration] ?? 0.5);
  }

  if (rang(impact) < rang(regeln.minImpact)) return null;

  // Nennt die Meldung einen Coin, der nicht im Profil steht, und betrifft sie
  // nur diesen Coin, ist sie für den Nutzer ohne Belang.
  const coins = item.coins || [];
  if (coins.length && item.scope !== 'market') {
    const treffer = coins.some((c) => profil.coins.includes(c));
    if (!treffer) return null;
  }

  // Einzelprojekt-Meldungen ohne Bezug zu den gehandelten Coins ausblenden.
  if (item.scope === 'project' && !coins.some((c) => profil.coins.includes(c))) return null;

  const dauerFaktor = regeln.dauern[item.duration] ?? 0.5;
  if (dauerFaktor < 0.25) return null;

  // Ein Coin aus dem Profil ist ein Pluspunkt.
  const coinBonus = coins.some((c) => profil.coins.includes(c)) ? 1.25 : 1;

  return dauerFaktor * coinBonus * (1 + rang(impact) * 0.18);
}

/** Filtert und ordnet eine Liste nach dem Profil. */
export function nachProfil(items, profil = STANDARD_PROFIL) {
  if (!profil.aktiv) return items;
  return items
    .map((n) => ({ n, f: profilPassung(n, profil) }))
    .filter((x) => x.f !== null)
    .map((x) => ({ ...x.n, profilFaktor: +x.f.toFixed(2) }));
}
