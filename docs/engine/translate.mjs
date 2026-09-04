// Übersetzung der Schlagzeilen ins Deutsche.
//
// Die Feeds liefern englische Titel. Kalendereinträge baut die Pipeline selbst
// zweisprachig — dort ist die Fassung exakt. Für echte Schlagzeilen wird ein
// Übersetzungsdienst genutzt, mit dauerhaftem Zwischenspeicher: Ein einmal
// übersetzter Titel wird nie erneut angefragt. Schlägt der Dienst fehl, bleibt
// der englische Titel stehen — die Bewertung selbst ist davon nicht betroffen,
// weil sie auf dem Originaltext arbeitet.

const MYMEMORY = 'https://api.mymemory.translated.net/get';
const DEEPL = 'https://api-free.deepl.com/v2/translate';

/** DeepL, falls ein Schlüssel hinterlegt ist — deutlich bessere Qualität. */
async function viaDeepL(texte, key) {
  const res = await fetch(DEEPL, {
    method: 'POST',
    headers: {
      'Authorization': `DeepL-Auth-Key ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text: texte, source_lang: 'EN', target_lang: 'DE' }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`DeepL ${res.status}`);
  const j = await res.json();
  return j.translations.map((t) => t.text);
}

/** MyMemory braucht keinen Schlüssel, verlangt aber Einzelanfragen. */
async function viaMyMemory(text, email) {
  const p = new URLSearchParams({ q: text, langpair: 'en|de' });
  if (email) p.set('de', email);        // hebt das Tageskontingent auf 50.000 Zeichen
  const res = await fetch(`${MYMEMORY}?${p}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`MyMemory ${res.status}`);
  const j = await res.json();
  const out = j?.responseData?.translatedText;
  if (!out || /MYMEMORY WARNING|QUOTA/i.test(out)) throw new Error('Kontingent erschöpft');
  return out;
}

const istEnglisch = (s) => /[a-z]/i.test(s) && !/[äöüßÄÖÜ]/.test(s);

/**
 * Übersetzt fehlende Titel und ergänzt den Zwischenspeicher.
 *
 * @param items   Meldungen; jede bekommt bei Erfolg ein Feld `titleDe`
 * @param cache   Objekt { originaltitel: übersetzung }, wird ergänzt
 * @param opts    { max, deeplKey, email }
 * @returns       { uebersetzt, fehler }
 */
export async function translateTitles(items, cache = {}, opts = {}) {
  const { max = 40, deeplKey = '', email = '' } = opts;

  // Kalendereinträge tragen ihre deutsche Fassung schon selbst.
  const offen = [];
  for (const n of items) {
    if (n.titleDe) continue;
    if (cache[n.title]) { n.titleDe = cache[n.title]; continue; }
    if (istEnglisch(n.title)) offen.push(n);
  }

  if (!offen.length) return { uebersetzt: 0, fehler: null };

  // Die wichtigsten zuerst — bei knappem Kontingent zählt die Reihenfolge.
  offen.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const arbeit = offen.slice(0, max);

  let uebersetzt = 0;
  let fehler = null;

  if (deeplKey) {
    try {
      const ergebnis = await viaDeepL(arbeit.map((n) => n.title), deeplKey);
      arbeit.forEach((n, i) => {
        if (!ergebnis[i]) return;
        n.titleDe = ergebnis[i];
        cache[n.title] = ergebnis[i];
        uebersetzt++;
      });
      return { uebersetzt, fehler };
    } catch (err) {
      fehler = `DeepL: ${err.message}`;   // weiter mit MyMemory
    }
  }

  for (const n of arbeit) {
    try {
      const de = await viaMyMemory(n.title, email);
      n.titleDe = de;
      cache[n.title] = de;
      uebersetzt++;
    } catch (err) {
      fehler = err.message;
      break;                              // Kontingent oder Dienst weg: abbrechen
    }
  }

  return { uebersetzt, fehler };
}

/** Hält den Zwischenspeicher klein, damit die Datei nicht unbegrenzt wächst. */
export function trimCache(cache, max = 4000) {
  const keys = Object.keys(cache);
  if (keys.length <= max) return cache;
  const behalten = keys.slice(-max);
  return Object.fromEntries(behalten.map((k) => [k, cache[k]]));
}
