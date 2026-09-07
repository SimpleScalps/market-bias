import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zustandZusammenfuehren } from '../worker/versandbuch.mjs';
import { ANWEISUNG_STAND } from '../worker/deuten.mjs';

/*
 * Der Betriebszustand im Durable Object addiert Zahlenfelder und ersetzt alles
 * andere. Das ist fuer Zaehler richtig und fuer alles andere falsch - dreimal
 * ist mir dieselbe Falle zugeschnappt, und jedes Mal hoerte lautlos etwas auf
 * zu funktionieren, weil ein Vergleich nie wieder passte. Diese Tests halten
 * beide Seiten der Regel fest.
 */

test('Zaehler werden addiert', () => {
  const r = zustandZusammenfuehren({ tokens: 100, schreibVersuche: 3 }, { tokens: 50, schreibVersuche: 1 });
  assert.equal(r.tokens, 150);
  assert.equal(r.schreibVersuche, 4);
});

test('Texte und Objekte werden ersetzt', () => {
  const r = zustandZusammenfuehren(
    { letzteDubletten: '2026-09-07T01:00:00.000Z', ticks: { a: 1 } },
    { letzteDubletten: '2026-09-07T02:00:00.000Z', ticks: { b: 2 } },
  );
  assert.equal(r.letzteDubletten, '2026-09-07T02:00:00.000Z');
  assert.deepEqual(r.ticks, { b: 2 });
});

test('Versionsstände dürfen keine Zahlen sein', () => {
  /*
   * Der eigentliche Fund. Als Zahl geschrieben verdoppelt sich ein Stand bei
   * jedem Durchgang: aus 2 wird 4, aus 5 wird 10. Danach passt er zu keinem
   * Vergleich mehr, und was daran haengt, gilt fuer immer als veraltet.
   */
  const alsZahl = zustandZusammenfuehren({ stand: 2 }, { stand: 2 });
  assert.equal(alsZahl.stand, 4, 'so verhält sich das Objekt — deshalb nie eine Zahl nehmen');

  const alsText = zustandZusammenfuehren({ stand: '2' }, { stand: '2' });
  assert.equal(alsText.stand, '2');
});

test('Die tatsächlich benutzten Stände sind Texte', () => {
  // Bricht, sobald jemand einen Stand wieder als Zahl ablegt.
  assert.equal(typeof String(ANWEISUNG_STAND), 'string');
  const r = zustandZusammenfuehren(
    { pruefFehlerStand: String(ANWEISUNG_STAND), bilanzStand: '2' },
    { pruefFehlerStand: String(ANWEISUNG_STAND), bilanzStand: '2' },
  );
  assert.equal(r.pruefFehlerStand, String(ANWEISUNG_STAND));
  assert.equal(r.bilanzStand, '2');
});

// --- Bilanz ---------------------------------------------------------------

test('Die Bilanz wird aufaddiert, nicht ersetzt', () => {
  const basis = { bilanzStand: '2', bilanz: { 'Signal: Eskalation': { n: 4, treffer: 1, summe: -0.4 } } };
  const r = zustandZusammenfuehren(basis, {
    bilanzStand: '2',
    bilanzZuwachs: { 'Signal: Eskalation': { n: 1, treffer: 1, summe: 0.3 } },
  });
  assert.deepEqual(r.bilanz['Signal: Eskalation'], { n: 5, treffer: 2, summe: -0.1 });
  assert.equal(r.bilanzZuwachs, undefined, 'der Zuwachs selbst wird nicht abgelegt');
});

test('Zwei Durchgänge gleichzeitig verlieren nichts', () => {
  /*
   * Genau der Fall, an dem es scheiterte: Drei Taktgeber laufen parallel,
   * jeder liest denselben Stand und schreibt am Ende zurueck. Wer den
   * Gesamtstand schickt, ueberschreibt den anderen; wer den Zuwachs schickt,
   * nicht.
   */
  const start = { bilanzStand: '2', bilanz: {} };
  const eins = zustandZusammenfuehren(start, {
    bilanzStand: '2', bilanzZuwachs: { A: { n: 1, treffer: 1, summe: 0.2 } },
  });
  const zwei = zustandZusammenfuehren(eins, {
    bilanzStand: '2', bilanzZuwachs: { A: { n: 1, treffer: 0, summe: -0.1 } },
  });
  assert.deepEqual(zwei.bilanz.A, { n: 2, treffer: 1, summe: 0.1 });
});

test('Ein neuer Bilanzstand beginnt die Zählung von vorn', () => {
  const basis = { bilanzStand: '1', bilanz: { A: { n: 9, treffer: 9, summe: 9 } } };
  const r = zustandZusammenfuehren(basis, {
    bilanzStand: '2', bilanzZuwachs: { A: { n: 1, treffer: 0, summe: -0.5 } },
  });
  assert.deepEqual(r.bilanz.A, { n: 1, treffer: 0, summe: -0.5 });
});
