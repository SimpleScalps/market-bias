/*
 * Den Artikeltext holen — nur auf Nachfrage.
 *
 * Bis hierher kannte das Sprachmodell nur die Schlagzeile und den Anriss aus
 * dem Feed, also ein bis zwei Saetze. Auf die Frage, welches Kriegsschiff wann
 * von wem angegriffen wurde, konnte es deshalb nur antworten, dass das nicht
 * dasteht — richtig, aber unbefriedigend, denn im Artikel steht es sehr wohl.
 *
 * Der Abruf laeuft ausdruecklich nicht automatisch. Bei rund 240 Meldungen am
 * Tag waeren das 240 zusaetzliche Abrufe und ein Vielfaches an Token, fuer
 * Text, den fast niemand liest. Wer eine Frage stellt, liest dagegen mit
 * Sicherheit — dort lohnt es sich.
 */

/*
 * Hoechstens so viel HTML wird gelesen.
 *
 * Der erste Wert war 400.000 und damit zu klein: Die CNBC-Seite ist 811.857
 * Zeichen lang und ihr <body> beginnt erst bei 600.896. Gelesen wurde also
 * ausschliesslich der Kopf - das Modell bekam ein Stylesheet vorgesetzt,
 * beginnend mit '@charset "UTF-8"'. Bezeichnend: Es fiel nicht auf, weil
 * "Text gefunden" und "brauchbarer Text gefunden" dasselbe Ergebnis liefern.
 */
const HTML_MAX = 1_600_000;

/*
 * So viel HTML wird nach dem Zuschnitt noch durchsucht.
 *
 * Der Zuschnitt auf <body> nimmt den Loewenanteil schon weg. Was dann noch
 * bleibt, begrenzt den Aufwand der Ausdruecke - auf dem kostenlosen Tarif ist
 * Rechenzeit die knappere Ware als Speicher.
 */
const RUMPF_MAX = 300_000;

/** So viel Text bekommt das Modell hoechstens. Rund 1.500 Token. */
export const TEXT_MAX = 6000;

/*
 * Bereiche, die nie zum Artikel gehoeren.
 *
 * Ohne sie bestuende die Haelfte des Textes aus Navigation, Zustimmungs-
 * bannern und "Das koennte Sie auch interessieren" — Text, der Token kostet
 * und die Antwort verwaessert.
 */
const RAUS = /<(script|style|nav|header|footer|aside|form|noscript|svg|iframe)[\s>][\s\S]*?<\/\1>/gi;

/*
 * Ein Absatz, und zwar nur <p> - nicht <pre> oder <picture>.
 *
 * Die Wortgrenze ist hier bewusst als Vorschau geschrieben und nicht als \b:
 * Diese Dateien werden von Hilfsskripten bearbeitet, und die haben aus einer
 * solchen Folge schon mehrfach ein Steuerzeichen gemacht. Das faellt weder
 * dem Syntaxpruefer noch den Tests auf, weil der Ausdruck gueltig bleibt und
 * nur nichts mehr trifft - genau so ist diese Funktion einmal still
 * ausgefallen.
 */
const ABSATZ = /<p(?=[\s>])[^>]*>([\s\S]*?)<\/p>/gi;

/** Die wenigen Entitaeten, die in Nachrichtentexten wirklich vorkommen. */
const ENTITAETEN = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', hellip: '…',
  lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
};

function entschluesseln(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&(\w+);/g, (t, name) => ENTITAETEN[name.toLowerCase()] ?? t);
}

/** Nimmt die Auszeichnung heraus und glaettet die Leerraeume. */
function flach(teil, mehrzeilig = false) {
  const t = entschluesseln(String(teil).replace(/<[^>]+>/g, ' '));
  return (mehrzeilig
    ? t.replace(/[^\S\n]+/g, ' ').replace(/\n\s*\n\s*/g, '\n')
    : t.replace(/\s+/g, ' ')).trim();
}

/**
 * Schaelt den Fliesstext aus einer HTML-Seite.
 *
 * Bevorzugt <article>, dann <main>, sonst der Rumpf. Das ist keine
 * vollstaendige Auszeichnungsanalyse und soll auch keine sein: Es genuegt,
 * dass die Saetze in der richtigen Reihenfolge herauskommen.
 */
