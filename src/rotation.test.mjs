import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupe } from '../docs/engine/dedupe.mjs';

/*
 * Spielt den Ablauf des Workers nach: zusammenführen, kürzen, sich merken.
 *
 * Der Bestand fasst 300 Meldungen, die Quellen liefern mehr. Eine Nachricht,
 * über die schon benachrichtigt wurde, kann dadurch aus der Anzeige fallen und
 * später erneut geliefert werden. Ohne ein Gedächtnis, das über die Anzeige
 * hinausreicht, löst sie dann eine zweite Benachrichtigung aus — genau das ist
 * mehrfach passiert. Dieser Test hält den Mechanismus fest.
 */

const LIMIT = 300;
const GESEHEN_MAX = 4000;

// Nachbau von zusammenfuehren() aus worker/index.mjs
function zusammenfuehren(bestand, frische) {
  const bekannt = new Map((bestand?.items || []).map((n) => [n.id, n]));
  const kandidaten = [];
  for (const n of frische) {
    const vorhanden = bekannt.get(n.id);
    if (!vorhanden) kandidaten.push(n);
    bekannt.set(n.id, vorhanden ? { ...n, date: vorhanden.date } : n);
  }
  const items = dedupe([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, LIMIT);

  const sichtbar = new Set(items.map((n) => n.id));
  return { items, neue: kandidaten.filter((n) => sichtbar.has(n.id)) };
}

// Nachbau von teilAbgleich(): melden und merken in einem Zug
function durchlauf(bestand, frische) {
  const { items, neue } = zusammenfuehren(bestand, frische);
  const gesehen = new Set(bestand?.gesehen || []);
  const kandidaten = neue.filter((n) => !gesehen.has(n.id));
  for (const n of items) gesehen.add(n.id);
  return {
    bestand: { items, gesehen: [...gesehen].slice(-GESEHEN_MAX) },
    gemeldet: kandidaten,
  };
}

const meldung = (i, minutenAlt) => ({
  id: `Quelle:Meldung ${i}`,
  title: `Meldung ${i}`,
  date: new Date(Date.now() - minutenAlt * 60000).toISOString(),
  scores: { crypto: 0 },
});

test('Eine verdrängte Meldung wird nicht erneut gemeldet', () => {
  // Runde 1: 300 Meldungen füllen den Bestand vollständig.
  const start = Array.from({ length: LIMIT }, (_, i) => meldung(i, i + 100));
  let stand = durchlauf(null, start).bestand;
  assert.equal(stand.items.length, LIMIT);

  const beobachtet = stand.items.find((n) => n.id === 'Quelle:Meldung 299');
  assert.ok(beobachtet, 'die älteste Meldung ist zunächst sichtbar');

  // Runde 2: 50 neuere Meldungen verdrängen die ältesten.
  const neuere = Array.from({ length: 50 }, (_, i) => meldung(1000 + i, i));
  stand = durchlauf(stand, neuere).bestand;

  const nochSichtbar = stand.items.some((n) => n.id === 'Quelle:Meldung 299');
  assert.equal(nochSichtbar, false, 'die alte Meldung ist aus der Anzeige gefallen');
  assert.ok(stand.gesehen.length > LIMIT, 'das Gedächtnis reicht über die Anzeige hinaus');

  // Runde 3: Die Quelle liefert die verdrängte Meldung erneut - diesmal mit
  // frischem Datum, sie landet also wieder in der Anzeige.
  const wiedervorlage = [{ ...meldung(299, 0) }];
  const runde3 = durchlauf(stand, wiedervorlage);

  assert.ok(
    runde3.bestand.items.some((n) => n.id === 'Quelle:Meldung 299'),
    'sie ist wieder sichtbar'
  );
  assert.equal(
    runde3.gemeldet.length, 0,
    'löst aber keine zweite Benachrichtigung aus'
  );
});

test('Eine tatsächlich neue Meldung wird gemeldet', () => {
  const start = Array.from({ length: 10 }, (_, i) => meldung(i, i + 10));
  let stand = durchlauf(null, start).bestand;

  const runde = durchlauf(stand, [meldung(999, 0)]);
  assert.equal(runde.gemeldet.length, 1, 'echte Neuzugänge kommen durch');
  assert.equal(runde.gemeldet[0].id, 'Quelle:Meldung 999');
});
