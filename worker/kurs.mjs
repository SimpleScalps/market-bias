/*
 * Der Rueckkanal vom Markt.
 *
 * Alles andere in diesem Projekt ist Vorhersage: Das Regelwerk liest Woerter,
 * das Modell liest Saetze, und beide sagen, wohin der Kurs gehen sollte. Was
 * bisher fehlte, ist die einzige Instanz, die es wirklich weiss - der Kurs
 * selbst. Ohne ihn laesst sich eine Regel nur daran messen, ob sie plausibel
 * klingt.
 *
 * Gemessen wird die Bewegung von BTCUSDT in den fuenfzehn Minuten nach dem
 * Eingang der Meldung. Nicht nach ihrem Erscheinen: Was vor dem Eingang
 * passiert ist, haette niemand handeln koennen. Die Zahl sagt also nicht
 * "hatte die Meldung Wirkung", sondern "haette man damit etwas anfangen
 * koennen" - und das ist die Frage, um die es hier geht.
 *
 * Fuenfzehn Minuten Bitcoin sind zum grossen Teil Rauschen. Eine einzelne
 * Zeile beweist deshalb nichts; erst ein paar Dutzend Faelle je Signal ergeben
 * ein Bild. Genau deshalb wird gezaehlt statt geschaetzt.
 */

const MINUTE = 60_000;

/*
 * Zwei Boersen, in dieser Reihenfolge.
 *
 * Binance ist der tiefste Markt und liefert genau so viele Kerzen, wie
 * angefragt werden - achthundert Byte statt zwanzig Kilobyte. Coinbase
 * antwortet schneller und ist nirgends gesperrt, schickt aber immer
 * dreihundert Kerzen. Als Ausweichquelle ist das in Ordnung.
 */
const BINANCE = 'https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1m&limit=';
const COINBASE = 'https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60';

const KOPF = { 'user-agent': 'Mozilla/5.0 (compatible; MarketBias/1.0)' };

/** Auf die volle Minute abgerundet - der Schluessel im Kerzenverzeichnis. */
export const aufMinute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

/**
 * Holt die Schlusskurse der letzten `minuten` Minuten.
 *
 * Zurueck kommt eine Map von Minutenbeginn auf Schlusskurs, oder `{ fehler }`.
 * Eine Ausnahme wirft die Funktion nie: Faellt die Boerse aus, soll der
 * Durchgang weiterlaufen - die Messung holt der naechste nach.
 */
export async function kerzenHolen(minuten = 100) {
  const grenze = Math.max(2, Math.min(1000, Math.round(minuten)));

  try {
    const res = await fetch(BINANCE + grenze, { headers: KOPF, signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const roh = await res.json();
      if (Array.isArray(roh) && roh.length) {
        const map = new Map();
        for (const k of roh) map.set(aufMinute(Number(k[0])), Number(k[4]));
        return { kerzen: map, boerse: 'binance' };
      }
    }
  } catch { /* weiter zur Ausweichquelle */ }

  try {
    const res = await fetch(COINBASE, { headers: KOPF, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { fehler: `Coinbase ${res.status}` };
    const roh = await res.json();
    if (!Array.isArray(roh) || !roh.length) return { fehler: 'Coinbase ohne Kerzen' };
    const map = new Map();
    // [Zeit in Sekunden, tief, hoch, offen, schluss, Menge]
    for (const k of roh) map.set(aufMinute(Number(k[0]) * 1000), Number(k[4]));
    return { kerzen: map, boerse: 'coinbase' };
  } catch (err) {
    return { fehler: err.name === 'TimeoutError' ? 'Kursabruf dauerte zu lange' : String(err.message).slice(0, 90) };
  }
}

/**
 * Der Schlusskurs zu einem Zeitpunkt, notfalls aus einer Nachbarminute.
 *
 * Eine einzelne fehlende Kerze - die Boerse liefert sie gelegentlich nicht -
 * darf die Messung nicht verwerfen. Zwei Minuten Toleranz sind bei einer
 * Viertelstunde Messfenster unerheblich.
 */
function kursBei(kerzen, ms, toleranz = 2) {
  const start = aufMinute(ms);
  for (let i = 0; i <= toleranz; i++) {
    const a = kerzen.get(start + i * MINUTE);
    if (a) return a;
    const b = kerzen.get(start - i * MINUTE);
    if (b) return b;
  }
  return null;
}

/**
 * Wie weit sich der Kurs zwischen `vonMs` und `vonMs + minuten` bewegt hat.
 * In Prozent, oder null, wenn eine der beiden Kerzen fehlt.
 */
export function bewegung(kerzen, vonMs, minuten = 15) {
  const a = kursBei(kerzen, vonMs);
  const b = kursBei(kerzen, vonMs + minuten * MINUTE);
  if (!a || !b) return null;
  return +(((b - a) / a) * 100).toFixed(3);
}

/**
 * Fuehrt die Bilanz je Merkmal fort.
 *
 * Gezaehlt wird `bewegung * vorzeichen`: positiv heisst, der Kurs ging in die
 * vorhergesagte Richtung. So bleibt ein einziges Feld aussagekraeftig, ohne
 * dass bullish und bearish getrennt gefuehrt werden muessten.
 */
export function bilanzAddieren(bisher, merkmale, bewegungProzent, vorzeichen) {
  const neu = { ...(bisher || {}) };
  const punkt = bewegungProzent * vorzeichen;
  for (const m of merkmale) {
    const e = neu[m] || { n: 0, treffer: 0, summe: 0 };
    neu[m] = {
      n: e.n + 1,
      treffer: e.treffer + (punkt > 0 ? 1 : 0),
      summe: +(e.summe + punkt).toFixed(3),
    };
  }
  return neu;
}
