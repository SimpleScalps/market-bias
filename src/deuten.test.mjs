import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alsWert, widerspruch } from '../worker/deuten.mjs';

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
