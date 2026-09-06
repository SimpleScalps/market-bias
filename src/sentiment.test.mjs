import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMacroEvent, scoreHeadline, label, parseNumber } from '../docs/engine/sentiment.mjs';

const dir = (r) => (r ? label(r.scores.crypto) : 'kein_signal');

test('Zahlen aus dem Kalender werden korrekt gelesen', () => {
  assert.equal(parseNumber('162.0K'), 162);
  assert.equal(parseNumber('-23K'), -23);
  assert.equal(parseNumber('4.1%'), 4.1);
  assert.equal(parseNumber('1.2M'), 1200);
  assert.equal(parseNumber(''), null);
});

test('NFP deutlich über Prognose ist stark bearish für Krypto', () => {
  const r = scoreMacroEvent({ title: 'United States Non Farm Payrolls', actual: '162.0K', consensus: '56.0K', previous: '21.0K' });
  assert.equal(dir(r), 'strong_bearish');
  assert.equal(label(r.scores.usd), 'strong_bullish');   // Gegenprobe: für den Dollar umgekehrt
});

test('Schwache Arbeitsmarktdaten sind bullish für Krypto', () => {
  const r = scoreMacroEvent({ title: 'United States Non Farm Payrolls', actual: '10.0K', consensus: '150.0K', previous: '80K' });
  assert.ok(r.scores.crypto > 0.3, 'erwartet bullish, war ' + r.scores.crypto);
});

test('Steigende Arbeitslosenquote ist bullish (invertierte Polarität)', () => {
  const r = scoreMacroEvent({ title: 'United States Unemployment Rate', actual: '4.6%', consensus: '4.1%', previous: '4.1%' });
  assert.ok(r.scores.crypto > 0, 'höhere Arbeitslosigkeit -> Fed lockert -> bullish');
});

test('Heiße Inflation ist bearish', () => {
  const r = scoreMacroEvent({ title: 'United States Core CPI YoY', actual: '3.8%', consensus: '3.2%', previous: '3.1%' });
  assert.ok(['bearish', 'strong_bearish'].includes(dir(r)));
});

test('Irrelevante Volkswirtschaften werden verworfen', () => {
  assert.equal(scoreMacroEvent({ title: 'Albania PPI YoY', actual: '0.2%', consensus: '1.0%' }), null);
  assert.equal(scoreMacroEvent({ title: 'Ireland GDP Growth Rate YoY', actual: '-0.4%', consensus: '-1.6%' }), null);
});

test('Verbale Überraschungen bekommen die richtige Richtung', () => {
  const cases = [
    ['U.S. payrolls rose 162,000 in August, much more than expected', 'strong_bearish'],
    ['US inflation cools more than expected in August', 'strong_bullish'],
    ['Core CPI rises faster than expected', 'strong_bearish'],
    /*
     * Bullish, nicht stark bullish - und das ist die Berichtigung.
     *
     * Frueher kamen hier zwei Regeln zusammen: "schwacher Arbeitsmarkt", der
     * zu Recht griff, und "Kursanstieg", der auf das Wort "jump" ansprang,
     * obwohl von Arbeitslosenzahlen die Rede war und nicht von Kursen. Die
     * Staerke stammte also zur Haelfte aus einem Fehlgriff. Seit ein
     * Kursanstieg ein Marktsubjekt verlangt, bleibt nur die richtige Regel -
     * und mit ihr das ehrlichere Ergebnis.
     */
    ['Jobless claims jump higher than expected', 'bullish'],
  ];
  for (const [title, want] of cases) assert.equal(dir(scoreHeadline(title)), want, title);
});

test('Dämpfende Verben drehen das Signal', () => {
  const zahm = scoreHeadline('BoE Bailey tames rate hike hopes');
  assert.ok(zahm.scores.crypto > 0, '"tames rate hike hopes" ist dovish');
  const roh = scoreHeadline('Fed signals rate hike in September');
  assert.ok(roh.scores.crypto < 0, 'angekündigte Zinserhöhung ist bearish');
});

test('Krypto-eigene Nachrichten wirken direkt', () => {
  assert.ok(scoreHeadline('Bitcoin ETF inflows hit $731M as BTC reclaims $80K').scores.crypto > 0);
  assert.ok(scoreHeadline('Exchange hacked, $200M drained from hot wallet').scores.crypto < 0);
});

