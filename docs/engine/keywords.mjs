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
  /*
   * Auch in umgekehrter Wortstellung.
   *
   * "sticky inflation" traf, "inflation proves sticky" nicht - dieselbe
   * Aussage, nur andersherum gebaut, und die Meldung fiel auf neutral.
   * Schlagzeilen stellen den Befund gern nach: "inflation remains stubborn",
   * "inflation stays hot".
   */
  { re: /\b(sticky|persistent|stubborn|hot|elevated|accelerat\w+) inflation\b|\binflation\b[^.]{0,20}\b(sticky|persistent|stubborn|hot|elevated|entrenched)\b/, type: 'hawkish', weight: 0.6, label: 'hartnäckige Inflation', labelEn: 'sticky inflation' },
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
  /*
   * Ein Rekordhoch beim Diesel ist keine Rally, sondern ein Preisschock: Er
   * treibt die Inflation und belastet damit Risk-Assets.
   *
   * Nicht nur Rekordhochs. "Oil price shock lifts energy costs sharply" ergab
   * null, weil die Regel ausschliesslich auf "record high" und "all-time high"
   * ansprang — der Begriff Preisschock selbst stand nicht darin. Auch ein
   * Sprung ohne Rekord treibt die Inflation.
   */
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}((record|all.time) high|shock|spikes?|surges?|soars?|jumps?)\b/, type: 'hawkish', weight: 0.5, label: 'Energiepreisschock', labelEn: 'energy price shock' },
  { re: /\b(oil|crude|diesel|gasoline|petrol|natural gas|energy|food|wheat) (price[s]? )?[a-z ]{0,14}((record|all.time) high|shock|spikes?|surges?|soars?|jumps?)\b/, type: 'risk', weight: -0.42, label: 'Preisdruck', labelEn: 'price pressure' },
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
  /*
   * Zwischen "ETF" und "inflows" darf etwas stehen.
   *
   * "Bitcoin ETF sees record inflows of $1.2 billion" ergab null, weil die
   * Regel die beiden Woerter unmittelbar nebeneinander verlangte. Genau so
   * schreiben Redaktionen aber selten - "sees record", "posts", "attracts"
   * stehen regelmaessig dazwischen. ETF-Fluesse sind einer der staerksten
   * Treiber ueberhaupt; sie zu uebersehen ist teuer.
   */
  { re: /\b(etf\b[^.]{0,24}\b(approval|approved|inflow[s]?|net buying)|spot etf)\b/, type: 'crypto', weight: 0.7, label: 'ETF-Zuflüsse', labelEn: 'ETF inflows' },
  { re: /\b(institutional (adoption|inflow|demand)|corporate treasury|strategic (bitcoin )?reserve)\b/, type: 'crypto', weight: 0.6, label: 'institutionelle Nachfrage', labelEn: 'institutional demand' },
  /*
   * Auch der schlichte Kauf zaehlt.
   *
   * "MicroStrategy buys another 5,000 BTC" ergab null: Die Regel kannte
   * "accumulates" und "whales buy", aber nicht das gewoehnlichste Wort dafuer.
   * Die Menge muss dabeistehen, sonst faengt sie jede Kaufabsicht ein.
   */
  { re: /\b(accumulat\w+|whale[s]? (buy|bought|accumulat\w+)|adds to holdings|(buys|bought|purchased|acquired)\b[^.]{0,24}\b(btc|bitcoin|eth|ether)\b)\b/, type: 'crypto', weight: 0.45, label: 'Akkumulation', labelEn: 'accumulation' },
  { re: /\b(halving|network upgrade|mainnet launch)\b/, type: 'crypto', weight: 0.35, label: 'Netzwerk-Katalysator', labelEn: 'network catalyst' },
  { re: /\b(regulatory clarity|approved for listing|pro.crypto)\b/, type: 'crypto', weight: 0.5, label: 'regulatorische Klarheit', labelEn: 'regulatory clarity' },

  // ----- Krypto-spezifisch negativ -----
  { re: /\b(hack(ed|s)?|exploit(ed|s)?|stolen|breach|drained)\b/, type: 'crypto', weight: -0.7, label: 'Hack/Exploit', labelEn: 'hack or exploit' },
  { re: /\b(sec (sues|charges|lawsuit)|crackdown|enforcement action|indicted)\b/, type: 'crypto', weight: -0.6, label: 'Regulierungsdruck', labelEn: 'regulatory pressure' },
  /*
   * Ein Verbot laesst sich auf viele Arten formulieren.
   *
   * "China bans all cryptocurrency transactions" ergab null: Die Regel
   * verlangte "bans crypto" unmittelbar nebeneinander, hier stand "all"
   * dazwischen - und "cryptocurrency" endete nicht dort, wo sie eine
   * Wortgrenze erwartete. Ein Landesverbot gehoert zu den staerksten
   * Einzelereignissen fuer den Kurs.
   */
  { re: /\b(ban(s|ned|ning)?\b[^.]{0,20}\b(crypto\w*|bitcoin|digital asset[s]?|mining)|crypto\w* ban|delisting|outlaw\w*\b[^.]{0,20}\b(crypto\w*|bitcoin))\b/, type: 'crypto', weight: -0.65, label: 'Verbot/Delisting', labelEn: 'ban or delisting' },
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

