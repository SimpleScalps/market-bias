import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe, woerter } from '../docs/engine/dedupe.mjs';

/*
 * CNBC und CNBC World bringen dieselbe Nachricht in anderer Wortwahl, und
 * beide standen in der Liste. Verglichen wurden Wortformen: "yield" und
 * "yields" galten als verschiedene Woerter. Diese Tests halten fest, was
 * zusammengehoert - und vor allem, was nicht.
 */

const meldung = (id, title, crypto = 0.5, priority = 50) =>
  ({ id, title, scores: { crypto }, priority });

const verschmilzt = (a, b, cryptoA = 0.5, cryptoB = 0.5) =>
  dedupe([meldung('a', a, cryptoA, 50), meldung('b', b, cryptoB, 40)]).length === 1;

test('Wortstämme fassen Beugungsformen zusammen', () => {
  const w = woerter('Treasury yields rising to highest levels');
  assert.ok(w.has('yield'), 'yields -> yield');
  assert.ok(w.has('ris'), 'rising -> ris');
  assert.ok(w.has('high'), 'highest -> high');
});

test('Dieselbe Nachricht in anderer Wortwahl wird zusammengefasst', () => {
  // Der Fall, der die Aenderung ausgeloest hat - beide von CNBC.
  assert.ok(verschmilzt(
    '10-year Treasury yield tops 4.9%, highest since 2023, as oil surge raises inflation fears',
    'Treasury yields rise to multi-year highs as surging oil outweighs tame inflation report',
  ));
  assert.ok(verschmilzt(
    'Nasdaq to invest $100 million in Kraken parent Payward as firms expand partnership',
    'Nasdaq Invests $100M in Kraken Parent Payward at $21B Valuation',
  ));
});

test('Gegenteilige Meldungen bleiben getrennt, auch bei gleicher Wertung', () => {
  /*
   * Der Preis der Stammformen: Zwei Schlagzeilen koennen bis auf ein Wort
   * gleich lauten und das Gegenteil sagen. gegensatz() greift nur bei
   * verschiedenen Vorzeichen - hier sind beide gleich bewertet.
   */
  assert.ok(!verschmilzt(
    'Bitcoin ETF sees record inflows this week after approval',
    'Bitcoin ETF sees record outflows this week after approval',
  ));
  assert.ok(!verschmilzt(
    'Fed cuts rates by 25 basis points citing cooling inflation',
    'Fed hikes rates by 25 basis points citing rising inflation',
  ));
});

test('Verschiedene Nachrichten mit gemeinsamen Wörtern bleiben getrennt', () => {
  assert.ok(!verschmilzt(
    'US envoys arrive in Moscow ahead of Ukraine talks',
    'At least 5 killed in Russian attacks on Ukraine',
  ));
  assert.ok(!verschmilzt('Best Biotech Stocks Right Now', 'Best Oil Stocks Right Now'));
});

test('Die Wertung trennt weiterhin, was sich widerspricht', () => {
  assert.ok(!verschmilzt(
    'Dovish hold may follow as inflation cools further this quarter',
    'Dovish hold unlikely as inflation cools further this quarter',
    0.6, -0.6,
  ));
});

test('Der früheste Zeitpunkt und die weiteren Quellen bleiben erhalten', () => {
  const frueh = new Date(Date.now() - 3600_000).toISOString();
  const spaet = new Date().toISOString();
  const [n] = dedupe([
    { ...meldung('a', 'Treasury yields rise to multi-year highs as surging oil outweighs tame inflation report', 0.5, 40), source: 'CNBC', date: spaet },
    { ...meldung('b', '10-year Treasury yield tops 4.9%, highest since 2023, as oil surge raises inflation fears', 0.5, 60), source: 'CNBC World', date: frueh },
  ]);
  assert.equal(n.source, 'CNBC World', 'die relevantere Fassung gewinnt');
  assert.equal(n.date, frueh, 'der frueheste Zeitpunkt zaehlt');
  assert.deepEqual(n.alsoIn, ['CNBC']);
});
