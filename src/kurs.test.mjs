import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aufMinute, bewegung, bilanzAddieren } from '../worker/kurs.mjs';

/*
 * Der Rueckkanal vom Markt. Geprueft wird die Rechnung, nicht der Abruf -
 * eine Boerse laesst sich im Test nicht sinnvoll nachstellen, die Frage
 * "wie viel Prozent zwischen diesen beiden Kerzen" dagegen schon.
 */

const MINUTE = 60_000;
const start = aufMinute(Date.now()) - 60 * MINUTE;

/** Kerzen mit festem Kurs, einzelne davon abweichend. */
function kerzen(abweichungen = {}) {
  const m = new Map();
  for (let i = 0; i <= 60; i++) m.set(start + i * MINUTE, abweichungen[i] ?? 100);
  return m;
}

test('Die Bewegung wird in Prozent gerechnet', () => {
  const k = kerzen({ 15: 101 });
  assert.equal(bewegung(k, start, 15), 1);
  const runter = kerzen({ 15: 99.5 });
  assert.equal(bewegung(runter, start, 15), -0.5);
});

test('Eine fehlende Kerze wird aus der Nachbarminute geholt', () => {
  const k = kerzen({ 15: 102 });
  k.delete(start + 15 * MINUTE);
  // Minute 14 und 16 stehen auf 100 - die Toleranz greift, das Ergebnis ist 0.
  assert.equal(bewegung(k, start, 15), 0);
});

test('Fehlen beide Enden, kommt null statt einer erfundenen Zahl', () => {
  const k = new Map();
  assert.equal(bewegung(k, start, 15), null);
});

test('Die Bilanz zaehlt Treffer und Summe je Merkmal', () => {
  let b = bilanzAddieren(null, [
    { name: 'Signal: Eskalation', treffer: true, punkt: 0.4 },
    { name: 'Regel (unberührt)', treffer: true, punkt: 0.4 },
  ]);
  b = bilanzAddieren(b, [{ name: 'Signal: Eskalation', treffer: false, punkt: -0.2 }]);

  assert.deepEqual(b['Signal: Eskalation'], { n: 2, treffer: 1, summe: 0.2 });
  assert.deepEqual(b['Regel (unberührt)'], { n: 1, treffer: 1, summe: 0.4 });
});

test('Die Bilanz veraendert den uebergebenen Stand nicht', () => {
  const alt = { x: { n: 1, treffer: 1, summe: 0.5 } };
  bilanzAddieren(alt, [{ name: 'x', treffer: false, punkt: -1 }]);
  assert.deepEqual(alt.x, { n: 1, treffer: 1, summe: 0.5 });
});
