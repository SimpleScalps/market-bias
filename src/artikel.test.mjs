// Tests für das Schälen des Artikeltextes aus einer HTML-Seite.
//
// Der Text geht anschließend an das Sprachmodell und ist die Grundlage für
// jede Antwort auf eine Nachfrage. Was hier verloren geht oder fälschlich
// mitkommt, schlägt dort unmittelbar durch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textAusHtml } from '../worker/artikel.mjs';

test('Der Artikelbereich wird dem übrigen Seitengerüst vorgezogen', () => {
  const t = textAusHtml(`
    <body>
      <nav>Startseite Politik Wirtschaft Sport</nav>
      <article><p>Das US Central Command teilte mit, die USS Nitze sei
      am Freitag beschossen worden.</p></article>
      <footer>Impressum Datenschutz</footer>
    </body>`);

  assert.match(t, /USS Nitze/);
  // Navigation und Fußzeile kosten Token und verwässern die Antwort.
  assert.doesNotMatch(t, /Startseite|Impressum/);
});

test('Skripte und Formatvorlagen kommen nie mit', () => {
  const t = textAusHtml(`
    <main>
      <script>var werbung = "Jetzt kaufen";</script>
      <style>.a{color:red}</style>
      <p>Der Angriff ereignete sich im Golf von Oman.</p>
    </main>`);

  assert.match(t, /Golf von Oman/);
  assert.doesNotMatch(t, /Jetzt kaufen|color:red/);
});

test('Absatzgrenzen bleiben erhalten, Sätze laufen nicht ineinander', () => {
  const t = textAusHtml('<article><p>Erster Satz.</p><p>Zweiter Satz.</p></article>');
  // Ohne die Grenze stünde dort "Erster Satz.Zweiter Satz."
  assert.match(t, /Erster Satz\.\s+Zweiter Satz\./);
});

test('Entitäten werden lesbar', () => {
  const t = textAusHtml('<article><p>Trump&rsquo;s &quot;deal&quot; &amp; more &#8211; heute</p></article>');
  assert.match(t, /Trump’s "deal" & more – heute/);
});

test('Ohne Artikel- oder Hauptbereich dient der Rumpf als Grundlage', () => {
  const t = textAusHtml('<html><body><p>Nur ein Rumpf, aber Text.</p></body></html>');
  assert.match(t, /Nur ein Rumpf, aber Text\./);
});

test('Unbrauchbare Eingaben ergeben leeren Text statt einer Ausnahme', () => {
  assert.equal(textAusHtml(null), '');
  assert.equal(textAusHtml(undefined), '');
  assert.equal(textAusHtml(''), '');
});

test('Absätze schlagen das übrige Seitengerüst, auch wenn es riesig ist', () => {
  // Der reale Fall: CNBC lieferte 397.926 Zeichen. Auf 6.000 beschnitten wäre
  // beim Modell kein Wort des Artikels angekommen, nur Gerüst.
  const wust = '<div>' + 'Navigation Menü Abo Newsletter '.repeat(2000) + '</div>';
  const t = textAusHtml(`<body>${wust}<p>${'Die USS Nitze wurde am Freitag beschossen. '.repeat(12)}</p></body>`);

  assert.match(t, /USS Nitze/);
  assert.doesNotMatch(t, /Newsletter/);
  // Der Absatz allein, nicht die halbe Seite.
  assert.ok(t.length < 2000, `zu viel Text: ${t.length} Zeichen`);
});

test('<pre> und <picture> gelten nicht als Absatz', () => {
  // Der Absatz muss die 400 Zeichen ueberschreiten, sonst greift absichtlich
  // der Rueckfall auf den ganzen Bereich - lieber etwas als nichts.
  const satz = 'Der Angriff ereignete sich laut Zentralkommando im Golf von Oman. ';
  const t = textAusHtml('<article><pre>var x = 1; // ein Codeblock, der hier nichts zu suchen hat</pre>'
    + '<picture><p>Bildunterschrift</p></picture>'
    + `<p>${satz.repeat(8)}</p></article>`);

  assert.match(t, /Golf von Oman/);
  assert.doesNotMatch(t, /var x = 1/);
});

test('Ist der Absatztext zu duenn, dient der ganze Bereich als Rueckfall', () => {
  // Absichtlich so: Eine Seite ohne brauchbare <p> ist kein Grund, dem Modell
  // gar nichts zu geben.
  const t = textAusHtml('<article><div>' + 'Ein Satz ohne Absatzmarkierung. '.repeat(20) + '</div></article>');
  assert.match(t, /Ein Satz ohne Absatzmarkierung/);
});
