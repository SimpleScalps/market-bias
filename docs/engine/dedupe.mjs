// Dieselbe Meldung läuft oft über fünf Portale. CryptoPanic fasst solche
// Duplikate zu einem Eintrag mit Quellenzähler zusammen; das macht diese
// Funktion ebenso, damit der Feed nicht von einer Nachricht geflutet wird.
//
// Die frühere Fassung verglich die sechs längsten Wörter einer Überschrift und
// verlangte, dass sie exakt übereinstimmen. Das griff praktisch nie: Von 283
// Meldungen im Bestand war keine einzige als Dublette erkannt, obwohl dieselbe
// Nachricht drei- und viermal darin stand.
//
//   Zcash tops $1,000 as ETF inflows ramp up and miners pile in
//   Zcash Hits Highest Price in Nearly a Decade, Crushing Short Bets
//
// Beide meinen dasselbe und teilen außer "Zcash" kein einziges der prägenden
// Wörter. Verglichen wird deshalb jetzt die Überlappung: Wie viel des
// kleineren Wortschatzes steckt auch im größeren.

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'as', 'at', 'by',
  'from', 'is', 'are', 'was', 'were', 'be', 'been', 'has', 'have', 'had', 'will', 'says',
  'said', 'after', 'over', 'into', 'amid', 'its', 'it', 'that', 'this', 'new', 'more',
  'than', 'up', 'down', 'vs', 'how', 'far', 'can', 'not', 'but', 'least', 'best',
  'right', 'now', 'could', 'would', 'may', 'might', 'about', 'their', 'them',
  'der', 'die', 'das', 'und', 'von', 'mit', 'für', 'auf', 'im', 'ist', 'nach', 'bei',
]);

/*
 * Die Schwellen sind an echten Schlagzeilen ausgemessen, nicht geschätzt.
 *
 * Bei 0,5 und drei gemeinsamen Wörtern verschmolzen "US envoys arrive in
 * Moscow ahead of Ukraine talks" und "At least 5 killed in Russian attacks on
 * Ukraine" — Friedensgespräche und Angriffe, das Gegenteil voneinander. Bei
 * 0,6 und vier fällt dieses Paar heraus, während "US envoys arrive in Moscow"
 * und "Trump envoys arrive in Moscow" zusammenbleiben.
 *
 * Die Mindestzahl an Wörtern verhindert den anderen Fehler: "Best Biotech
 * Stocks Right Now" und "Best Oil Stocks Right Now" behalten nach Abzug der
 * Füllwörter zu wenig, um sie auseinanderhalten zu können — solche Titel
 * bleiben lieber getrennt.
 */
const SCHWELLE = 0.6;
const MIN_GEMEINSAM = 4;
const MIN_WOERTER = 4;

/*
 * Viele gemeinsame Woerter wiegen schwerer als ein guter Anteil.
 *
 * Die Quote schuetzt kurze Ueberschriften: Bei fuenf Woertern sind drei
 * gemeinsame noch keine Dublette. Bei langen dreht sie sich gegen die Sache -
 * die beiden Anleihe-Schlagzeilen oben teilen sechs Woerter und kommen wegen
 * ihrer Laenge trotzdem nur auf 0,55. Sechs uebereinstimmende Begriffe sind
 * fuer sich genommen schon ein Beweis.
 */
const STARK_GEMEINSAM = 6;

/*
 * Wortstamm statt Wortform.
 *
 * Verglichen wurden bisher die Woerter, wie sie dastehen. "yield" und
 * "yields" galten damit als verschiedene Woerter, "high" und "highest"
 * ebenso - und zwei Fassungen derselben Nachricht standen doppelt in der
 * Liste:
 *
 *   10-year Treasury yield tops 4.9%, highest since 2023, as oil surge ...
 *   Treasury yields rise to multi-year highs as surging oil outweighs ...
 *
 * Zwei gemeinsame Woerter waren es vorher, sechs sind es mit den Staemmen.
 *
 * Die Regeln sind bewusst grob: Ein Stammformer, der zu viel weiss, verbindet
 * am Ende Woerter, die nichts miteinander zu tun haben. Diese hier schneiden
 * nur die haeufigsten Endungen ab, und beide Seiten des Vergleichs werden
 * gleich behandelt - was hier zusammenfaellt, faellt ueberall zusammen.
 */
const stamm = (w) => w
  .replace(/ies$/, 'y')
  .replace(/(sses|shes|ches|xes)$/, (m) => m.slice(0, -2))
  .replace(/([^s])s$/, '$1')
  .replace(/(est|ing|ed)$/, '')
  .replace(/e$/, '');

/** Bedeutungstragende Wortstämme einer Überschrift, ab vier Zeichen. */
export function woerter(title) {
  const roh = String(title || '').toLowerCase().match(/[a-zäöüß0-9]{4,}/g) || [];
  return new Set(roh.filter((w) => !STOP.has(w)).map(stamm));
}

/** Schlüssel aus denselben Wörtern — für Aufrufer, die einen Text erwarten. */
export function signature(title) {
  return [...woerter(title)].sort().join('|');
}

/**
 * Widersprechen sich zwei Meldungen?
 *
 * Zwei Texte können sich stark überlappen und trotzdem Gegenteiliges sagen —
 * "Dovish hold may follow" und "September hike path" etwa. Sie zu einem
 * Eintrag zu verschmelzen hieße, eine der beiden Aussagen zu unterschlagen.
 */