test('Geopolitik wirkt risk-off: Krypto runter, Gold rauf', () => {
  const r = scoreHeadline('Iran says response to Israeli airstrike will be devastating');
  assert.ok(r.scores.crypto < 0, 'Krypto risk-off');
  assert.ok(r.scores.gold > 0, 'Gold profitiert als sicherer Hafen');
});

test('Schlagzeilen ohne Signal bleiben ohne Wertung', () => {
  assert.equal(scoreHeadline('Is the stock market open on Labor Day?'), null);
});

test('Wachstumsregime dreht die Zinslogik um', () => {
  const ev = { title: 'United States Non Farm Payrolls', actual: '162.0K', consensus: '56.0K' };
  assert.ok(scoreMacroEvent(ev, 'policy').scores.crypto < 0);
  assert.ok(scoreMacroEvent(ev, 'growth').scores.crypto > 0);
});

test('Dubletten behalten den Zeitpunkt der frühesten Meldung', async () => {
  const { dedupe } = await import('../docs/engine/dedupe.mjs');
  const titel = 'US Nonfarm Payrolls rise sharply above forecast in August';
  const [zusammengefasst] = dedupe([
    { id: 'a', title: titel, source: 'CoinDesk', date: '2026-09-04T12:31:00Z', priority: 40 },
    { id: 'b', title: titel, source: 'CNBC', date: '2026-09-04T17:16:00Z', priority: 90 },
  ]);
  // Der wichtigere Eintrag gewinnt, aber mit der früheren Uhrzeit.
  assert.equal(zusammengefasst.source, 'CNBC');
  assert.equal(zusammengefasst.date, '2026-09-04T12:31:00Z');
  assert.deepEqual(zusammengefasst.alsoIn, ['CoinDesk']);
});

test('Friedensbemühungen sind keine Eskalation', () => {
  const bullish = [
    "Witkoff and Kushner will travel to end Russia's war in Ukraine: Trump",
    'Peace talks to end the war in Gaza begin in Cairo',
    'Ceasefire agreed after months of war',
  ];
  for (const t of bullish) {
    const r = scoreHeadline(t);
    assert.ok(r && r.scores.crypto > 0, `sollte bullish sein: ${t}`);
  }

  // Eskalation und gescheiterte Gespräche bleiben risk-off.
  for (const t of ['Russia escalates war in Ukraine with new strikes',
                   'Peace talks collapse as both sides walk out']) {
    const r = scoreHeadline(t);
    assert.ok(r && r.scores.crypto < 0, `sollte bearish sein: ${t}`);
  }
});

test('Krypto-Signalwörter gelten nur für Krypto-Meldungen', () => {
  // Dieselben Stichwörter, einmal ohne und einmal mit Bezug zur Sache.
  const ohneBezug = [
    'Andrew Tate indicted in Romania for trafficking minors, money laundering',
    'OpenAI Agents Hack German Website to Share Rule-Breaking Tactics',
    'Utah Becomes First State to Target VPNs in Age-Verification Crackdown',
  ];
  for (const t of ohneBezug) {
    const r = scoreHeadline(t);
    assert.ok(!r || Math.abs(r.scores.crypto) < 0.16, `darf nicht werten: ${t}`);
  }

  const mitBezug = [
    'Trezor says data breach affects another 67K US customers',
    'Binance Adds Four Crypto Assets to Delisting Watch',
    'SEC sues crypto exchange over unregistered securities',
  ];
  for (const t of mitBezug) {
    const r = scoreHeadline(t);
    assert.ok(r && r.scores.crypto < -0.16, `sollte bearish sein: ${t}`);
  }
});

test('Notenbanken kleiner Märkte bewegen Krypto nicht', () => {
  const rand = scoreHeadline('Malaysian Ringgit: BNM hawkish tilt supports MYR – Commerzbank');
  assert.ok(Math.abs(rand.scores.crypto) < 0.16, 'BNM ist für Krypto ohne Belang');

  const fed = scoreHeadline('Fed signals rate hike in September');
  assert.ok(fed.scores.crypto < -0.5, 'die Fed dagegen schon');
});

