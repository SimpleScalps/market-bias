import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tagesSchluessel, wochentag, wochenTage, tagPlus,
  tagesSchnappschuss, fortschreiben, wochenSicht, TAGE_MAX,
} from '../docs/engine/wochenbuch.mjs';

const meldung = (id, datum, crypto, priority = 60) => ({
  id, title: `Meldung ${id}`, source: 'test', date: datum, priority,
  impactLevel: 'high',
  scores: { crypto, stocks: crypto * 0.8, gold: -crypto * 0.3, usd: -crypto },
});

test('Kalendertag richtet sich nach der Zone, nicht nach UTC', () => {
  // 22:30 UTC ist in Berlin schon der Folgetag.
  assert.equal(tagesSchluessel('2026-09-05T22:30:00Z'), '2026-09-06');
  assert.equal(tagesSchluessel('2026-09-05T21:00:00Z'), '2026-09-05');
});

test('Woche laeuft von Montag bis Sonntag', () => {
  assert.equal(wochentag('2026-09-07'), 0);          // Montag
  assert.equal(wochentag('2026-09-13'), 6);          // Sonntag
  const w = wochenTage('2026-09-09');                // ein Mittwoch
  assert.equal(w[0], '2026-09-07');
  assert.equal(w[6], '2026-09-13');
  assert.equal(w.length, 7);
});

test('Ein Tag darf beim Fortschreiben nicht schrumpfen', () => {
  const voll = [
    meldung('a', '2026-09-05T08:00:00Z', 0.9),
    meldung('b', '2026-09-05T12:00:00Z', -0.7),
    meldung('c', '2026-09-05T16:00:00Z', 0.5),
  ];
  let buch = fortschreiben({}, voll, Date.parse('2026-09-05T20:00:00Z'));
  assert.equal(buch['2026-09-05'].anzahl, 3);

  // Tags darauf liegt nur noch eine Meldung des Vortags im 24h-Fenster.
  const rest = [meldung('c', '2026-09-05T16:00:00Z', 0.5)];
  buch = fortschreiben(buch, rest, Date.parse('2026-09-06T20:00:00Z'));

  assert.equal(buch['2026-09-05'].anzahl, 3, 'der volle Tag bleibt stehen');
  assert.ok(buch['2026-09-05'].top.some((x) => x.id === 'a'), 'Spitzenmeldung bleibt');
});

test('Spitzenmeldungen beider Fassungen werden vereinigt', () => {
  let buch = fortschreiben({}, [meldung('a', '2026-09-05T08:00:00Z', 0.9)]);
  // Spaeter im Tag kommen weitere dazu; die erste liegt noch im Fenster.
  buch = fortschreiben(buch, [
    meldung('a', '2026-09-05T08:00:00Z', 0.9),
    meldung('b', '2026-09-05T18:00:00Z', -0.8),
  ]);
  const ids = buch['2026-09-05'].top.map((x) => x.id);
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('Tage jenseits der Aufbewahrung fallen heraus', () => {
  const alt = tagPlus('2026-09-05', -(TAGE_MAX + 3));
  const buch = fortschreiben(
    { [alt]: { tag: alt, anzahl: 5, klassen: {}, top: [] } },
    [meldung('a', '2026-09-05T08:00:00Z', 0.5)],
    Date.parse('2026-09-05T20:00:00Z'),
  );
  assert.equal(buch[alt], undefined);
});

test('Kuenftige Tage bleiben leer statt neutral', () => {
  const buch = fortschreiben({}, [meldung('a', '2026-09-09T08:00:00Z', 0.9)]);
  const w = wochenSicht(buch, 'crypto', Date.parse('2026-09-09T12:00:00Z'));
  const [mo, , mi, do_] = w.tage;
  assert.equal(mi.leer, undefined, 'Mittwoch hat Daten');
  assert.equal(mi.heute, true);
  assert.equal(do_.leer, true, 'Donnerstag steht noch aus');
  assert.equal(do_.kuenftig, true);
  assert.equal(mo.leer, true, 'Montag ohne Aufnahme bleibt leer');
  assert.equal(w.tageBelegt, 1);
});

test('Wochenmittel gewichtet nach Meldungszahl', () => {
  const viele = Array.from({ length: 10 }, (_, i) =>
    meldung(`v${i}`, '2026-09-07T10:00:00Z', -0.6));
  const wenige = [meldung('w', '2026-09-13T10:00:00Z', 0.9)];
  const buch = fortschreiben(fortschreiben({}, viele), wenige);
  const w = wochenSicht(buch, 'crypto', Date.parse('2026-09-13T20:00:00Z'));

  assert.equal(w.meldungen, 11);
  assert.ok(w.score < 0, 'der volle Montag zieht staerker als der einzelne Sonntag');
});

test('Anlageklasse wechselt die Kennzahlen mit', () => {
  const buch = fortschreiben({}, [meldung('a', '2026-09-09T08:00:00Z', 0.9)]);
  const krypto = wochenSicht(buch, 'crypto', Date.parse('2026-09-09T12:00:00Z'));
  const dollar = wochenSicht(buch, 'usd', Date.parse('2026-09-09T12:00:00Z'));
  assert.ok(krypto.score > 0);
  assert.ok(dollar.score < 0, 'was Krypto stuetzt, belastet den Dollar');
});
