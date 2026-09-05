// Signalwörter für Schlagzeilen ohne Zahlenwerte.
//
// type 'hawkish' : + = straffere Geldpolitik erwartet (schlecht für Risk-Assets)
//                  - = lockerere Geldpolitik erwartet (gut für Risk-Assets)
// type 'risk'    : + = Risikofreude (risk-on), - = Risikoaversion (risk-off)
// type 'crypto'  : direkt krypto-spezifisch, + = positiv, - = negativ

export const KEYWORDS = [
  // ----- Geldpolitik: restriktiv -----
  { re: /\b(rate (hikes?|increases?|rises?)|hike[sd]? rates|raise[sd]? (interest )?rates|hiking rates|tightening cycle)\b/, type: 'hawkish', weight: 0.75, label: 'Zinserhöhung', labelEn: 'rate hike' },
  { re: /\bhawkish\b/, type: 'hawkish', weight: 0.6, label: 'hawkisch', labelEn: 'hawkish' },
  { re: /\bhigher for longer\b/, type: 'hawkish', weight: 0.6, label: 'higher for longer', labelEn: 'higher for longer' },
  { re: /\b(tightening|quantitative tightening|\bqt\b)\b/, type: 'hawkish', weight: 0.5, label: 'Straffung', labelEn: 'tightening' },
  { re: /\b(sticky|persistent|hot|accelerat\w+) inflation\b/, type: 'hawkish', weight: 0.6, label: 'hartnäckige Inflation', labelEn: 'sticky inflation' },
  { re: /\binflation (rises|jumps|accelerates|surges|picks up)\b/, type: 'hawkish', weight: 0.65, label: 'Inflation steigt', labelEn: 'inflation rising' },
  { re: /\b(yields|treasury yields) (surge|jump|rise|climb|spike)\b/, type: 'hawkish', weight: 0.45, label: 'Renditen steigen', labelEn: 'yields rising' },
  { re: /\bbets on (a )?(september |december |november )?(fed )?rate (increase|hike)\b/, type: 'hawkish', weight: 0.7, label: 'Markt preist Zinserhöhung ein', labelEn: 'market prices in a hike' },
  { re: /\b(strong|robust|solid|hot|blowout) (jobs|payrolls|nfp|employment|labou?r market|report)\b/, type: 'hawkish', weight: 0.6, label: 'starker Arbeitsmarkt', labelEn: 'strong labour market' },

  // ----- Geldpolitik: locker -----
  { re: /\b(rate cuts?|cut[s]? rates|lower[s]? rates|rate reductions?|cutting rates|easing cycle)\b/, type: 'hawkish', weight: -0.75, label: 'Zinssenkung', labelEn: 'rate cut' },
  { re: /\bdovish\b/, type: 'hawkish', weight: -0.6, label: 'dovish', labelEn: 'dovish' },
  { re: /\b(quantitative easing|\bqe\b|stimulus|liquidity injection)\b/, type: 'hawkish', weight: -0.7, label: 'geldpolitische Lockerung', labelEn: 'monetary easing' },
  { re: /\b(disinflation|inflation (cools|eases|slows|falls|declines))\b/, type: 'hawkish', weight: -0.65, label: 'Inflation kühlt ab', labelEn: 'inflation cooling' },
  { re: /\b(fed )?(pivot|pause)\b/, type: 'hawkish', weight: -0.4, label: 'Fed-Pause', labelEn: 'Fed pause' },
  { re: /\b(weak|soft|weaker.than.expected|cooling) (jobs|payrolls|employment|labou?r market)\b/, type: 'hawkish', weight: -0.55, label: 'schwacher Arbeitsmarkt', labelEn: 'weak labour market' },

  // ----- Rohstoff- und Energiepreise -----
  // Ein Rekordhoch beim Diesel ist keine Rally, sondern ein Preisschock:
  // er treibt die Inflation und belastet damit Risk-Assets.
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}(record|all.time) high\b/, type: 'hawkish', weight: 0.5, label: 'Energiepreisschock', labelEn: 'energy price shock' },
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}(record|all.time) high\b/, type: 'risk', weight: -0.42, label: 'Preisdruck', labelEn: 'price pressure' },
  { re: /\b(oil|crude|diesel|gas) prices? (surge|soar|spike|jump|climb)\w*/, type: 'hawkish', weight: 0.42, label: 'Energiepreise steigen', labelEn: 'energy prices rising' },

  // ----- Risikoneigung -----
  { re: /\b(rally|rallies|surge[sd]?|soar[sd]?|record high|all.time high|jump[sd]?)\b/, type: 'risk', weight: 0.4, label: 'Kursanstieg', labelEn: 'price rally' },
  { re: /\b(ceasefire|truce|peace deal|de.escalat\w+|agreement reached|deal reached)\b/, type: 'risk', weight: 0.55, label: 'Entspannung', labelEn: 'de-escalation' },
  { re: /\b(optimism|risk.on|relief rally)\b/, type: 'risk', weight: 0.4, label: 'Risikofreude', labelEn: 'risk-on' },
  { re: /\b(crash|plunge[sd]?|slump[sd]?|tumble[sd]?|sell.off|selloff|rout)\b/, type: 'risk', weight: -0.5, label: 'Kurssturz', labelEn: 'sell-off' },
  { re: /\b(recession|contraction|downgrade[sd]?|default|bankrupt\w*|insolven\w+)\b/, type: 'risk', weight: -0.6, label: 'Konjunktur-/Kreditrisiko', labelEn: 'growth or credit risk' },
  { re: /\b(tariff[s]?|trade war|export ban|sanction[s]?|halt trade|stop trading with|trade restrictions?|embargo)\b/, type: 'risk', weight: -0.45, label: 'Handelskonflikt', labelEn: 'trade conflict' },
  { re: /\b(government shutdown|debt ceiling)\b/, type: 'risk', weight: -0.4, label: 'US-Haushaltsrisiko', labelEn: 'US fiscal risk' },
  { re: /\b(contagion|bank run|banking crisis|credit crunch)\b/, type: 'risk', weight: -0.7, label: 'Finanzstress', labelEn: 'financial stress' },
  // Scheiternde Verhandlungen sind die Kehrseite der Entspannung: Sie wiegen
  // schwerer als der Optimismus, der ihnen vorausging.
  { re: /\b(talks|negotiations|deal|agreement|summit|ceasefire)\b[^.]{0,24}\b(collapse[sd]?|fail\w*|break(s|ing)? down|broke down|stall\w*|reject\w*|walk(s|ed)? out)\b/, type: 'risk', weight: -0.55, label: 'Verhandlungen gescheitert', labelEn: 'talks collapsed' },

  // ----- Krypto-spezifisch positiv -----
  { re: /\b(etf (approval|approved|inflow[s]?)|spot etf)\b/, type: 'crypto', weight: 0.7, label: 'ETF-Zuflüsse', labelEn: 'ETF inflows' },
  { re: /\b(institutional (adoption|inflow|demand)|corporate treasury|strategic (bitcoin )?reserve)\b/, type: 'crypto', weight: 0.6, label: 'institutionelle Nachfrage', labelEn: 'institutional demand' },
  { re: /\b(accumulat\w+|whale[s]? (buy|bought|accumulat\w+)|adds to holdings)\b/, type: 'crypto', weight: 0.45, label: 'Akkumulation', labelEn: 'accumulation' },
  { re: /\b(halving|network upgrade|mainnet launch)\b/, type: 'crypto', weight: 0.35, label: 'Netzwerk-Katalysator', labelEn: 'network catalyst' },
  { re: /\b(regulatory clarity|approved for listing|pro.crypto)\b/, type: 'crypto', weight: 0.5, label: 'regulatorische Klarheit', labelEn: 'regulatory clarity' },

  // ----- Krypto-spezifisch negativ -----
  { re: /\b(hack(ed|s)?|exploit(ed|s)?|stolen|breach|drained)\b/, type: 'crypto', weight: -0.7, label: 'Hack/Exploit', labelEn: 'hack or exploit' },
  { re: /\b(sec (sues|charges|lawsuit)|crackdown|enforcement action|indicted)\b/, type: 'crypto', weight: -0.6, label: 'Regulierungsdruck', labelEn: 'regulatory pressure' },
  { re: /\b(ban(s|ned)? (crypto|bitcoin)|crypto ban|delisting)\b/, type: 'crypto', weight: -0.65, label: 'Verbot/Delisting', labelEn: 'ban or delisting' },
  { re: /\b(etf outflow[s]?|outflows)\b/, type: 'crypto', weight: -0.55, label: 'ETF-Abflüsse', labelEn: 'ETF outflows' },
  { re: /\b(liquidation[s]?|forced selling|miner capitulation|whale[s]? (sold|dump\w*))\b/, type: 'crypto', weight: -0.55, label: 'Liquidationen', labelEn: 'liquidations' },
  { re: /\b(seized|confiscat\w+|mt\.? gox|exchange collapse|halts withdrawals)\b/, type: 'crypto', weight: -0.6, label: 'Coin-Überhang/Ausfall', labelEn: 'coin overhang or failure' },
];

