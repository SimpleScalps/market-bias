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

/** Bedeutungstragende Wörter einer Überschrift, ab vier Zeichen. */
export function woerter(title) {
  const roh = String(title || '').toLowerCase().match(/[a-zäöüß0-9]{4,}/g) || [];
  return new Set(roh.filter((w) => !STOP.has(w)));
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
        if (gemeinsam / Math.min(eigene.size, g.woerter.size) < SCHWELLE) continue;
        if (gegensatz(n, g.eintrag)) continue;

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
    const sieger = (n.priority ?? 0) > (bisher.priority ?? 0) ? n : bisher;
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