test('Randmärkte färben auch nicht über Risikosignale ab', () => {
  // Ein mexikanisches Währungspaar ist für Krypto ohne Belang, auch wenn
  // das Wort "rally" darin vorkommt.
  const peso = scoreHeadline('USD/MXN Price Forecast: Peso rally targets April 2024 low');
  assert.ok(!peso || Math.abs(peso.scores.crypto) < 0.16, 'MXN-Prognose darf nicht werten');

  // Krypto selbst und weltweite Geopolitik bleiben unberührt.
  assert.ok(scoreHeadline('Bitcoin rallies to new all-time high').scores.crypto > 0.16);
  assert.ok(scoreHeadline('Iran says response to Israeli airstrike will be devastating').scores.crypto < -0.16);
});

test('Typografische Zeichen brechen die Erkennung nicht', () => {
  // Redaktionen setzen geschwungene Anführungszeichen und lange Striche.
  // "travel to ‘end’ the war" trennte damit genau die Wörter, an denen die
  // Erkennung der Deeskalation ansetzt.
  const paare = [
    ['Witkoff and Kushner will travel to \u2018end\u2019 Russia\u2019s war in Ukraine', 0],
    ['Bailey \u2018tames\u2019 rate hike hopes', 0],
    ['Inflation \u2014 cooling faster than expected', 0],
  ];
  for (const [t] of paare) {
    const r = scoreHeadline(t);
    assert.ok(r && r.scores.crypto > 0, `sollte bullish sein: ${t}`);
  }
});

test('Verbrichtung erkennt auch die Verlaufsform', () => {
  // "cooling", "rising", "falling" — ohne diese Formen kippte das Vorzeichen.
  assert.ok(scoreHeadline('Inflation cooling faster than expected').scores.crypto > 0);
  assert.ok(scoreHeadline('Payrolls rising faster than expected').scores.crypto < 0);
  assert.ok(scoreHeadline('Jobless claims falling faster than expected').scores.crypto < 0);
});

test('Gefordert ist nicht beschlossen', () => {
  // "unless the Fed cuts rates" nennt eine Bedingung, keine Entscheidung.
  // Die Drohung mit Handelsstopp galt dadurch als kaufenswerte Nachricht.
  const drohung = scoreHeadline(
    'Trump doubles down on threat to halt trade with top partners unless Fed cuts rates');
  assert.ok(drohung.scores.crypto < 0,
    'eine Handelsdrohung ist nicht bullish, auch wenn Zinssenkung darin vorkommt');

  // Der Plural fehlte im Muster: "rate cuts" blieb unerkannt, waehrend
  // "cuts rates" erfasst wurde. Die Forderung war damit aus Zufall neutral.
  for (const t of ['Trump calls for immediate rate cuts from the Fed',
                   'Trump urges the Fed to deliver rate cuts']) {
    const r = scoreHeadline(t);
    assert.ok(r, `Stichwort muss erkannt werden: ${t}`);
    assert.ok(Math.abs(r.scores.crypto) < 0.16, `blosse Forderung bewegt nichts: ${t}`);
  }

  // Plural auch bei tatsaechlichen Entscheidungen.
  assert.ok(scoreHeadline('Fed delivers two rate cuts this year').scores.crypto > 0.5);

  // Tatsächliche Entscheidungen wirken unverändert.
  assert.ok(scoreHeadline('Fed cuts rates by 25 basis points').scores.crypto > 0.5);
  assert.ok(scoreHeadline('Fed signals rate hike in September').scores.crypto < -0.5);
});

// ── Krieg als Bild, und echte Konflikte, die durchfielen ──────────────────

test('"Krieg" im übertragenen Sinn ist keine Eskalation', () => {
  // Die Regel griff auf das blosse Wort und wertete eine Meldung über
  // IT-Sicherheitschefs als bearish für Bitcoin.
  for (const t of [
    'Meet the CISO: A new front line star in the AI cybersecurity war',
    'Netflix and Disney escalate streaming war with price cuts',
    'Chipmakers locked in a price war over AI accelerators',
    'Trump and Powell trade a war of words',
  ]) {
    const r = scoreHeadline(t, 'policy');
    assert.equal(label(r?.scores?.crypto ?? 0), 'neutral', t);
  }
});

test('Ein echter Krieg bleibt eine Eskalation', () => {
  const r = scoreHeadline('Iran war live: oil tanker reported hit by missiles', 'policy');
  assert.ok((r?.scores?.crypto ?? 0) < -0.2, 'muss bearish bleiben');
});

