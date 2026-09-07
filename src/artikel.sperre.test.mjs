import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artikelHolen } from '../worker/artikel.mjs';

/*
 * Wer ist gemeint, wenn ein Artikelabruf scheitert - die Quelle oder dieser
 * eine Artikel? Vier Quellen standen als gesperrt in der Anzeige; nachgemessen
 * sperrten nur zwei. Tehran Times lieferte einwandfrei und war trotzdem einen
 * Tag lang ausgesperrt, weil drei kurze Meldungen hintereinander unter die
 * Textschwelle gefallen waren.
 */

test('Eine unbrauchbare Adresse sagt nichts ueber die Quelle', async () => {
  for (const u of ['kein-url', 'ftp://example.com/x', 'http://127.0.0.1/x']) {
    const r = await artikelHolen(u);
    assert.ok(r.fehler, u);
    assert.equal(r.art, 'inhalt', `${u} darf die Quelle nicht belasten`);
  }
});

test('Die Zuordnung deckt jeden Rueckgabeweg ab', async () => {
  // Ohne Netz laesst sich nur pruefen, dass keine Fassung ohne `art` zurueckkommt.
  const r = await artikelHolen('http://10.0.0.1/x');
  assert.ok(['inhalt', 'abfuhr', 'drosselung', 'netz'].includes(r.art));
});