/*
 * ... es sei denn, die Bemühungen scheitern.
 *
 * Die Liste war zu eng. "Zelensky says he expects war to continue into winter
 * after talks with US envoys" enthielt "talks" und galt damit als Entspannung:
 * Die Eskalationsregel drehte ihr Vorzeichen um, und eine Meldung über einen
 * weitergehenden Krieg wurde bullish für Krypto und bearish für Gold — das
 * genaue Gegenteil dessen, was der Markt daraus macht.
 *
 * Zwei Lücken steckten darin. "no breakthrough" fehlte, obwohl "no deal" und
 * "no agreement" dastanden. Und die Fortdauer des Konflikts war überhaupt nicht
 * erfasst — dabei ist gerade sie die Absage an die Hoffnung, die den
 * Gesprächen vorausging.
 *
 * Die Fortdauer ist bewusst eng gefasst: Es muss um den Konflikt selbst gehen,
 * nicht um irgendetwas, das weitergeht. "Gespräche werden fortgesetzt" ist
 * Entspannung, "der Krieg wird fortgesetzt" ist das Gegenteil.
 */
export const DEESKALATION_GESCHEITERT = new RegExp([
  // Abbruch, Ablehnung, Blockade
  String.raw`\b(fail\w*|collapse[sd]?|break(s|ing)? down|broke down|reject\w*|stall\w*)\b`,
  String.raw`\b(walks? out|suspend\w*|deadlock\w*|impasse|stalemate|inconclusive)\b`,
  // Ausbleibender Fortschritt
  String.raw`\bno (deal|agreement|breakthrough|progress|ceasefire|truce|end in sight)\b`,
  String.raw`\bwithout (a |any )?(deal|agreement|breakthrough|announcement)\b`,
  // Der Konflikt geht weiter
  String.raw`\b(war|fighting|conflict|hostilities|offensive)\b[^.]{0,40}\b(continue\w*|drag\w*|persist\w*|rage[sd]?|prolong\w*|grind\w*)\b`,
  String.raw`\b(continue\w*|drag\w*|prolong\w*)\b[^.]{0,25}\b(war|fighting|conflict|hostilities)\b`,
].join('|'), 'i');

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
  /*
   * "strike" ohne Zusatz - aber nur mit Opfern daneben.
   *
   * Das Wort allein bleibt zweideutig: Ein Streik ist auch einer, und
   * "workers strike" darf den Kryptomarkt nicht bewegen. Steht aber im selben
   * Satz von Getöteten oder Verletzten, ist die Lesart eindeutig.
   *
   * Aufgefallen an "Israeli strike kills two in Gaza": Das ergab 0.000,
   * waehrend "Israeli AIR strike kills two in Gaza" -0.900 ergab. Ein
   * fehlendes Wort entschied ueber alles oder nichts.
   */
  { re: /\bstrikes?\b[^.]{0,40}\b(kill\w*|dead|killed|wounded|injur\w*|casualt\w*)\b/, weight: 0.5, label: 'Militärschlag', labelEn: 'military strike' },
  { re: /\b(invasion|invade[sd]?|offensive launched)\b/, weight: 0.6, label: 'Invasion', labelEn: 'invasion' },
  { re: /\b(war|conflict|hostilities|escalat\w+)\b/, weight: 0.4, label: 'Eskalation', labelEn: 'escalation' },
  { re: /\b(nuclear|retaliat\w+|preemptive (strike|operation))\b/, weight: 0.5, label: 'Vergeltungsdrohung', labelEn: 'retaliation threat' },
  // Mit Plural: "Russian attacks on Ukraine" fiel sonst durch.
  { re: /\b(attacks?|assaults?|raids?) on\b/, weight: 0.45, label: 'Angriff', labelEn: 'attack' },
];