/*
 * Deeskalation. Eine Meldung über das ENDE eines Krieges enthält dasselbe Wort
 * wie eine über dessen Ausbruch. Ohne diese Prüfung galt "peace talks to end
 * the war" als Eskalation und damit als bearish - das Gegenteil dessen, was
 * der Markt daraus macht.
 */
export const DEESKALATION = /\b(ceasefire|truce|peace (deal|talks|plan|process|summit)?|end(ing)? the war|to end\b[^.]{0,20}\bwar|withdraw\w*|de-?escalat\w+|disengage\w*|armistice|negotiat\w+|talks\b|agreement|accord|summit|resolution)\b/i;

// ... es sei denn, die Bemühungen scheitern.
export const DEESKALATION_GESCHEITERT = /\b(fail\w*|collapse[sd]?|break(s|ing)? down|broke down|reject\w*|stall\w*|no (deal|agreement)|walks? out|suspend\w*)\b/i;

/*
 * Gefordert ist nicht beschlossen.
 *
 * "unless the Fed cuts rates" nennt eine Bedingung, "Trump calls for rate
 * cuts" eine Forderung - in beiden Faellen ist die Zinssenkung nicht
 * geschehen. Das Regelwerk las bisher nur das Stichwort und schloss auf eine
 * tatsaechliche Lockerung; eine Drohung mit Handelsstopp galt dadurch als
 * kaufenswerte Nachricht. Steht das geldpolitische Signal in einem solchen
 * Zusammenhang, wird es stark gedaempft: Die Aeusserung sagt etwas ueber den
 * Wunsch des Sprechers, nicht ueber die Geldpolitik.
 */
