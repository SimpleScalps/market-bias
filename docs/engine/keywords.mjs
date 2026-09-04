// Signalwörter für Schlagzeilen ohne Zahlenwerte.
//
// type 'hawkish' : + = straffere Geldpolitik erwartet (schlecht für Risk-Assets)
//                  - = lockerere Geldpolitik erwartet (gut für Risk-Assets)
// type 'risk'    : + = Risikofreude (risk-on), - = Risikoaversion (risk-off)
// type 'crypto'  : direkt krypto-spezifisch, + = positiv, - = negativ

export const KEYWORDS = [
  // ----- Geldpolitik: restriktiv -----
  { re: /\b(rate (hike|increase|rise)|hike[sd]? rates|raise (interest )?rates)\b/, type: 'hawkish', weight: 0.75, label: 'Zinserhöhung' },
  { re: /\bhawkish\b/, type: 'hawkish', weight: 0.6, label: 'hawkisch' },
  { re: /\bhigher for longer\b/, type: 'hawkish', weight: 0.6, label: 'higher for longer' },
  { re: /\b(tightening|quantitative tightening|\bqt\b)\b/, type: 'hawkish', weight: 0.5, label: 'Straffung' },
  { re: /\b(sticky|persistent|hot|accelerat\w+) inflation\b/, type: 'hawkish', weight: 0.6, label: 'hartnäckige Inflation' },
  { re: /\binflation (rises|jumps|accelerates|surges|picks up)\b/, type: 'hawkish', weight: 0.65, label: 'Inflation steigt' },
  { re: /\b(yields|treasury yields) (surge|jump|rise|climb|spike)\b/, type: 'hawkish', weight: 0.45, label: 'Renditen steigen' },
  { re: /\bbets on (a )?(september |december |november )?(fed )?rate (increase|hike)\b/, type: 'hawkish', weight: 0.7, label: 'Markt preist Zinserhöhung ein' },
  { re: /\b(strong|robust|solid|hot|blowout) (jobs|payrolls|nfp|employment|labou?r market|report)\b/, type: 'hawkish', weight: 0.6, label: 'starker Arbeitsmarkt' },

  // ----- Geldpolitik: locker -----
  { re: /\b(rate cut|cut[s]? rates|lower[s]? rates|rate reduction)\b/, type: 'hawkish', weight: -0.75, label: 'Zinssenkung' },
  { re: /\bdovish\b/, type: 'hawkish', weight: -0.6, label: 'dovish' },
  { re: /\b(quantitative easing|\bqe\b|stimulus|liquidity injection)\b/, type: 'hawkish', weight: -0.7, label: 'geldpolitische Lockerung' },
  { re: /\b(disinflation|inflation (cools|eases|slows|falls|declines))\b/, type: 'hawkish', weight: -0.65, label: 'Inflation kühlt ab' },
  { re: /\b(fed )?(pivot|pause)\b/, type: 'hawkish', weight: -0.4, label: 'Fed-Pause' },
  { re: /\b(weak|soft|weaker.than.expected|cooling) (jobs|payrolls|employment|labou?r market)\b/, type: 'hawkish', weight: -0.55, label: 'schwacher Arbeitsmarkt' },

  // ----- Rohstoff- und Energiepreise -----
  // Ein Rekordhoch beim Diesel ist keine Rally, sondern ein Preisschock:
  // er treibt die Inflation und belastet damit Risk-Assets.
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}(record|all.time) high\b/, type: 'hawkish', weight: 0.5, label: 'Energiepreisschock' },
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}(record|all.time) high\b/, type: 'risk', weight: -0.42, label: 'Preisdruck' },
  { re: /\b(oil|crude|diesel|gas) prices? (surge|soar|spike|jump|climb)\w*/, type: 'hawkish', weight: 0.42, label: 'Energiepreise steigen' },

  // ----- Risikoneigung -----
  { re: /\b(rally|rallies|surge[sd]?|soar[sd]?|record high|all.time high|jump[sd]?)\b/, type: 'risk', weight: 0.4, label: 'Kursanstieg' },
  { re: /\b(ceasefire|truce|peace deal|de.escalat\w+|agreement reached|deal reached)\b/, type: 'risk', weight: 0.55, label: 'Entspannung' },
  { re: /\b(optimism|risk.on|relief rally)\b/, type: 'risk', weight: 0.4, label: 'Risikofreude' },
  { re: /\b(crash|plunge[sd]?|slump[sd]?|tumble[sd]?|sell.off|selloff|rout)\b/, type: 'risk', weight: -0.5, label: 'Kurssturz' },
  { re: /\b(recession|contraction|downgrade[sd]?|default|bankrupt\w*|insolven\w+)\b/, type: 'risk', weight: -0.6, label: 'Konjunktur-/Kreditrisiko' },
  { re: /\b(tariff[s]?|trade war|export ban|sanction[s]?)\b/, type: 'risk', weight: -0.45, label: 'Handelskonflikt' },
  { re: /\b(government shutdown|debt ceiling)\b/, type: 'risk', weight: -0.4, label: 'US-Haushaltsrisiko' },
  { re: /\b(contagion|bank run|banking crisis|credit crunch)\b/, type: 'risk', weight: -0.7, label: 'Finanzstress' },

  // ----- Krypto-spezifisch positiv -----
  { re: /\b(etf (approval|approved|inflow[s]?)|spot etf)\b/, type: 'crypto', weight: 0.7, label: 'ETF-Zuflüsse' },
  { re: /\b(institutional (adoption|inflow|demand)|corporate treasury|strategic (bitcoin )?reserve)\b/, type: 'crypto', weight: 0.6, label: 'institutionelle Nachfrage' },
  { re: /\b(accumulat\w+|whale[s]? (buy|bought|accumulat\w+)|adds to holdings)\b/, type: 'crypto', weight: 0.45, label: 'Akkumulation' },
  { re: /\b(halving|network upgrade|mainnet launch)\b/, type: 'crypto', weight: 0.35, label: 'Netzwerk-Katalysator' },
  { re: /\b(regulatory clarity|approved for listing|pro.crypto)\b/, type: 'crypto', weight: 0.5, label: 'regulatorische Klarheit' },

  // ----- Krypto-spezifisch negativ -----
  { re: /\b(hack(ed|s)?|exploit(ed|s)?|stolen|breach|drained)\b/, type: 'crypto', weight: -0.7, label: 'Hack/Exploit' },
  { re: /\b(sec (sues|charges|lawsuit)|crackdown|enforcement action|indicted)\b/, type: 'crypto', weight: -0.6, label: 'Regulierungsdruck' },
  { re: /\b(ban(s|ned)? (crypto|bitcoin)|crypto ban|delisting)\b/, type: 'crypto', weight: -0.65, label: 'Verbot/Delisting' },
  { re: /\b(etf outflow[s]?|outflows)\b/, type: 'crypto', weight: -0.55, label: 'ETF-Abflüsse' },
  { re: /\b(liquidation[s]?|forced selling|miner capitulation|whale[s]? (sold|dump\w*))\b/, type: 'crypto', weight: -0.55, label: 'Liquidationen' },
  { re: /\b(seized|confiscat\w+|mt\.? gox|exchange collapse|halts withdrawals)\b/, type: 'crypto', weight: -0.6, label: 'Coin-Überhang/Ausfall' },
];

// Geopolitik wirkt praktisch immer risk-off.
export const GEOPOLITICS = [
  { re: /\b(missile|air ?strike|airstrike|bomb\w*|shelling)\b/, weight: 0.55, label: 'Militärschlag' },
  { re: /\b(invasion|invade[sd]?|offensive launched)\b/, weight: 0.6, label: 'Invasion' },
  { re: /\b(war|conflict|hostilities|escalat\w+)\b/, weight: 0.4, label: 'Eskalation' },
  { re: /\b(nuclear|retaliat\w+|preemptive (strike|operation))\b/, weight: 0.5, label: 'Vergeltungsdrohung' },
  { re: /\b(attack|assault) on\b/, weight: 0.45, label: 'Angriff' },
];