/*
 * Woerter, die einander ausschliessen.
 *
 * Zwei Schlagzeilen koennen bis auf ein Wort gleich lauten und das Gegenteil
 * sagen: "record inflows" gegen "record outflows", "Fed cuts rates" gegen
 * "Fed hikes rates". Ueber die Wortueberlappung sind sie fast identisch, und
 * seit Staemme verglichen werden und viele gemeinsame Woerter fuer sich
 * zaehlen, reichte das zum Verschmelzen.
 *
 * gegensatz() faengt das nur ab, wenn die Bewertung bereits verschiedene
 * Vorzeichen traegt. Genau daran fehlt es hier: Bei einer Meldung ohne
 * Wertung steht auf beiden Seiten null.
 *
 * Die Paare stehen als Wortstamm da, so wie sie verglichen werden.
 */
const GEGENWORT = [
  ['inflow', 'outflow'], ['cut', 'hik'], ['ris', 'fall'], ['gain', 'loss'],
  ['surg', 'plung'], ['rally', 'crash'], ['approv', 'reject'], ['win', 'los'],
  ['open', 'clos'], ['rais', 'lower'], ['grow', 'shrink'], ['buy', 'sell'],
  ['bullish', 'bearish'], ['ceasefir', 'offensiv'],
];

/** Sagen die beiden Überschriften einander widersprechende Dinge? */
function gegenwoerter(a, b) {
  for (const [x, y] of GEGENWORT) {
    if ((a.has(x) && b.has(y)) || (a.has(y) && b.has(x))) return true;
  }
  return false;
}

function gegensatz(a, b) {
  const x = a.scores?.crypto ?? 0;
  const y = b.scores?.crypto ?? 0;
  return x * y < 0 && Math.abs(x) >= 0.2 && Math.abs(y) >= 0.2;
}

/**
 * Fasst Duplikate zusammen. Behalten wird der Eintrag mit der höchsten
 * Relevanz; die übrigen Quellen werden als `alsoIn` vermerkt.
 */
export function dedupe(items) {
  const gruppen = [];

  /*
   * Wortverzeichnis statt jeder-gegen-jeden.
   *
   * Bei dreihundert Meldungen sind das sonst 45.000 Mengenvergleiche - im
   * Test 24 Millisekunden, und der Worker hat davon nur zehn. Über das
   * Verzeichnis kommen nur Gruppen in Frage, die mindestens ein Wort teilen;
   * das sind je Meldung eine Handvoll statt aller.
   */
  const wortIndex = new Map();   // Wort -> Menge von Gruppennummern

  for (const n of items) {
    const eigene = woerter(n.title);

    let treffer = null;
    if (eigene.size >= MIN_WOERTER) {
      // Gemeinsame Wörter je Kandidat zählen, in einem Durchgang.
      const zaehler = new Map();
      for (const w of eigene) {
        const stellen = wortIndex.get(w);
        if (!stellen) continue;
        for (const i of stellen) zaehler.set(i, (zaehler.get(i) || 0) + 1);
      }

      for (const [i, gemeinsam] of zaehler) {
        if (gemeinsam < MIN_GEMEINSAM) continue;
        const g = gruppen[i];
        if (g.woerter.size < MIN_WOERTER) continue;
        if (gemeinsam < STARK_GEMEINSAM
            && gemeinsam / Math.min(eigene.size, g.woerter.size) < SCHWELLE) continue;
        if (gegensatz(n, g.eintrag)) continue;
        if (gegenwoerter(eigene, g.woerter)) continue;

        treffer = g;
        break;
      }
    }

    if (!treffer) {
      const nummer = gruppen.length;
      gruppen.push({ nummer, woerter: eigene, eintrag: { ...n, alsoIn: [] } });
      for (const w of eigene) {
        if (!wortIndex.has(w)) wortIndex.set(w, new Set());
        wortIndex.get(w).add(nummer);
      }
      continue;
    }

    const bisher = treffer.eintrag;
    /*
     * Bei gleicher Relevanz entscheidet die Kennung, nicht die Reihenfolge.
     *
     * Sonst gewinnt mal die eine, mal die andere Fassung - je nachdem, welche
     * in diesem Durchgang zuerst kam. Beide Kennungen bleiben dann im Bestand,
     * jede mit der anderen als Zweitquelle, und in der Liste steht dieselbe
     * Meldung zweimal. Gemessen: elf solcher Paare gleichzeitig, darunter
     * dreimal dieselbe Al-Jazeera-Meldung ueber zwei Feeds.
     */
    const besser = (n.priority ?? 0) - (bisher.priority ?? 0)
      || String(bisher.id ?? '').localeCompare(String(n.id ?? ''));
    const sieger = besser > 0 ? n : bisher;
    const verlierer = sieger === n ? bisher : n;

    const quellen = [...new Set([...(bisher.alsoIn || []), ...(n.alsoIn || []), verlierer.source])]
      .filter((s) => s !== sieger.source);

    // Der Zeitpunkt der frühesten Meldung zählt, nicht der des ausführlichsten
    // Artikels. Wer handelt, will wissen, wann die Nachricht zuerst draußen
    // war — nicht, wann die dritte Redaktion nachgezogen hat.
    const frueheste = new Date(bisher.date) <= new Date(n.date) ? bisher.date : n.date;

    treffer.eintrag = { ...sieger, date: frueheste, alsoIn: quellen };

    // Der Wortschatz der Gruppe wächst mit: Eine vierte Fassung derselben
    // Nachricht findet so eher Anschluss.
    const { nummer } = treffer;
    for (const w of eigene) {
      treffer.woerter.add(w);
      if (!wortIndex.has(w)) wortIndex.set(w, new Set());
      wortIndex.get(w).add(nummer);
    }
  }

  return gruppen.map((g) => g.eintrag);
}
