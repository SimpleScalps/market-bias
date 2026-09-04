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
    ['Jobless claims jump higher than expected', 'strong_bullish'],
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
