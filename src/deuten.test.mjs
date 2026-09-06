import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alsWert, widerspruch, deuten, fragen, tageslage } from '../worker/deuten.mjs';

test('Einschätzung wird auf dieselbe Skala gebracht', () => {
  assert.equal(alsWert({ richtung: 'bullish', staerke: 0.7 }), 0.7);
  assert.equal(alsWert({ richtung: 'bearish', staerke: 0.4 }), -0.4);
  assert.equal(alsWert({ richtung: 'neutral', staerke: 0 }), 0);
  assert.equal(alsWert(null), 0);
  assert.equal(alsWert({ fehler: 'Groq 400' }), 0);
});

test('Widerspruch meint verschiedene Vorzeichen bei Gewicht', () => {
  // Der reale Fall: Die Regel liest "Fed cuts rates" als positiv, das Modell
  // erkennt die Handelsdrohung dahinter.
  assert.equal(widerspruch(0.25, { richtung: 'bearish', staerke: 0.4 }), true);

  // Einigkeit in der Richtung ist kein Widerspruch, auch bei anderer Stärke.
  assert.equal(widerspruch(-0.89, { richtung: 'bearish', staerke: 0.4 }), false);

  // Schwache Signale auf beiden Seiten lösen keinen Alarm aus.
  assert.equal(widerspruch(0.2, { richtung: 'bearish', staerke: 0.1 }), false);

  // Ohne Antwort bleibt es bei der Regel.
  assert.equal(widerspruch(0.8, { fehler: 'Groq 400' }), false);
  assert.equal(widerspruch(0.8, null), false);
});

/*
 * Die drei Wege zu Groq einmal wirklich durchlaufen.
 *
 * Anlass war ein Fehler, den keine Pruefung gefunden hat: fragen() reicht die
 * Arbeit an frageStellen() weiter, und der Zweck stand in der falschen der
 * beiden Funktionen. Weil jeder Weg seine Fehler abfaengt und als Text
 * zurueckgibt, kam das nicht als Absturz heraus, sondern als Antwort
 * "zweck is not defined" - im laufenden Betrieb, beim Nutzer.
 *
 * Diese Tests rufen die Wege mit einem vorgetaeuschten fetch auf. Sie pruefen
 * zweierlei: dass ueberhaupt eine Antwort herauskommt, und dass jeder Weg das
 * Modell nimmt, das ihm zusteht - daran haengt die Trennung der Kontingente.
 */
const ANTWORTEN = {
  deuten: { richtung: 'bearish', staerke: 0.6, inhalt: 'Test', grund: 'Test' },
  lage: { lage: 'Ruhiger Tag.' },
};

/** Ersetzt fetch und merkt sich, welches Modell angefragt wurde. */
function groqVortaeuschen(inhalt) {
  const gefragt = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/models')) {
      return new Response(JSON.stringify({
        data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }],
      }), { status: 200 });
    }
    gefragt.push(JSON.parse(opts.body).model);
    return new Response(JSON.stringify({
      choices: [{ message: { content: typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt) } }],
      usage: { total_tokens: 42 },
    }), { status: 200 });
  };
  return gefragt;
}

test('Jeder Weg antwortet und nimmt sein eigenes Modell', async () => {
  const echt = globalThis.fetch;
  try {
    const env = { GROQ_KEY: 'test' };

    // Die laufende Pruefung - auf dem Modell der Dauerlast.
    const g1 = groqVortaeuschen(ANTWORTEN.deuten);
    const d = await deuten('US jobless claims jump', env, 'Mehr als erwartet.');
    assert.equal(d.fehler, undefined, `deuten() scheiterte: ${d.fehler}`);
    assert.equal(d.richtung, 'bearish');
    assert.equal(g1[0], 'openai/gpt-oss-20b');

    // Eine eigene Frage - auf dem Modell, das die Dauerlast nicht antastet.
    const g2 = groqVortaeuschen('Weil die Daten stark ausfielen.');
    const f = await fragen('US jobless claims jump', 'Anriss', 'Warum bearish?', env);
    assert.equal(f.fehler, undefined, `fragen() scheiterte: ${f.fehler}`);
    assert.match(f.antwort, /Daten/);
    assert.equal(g2[0], 'openai/gpt-oss-120b');

    // Der Tagesbericht gehoert zum selben Topf wie die eigene Frage.
    const g3 = groqVortaeuschen(ANTWORTEN.lage);
    const l = await tageslage([{ titel: 'Test', wertung: '0.50' }], 'crypto', env);
    assert.equal(l.fehler, undefined, `tageslage() scheiterte: ${l.fehler}`);
    assert.equal(g3[0], 'openai/gpt-oss-120b');
  } finally {
    globalThis.fetch = echt;
  }
});

