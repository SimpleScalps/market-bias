/*
 * Welcher Rubrik gehört eine Meldung an — Sport, Unterhaltung, Lebensart?
 *
 * Warum das eine eigene Stufe ist und kein weiteres Stichwort im Regelwerk:
 * Ein Spielbericht ist nicht deshalb harmlos, weil zufällig kein Signalwort
 * darin steht, sondern weil er zu einer Sorte Text gehört, die den Markt
 * grundsätzlich nicht bewegt. "Video shows damaged Amazon cargo plane after
 * crash" feuerte "Kurssturz", weil das Regelwerk Wörter liest und keine
 * Rubriken kennt. Wer die Rubrik zuerst bestimmt, muss den Einzelfall
 * hinterher nicht mehr abfangen — und spart der KI die Prüfung gleich mit.
 *
 * Zwei Wege, in dieser Reihenfolge:
 *
 *   1. Der Pfad in der Adresse. Redaktionen sortieren ihre Texte selbst;
 *      "/sports/" ist eine Aussage der Redaktion und kein Ratespiel.
 *   2. Der Wortschatz im Titel. Nötig, weil Google News nur eine
 *      Weiterleitungsadresse liefert — der wahre Pfad steht dort nirgends,
 *      und über diesen Weg kommt gut ein Viertel des Bestands herein.
 *
 * Der Wortschatz ist bewusst eng gehalten. Aufgenommen wird nur, was im
 * Wirtschaftsteil nicht vorkommt: "NFL" ja, "league" nein; "head coach" ja,
 * "manager" nein; "innings" ja, "season" nein. Ein Fehlalarm hier wirft eine
 * marktbewegende Meldung weg — das wiegt schwerer als ein durchgerutschter
 * Spielbericht, den die Bewertung ohnehin auf neutral setzt.
 */

// Pfade, die die Redaktion selbst vergeben hat.
const PFAD = [
  [/\/sports?\//i, 'Sport'],
  [/\/(entertainment|celebrity|celebrities|arts|culture|music|film|movies|television)\//i, 'Unterhaltung'],
  [/\/(lifestyle|style|fashion|food|travel|recipes?|wellness|gardening|horoscopes?)\//i, 'Lebensart'],
];

/*
 * Ligen, Wettbewerbe und Titel. "US Open" braucht eine Ausnahme: Ein Satz
 * wie "US open higher" meint die Boerseneroeffnung, nicht das Tennisturnier.
 * Alle mehrteilig oder als Kürzel eindeutig —
 * "Cup" allein steht auch im Kaffeegeschäft, "Champions League" nicht.
 */
const SPORT_WETTBEWERB = /\b(nfl|nba|mlb|nhl|ncaa|wnba|mls|uefa|fifa|motogp|nascar|formula one|formula 1|f1)\b|\b(premier league|champions league|europa league|bundesliga|la liga|serie a|ligue 1|copa (america|libertadores|del rey)|world series|stanley cup|ryder cup|walker cup|davis cup|super bowl|wimbledon|roland garros|us open(?! (higher|lower|up|down|mixed|flat|for business))|australian open|french open|grand prix|tour de france|ballon d'?or|world championships?)\b/i;

/*
 * Fachwörter, die es nur im Sport gibt. Bewusst nicht dabei: strike, rally,
 * record, match, goal, season, manager, coach, striker — jedes davon hat im
 * Wirtschaftsteil eine eigene, häufige Bedeutung.
 */
const SPORT_FACH = /\b(touchdowns?|quarterbacks?|home runs?|innings?|no-hitter|bullpen|shutouts?|playoffs?|quarter-?finals?|semi-?finals?|penalty shoot-?out|midfielders?|goalkeepers?|free agents?|draft picks?|doubleheader|pole position|transfer window|head coach|sporting director|batting|pitchers?|golfers?|peloton|walk-?off)\b/i;

// Verletzungs- und Kadermeldungen: im Sport ein eigenes Genre.
const SPORT_KADER = /\b(out for (the )?season|on the (injured list|il)\b|placed? on the il|hamstring|torn acl|sidelined with|called? up .{0,20}\bprospect|day-to-day)\b/i;

// Spielstände. "1-1 draw", "stun U.S. to win" — im Wirtschaftsteil unbekannt.
const SPORT_STAND = /\b\d{1,3}-\d{1,3}\s+(draw|win|victory|defeat|loss|lead)\b|\bin (extra time|overtime|the shootout)\b/i;

const UNTERHALTUNG = /\b(box office|grammys?|oscars?|academy awards?|emmys?|golden globes?|cannes|sundance|red carpet|season finale|tour dates|chart-topping)\b/i;

const LEBENSART = /\b(recipes?|restaurant review|fashion week|met gala|horoscopes?|gardening|beauty tips|dating apps?)\b/i;

/*
 * Was gar keine Meldung ist.
 *
 * Google News liefert zur Reuters-Abfrage auch Kursabrufseiten
 * ("PBAM.O - | Stock Price & Latest News"), Rubrikseiten ("Latam - Reuters")
 * und Einträge, deren Titel nur aus einem Servernamen besteht
 * ("- rmb.reuters.com"). Alle drei landeten als vollwertige Meldungen im
 * Bestand, wurden mitgezählt und von der KI geprüft.
 */
const UNSINN = [
  /\bstock price\b.{0,12}\blatest news\b/i,
  /^\s*[-–]\s*[a-z0-9.-]+\.(com|net|org|co\.uk)\s*$/i,
  /^[a-z0-9.-]+\.(com|net|org)\s*$/i,
  /^(latam|world|markets|business|sports|video|live|breaking news)\s*(-\s*reuters)?\s*$/i,
];

/**
 * Bestimmt die Rubrik einer Meldung.
 * Gibt den Namen der Rubrik zurück oder null, wenn keine zutrifft.
 */
export function rubrik(title = '', url = '') {
  const t = String(title);
  const u = String(url);

  if (!t.trim() || t.trim().length < 12) return 'Unsinn';
  if (UNSINN.some((re) => re.test(t.trim()))) return 'Unsinn';

  // Der Pfad der Redaktion wiegt schwerer als jedes geratene Stichwort.
  for (const [re, name] of PFAD) if (re.test(u)) return name;

  if (SPORT_WETTBEWERB.test(t) || SPORT_FACH.test(t) || SPORT_KADER.test(t) || SPORT_STAND.test(t)) return 'Sport';
  if (UNTERHALTUNG.test(t)) return 'Unterhaltung';
  if (LEBENSART.test(t)) return 'Lebensart';
  return null;
}