test('Angriffe im Plural und Drohnenschläge werden erkannt', () => {
  // Das Muster verlangte den Singular; "Russian attacks on Ukraine" fiel
  // durch und stand ohne Wertung in der Liste - also unsichtbar.
  for (const t of [
    'At least 5 killed in Russian attacks on Ukraine as US envoys visit Moscow',
    'Russian drone strikes Ukraine\u2019s security service headquarters',
    'Russia hits Ukrainian security headquarters in drone attack',
  ]) {
    const r = scoreHeadline(t, 'policy');
    assert.ok((r?.scores?.crypto ?? 0) < -0.2, t);
  }
});

test('Ein Arbeitskampf ist kein Militärschlag', () => {
  const r = scoreHeadline('Dock workers strike at Los Angeles port enters second week', 'policy');
  assert.equal(label(r?.scores?.crypto ?? 0), 'neutral');
});

test('Gewalt ohne Marktbezug bleibt ohne Wertung', () => {
  // Tragisch, aber für den Kryptomarkt ohne Belang - die Länderrelevanz
  // muss das auffangen, sonst fluten Regionalmeldungen die Liste.
  for (const t of [
    'Bolivian military barracks explosion kills at least 10',
    'At least five killed in Sudan\u2019s South Kordofan in attack by rebel group',
    'Mudslide in eastern China kills one, leaves 11 missing',
  ]) {
    const r = scoreHeadline(t, 'policy');
    assert.equal(label(r?.scores?.crypto ?? 0), 'neutral', t);
  }
});

/*
 * Gescheiterte Entspannung und der Krieg, der weitergeht.
 *
 * Der reale Fall: "Zelensky says he expects war to continue into winter after
 * talks with US envoys" enthielt "talks" und galt damit als Entspannung. Die
 * Eskalationsregel drehte ihr Vorzeichen um — die Meldung über einen
 * weitergehenden Krieg wurde bullish für Krypto und bearish für Gold, also das
 * Gegenteil dessen, was der Markt daraus macht.
 */
test('Ein Krieg, der weitergeht, ist keine Entspannung', () => {
  const s = scoreHeadline(
    'Zelensky says he expects war to continue into winter after talks with US envoys', 'policy');
  assert.ok(s.scores.crypto < -0.05, `sollte bearish sein, ist ${s.scores.crypto}`);
  assert.ok(s.scores.gold > 0, `Gold sollte stützen, ist ${s.scores.gold}`);
});

test('Gespräche ohne Durchbruch gelten nicht als Entspannung', () => {
  const s = scoreHeadline('Peace talks on the war end without a breakthrough', 'policy');
  assert.ok(s.scores.crypto <= 0, `sollte nicht bullish sein, ist ${s.scores.crypto}`);
});

test('Echte Entspannung bleibt bullish', () => {
  const s = scoreHeadline('Ukraine and Russia agree ceasefire after peace talks', 'policy');
  assert.ok(s.scores.crypto > 0.05, `sollte bullish sein, ist ${s.scores.crypto}`);
});

/*
 * "strike" ohne Zusatz — aber nur mit Opfern daneben.
 *
 * "Israeli strike kills two in Gaza" ergab 0.000, "Israeli AIR strike kills
 * two in Gaza" dagegen -0.900. Ein fehlendes Wort entschied über alles oder
 * nichts. Zugleich darf ein Arbeitskampf den Kryptomarkt nicht bewegen.
 */
test('Ein Militärschlag mit Opfern zählt auch ohne Zusatzwort', () => {
  for (const t of ['Israeli strike kills two in Gaza',
                   'Russian strike killed 12 civilians overnight']) {
    assert.ok(scoreHeadline(t, 'policy').scores.crypto < -0.05, t);
  }
});

test('Ein Arbeitskampf ist kein Militärschlag', () => {
  for (const t of ['Boeing workers strike enters third week',
                   'Autoworkers strike ends with wage deal',
                   'Dockworkers strike could hit supply chains']) {
    // null heisst: kein Richtungssignal gefunden - genau das Gewuenschte.
    const s = scoreHeadline(t, 'policy');
    const wert = s?.scores?.crypto ?? 0;
    assert.ok(Math.abs(wert) < 0.15, `${t} -> ${wert}`);
  }
});