export const NUR_GEFORDERT = /\b(unless|if\b|should\b|must\b|calls? for|demand(s|ed|ing)?|urges?|urging|pressur(e|es|ing)|push(es|ing)? for|wants?|wanted|insists?|threat(en(s|ed|ing)?)?|hopes? for|expects? (a )?cut|forderung)\b/i;

/*
 * "Krieg" als Bild, nicht als Krieg.
 *
 * Die Eskalationsregel greift auf das blosse Wort "war" - und wertete damit
 * "Meet the CISO: A new front line star in the AI cybersecurity war" als
 * bearish fuer Bitcoin. Gemeint ist dort ein Berufsfeld, kein Konflikt.
 *
 * Die Wendungen unten sind durchweg uebertragen gebraucht: Preiskampf,
 * Bieterwettstreit, Formatstreit, Wortgefecht. Sie stehen haeufig in
 * Wirtschaftsmeldungen und haben mit Risikoaversion nichts zu tun.
 *
 * Bewusst nicht dabei: "trade war". Ein Handelskrieg bewegt die Maerkte
 * tatsaechlich, und dafuer gibt es weiter oben eine eigene Regel.
 */
export const KRIEG_BILDLICH =
  /\b(?:cyber\w*|price|pricing|bidding|talent|hiring|streaming|format|browser|console|chip|ai|tech|meme|marketing|ad|content|patent|turf)[\s-]+wars?\b|\bwars?\s+(?:of\s+words|chest|room)\b|\bwar\s+on\s+(?:drugs|poverty|cash|talent|waste|terror)\b/i;

// Geopolitik wirkt praktisch immer risk-off.
export const GEOPOLITICS = [
  { re: /\b(missile|air ?strike|airstrike|bomb\w*|shelling)\b/, weight: 0.55, label: 'Militärschlag', labelEn: 'military strike' },
  /*
   * Waffengattung plus Wirkung.
   *
   * "Russian drone strikes Ukraine's security service headquarters" blieb ohne
   * Wertung: "drone strike" stand nirgends, "air strike" trifft es nicht. Die
   * Waffengattung voranzustellen haelt die Regel eng - ein Arbeitskampf
   * ("dock workers strike") loest sie nicht aus.
   */
  { re: /\b(drone|missile|rocket|artillery|air)s?[\s-]+(strike|attack|barrage)s?\b/, weight: 0.5, label: 'Militärschlag', labelEn: 'military strike' },
  { re: /\bstrike[sd]?\s+(on|against)\s+\w/, weight: 0.45, label: 'Militärschlag', labelEn: 'military strike' },
  { re: /\b(invasion|invade[sd]?|offensive launched)\b/, weight: 0.6, label: 'Invasion', labelEn: 'invasion' },
  { re: /\b(war|conflict|hostilities|escalat\w+)\b/, weight: 0.4, label: 'Eskalation', labelEn: 'escalation' },
  { re: /\b(nuclear|retaliat\w+|preemptive (strike|operation))\b/, weight: 0.5, label: 'Vergeltungsdrohung', labelEn: 'retaliation threat' },
  // Mit Plural: "Russian attacks on Ukraine" fiel sonst durch.
  { re: /\b(attacks?|assaults?|raids?) on\b/, weight: 0.45, label: 'Angriff', labelEn: 'attack' },
];
