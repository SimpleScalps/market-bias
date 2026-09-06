import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rubrik } from '../docs/engine/rubrik.mjs';
import { nachbewerten } from '../docs/engine/feeds.mjs';
import { REGEL_STAND } from '../docs/engine/keywords.mjs';

/*
 * Die Rubrikpruefung entscheidet, was gar nicht erst bewertet wird. Ein
 * Fehlalarm hier laesst eine marktbewegende Meldung verschwinden - deshalb
 * steht in jedem Block auch die Gegenprobe.
 */

test('Sport wird am Pfad der Redaktion erkannt', () => {
  assert.equal(rubrik('Arsenal come from behind to beat Chelsea',
    'https://www.aljazeera.com/sports/2026/9/6/arsenal'), 'Sport');
  assert.equal(rubrik('Oil prices surge after attack on refinery',
    'https://www.aljazeera.com/economy/2026/9/6/oil'), null);
});

test('Sport wird am Wortschatz erkannt, wenn die Adresse nichts hergibt', () => {
  for (const t of [
    'NFL owners extend commissioner Roger Goodell through 2030',
    "Mariners' Matt Brash out for season with lat inflammation",
    'Orioles place OF Luis Robert Jr. (hamstring) on IL',
    "Bo Bichette fuels Mets' 8th-inning rally to top Giants",
    'Maitland-Niles screamer earns Everton 2-2 draw with Man Utd',
    'Sabalenka fights past Townsend into US Open quarters',
  ]) assert.equal(rubrik(t, ''), 'Sport', t);
});

test('Marktmeldungen bleiben unangetastet', () => {
  for (const t of [
    'US open higher after jobs data',
    'Fed holds rates steady as inflation cools',
    'Israeli strike kills two people in Gaza, medics say',
    'Bitcoin ETF sees record inflows',
    'Dockworkers strike shuts down East Coast ports',
    'Oil rally continues into third session',
    'Trump attacks Fed chair over rate decision',
    'Amazon cargo plane crashes at Miami airport',
  ]) assert.equal(rubrik(t, ''), null, t);
});

test('Was keine Meldung ist, faellt heraus', () => {
  assert.equal(rubrik('- rmb.reuters.com', ''), 'Unsinn');
  assert.equal(rubrik('(AMZZ.O) | Stock Price & Latest News', ''), 'Unsinn');
  assert.equal(rubrik('Latam - Reuters', ''), 'Unsinn');
  assert.equal(rubrik('15414', ''), 'Unsinn');
});

// --- Nachbewerten ---------------------------------------------------------

const meldung = (zusatz = {}) => ({
  id: 'Quelle:Test', title: 'Fed holds rates steady as inflation cools',
  source: 'Quelle', url: 'https://example.com/a', date: new Date().toISOString(),
  kind: 'headline', impact: 'low', tags: [], signals: [],
  scores: { crypto: 0, stocks: 0, gold: 0, usd: 0 }, ...zusatz,
});

test('Ein veralteter Regelstand wird nachbewertet, ein aktueller nicht', () => {
  const alt = nachbewerten([meldung({ regelStand: REGEL_STAND - 1 })], 'policy', 10);
  assert.equal(alt.nachbewertet, 1);
  assert.equal(alt.items[0].regelStand, REGEL_STAND);

  const neu = nachbewerten([meldung({ regelStand: REGEL_STAND })], 'policy', 10);
  assert.equal(neu.nachbewertet, 0);
  assert.equal(neu.offen, 0);
});

test('Beim Nachbewerten faellt die Berichtigung der KI weg, das Urteil bleibt', () => {
  const vorher = meldung({
    regelStand: 1,
    scores: { crypto: 0, stocks: 0, gold: 0, usd: 0 },   // Wert der KI
    regelScores: { crypto: -0.7, stocks: -0.6, gold: -0.5, usd: 0.7 },
    regelLabel: 'strong_bearish',
    kiKorrigiert: true, kiWiderspruch: true,
    ki: { richtung: 'neutral', staerke: 0, stand: 5 },
  });
  const { items } = nachbewerten([vorher], 'policy', 10);
  const n = items[0];
  assert.equal(n.kiKorrigiert, undefined, 'Berichtigung muss neu entschieden werden');
  assert.equal(n.regelScores, undefined);
  assert.ok(n.ki, 'das Urteil selbst bleibt erhalten');
  assert.equal(n.ki.richtung, 'neutral');
});

test('Nachbewerten sortiert aus, was inzwischen in eine Rubrik faellt', () => {
  const sport = meldung({ id: 'Q:S', title: 'NFL owners extend commissioner', regelStand: 1 });
  const echt = meldung({ id: 'Q:E', regelStand: 1 });
  const r = nachbewerten([sport, echt], 'policy', 10);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].id, 'Q:E');
  assert.equal(r.aussortiert.Sport, 1);
});

test('Nur ein Teil je Durchgang, die Reihenfolge bleibt', () => {
  const liste = Array.from({ length: 5 }, (_, i) =>
    meldung({ id: `Q:${i}`, title: `Fed signals rate cut number ${i}`, regelStand: 1 }));
  const r = nachbewerten(liste, 'policy', 2);
  assert.equal(r.nachbewertet, 2);
  assert.equal(r.offen, 3);
  assert.deepEqual(r.items.map((n) => n.id), ['Q:0', 'Q:1', 'Q:2', 'Q:3', 'Q:4']);
});
