/*
 * Stand des Regelwerks.
 *
 * Bewertete Meldungen liegen im Bestand und werden nur dann neu bewertet, wenn
 * sie erneut im Feed auftauchen. Ein Feed haelt aber nur ein Dutzend Eintraege:
 * Alles Aeltere behielt sein Urteil fuer immer - auch dann, wenn genau die
 * Regel, die es erzeugt hat, inzwischen berichtigt war. Genau so blieb
 * "Deeskalation" unter einer Meldung stehen, die keine ist, obwohl das Muster
 * schon zwei Stunden vorher enger gefasst worden war.
 *
 * Diese Zahl steigt bei jeder Aenderung an Regeln oder Bewertung. Der Worker
 * bewertet daraufhin nach, was einen aelteren Stand traegt.
 *
 * 1  Ausgangsstand
 * 2  Rubrikpruefung, Verneinung bei der Deeskalation, gescheiterte Diplomatie
 */
export const REGEL_STAND = 2;

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
  /*
   * Eine Wende in der Geldpolitik, keine im Lebenslauf.
   *
   * "Career pivot leads chef to open bakery" wurde als Fed-Pause gewertet und
   * damit bullish. Auch eine Spielunterbrechung ist eine "pause". Gefordert
   * ist deshalb die Notenbank in der Nähe.
   */
  { re: /\b(fed|fomc|ecb|boe|boj|snb|central bank|policy|rates?|hiking|tightening)\b[^.]{0,32}\b(pivot|pause)\b|\b(pivot|pause)\b[^.]{0,32}\b(fed|fomc|ecb|boe|boj|rate hikes?|tightening|policy)\b/, type: 'hawkish', weight: -0.4, label: 'Fed-Pause', labelEn: 'Fed pause' },
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
  /*
   * Ein Kursanstieg braucht einen Markt, nicht irgendein Subjekt.
   *
   * Vorher sprang die Regel auf jedes "jumps", "surges" oder "soars" an -
   * gleich, wovon die Rede war. "Okta Jumps 20% as AI Features Boost Outlook"
   * wurde damit zu einem Kaufsignal für Bitcoin, und "US jobless claims jump"
   * bekam die richtige Richtung aus dem falschen Grund: als Kursanstieg
   * verbucht, obwohl es um Arbeitslosenzahlen ging.
   *
   * Eine einzelne Aktie bewegt den Kryptomarkt nicht. Gefordert ist deshalb
   * ein breites Subjekt in der Nähe - Indizes, Aktien allgemein, Krypto, Gold.
   */
  { re: /\b(stocks?|shares|equities|markets?|wall street|s&p|nasdaq|dow|dax|nikkei|ftse|bitcoin|btc|ether|eth|crypto\w*|gold|risk assets?)\b[^.]{0,28}\b(rally|rallies|surge[sd]?|soar[sd]?|jump[sd]?|record high|all.time high)\b|\b(rally|rallies|surge[sd]?|soar[sd]?|jump[sd]?)\b[^.]{0,28}\b(stocks?|shares|equities|markets?|wall street|s&p|nasdaq|dow|bitcoin|btc|crypto\w*|gold)\b/, type: 'risk', weight: 0.4, label: 'Kursanstieg', labelEn: 'price rally' },
  { re: /\b(ceasefire|truce|peace deal|de.escalat\w+|agreement reached|deal reached)\b/, type: 'risk', weight: 0.55, label: 'Entspannung', labelEn: 'de-escalation' },
  { re: /\b(optimism|risk.on|relief rally)\b/, type: 'risk', weight: 0.4, label: 'Risikofreude', labelEn: 'risk-on' },
  /*
   * Ein Kurssturz braucht einen Markt - wie der Kursanstieg auch.
   *
   * "Video shows damaged Amazon cargo plane after crash" wurde als Kurssturz
   * gewertet und damit bearish. Ebenso ein Autounfall, ein Zugunglück, eine
   * stolpernde Turnerin ("tumbles") und ein Sänger, der auf der Bühne
   * zusammensackt ("slumps"). Auch eine militärische Niederlage heisst "rout".
   *
   * Eindeutig bleiben nur die Fachbegriffe: Ein Ausverkauf oder ein
   * Baerenmarkt kann nichts anderes meinen. Alles Uebrige verlangt ein
   * Marktsubjekt in der Naehe.
   */
  { re: /\b(sell.?off|selloff|bear market|market rout|flash crash)\b|\b(stocks?|shares|equities|markets?|wall street|s&p|nasdaq|dow|dax|nikkei|ftse|bitcoin|btc|ether|eth|crypto\w*|gold|oil|yields?|bonds?|treasur\w+|dollar|futures|index|indices|risk assets?)\b[^.]{0,28}\b(crash\w*|plunge[sd]?|slump[sd]?|tumble[sd]?|rout|dive[sd]?|slide[sd]?|sink[s]?)\b|\b(crash\w*|plunge[sd]?|slump[sd]?|tumble[sd]?|dive[sd]?|slide[sd]?)\b[^.]{0,28}\b(stocks?|shares|equities|markets?|wall street|s&p|nasdaq|dow|bitcoin|btc|crypto\w*|gold|yields?|bonds?|dollar)\b/, type: 'risk', weight: -0.5, label: 'Kurssturz', labelEn: 'sell-off' },
  /*
   * Auch hier trennt der Zusammenhang.
   *
   * "Default setting changed in latest Android update" galt als Kreditrisiko,
   * ebenso eine Studie ueber Muskelkontraktion. Rezession, Pleite und
   * Zahlungsunfaehigkeit sind eindeutig; Kontraktion, Herabstufung und Ausfall
   * sind es nur mit ihrem Gegenstand.
   */
  { re: /\b(recession|bankrupt\w*|insolven\w+|credit crunch)\b|\b(economic|economy|gdp|output|manufacturing|industrial|activity) contraction\b|\bcontraction in\b|\b(credit|ratings?|debt|sovereign|outlook) (rating )?downgrade[sd]?\b|\bdowngrade[sd]?\b[^.]{0,20}\b(rating|outlook|debt|credit|bond|stock|shares|to junk)\b|\b(debt|bond|loan|sovereign|payment|technical) default\b|\bdefault[s]? on\b/, type: 'risk', weight: -0.6, label: 'Konjunktur-/Kreditrisiko', labelEn: 'growth or credit risk' },
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
  /*
   * "bomb" allein ist zweideutig.
   *
   * "New film bombs at the box office" und eine Bombendrohung an einer Schule
   * wurden als Militärschlag gewertet, beide mit −0,49. Eindeutig sind nur die
   * Formen, die militärisch vorkommen: Bombardierung, Luftangriff, Beschuss.
   * Das bloße Wort braucht ein Ziel.
   */
  { re: /\b(missile|air ?strike|airstrike|bombing|bombard\w*|air raid|shelling)\b|\bbombs?\b[^.]{0,24}\b(city|cities|town|village|port|base|border|target\w*|kill\w*|civilians|infrastructure|positions?|troops)\b/, weight: 0.55, label: 'Militärschlag', labelEn: 'military strike' },
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
  /*
   * "Invasion of privacy" ist keine.
   *
   * Die Wendung ist im englischen Rechtsjournalismus haeufig und wurde als
   * militaerische Invasion gewertet - stark bearish fuer eine Klage gegen ein
   * Technikunternehmen. Dasselbe gilt fuer die Invasion von Arten oder
   * Touristen.
   */
  { re: /\binvasion\b(?!\s+of\s+(privacy|species|tourists|ants|insects))|\binvade[sd]?\b|\boffensive launched\b/, weight: 0.6, label: 'Invasion', labelEn: 'invasion' },
  /*
   * "Conflict of interest" ist kein Konflikt in diesem Sinn.
   *
   * Die Wendung ist in Rechts- und Politikmeldungen häufig und wurde als
   * Eskalation gewertet — bearish für eine Befangenheitsentscheidung.
   */
  { re: /\b(war|hostilities|escalat\w+)\b|\bconflict\b(?!\s+of\s+interest)/, weight: 0.4, label: 'Eskalation', labelEn: 'escalation' },
  /*
   * "nuclear" allein sagt nichts.
   *
   * Das Wort steht ebenso in "nuclear power plant", "nuclear energy shortlist"
   * oder "nuclear talks" - lauter Meldungen ohne militärische Drohung.
   * "Twelve Companies Make DOEs Latest Nuclear Shortlist" wurde so zu einer
   * Vergeltungsdrohung und damit stark bearish, obwohl es um die Vergabe von
   * Aufträgen in der Kernenergie ging.
   *
   * Gefordert ist deshalb der militärische Zusammenhang. "Retaliation" und
   * "preemptive strike" tragen ihn schon im Wort.
   */
  { re: /\bnuclear\b[^.]{0,24}\b(weapon\w*|warhead\w*|strike\w*|attack\w*|test\w*|threat\w*|arsenal|bomb\w*|war\b|escalat\w*)\b|\b(weapon\w*|threat\w*|strike\w*|attack\w*|test\w*)\b[^.]{0,24}\bnuclear\b|\b(retaliat\w+|preemptive (strike|operation))\b/, weight: 0.5, label: 'Vergeltungsdrohung', labelEn: 'retaliation threat' },
  // Mit Plural: "Russian attacks on Ukraine" fiel sonst durch.
  /*
   * Ein Angriff braucht ein Ziel von Gewicht.
   *
   * "Assaults on nurses rise, union warns" wurde als geopolitischer Angriff
   * gewertet. Übergriffe im Alltag und Polizeirazzien bewegen keinen Markt —
   * Angriffe auf Städte, Häfen, Truppen oder Versorgung sehr wohl.
   */
  /*
   * Zwei Wege zum Ziel: ein gewichtiges Objekt — oder Opfer.
   *
   * Der Katalog allein reichte nicht. "At least 5 killed in Russian attacks on
   * Ukraine" nennt ein Land, keinen Hafen, und die Toten stehen im Satz VOR
   * dem Angriff. Deshalb wird beides im ganzen Titel gesucht statt in einem
   * Fenster dahinter: irgendwo ein Angriff, irgendwo ein Ziel von Gewicht oder
   * Opfer. Übergriffe im Alltag erfüllen weder das eine noch das andere.
   */
  { re: /^(?=[^]*\b(attacks?|assaults?|raids?|strikes?) on\b)(?=[^]*\b(city|cities|town|village|base|port|harbou?r|airport|airfield|border|troops|forces|positions?|infrastructure|convoy|ship|vessel|tanker|pipeline|refinery|grid|capital|region|province|territory|embassy|nuclear|military|army|navy|oil|energy|civilians|warship|kill\w*|dead|wounded|injur\w*|casualt\w*)\b)/, weight: 0.45, label: 'Angriff', labelEn: 'attack' },
  /*
   * Gescheiterte Diplomatie ist Eskalation, nicht Entspannung.
   *
   * "Trump official says 'there may not be a nuclear agreement' with Iran"
   * bekam gar kein Signal mehr, seit die Vergeltungsregel einen militaerischen
   * Zusammenhang verlangt - das blosse Wort "nuclear" traegt zu Recht nicht.
   * Uebrig blieb "agreement", und das las das Regelwerk als Friedensmeldung.
   * Beides war falsch: Ein Abkommen, das ausdruecklich nicht zustande kommt,
   * ist die Absage an die Hoffnung, die davorstand.
   *
   * Eng gefasst auf die diplomatischen Formen. "No agreement on the budget"
   * bewegt keinen Risikowert und darf hier nicht hineinlaufen.
   */
  { re: /\b(no|not|never|without|rules? out|ruled out|fail\w* to reach|collapse of|breakdown in|abandon\w*)\b[^.]{0,30}\b(cease-?fire|truce|armistice|peace (deal|plan|agreement|accord|talks)|nuclear (deal|agreement|accord|talks))\b/, weight: 0.35, label: 'Diplomatie gescheitert', labelEn: 'diplomacy failed' },
];