test('Rueckfragen bekommen den bisherigen Verlauf mit', async () => {
  const echt = globalThis.fetch;
  try {
    let gesendet = '';
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }), { status: 200 });
      }
      gesendet = JSON.parse(opts.body).messages.map((m) => m.content).join('\n');
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'Antwort.' } }], usage: { total_tokens: 9 },
      }), { status: 200 });
    };

    await fragen('US hits Iranian tankers', 'Anriss', 'kannst du das nicht herausfinden?',
      { GROQ_KEY: 'test' }, 'de', null,
      [{ frage: 'welches warship?', antwort: 'Steht nicht in der Meldung.' }]);

    // Ohne den Bezug beantwortet das Modell eine andere Frage - genau das war
    // beim Nutzer zu sehen.
    assert.match(gesendet, /BISHER/);
    assert.match(gesendet, /welches warship\?/);
    assert.match(gesendet, /Steht nicht in der Meldung\./);
  } finally {
    globalThis.fetch = echt;
  }
});

/*
 * Erfundene Zahlen dürfen nicht durchgehen.
 *
 * Anlass war eine erfundene Person: Aus "Merz" machte das Modell
 * "Bundeskanzler Olaf Merkel", aus einem "Vorfall" einen "Absturz". Namen
 * lassen sich maschinell schlecht prüfen — die Antwort ist deutsch, die
 * Vorlage englisch, und im Deutschen ist jedes Substantiv groß geschrieben.
 * Zahlen überstehen die Übersetzung dagegen unverändert, und eine erfundene
 * Zahl ist in einem Handelswerkzeug das Gefährlichste, was herauskommen kann.
 */
test('Eine Zahl, die nicht in der Vorlage steht, verwirft den Inhaltssatz', async () => {
  const echt = globalThis.fetch;
  try {
    groqVortaeuschen({
      richtung: 'bearish', staerke: 0.5,
      inhalt: 'Die Notenbank senkte den Zins um 75 Basispunkte.',
      grund: 'Zinskanal.',
    });
    const d = await deuten('Fed signals a rate cut', { GROQ_KEY: 'test' }, 'Officials hinted at easing.');

    // Das Urteil bleibt - es ist eine Einschaetzung, keine Tatsachenbehauptung.
    assert.equal(d.richtung, 'bearish');
    // Der Satz mit der erfundenen 75 nicht.
    assert.equal(d.inhalt, '', 'erfundene Zahl haette verworfen werden muessen');
  } finally { globalThis.fetch = echt; }
});

test('Zahlen aus der Vorlage bleiben stehen', async () => {
  const echt = globalThis.fetch;
  try {
    groqVortaeuschen({
      richtung: 'bearish', staerke: 0.5,
      inhalt: 'Die Beschaeftigung stieg um 162.000 Stellen, mehr als erwartet.',
      grund: 'Starke Daten.',
    });
    const d = await deuten('US payrolls rose 162,000 in August',
      { GROQ_KEY: 'test' }, 'Much more than the 110,000 expected.');
    assert.match(d.inhalt, /162/);
  } finally { globalThis.fetch = echt; }
});

/*
 * Ein "keine Marktrelevanz" der KI muss ein schwaches Regelsignal aufheben.
 *
 * Vorher konnte nur eine Gegenrichtung widersprechen. Damit gewann bei jedem
 * Fehlalarm des Regelwerks das bloße Wort: "Can AfD form Germany's first
 * far-right state government" stand auf bearish −0,36, weil eine Regel
 * "Eskalation" gesehen hatte — während das Modell den Satz gelesen und richtig
 * erkannt hatte, dass eine Landtagswahl keinen globalen Risikowert bewegt.
 *
 * Starke Signale bleiben unangetastet: Ein Raketenangriff mit −0,9 wird nicht
 * dadurch harmlos, dass das Modell ihn nicht einordnen konnte.
 */
test('Ein neutrales Urteil hebt schwache Regelsignale auf', () => {
  const neutral = { richtung: 'neutral', staerke: 0 };
  assert.equal(widerspruch(-0.36, neutral), true, 'schwach bearish');
  assert.equal(widerspruch(0.36, neutral), true, 'schwach bullish');
  assert.equal(widerspruch(-0.10, neutral), false, 'zu nah an null');
});

test('Starke Regelsignale ueberstehen ein neutrales Urteil', () => {
  const neutral = { richtung: 'neutral', staerke: 0 };
  assert.equal(widerspruch(-0.90, neutral), false, 'Raketenangriff');
  assert.equal(widerspruch(0.70, neutral), false, 'starker ETF-Zufluss');
});

test('Ein Fehlschlag der KI hebt nichts auf', () => {
  assert.equal(widerspruch(-0.36, { fehler: 'Groq 429' }), false);
  assert.equal(widerspruch(-0.36, null), false);
});