export function textAusHtml(html) {
  let h = String(html || '');

  /*
   * Zuerst den Kopf abschneiden, und zwar ohne Ausdruck.
   *
   * indexOf ist hier hundertfach billiger als ein Ausdruck ueber die ganze
   * Seite - und es loest zugleich das eigentliche Problem: Im <head> steht
   * bei grossen Nachrichtenseiten ein Stylesheet von mehreren hunderttausend
   * Zeichen, das sonst alles Weitere ueberdeckt.
   */
  const rumpf = h.indexOf('<body');
  if (rumpf > -1) h = h.slice(rumpf);
  if (h.length > RUMPF_MAX) h = h.slice(0, RUMPF_MAX);

  h = h.replace(RAUS, ' ');

  const bereich = h.match(/<article(?=[\s>])[^>]*>([\s\S]*?)<\/article>/i)
    || h.match(/<main(?=[\s>])[^>]*>([\s\S]*?)<\/main>/i)
    || h.match(/<body(?=[\s>])[^>]*>([\s\S]*?)<\/body>/i);
  if (bereich) h = bereich[1];

  /*
   * Zuerst nur die Absaetze.
   *
   * CNBC lieferte beim ersten Versuch 397.926 Zeichen - die ganze Seite samt
   * eingebetteter Daten. Auf die ersten paar tausend Zeichen beschnitten waere
   * davon Navigationsgeruest beim Modell angekommen und kein Wort des
   * Artikels. Nachrichtentexte stehen aber praktisch immer in <p>; Menues,
   * Listen und eingebettetes JSON stehen es nicht.
   *
   * Kurze Absaetze fallen weg: Bildunterschriften, "Lesen Sie auch",
   * Datumszeilen. Vierzig Zeichen trennen das zuverlaessig von echten Saetzen.
   */
  const absaetze = [...h.matchAll(ABSATZ)]
    .map((m) => flach(m[1]))
    .filter((t) => t.length >= 40);

  const ausAbsaetzen = absaetze.join('\n');
  if (ausAbsaetzen.length >= 400) return ausAbsaetzen;

  // Keine brauchbaren Absaetze - dann eben der ganze Bereich.
  return flach(h
    // Absatzgrenzen erhalten, sonst laufen Saetze ineinander.
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n'), true);
}

/**
 * Holt den Artikel und gibt seinen Text zurueck.
 *
 * Bei jedem Fehlschlag kommt `{ fehler }` — nie eine Ausnahme. Ein Artikel,
 * der sich nicht abrufen laesst, darf die Frage nicht mitreissen: Schlagzeile
 * und Anriss stehen ja weiterhin zur Verfuegung.
 */
export async function artikelHolen(url) {
  let ziel;
  try {
    ziel = new URL(String(url));
  } catch {
    return { fehler: 'unbrauchbare Adresse' };
  }
  if (ziel.protocol !== 'https:' && ziel.protocol !== 'http:') {
    return { fehler: 'nur http und https' };
  }

  try {
    const res = await fetch(ziel.href, {
      redirect: 'follow',
      headers: {
        // Ohne Kennung antworten manche Seiten mit 403.
        'user-agent': 'Mozilla/5.0 (compatible; MarketBias/1.0)',
        'accept': 'text/html,application/xhtml+xml',
        'accept-language': 'en,de;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return { fehler: `Abruf ${res.status}` };

    const art = res.headers.get('content-type') || '';
    if (art && !/text\/html|xhtml|text\/plain/i.test(art)) {
      return { fehler: `unerwartetes Format (${art.split(';')[0]})` };
    }

    const html = (await res.text()).slice(0, HTML_MAX);
    const text = textAusHtml(html);

    /*
     * Zu wenig Text heisst fast immer: Zustimmungsbanner oder Bot-Sperre.
     * Dann ist es ehrlicher, nichts zu liefern, als drei Zeilen Rechtstext
     * als Artikel auszugeben.
     */
    if (text.length < 400) return { fehler: 'kein Artikeltext gefunden' };

    return { text: text.slice(0, TEXT_MAX), laenge: text.length };
  } catch (err) {
    return { fehler: err.name === 'TimeoutError' ? 'Abruf dauerte zu lange' : err.message.slice(0, 120) };
  }
}
