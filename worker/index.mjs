import { collectNews, loadCalendar, enrich, imFenster } from '../docs/engine/feeds.mjs';
import { label, LABEL_TEXT } from '../docs/engine/sentiment.mjs';
import { IMPACT_TEXT, DURATION_TEXT } from '../docs/engine/tradeimpact.mjs';
import { uebersetze } from '../docs/engine/translate.mjs';
import { fortschreiben, TAGE_MAX } from '../docs/engine/wochenbuch.mjs';
import { sendeAn } from './notify.mjs';
export { Versandbuch } from './versandbuch.mjs';
import { deuten, deutenStapel, widerspruch, verfuegbareModelle, tageslage, modellWaehlen, fragen, kontingent, verbrauchAbholen, tagesverbrauch, gewaehlteModelle, ANWEISUNG_STAND } from './deuten.mjs';
import { artikelHolen } from './artikel.mjs';

// Cloudflare Worker: holt die Quellen serverseitig (RSS-Feeds senden keine
// CORS-Header, der Browser kann sie also nicht selbst laden), bewertet sie mit
// derselben Engine wie die App und liefert das Ergebnis mit CORS aus. Der
// Cron-Trigger verschickt dabei Benachrichtigungen — auch dann, wenn die App
// geschlossen ist. Das ist der eigentliche Zweck des Workers.
//
// Rechenzeit: Der Gratisplan erlaubt 10 ms pro Aufruf, alle Feeds zusammen
// brauchen rund 19 ms. Deshalb arbeitet der Cron rollierend eine Gruppe pro
// Minute ab (rund 4 ms) und führt das Ergebnis mit dem Bestand zusammen. Der
// Wirtschaftskalender läuft in jedem Durchgang mit, weil NFP und CPI auf die
// Sekunde zählen — er kostet nur 0,4 ms.

const KEY = 'https://market-bias.internal/news';
const ABO_KEY = 'https://market-bias.internal/abo';
const GRUPPEN = 3;
/*
 * Wie oft der Lesepfad den Kalender nachzieht.
 *
 * Frueher stand hier eine Bedingung auf das Alter des abgelegten Bestands -
 * und weil das Nachziehen ihn danach neu ablegte, kostete jeder Abruf, der
 * aelter als zwanzig Sekunden war, einen Schreibvorgang. Bei einer App, die
 * alle zwoelf Sekunden nachfragt, waren das ueber den Tag mehrere Tausend: mit
 * Abstand der groesste Posten, deutlich vor allen Ticks zusammen, und der
 * Grund, warum das Tageskontingent von KV schon am Vormittag erschoepft war.
 *
 * Der Schreibvorgang war ausserdem entbehrlich: collectNews holt den Kalender
 * bei jedem Tick ohnehin mit, er landet also so oder so im Bestand. Der
 * Lesepfad zieht ihn jetzt nur noch fuer die eine Antwort nach und legt nichts
 * ab. Gedrosselt wird ueber einen Zeitstempel im Arbeitsspeicher - der reicht
 * fuer den Zweck und kostet nichts.
 */
const KAL_MS = 45_000;
let kalenderZuletzt = 0;
const BESTAND_TTL = 86_400; // Bestand einen Tag halten, nicht zehn Minuten
const GESEHEN_MAX = 4000;   // Gedächtnis über die Sichtbarkeitsgrenze hinaus
/*
 * Wie viele Meldungen je Durchlauf gegengelesen werden.
 *
 * Die Anfragen laufen nebeneinander, also begrenzt die Zahl auch, wie viele
 * Token in dieselbe Minute fallen. Die kostenlose Stufe erlaubt 8.000; bei
 * rund 1.300 je Antwort sind drei unbedenklich.
 *
 * Warum nicht mehr: In derselben Minute kann jemand in der App auf
 * "Nachfragen" tippen. Fuellt der Nachlauf das Minutenkontingent aus, bekommt
 * der Nutzer eine Absage fuer etwas, das er selbst angestossen hat - das
 * waere die falsche Reihenfolge. Der Nachlauf laeuft im Hintergrund und hat
 * Zeit; er tritt zurueck. Ueber den Tag wacht zusaetzlich KI_TOKEN_MAX.
 */
const GEGENPROBE_MAX = 3;

/*
 * Nachlauf: wie viel je Durchgang, und wie weit die Durchgaenge auseinander.
 *
 * Der Abstand ist der wichtigere Wert. KV gibt einen einmal gelesenen Wert am
 * Rand bis zu eine Minute lang unveraendert zurueck - wer oefter liest,
 * aendert und zurueckschreibt, rechnet auf einem alten Stand und macht die
 * Arbeit des vorigen Durchgangs zunichte. Bei einem Tick je Minute lief der
 * Nachlauf deshalb ins Leere: Das Budget pendelte zwischen zwei Werten, die
 * Zahl der offenen Pruefungen blieb bei siebzig stehen, und die Anfragen an
 * das Modell waren verschenkt.
 *
 * Fuenf Minuten Abstand liegen sicher jenseits dieses Fensters. Der Zeitpunkt
 * des letzten Durchgangs steht im Urteilsspeicher selbst - also in genau dem
 * Eintrag, den der Nachlauf ohnehin schreibt, und damit konsistent zu ihm.
 */
/*
 * Wie zuegig der Bestand nachgezogen wird.
 *
 * Frueher drei Meldungen alle zehn Minuten - fuer den Zulauf reichte das, denn
 * neue Meldungen werden ohnehin sofort geprueft. Als aber alle 82 Urteile
 * wegen verschaerfter Regeln neu zu faellen waren, haette dieser Takt vier
 * einhalb Stunden gebraucht, in denen ein erfundener Name sichtbar blieb.
 *
 * Fuenf alle fuenf Minuten kosten dieselbe Summe - nur schneller. Die Grenze
 * setzt das Minutenkontingent des Modells: fuenf Anfragen zu je rund 830 Token
 * sind gut 4.000 von 8.000 je Minute, es bleibt Luft fuer Uebersetzungen.
 */
const NACHZIEHEN_MAX = 8;
const NACHZIEHEN_ABSTAND_MS = 60_000;

/*
 * Wie oft eine Meldung hoechstens vergeblich geprueft wird.
 *
 * Eine fehlgeschlagene Pruefung liess die Meldung unveraendert - sie galt
 * weiter als offen und wurde beim naechsten Nachlauf erneut angefragt. Da nach
 * Gewicht sortiert wird, kamen immer dieselben zuerst: Zwei Meldungen, die aus
 * welchem Grund auch immer nie durchgingen, blockierten zwanzig Minuten lang
 * jeden Nachlauf und verbrauchten dabei Token, ohne dass die Zahl der
 * geprueften Meldungen stieg.
 *
 * Nach drei Versuchen bleibt die Meldung bei der Bewertung des Regelwerks.
 * Das ist kein Verlust: Die Regelbewertung ist ohnehin die Grundlage, die
 * Zweitmeinung nur die Gegenprobe.
 */
const PRUEF_VERSUCHE_MAX = 3;
const PRUEF_BUCH_MAX = 300;   // Eintraege im Fehlerbuch, damit es nicht waechst

/**
 * Schreibt das Fehlerbuch fort und haelt es klein.
 *
 * Nur Meldungen, die noch im Bestand liegen, bleiben vermerkt - was aus dem
 * 24-Stunden-Fenster gefallen ist, braucht keinen Eintrag mehr. Bleibt es
 * darueber hinaus zu gross, fallen die aeltesten Eintraege heraus.
 */
function fehlerbuchFortschreiben(buch, gescheitert, items) {
  const imBestand = new Set(items.map((n) => n.id));
  const neu = {};
  for (const [id, n] of Object.entries(buch)) if (imBestand.has(id)) neu[id] = n;
  for (const id of gescheitert) neu[id] = (neu[id] || 0) + 1;

  const ids = Object.keys(neu);
  for (const alt of ids.slice(0, Math.max(0, ids.length - PRUEF_BUCH_MAX))) delete neu[alt];
  return neu;
}

/*
 * Tagesbudget fuer das Sprachmodell - gerechnet in Token, nicht in Anfragen.
 *
 * Die kostenlose Stufe von Groq erlaubt fuer gpt-oss-120b 1.000 Anfragen und
 * 200.000 Token am Tag. Bindend sind die Token, und zwar deutlich: Als das
 * Tageslimit erstmals griff, waren noch 436 Anfragen frei, die Token aber
 * aufgebraucht. Ein Zaehler, der Anfragen zaehlt, misst also das Falsche - er
 * stand bei 19 von 150, waehrend nichts mehr ging.
 *
 * Aus diesem Topf bezahlen zwei Dinge, die von selbst laufen: die Pruefung der
 * Meldungen und die Uebersetzung der Titel und Anrisse. Beide teilen sich das
 * Tageskontingent von gpt-oss-20b. Tagesbericht und Nachfragen liegen auf
 * einem eigenen Modell und damit auf einem eigenen Kontingent - sie brauchen
 * hier keine Luft mehr.
 *
 * Solange alles auf einem Modell lag, musste die Grenze deutlich unter dem
 * Limit bleiben, damit eine eigene Frage nicht gegen eine leergelaufene
 * Dauerpruefung lief. Genau das ist heute passiert, bei 199.710 von 200.000.
 * Seit der Trennung ist der Rest freier Spielraum: 170.000 von 200.000 lassen
 * 30.000 Puffer, und die Pruefung reicht damit rund drei Stunden weiter in den
 * Tag. Was tatsaechlich verbraucht wurde, meldet Groq bei jeder Antwort -
 * geschaetzt wird hier nichts.
 */
/*
 * Der Deckel zaehlt ueber alle Modelle zusammen.
 *
 * Seit der Nachlauf auf dem grossen Modell laeuft, stehen zwei Kontingente zu
 * je 200.000 offen statt eines. 320.000 laesst beiden Luft und bleibt weit
 * unter der Summe - die Bremse greift also weiter, nur nicht mehr dort, wo
 * noch ein ganzes unbenutztes Kontingent danebenliegt.
 */
const KI_TOKEN_MAX = 320_000;

/*
 * Klarnamen fuer die drei Aufgaben, die sich Groq teilen.
 *
 * Sie stehen fuer je ein eigenes Modell und damit fuer je ein eigenes
 * Tageskontingent - siehe WUNSCHMODELLE in deuten.mjs.
 */
const AUFGABE = {
  interaktiv: 'Eigene Fragen',
  pruefung: 'Laufende Pruefung',
  uebersetzung: 'Uebersetzung',
};

/**
 * Nennt die Aufgabe, die ein Modell gerade traegt.
 *
 * Faellt auf den Modellnamen zurueck: In einem frisch gestarteten Isolat ist
 * die Zuordnung noch leer, weil sie erst bei der ersten Anfrage entsteht.
 */
/*
 * Wie lange eine abgelegte Stoerung noch als solche gilt.
 *
 * Im Durable Object bleibt sie bis zum Tageswechsel stehen. Ohne Verfallszeit
 * stuende ein einzelner Aussetzer von heute Morgen noch am Abend in der
 * Stoerungsliste, obwohl seither alles laeuft - eine Warnung, die nichts mehr
 * meint, wird schnell zu einer, die man nicht mehr liest.
 */
const STOERUNG_GILT_MS = 30 * 60_000;

/**
 * Bucht, was seit dem letzten Abholen an Groq ging.
 *
 * Der Zaehler in deuten.mjs ist prozesslokal. Eine eigene Frage laeuft aber in
 * einem anderen Isolat als der Abgleich, der ihn frueher als Einziger geleert
 * hat - was dort verbraucht wurde, tauchte in keiner Rechnung auf. Deshalb
 * bucht jetzt jeder Weg selbst, unmittelbar nachdem er Groq bemueht hat.
 */
const summe = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);

/** Fuehrt die Verbrauchsstaende zweier Zaehlungen zusammen. */
const modelleAddieren = (a, b) => {
  const zus = { ...(a || {}) };
  for (const [m, n] of Object.entries(b || {})) zus[m] = (zus[m] || 0) + n;
  return zus;
};

function tokenBuchen(env, ctx, zusatz = 0, zusatzModell = null) {
  const jeModell = verbrauchAbholen();
  // Die Uebersetzung laeuft ueber docs/engine und meldet ihren Verbrauch
  // getrennt zurueck; sie gehoert demselben Modell zugeschlagen.
  if (zusatz && zusatzModell) jeModell[zusatzModell] = (jeModell[zusatzModell] || 0) + zusatz;
  const frisch = summe(jeModell) + (zusatz && !zusatzModell ? zusatz : 0);
  if (frisch) ctx.waitUntil(zustand(env, { tokens: frisch, tokenJeModell: jeModell }));
  return frisch;
}

/** Gibt die Stoerung zurueck, solange sie frisch genug ist - sonst null. */
function frischeStoerung(...kandidaten) {
  for (const st of kandidaten) {
    if (!st || typeof st !== 'object' || !st.zeit) continue;
    if (Date.now() - new Date(st.zeit).getTime() < STOERUNG_GILT_MS) return st;
  }
  return null;
}

function aufgabeVon(modell, gebucht = null) {
  const belegung = { ...(gebucht || {}), ...gewaehlteModelle };
  const zwecke = Object.entries(belegung)
    .filter(([, m]) => m === modell)
    .map(([z]) => AUFGABE[z] || z);
  return zwecke.length ? zwecke.join(' + ') : modell;
}

/*
 * Wer hat zuletzt getickt?
 *
 * Ob der Bestand frisch ist, sagt darueber nichts: Der Lesepfad zieht bei
 * jedem Abruf den Kalender nach und setzt den Zeitstempel dabei neu. Ein
 * ausgefallener Ticker faellt so gar nicht auf - die Uhrzeit stimmt ja, nur
 * die Feeds werden nicht mehr abgefragt. Deshalb wird jeder echte Tick mit
 * Zeit und Herkunft vermerkt, nachzulesen unter /health.
 */
/*
 * Urteile des Modells, getrennt vom Bestand.
 *
 * Der Bestand wird bei jedem Tick als Ganzes neu geschrieben. KV liefert einen
 * Wert am Rand aber bis zu eine Minute lang veraltet aus - bei einem Tick je
 * Minute liest also fast jeder Durchlauf einen Stand von vorhin, rechnet darauf
 * und schreibt ihn zurueck. Alles, was der vorige Tick geprueft hatte, war
 * damit wieder weg: Das Budget lief vor und zurueck, die Zahl der offenen
 * Pruefungen pendelte, und die Anfragen an das Modell verpufften.
 *
 * Die Urteile liegen deshalb in einem eigenen Eintrag, der nur ergaenzt wird.
 * Ein veralteter Lesestand kostet dann hoechstens die Urteile der letzten
 * Minute - er macht aber nichts rueckgaengig, was schon feststand.
 */
const URTEILE_KEY = 'https://market-bias.internal/urteile';
const URTEILE_MAX = 700;

/** Felder, die ein Urteil an einer Meldung veraendert. */
const URTEIL_FELDER = ['ki', 'kiWiderspruch', 'kiKorrigiert',
  'scores', 'label', 'labelText', 'regelScores', 'regelLabel'];

/** Legt gespeicherte Urteile auf frisch bewertete Meldungen. */
function urteileAnlegen(items, speicher) {
  const urteile = speicher?.urteile;
  if (!urteile) return;
  for (const n of items) {
    const u = urteile[n.id];
    // Was schon am Eintrag haengt, ist mindestens so aktuell wie der Speicher.
    if (u && !n.ki?.inhalt) Object.assign(n, u);
  }
}

/** Zieht aus einer geprueften Meldung heraus, was aufbewahrt werden muss. */
function urteilAuslesen(n) {
  const raus = {};
  for (const f of URTEIL_FELDER) if (n[f] !== undefined) raus[f] = n[f];
  return raus;
}

/*
 * Schreibhaushalt.
 *
 * KV erlaubt im kostenlosen Tarif 1.000 Schreibvorgaenge am Tag - einen alle
 * 86 Sekunden. Der Worker schrieb bei jedem Tick den Bestand und das
 * Tickprotokoll, dazu je nach Lage Urteile und Wochenbuch: bei einem Tick je
 * Minute also das Drei- bis Fuenffache des Erlaubten.
 *
 * Aufgefallen ist es spaet, weil der Ausfall leise ist. Ist das Kontingent
 * erschoepft, wirft put() - der Tick bricht ab, der Bestand bleibt auf dem
 * letzten Stand stehen, und von aussen sieht alles unveraendert aus. Genau das
 * lief hier ab 04:27 Uhr, und es erklaert ruecklings alles: das vor- und
 * zurueckspringende Budget, den Nachlauf, der nicht vorankam, und das
 * Protokoll mit stundenalten Eintraegen.
 *
 * Geschrieben wird deshalb nur noch, wenn es etwas zu sichern gibt, und sonst
 * im Herzschlagtakt, damit der Zeitstempel nicht einfriert. Der Abruf bleibt
 * unberuehrt: Der Bestand wird bei jedem Tick neu berechnet und ausgeliefert,
 * nur nicht jedes Mal abgelegt.
 *
 * Grobe Rechnung fuer einen Tag: Herzschlag 288, neue Meldungen ~150,
 * Nachlauf 144, Wochenbuch 48, Uebersetzung und Abo eine Handvoll - zusammen
 * rund 650 von 1.000.
 */
/*
 * Wie oft der Bestand ohne Anlass neu abgelegt wird.
 *
 * Nur damit "zuletzt aufgefrischt" frisch aussieht - inhaltlich aendert sich
 * dabei nichts. Alle fuenf Minuten waren das allein 288 Ablagen am Tag, ein
 * knappes Drittel des Tageskontingents fuer eine Anzeige. Dass der Taktgeber
 * laeuft, steht ohnehin im Durable Object, und das kostet kein Kontingent.
 */
const BESTAND_HERZSCHLAG_MS = 15 * 60_000;

/*
 * Notbremse vor dem Tageslimit.
 *
 * KV erlaubt tausend Ablagen am Tag. Bisher merkte der Worker das Erreichen
 * erst daran, dass put() fehlschlug — und dann war alles betroffen, auch das
 * Nötigste. Ab dieser Marke fällt zuerst weg, was verzichtbar ist: der
 * Herzschlag und das Wochenbuch. Neue Meldungen werden bis zuletzt abgelegt,
 * denn an ihnen hängen die Benachrichtigungen.
 *
 * Der Zähler dafür liegt im Durable Object, nicht in KV. Einer in KV konnte
 * sich genau dann nicht mehr hochzählen, wenn es darauf ankam — die Anzeige
 * stand auf "0 von 1.000", während daneben "limit exceeded" gemeldet wurde.
 */
const ABLAGE_SPARSAM_AB = 800;
const ABLAGE_TAGESLIMIT = 1000;

/*
 * Verzug je Quelle: von der Veroeffentlichung bis zu uns.
 *
 * Eine Meldung von CNBC trug den Zeitstempel 12:00:01 und erreichte den Kanal
 * um 12:12 - zwoelf Minuten. Eine Stichprobe am Feed zeigte, dass CNBC seine
 * neueste Meldung erst mit sechseinhalb Minuten Rueckstand ausliefert, aber
 * damit war die Rechnung nicht geschlossen. Eine Momentaufnahme taugt dafuer
 * auch nicht: Der Rueckstand schwankt.
 *
 * Deshalb wird er laufend mitgeschrieben. Fuer jede erstmals gesehene Meldung
 * der Abstand zwischen ihrem Zeitstempel und dem Augenblick, in dem wir sie
 * haben - gemittelt je Quelle. Damit ist belegbar, wo die Zeit verlorengeht:
 * bei der Quelle oder bei uns. Und es zeigt, welche Quelle sich lohnt.
 */
const VERZUG_MAX_MS = 6 * 3600_000;   // darueber ist der Zeitstempel unbrauchbar
const VERZUG_PROBEN = 30;             // je Quelle, gleitend

/*
 * Wie viele Proben es braucht, ehe der Verzug etwas bedeutet.
 *
 * Beim ersten Abruf einer Quelle gilt jede Meldung ihres Feeds als neu -
 * auch die, die dort schon zwei Stunden liegt. Diese Ausreisser beherrschen
 * den Median, solange wenig anderes danebensteht, und erzeugten ein klares
 * Muster: je weniger Proben, desto langsamer sah die Quelle aus. CNBC stand
 * mit drei Proben bei 136 Minuten, Al Jazeera mit achtzehn bei 22.
 *
 * Darum wird unterhalb dieser Grenze keine Zahl mehr genannt. Eine Zahl, die
 * mehr ueber ihren eigenen Zustand aussagt als ueber die Quelle, taugt nicht
 * zur Auswahl schnellerer Feeds - und genau dafuer ist sie da.
 */
const VERZUG_MIN_PROBEN = 8;

/*
 * Ein Haupttaktgeber, der Rest als Reserve.
 *
 * Drei Taktgeber liefen gleichzeitig: Cloudflares eigener Zeitplan alle zwei
 * Minuten, cron-job.org jede Minute, die GitHub-Action alle zehn. Das war als
 * Absicherung gedacht und war in Wahrheit die Ursache doppelter Meldungen.
 *
 * KV liefert einen Lesestand bis zu einer Minute veraltet aus. Zwei Ticks kurz
 * hintereinander lesen also womoeglich beide den Stand von vorher, halten
 * beide dieselbe Meldung fuer neu, speichern beide erfolgreich - und senden
 * beide. Dass seit Neuestem erst gespeichert und dann gemeldet wird, hilft
 * dagegen nicht: Der zweite Durchgang weiss vom ersten schlicht noch nichts.
 *
 * Ein Durchgang mit `fallback=1` prueft deshalb zuerst, ob ueberhaupt jemand
 * fehlt: Ist der Bestand jung, bricht er sofort ab - ohne zu holen, zu
 * speichern oder zu melden. Faellt der Haupttaktgeber aus, springt er nach
 * dieser Frist ein. Aus drei gleichzeitigen wird so einer mit zwei Reserven.
 */
const RESERVE_AB_MS = 6 * 60_000;

/*
 * Letzter gescheiterte Tick.
 *
 * Weil der Taktgeber nun immer 200 bekommt, faellt ein Fehler nicht mehr
 * ueber den Statuscode auf. Er muss dafuer woanders sichtbar sein - hier, und
 * damit im Systemzustand der App.
 */
let letzterTickFehler = null;

/*
 * Letzter Tick je Herkunft.
 *
 * Zuerst war das eine Liste der letzten acht Ticks - und die litt an genau dem
 * Problem, das sie aufdecken sollte: gelesen, ergaenzt, zurueckgeschrieben, bei
 * einem Tick je Minute also fast immer auf veraltetem Stand. Sie zeigte
 * stundenalte Eintraege, waehrend der Nachlauf nachweislich lief.
 *
 * Jetzt schreibt jede Herkunft nur ihr eigenes Feld. Ein veralteter Lesestand
 * kostet dann hoechstens den Eintrag einer anderen Quelle, und die traegt ihn
 * beim naechsten eigenen Tick ohnehin neu ein. Fuer die eigentliche Frage -
 * tickt da noch etwas, und was - genuegt das.
 */
// Liegt im Urteilsspeicher mit, statt einen eigenen Schreibvorgang zu kosten.

/**
 * Braucht diese Meldung (noch) eine Pruefung durch das Modell?
 *
 * Nicht nur ungeprueft zaehlt, sondern auch unvollstaendig geprueft: Aeltere
 * Antworten tragen nur die Begruendung, seit der Erweiterung gehoert eine
 * kurze Zusammenfassung dazu. Ohne sie stand bei belanglosen Meldungen bloss
 * "hat keine Auswirkung auf Bitcoin" - formal richtig und trotzdem nutzlos.
 * Solche Antworten werden nach und nach nachgeholt, gebremst vom Tagesbudget.
 */
/*
 * Was noch geprueft werden muss.
 *
 * Nicht nur, was ueberhaupt kein Urteil hat - auch, was unter aelteren Regeln
 * gefaellt wurde. Sonst ueberdauert ein Satz wie "Bundeskanzler Olaf Merkel"
 * die Regel, die ihn kuenftig verhindert, und steht noch einen ganzen Tag da.
 */
/**
 * Nimmt Saetze heraus, die unter aelteren Regeln entstanden sind.
 *
 * Die Neubewertung des ganzen Bestands braucht mehr Token, als an einem Tag
 * zur Verfuegung stehen - gemessen: rund 237.000 fuer die verbliebenen 75
 * Meldungen, verfuegbar waren 55.000. Bis dahin haette "Bundeskanzler Olaf
 * Merkel" weiter dort gestanden, wo die Vorlage "Merz" sagt.
 *
 * Also andersherum: Der Satz verschwindet sofort und kostet nichts. Richtung,
 * Staerke und Herleitung bleiben - sie sind eine Einschaetzung, keine
 * Tatsachenbehauptung. Was fehlt, ist die Nacherzaehlung, und die steht als
 * Schlagzeile und Anriss ohnehin daneben. Der Nachlauf fuellt sie wieder auf,
 * sobald er die Meldung erreicht.
 */
function ohneAlteSaetze(stand) {
  if (!stand?.items?.length) return stand;
  return {
    ...stand,
    items: stand.items.map((n) => (n.ki?.inhalt && (n.ki.stand || 1) < ANWEISUNG_STAND
      ? { ...n, ki: { ...n.ki, inhalt: '' } }
      : n)),
  };
}

/*
 * Gemessen wird am Urteil, nicht am Inhaltssatz.
 *
 * Der Satz kann berechtigt leer sein - die Zahlenwache verwirft ihn, wenn eine
 * Zahl darin nicht in der Vorlage steht. Am Inhalt gemessen galt die Meldung
 * dann fuer immer als offen und wurde endlos erneut geprueft. Die Richtung
 * dagegen liegt bei jedem gelungenen Urteil vor.
 */
const brauchtPruefung = (n) => n.impactLevel !== 'ignore'
  && (!n.ki?.richtung || (n.ki.stand || 1) < ANWEISUNG_STAND);

/*
 * Zwischenspeicher der Uebersetzungen.
 *
 * Anrisse werden erst uebersetzt, wenn jemand die Meldung aufklappt. Alles
 * vorab durchzuschicken kostete rund 32.000 Zeichen am Tag - bei 500.000 im
 * Monat waere das Kontingent nach zehn Tagen aufgebraucht, und zwar fuer Text,
 * den fast niemand liest. Auf Abruf sind es ein paar hundert Zeichen am Tag.
 *
 * Der Speicher liegt beim Worker, nicht beim Geraet: Was einer aufklappt, ist
 * fuer den naechsten Aufruf schon da, auch am anderen Geraet.
 */
const UEBERSETZUNG_KEY = 'uebersetzungen';
const UEBERSETZUNG_MAX = 800;   // Eintraege, danach fallen die aeltesten raus
const UEBERSETZUNG_JE_ABRUF = 5;

/*
 * Zugangswort fuer die schreibenden und die kostenpflichtigen Wege.
 *
 * Die Adresse eines Workers ist kein Geheimnis - sie folgt aus Projekt- und
 * Kontonamen und laesst sich erraten. Ohne Pruefung konnte damit jeder das
 * Benachrichtigungs-Abo ueberschreiben und so die Meldungen abstellen oder
 * umlenken, und jeder konnte das Kontingent des Sprachmodells aufbrauchen.
 * Der Abruf der Meldungen bleibt offen: Er kostet nichts und veraendert nichts.
 *
 * Ist kein Wort hinterlegt, arbeitet alles wie bisher - damit eine bestehende
 * Einrichtung nicht ueber Nacht stehen bleibt. /health weist dann darauf hin.
 */
const GESCHUETZT = ['/subscribe', '/notify', '/testpush', '/deuten', '/tageslage',
  '/modelle', '/tick', '/uebersetzen', '/frage', '/versandprobe'];

/*
 * Merkt sich, wer das Zugangswort noch in der Adresse mitschickt.
 *
 * Ein Wort in der Adresse steht in jedem Protokoll: bei Cloudflare, beim
 * Taktgeber, in jedem Zwischenknoten. Es gehoert in eine Kopfzeile. Solange
 * aber noch etwas den alten Weg benutzt, darf er nicht abgeschaltet werden -
 * sonst steht der Taktgeber still. Dieser Vermerk sagt, wann es soweit ist.
 */
let adressZugangZuletzt = null;

function zugangGeprueft(request, url, env) {
  if (!env.ZUGANG) return true;                       // nicht eingerichtet
  if (!GESCHUETZT.includes(url.pathname)) return true; // offener Weg

  const ausKopfzeile = (request.headers.get('x-zugang') || '').trim();
  const ausAdresse = (url.searchParams.get('zugang') || '').trim();
  if (!ausKopfzeile && ausAdresse) {
    adressZugangZuletzt = { zeit: new Date().toISOString(), pfad: url.pathname };
  }

  const mitgegeben = ausKopfzeile || ausAdresse;
  // Beim Hinterlegen ueber die Kommandozeile haengt leicht ein Zeilenumbruch
  // an; ohne diese Bereinigung stimmt dann nie etwas ueberein.
  const soll = String(env.ZUGANG).trim();
  if (mitgegeben.length !== soll.length) return false;
  let gleich = 0;
  for (let i = 0; i < soll.length; i++) gleich |= mitgegeben.charCodeAt(i) ^ soll.charCodeAt(i);
  return gleich === 0;
}
const LAGE_KEY = 'https://market-bias.internal/lage';

/*
 * Zwischenspeicher fuer abgerufene Artikel.
 *
 * Eine Nachfrage kommt selten allein - wer einmal fragt, fragt meist noch
 * zweimal nach. Ohne Zwischenspeicher holte jede Rueckfrage denselben Artikel
 * erneut: ein Abruf beim Anbieter und ein paar Sekunden Wartezeit fuer nichts.
 *
 * Sechs Stunden genuegen. Laenger lohnt nicht, weil die Meldung ohnehin nach
 * 24 Stunden aus dem Bestand faellt.
 */
const ARTIKEL_TTL = 6 * 3600;
const artikelSchluessel = (url) =>
  'https://market-bias.internal/artikel/' + encodeURIComponent(String(url).slice(0, 300));
const LAGE_FRISCH_MS = 15 * 60_000;   // Zusammenfassung eine Viertelstunde nutzen
const SPERRE_KEY = 'https://market-bias.internal/letzterVersand';

/*
 * Wochenbuch.
 *
 * Der Bestand reicht nur einen Tag zurueck. Damit am Sonntag noch steht, was
 * am Montag los war, wird jeder Kalendertag festgehalten, bevor er aus dem
 * Fenster faellt. Aufbewahrt werden zwei Wochen - so bleibt beim Blick am
 * Montag auch die vergangene Woche vollstaendig.
 *
 * Nicht bei jedem Durchlauf geschrieben: Bei einem Takt von einer Minute
 * waeren das 1.440 Schreibvorgaenge am Tag, und das freie Kontingent von KV
 * liegt bei 1.000. Alle zehn Minuten genuegt vollauf - ein Tag aendert sich
 * nicht schneller.
 */
const WOCHE_KEY = 'https://market-bias.internal/wochenbuch';
const WOCHE_TTL = (TAGE_MAX + 2) * 86_400;
const WOCHE_TAKT_MS = 30 * 60_000;

/*
 * Mindestabstand zwischen Benachrichtigungen — aber nur für Kanäle, die ihn
 * brauchen. ntfy sperrt bei erschöpftem Tageskontingent komplett, Discord
 * kennt kein Tageslimit. Wer Discord nutzt, soll Meldungen sofort bekommen;
 * dafür ist das Werkzeug da.
 */
const RUHE_MS = 10 * 60_000;
const BRAUCHT_RUHE = new Set(['ntfy']);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  /*
   * X-Zugang muss hier stehen.
   *
   * Ein eigener Kopf loest im Browser eine Vorabfrage aus, und die lehnt
   * jeden Kopf ab, der hier nicht genannt ist. Ohne ihn scheiterte in der App
   * alles, was das Zugangswort mitschickt - Zweitmeinung, Tagesbericht,
   * Abo speichern, Uebersetzung, Nachfragen -, und zwar ohne verwertbare
   * Fehlermeldung: Der Browser bricht schon vor der eigentlichen Anfrage ab.
   */
  'access-control-allow-headers': 'Content-Type, X-Zugang, x-quelle',
  'access-control-max-age': '86400',
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, ...extra } });

/**
 * Kennzeichnet den Inhalt, damit unveraenderte Antworten nicht erneut
 * uebertragen werden muessen.
 *
 * Die App fragt alle zwoelf Sekunden nach; komprimiert sind das je 35 KB und
 * damit rund zehn Megabyte pro Stunde - auf dem Mobilfunk spuerbar. Meist hat
 * sich aber nichts geaendert. Der Zeitstempel bleibt bewusst aussen vor: Er
 * wandert bei jedem Abruf weiter und wuerde die Kennung wertlos machen.
 */
function inhaltsKennung(data) {
  let h = 0;
  const roh = `${data.count}|${(data.items || []).map((n) => n.id).join()}`;
  for (let i = 0; i < roh.length; i++) {
    h = (h * 31 + roh.charCodeAt(i)) | 0;
  }
  return `"${(h >>> 0).toString(36)}-${data.count}"`;
}

// --- Ablage: KV wenn gebunden, sonst der flüchtige Cache ------------------
async function lesen(env, key) {
  if (env.STORE) return (await env.STORE.get(key, 'json')) ?? null;
  const hit = await caches.default.match(key);
  return hit ? hit.json() : null;
}

/**
 * Ablegen. Die Verfallszeit gilt fuer KV: Sie muss deutlich laenger sein als
 * der Cron-Takt, sonst verschwindet der Bestand in ruhigen Phasen und der
 * naechste Lauf haelt jede Meldung fuer neu.
 */
/*
 * Zaehlwerk fuer die Ablage.
 *
 * `offen` sammelt, was seit dem letzten Sichern des Bestands geschrieben wurde
 * - Urteile, Wochenbuch, Uebersetzungen, das Abo. Beim naechsten Sichern
 * wandert die Summe in den Bestand und faengt von vorn an. Weil ein Durchgang
 * seine Schreibvorgaenge alle im selben Isolat erledigt und mit dem Bestand
 * abschliesst, geht dabei nichts verloren.
 *
 * Vorher zaehlte nur der Bestand selbst. Die Zahl war damit systematisch zu
 * niedrig, und gerade dann irrefuehrend, wenn es darauf ankommt: Wer prueft,
 * ob er an die tausend stoesst, will alle sehen.
 */
let offeneSchreibungen = 0;

/*
 * Versuche mitzaehlen, nicht nur Erfolge.
 *
 * Der Zaehler lag bisher allein im abgelegten Bestand - und stand damit still,
 * sobald das Kontingent erschoepft war. Ein niedriger Wert sagte dann nichts
 * darueber aus, ob noch Kontingent frei ist; genau die Auskunft, um die es
 * geht. Die Versuche zaehlt deshalb das Isolat selbst mit, und /health zeigt
 * beide Zahlen.
 */
let versucheSeitAblage = 0;
let fehlerSeitAblage = 0;

/*
 * Wer zuletzt getickt hat - im Arbeitsspeicher gefuehrt.
 *
 * Der Vermerk gehoert an den Tick, nicht an das Speichern. Sonst erscheint
 * eine Quelle nur, wenn ihr Durchgang zufaellig etwas zu sichern hatte:
 * cron-job.org lief im Minutentakt und tauchte trotzdem nie auf, weil der
 * Herzschlag jeweils schon von einem anderen Taktgeber erledigt war.
 *
 * Beim naechsten Sichern wird diese Sammlung in den Bestand gemischt, nie
 * ersetzt - so ergaenzen sich die Isolate gegenseitig.
 */
let taktVermerk = {};
let letzterAblageFehler = null;

async function schreiben(env, ctx, key, data, ttl = 86400) {
  if (env.STORE) {
    /*
     * Ein fehlgeschlagenes Ablegen darf den Abruf nicht mitreissen.
     *
     * Ist das Tageskontingent von KV erschoepft, wirft put(). Weil der Aufruf
     * im Antwortpfad steckte, brach damit der ganze Tick mit 500 ab - es kamen
     * also gar keine Nachrichten mehr durch, obwohl das Sammeln und Bewerten
     * einwandfrei lief. Ohne Ablage ist der Bestand nur fluechtig: Er wird bei
     * jedem Durchgang neu berechnet und ausgeliefert, er ueberdauert bloss
     * nicht. Das ist ungleich besser als nichts.
     */
    versucheSeitAblage++;
    try {
      await env.STORE.put(key, JSON.stringify(data), { expirationTtl: ttl });
      offeneSchreibungen++;
      return true;
    } catch (err) {
      fehlerSeitAblage++;
      console.log('KV put fehlgeschlagen:', err.message);
      letzterAblageFehler = { zeit: new Date().toISOString(), fehler: err.message.slice(0, 120) };
      return false;
    }
  }
  const res = new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json', 'cache-control': `max-age=${ttl}` },
  });
  ctx.waitUntil(caches.default.put(key, res));
  return true;
}

const alterMs = (d) => (d?.updated ? Date.now() - new Date(d.updated).getTime() : Infinity);

/**
 * Fuehrt den Tageszaehler der Modellanfragen und sagt, wie viele noch frei sind.
 *
 * Der Zaehler steht im Urteilsspeicher, nicht im Bestand. Im Bestand lief er
 * vor und zurueck, weil der bei jedem Tick als Ganzes neu geschrieben wird und
 * dabei regelmaessig ein veralteter Lesestand gewann. Beim Datumswechsel
 * faengt er von vorn an.
 */
function budgetRest(speicher) {
  const heute = new Date().toISOString().slice(0, 10);
  if (!speicher || speicher.tag !== heute) return { tag: heute, verbraucht: 0, rest: KI_TOKEN_MAX };
  const verbraucht = speicher.tokens || 0;
  return { tag: heute, verbraucht, rest: Math.max(0, KI_TOKEN_MAX - verbraucht) };
}

/**
 * Haelt die Kalendertage fest, solange ihre Meldungen noch vorliegen.
 *
 * Laeuft neben der Antwort her (waitUntil): Der Abruf soll nicht darauf warten.
 * Schlaegt es fehl, bleibt der letzte Stand stehen - die Datei im Verzeichnis
 * (docs/data/woche.json) ist ohnehin die belastbarere Fassung, dieser Weg
 * liefert nur den frischeren Zwischenstand.
 */
async function wochenbuchPflegen(env, ctx, items) {
  try {
    const alt = await lesen(env, WOCHE_KEY);
    if (alt?.updated && Date.now() - new Date(alt.updated).getTime() < WOCHE_TAKT_MS) return;

    const tage = fortschreiben(alt?.tage || {}, items);
    await schreiben(env, ctx, WOCHE_KEY,
      { updated: new Date().toISOString(), tage }, WOCHE_TTL);
  } catch (err) {
    console.log('Wochenbuch:', err.message);
  }
}

/**
 * Führt frische Meldungen mit dem Bestand zusammen.
 *
 * Der Zeitstempel einer bereits bekannten Meldung bleibt stehen. Redaktionen
 * überarbeiten Artikel im Lauf des Tages und setzen dabei das
 * Veröffentlichungsdatum neu — dieselbe Meldung wanderte dadurch im Feed nach
 * oben und wirkte Stunden jünger, als sie war. Für den Handel zählt, wann eine
 * Nachricht zuerst da war.
 */
function zusammenfuehren(bestand, frische) {
  const bekannt = new Map((bestand?.items || []).map((n) => [n.id, n]));
  const kandidaten = [];
  for (const n of frische) {
    const vorhanden = bekannt.get(n.id);
    if (!vorhanden) kandidaten.push(n);
    /*
     * Erstsichtung und geprueftes Urteil uebernehmen.
     *
     * Beim Abgleich kommt die Meldung frisch bewertet aus dem Regelwerk
     * zurueck. Ohne diese Uebernahme waere die Pruefung durch das Modell bei
     * jedem Durchlauf verloren - und eine bereits berichtigte Bewertung fiele
     * auf das Regelurteil zurueck.
     */
    bekannt.set(n.id, vorhanden
      ? {
          ...n,
          date: vorhanden.date,
          ...(vorhanden.ki ? {
            ki: vorhanden.ki,
            kiWiderspruch: vorhanden.kiWiderspruch,
            kiKorrigiert: vorhanden.kiKorrigiert,
            regelScores: vorhanden.regelScores,
            regelLabel: vorhanden.regelLabel,
            // Das berichtigte Urteil gilt weiter.
            ...(vorhanden.kiKorrigiert ? {
              scores: vorhanden.scores,
              label: vorhanden.label,
              labelText: vorhanden.labelText,
            } : {}),
          } : {}),
        }
      : n);
  }

  // Aelteres faellt heraus: Was gestern galt, hilft beim heutigen Handel nicht.
  /*
   * Kein zweiter Dublettenlauf.
   *
   * collectNews hat den frischen Zulauf bereits geprueft, und der Bestand
   * besteht aus lauter Ergebnissen frueherer Laeufe. Ihn vollstaendig erneut
   * durchzurechnen kostet Rechenzeit, die der Worker nicht hat - und findet
   * nichts, was nicht schon gefunden waere. Die Zusammenfuehrung nach Kennung
   * oben genuegt hier.
   */
  const items = imFenster([...bekannt.values()])
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 300);

  /*
   * Nur melden, was auch im Bestand landet.
   *
   * Der Bestand fasst 300 Meldungen, die Quellen liefern zusammen mehr. Eine
   * neue, aber etwas ältere Meldung fällt beim Kürzen heraus - benachrichtigt
   * wurde vorher trotzdem. Wer dann in der App danach sucht, findet nichts.
   * Auch die Zusammenfassung von Dubletten kann einen Eintrag ersetzen.
   */
  const sichtbar = new Set(items.map((n) => n.id));
  const neue = kandidaten.filter((n) => sichtbar.has(n.id));

  return { items, neue, verworfen: kandidaten.length - neue.length };
}

/**
 * Holt eine Feed-Gruppe, benachrichtigt und legt beides zusammen ab.
 *
 * Der Meldevermerk steckt bewusst im Bestand selbst statt in einem zweiten
 * Objekt: KV wird erst nach und nach über alle Rechenzentren verteilt. Zwei
 * getrennte Einträge konnten deshalb auseinanderlaufen, und dieselbe Meldung
 * ging zweimal raus. Ein Objekt, ein Schreibvorgang, ein Stand.
 */
/*
 * Quellen, die dem Rechenzentrum verwehrt sind, ueber die Action beziehen.
 *
 * Google News antwortet Cloudflare-Adressen mit 503 - gemessen, wiederholt,
 * kein Ausrutscher. Die GitHub-Action laeuft in einem anderen Netz und bekommt
 * dieselbe Datei anstandslos; sie schreibt sie nach docs/data/news.json. Der
 * Worker liest von dort nach, was er selbst nicht holen kann.
 *
 * Bewusst eng gehalten: nur benannte Quellen, und hoechstens alle fuenf
 * Minuten. Die Action schreibt ohnehin nur alle zehn, oefter nachzusehen
 * brachte nichts ausser Rechenzeit.
 */
const UEBER_AKTION = ['Reuters'];
const NACHSCHUB_URL = 'https://simplescalps.github.io/market-bias/data/news.json';
const NACHSCHUB_MS = 5 * 60_000;
let nachschubZuletzt = 0;
let nachschubStand = [];

async function nachschub() {
  if (Date.now() - nachschubZuletzt < NACHSCHUB_MS) return nachschubStand;
  nachschubZuletzt = Date.now();
  try {
    const res = await fetch(NACHSCHUB_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return nachschubStand;
    const j = await res.json();
    nachschubStand = (j.items || []).filter((n) => UEBER_AKTION.includes(n.source));
  } catch (err) {
    // Faellt der Nachschub aus, fehlt nur diese eine Quelle - kein Grund,
    // den ganzen Durchgang scheitern zu lassen.
    console.log('Nachschub:', err.message);
  }
  return nachschubStand;
}

async function teilAbgleich(env, ctx, regime, bestand, gruppe, quelle = 'unbekannt') {
  const teil = await collectNews({ regime, gruppe, gruppen: GRUPPEN, limit: 300 });

  // Was der Worker selbst nicht erreicht, kommt ueber die Action herein.
  const dazu = await nachschub();
  if (dazu.length) {
    const da = new Set(teil.items.map((n) => n.id));
    teil.items = [...teil.items, ...dazu.filter((n) => !da.has(n.id))]
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    /*
     * Den eigenen Fehlschlag zuruecknehmen, wo der Nachschub eingesprungen ist.
     *
     * Sonst stuende dauerhaft "Reuters: 503" in der Stoerungsliste, waehrend
     * die Meldungen einwandfrei ankommen. Eine Warnung, die immer da ist und
     * nie etwas bedeutet, bringt einem bei, Warnungen zu uebersehen.
     */
    const geliefert = new Set(dazu.map((n) => n.source));
    teil.errors = (teil.errors || []).filter((e) => ![...geliefert].some((q) => e.startsWith(q + ':')));
  }
  const { items, neue } = zusammenfuehren(bestand, teil.items);

  // Urteile aus ihrem eigenen Speicher nachlegen - sie ueberleben dort auch
  // einen Bestand, der von einem veralteten Lesestand ueberschrieben wurde.
  const speicher = (await lesen(env, URTEILE_KEY)) || { urteile: {} };
  speicher.urteile ||= {};
  urteileAnlegen(items, speicher);

  /*
   * Betriebszustand aus dem Durable Object.
   *
   * Er trägt alle Drosseln — und bleibt lesbar und schreibbar, auch wenn das
   * Tageskontingent von KV erschöpft ist. Genau daran hat es gefehlt: Ohne
   * diese Werte hielt der Worker bei jedem Durchgang für neu, was er eine
   * Minute zuvor schon getan hatte, und Groq wies dreitausend Anfragen ab.
   */
  const z = (await zustand(env)) || {};
  const sparsam = (z.schreibVersuche || 0) >= ABLAGE_SPARSAM_AB;

  /*
   * Das Gedächtnis überlebt die Sichtbarkeitsgrenze.
   *
   * Ein Vermerk an der Meldung selbst reicht nicht: Der angezeigte Bestand
   * fasst 300 Einträge, die Quellen liefern mehr. Eine gemeldete Nachricht
   * wird von neueren verdrängt, verschwindet samt Vermerk - und gilt beim
   * nächsten Durchlauf derselben Feed-Gruppe wieder als neu. Genau so ging
   * dieselbe Meldung dreimal raus. Die Liste der gemeldeten Kennungen liegt
   * deshalb neben den Meldungen, aber im selben Objekt: Zwei getrennte
   * Einträge liefen wegen der verzögerten Verteilung von KV auseinander.
   */
  const gesehen = new Set(bestand?.gesehen || []);

  // Neu ist, was noch nie im Bestand war - nicht bloss, was gerade fehlt.
  const kandidaten = neue.filter((n) => !gesehen.has(n.id));

  /*
   * Verzug festhalten, solange die Meldung frisch entdeckt ist.
   *
   * Nur hier ist bekannt, dass wir sie zum ersten Mal sehen - eine Zeile
   * spaeter waere sie nicht mehr von den uebrigen zu unterscheiden.
   */
  /*
   * Der bisherige Stand kommt aus beiden Ablagen.
   *
   * Der Bestand in KV friert ein, sobald das Tageskontingent erschoepft ist;
   * das Durable Object laeuft weiter. Nur der Bestand als Grundlage hiesse:
   * Alles, was seit dem letzten gelungenen Schreibvorgang gemessen wurde,
   * faellt beim naechsten Buchen wieder heraus.
   */
  const verzug = { ...(bestand?.verzug || {}), ...(z.verzug || {}) };
  for (const n of kandidaten) {
    const ms = Date.now() - new Date(n.date).getTime();
    if (!(ms >= 0 && ms < VERZUG_MAX_MS)) continue;   // unbrauchbarer Zeitstempel

    const e = verzug[n.source] || { proben: [] };
    e.proben = [...e.proben, Math.round(ms / 1000)].slice(-VERZUG_PROBEN);

    /*
     * Der Median, nicht der Mittelwert.
     *
     * Manche Quellen mischen zeitlose Stuecke unter die Nachrichten -
     * Benzingas "Best Oil Stocks Right Now" etwa, mit einem Zeitstempel von
     * vor zwei Stunden. Ein solcher Ausreisser verdirbt einen Mittelwert
     * vollstaendig: Aus zwei Messungen wurden 102 Minuten, obwohl die Quelle
     * ihre echten Nachrichten zuegig liefert. Der Median laesst sich davon
     * nicht beeindrucken.
     */
    const sortiert = [...e.proben].sort((a, b) => a - b);
    e.median = sortiert[Math.floor(sortiert.length / 2)];
    verzug[n.source] = e;
  }

  // Vor dem Versand gegenlesen lassen: Ein Widerspruch gehoert in die
  // Benachrichtigung, nicht erst in die spaetere Ansicht.
  // Der Tokenstand kommt aus dem Durable Object; KV kann ihn nicht führen.
  const budget = budgetRest(z.tag ? { tag: z.tag, tokens: z.tokens } : speicher);
  // Der eigene Verbrauch zaehlt mit, auch wenn er nirgends abgelegt werden kann.
  const restJetzt = budget.rest - tokenSeitStart;
  /*
   * Das Fehlerbuch liegt im Durable Object, nicht in KV.
   *
   * Es muss gerade dann lesbar und schreibbar sein, wenn KV klemmt - sonst
   * wiederholt sich der Fehlschlag, dessen Vermerk am selben Hindernis
   * scheitert.
   */
  /*
   * Das Fehlerbuch gilt nur fuer die Regeln, unter denen es entstand.
   *
   * Beim schnellen Aufholen zaehlten Kontingentabsagen als Fehlversuche - nach
   * dreien galt eine Meldung als aufgegeben, obwohl an ihr nichts falsch war.
   * So blieben 74 Meldungen stehen, waehrend der Zaehler sich nicht mehr
   * bewegte. Steigt der Regelstand, faellt das Buch deshalb weg: Was unter
   * alten Bedingungen scheiterte, verdient einen neuen Versuch.
   */
  let nachlaufErgebnis = null;
  const buchGilt = (z.pruefFehlerStand || 0) === ANWEISUNG_STAND;
  const pruefBuch = buchGilt ? { ...(z.pruefFehler || {}) } : {};
  const gescheitert = [];

  if (restJetzt > 0) {
    const r = await gegenlesen(kandidaten, env, GEGENPROBE_MAX, pruefBuch);
    gescheitert.push(...(r?.gescheitert || []));
  }

  /*
   * Den Bestand nachziehen.
   *
   * Neue Meldungen werden oben geprueft - die bereits vorhandenen aber nie.
   * In der Liste stuenden damit hunderte Eintraege, die allein aus Stichworten
   * beurteilt sind, waehrend nur der Zulauf gegengelesen wird. Bei jedem
   * Durchlauf kommt deshalb ein Teil des Bestands dazu, die gewichtigsten
   * zuerst. Nach einigen Stunden ist alles einmal durch.
   */
  /*
   * Der spaetere der beiden Zeitpunkte gilt: der abgelegte oder der im
   * Arbeitsspeicher. So bremst auch ein Isolat, dessen Schreibversuch scheitert.
   */
  const letzter = Math.max(
    nachlaufZuletzt,
    new Date(z.letzterNachlauf || speicher.letzterNachlauf || 0).getTime(),
  );
  if (Date.now() - letzter > NACHZIEHEN_ABSTAND_MS && restJetzt > 0) {
    const nachzuholen = items.filter(brauchtPruefung);
    if (nachzuholen.length) {
      nachlaufZuletzt = Date.now();          // sofort, nicht erst nach Erfolg
      // Auf dem grossen Modell: eigenes Kontingent, besseres Urteil.
      const r = await gegenlesen(nachzuholen, env, NACHZIEHEN_MAX, pruefBuch, 'nachlauf');
      gescheitert.push(...(r?.gescheitert || []));
      speicher.letzterNachlauf = new Date().toISOString();

      /*
       * Was dabei herauskam, festhalten.
       *
       * Das Protokoll von wrangler tail greift bei diesem Verkehr nur
       * stichprobenartig - zweimal habe ich daraus geschlossen, es gebe keine
       * Fehler, waehrend der Zaehler stand und Token liefen. Diese Ablage ist
       * vollstaendig und jederzeit abrufbar.
       */
      nachlaufErgebnis = {
        zeit: new Date().toISOString(),
        offen: nachzuholen.length,
        angefragt: r?.anzahl ?? 0,
        gescheitert: r?.gescheitert?.length ?? 0,
        ...(r?.fehler ? { fehler: String(r.fehler).slice(0, 200) } : {}),
      };
    }
  }

  /*
   * Frische Urteile in ihren Speicher nachtragen.
   *
   * Nur ergaenzen, nie ersetzen: Selbst wenn der gelesene Stand veraltet war,
   * geht dadurch nichts verloren, was ein anderer Durchlauf schon eingetragen
   * hat - schlimmstenfalls fehlen die Eintraege der letzten Minute und werden
   * beim naechsten Mal erneut geholt.
   */
  let neueUrteile = 0;
  for (const n of items) {
    if (!n.ki?.richtung) continue;               // gar kein Urteil

    /*
     * Ein neueres Urteil ersetzt ein aelteres.
     *
     * Vorher stand hier: liegt schon eines mit Inhalt vor, ueberspringen. Das
     * war richtig, solange es nur ein Regelwerk gab - mit dem Regelstand wurde
     * es zur Falle. Die Neubewertung lief, kostete Token, und ihr Ergebnis
     * landete jedes Mal im Papierkorb, weil das alte Urteil noch dastand. Der
     * Zaehler blieb auf 42 stehen, waehrend acht Meldungen je Minute
     * fehlerfrei durchliefen.
     */
    const alt = speicher.urteile[n.id]?.ki;
    if (alt?.richtung && (alt.stand || 1) >= (n.ki.stand || 1)) continue;

    speicher.urteile[n.id] = urteilAuslesen(n);
    neueUrteile++;
  }

  /*
   * Alles, was seit dem letzten Mal an Groq ging - gleich aus welchem Weg.
   * Der Zaehler steht in deuten.mjs, wo jede Antwort durchlaeuft.
   */
  const jeModell = verbrauchAbholen();
  const frisch = summe(jeModell);
  tokenSeitStart += frisch;
  budget.verbraucht += frisch;
  if (frisch) {
    // Das Objekt wird ersetzt, nicht addiert - also selbst zusammenfuehren.
    ctx.waitUntil(zustand(env, {
      tokens: frisch,
      tokenJeModell: modelleAddieren(z.tokenJeModell, jeModell),
    }));
  }

  /*
   * Nennt Groq seinen Tagesstand, gilt der - nicht der eigene Zaehler.
   * Er wird gesetzt, nicht addiert; deshalb ein eigenes Feld.
   */
  if (Object.keys(tagesverbrauch).length) {
    // Das Objekt wird ersetzt, nicht addiert - also selbst zusammenfuehren,
    // damit ein Stand nicht den eines anderen Modells verdraengt.
    const bisher = Object.fromEntries(
      // Nur echte Modellstaende uebernehmen. Frueher lag hier ein einzelner,
      // modellloser Stand; dessen Felder wuerden sonst dauerhaft mitwandern.
      Object.entries(z.groqTag || {}).filter(([, g]) => g && typeof g === 'object' && g.stand),
    );
    ctx.waitUntil(zustand(env, { groqTag: { ...bisher, ...tagesverbrauch } }));
  }

  if (neueUrteile || budget.verbraucht !== (speicher.tokens || 0)) {
    const ids = Object.keys(speicher.urteile);
    for (const alt of ids.slice(0, Math.max(0, ids.length - URTEILE_MAX))) {
      delete speicher.urteile[alt];
    }
    speicher.tag = budget.tag;
    speicher.tokens = budget.verbraucht;
    await schreiben(env, ctx, URTEILE_KEY, speicher, BESTAND_TTL);
  }

  // Alles Sichtbare gilt fortan als bekannt, auch das noch nicht Gemeldete:
  // Wandert eine Meldung spaeter aus der Anzeige, soll sie beim Wiederauftauchen
  // keine zweite Benachrichtigung ausloesen.
  for (const n of items) gesehen.add(n.id);
  const gedaechtnis = [...gesehen].slice(-GESEHEN_MAX);

  /*
   * Schreibvorgaenge mitzaehlen.
   *
   * KV erlaubt 1.000 am Tag, und die Grenze zu ueberschreiten faellt von
   * aussen nicht auf - es hoert einfach auf zu speichern. Der Zaehler faehrt
   * im selben Objekt mit, kostet also nichts.
   *
   * Was er zaehlt, muss man wissen: nur GELUNGENE Schreibvorgaenge. Er liegt
   * ja im abgelegten Bestand, und ihn zu erhoehen braucht selbst einen
   * Schreibvorgang - ist das Kontingent erschoepft, steht er still. Ein
   * niedriger Wert bei blockiertem Speichern heisst also nicht, dass noch
   * Kontingent frei waere; er heisst, dass seit dem Einbau des Zaehlers kaum
   * noch etwas durchkam. Aussagekraeftig wird er ab dem ersten vollen Tag.
   */
  const heute = new Date().toISOString().slice(0, 10);
  const zaehlerGilt = bestand?.schreibTag === heute;

  const data = {
    updated: new Date().toISOString(),
    regime,
    count: items.length,
    errors: teil.errors,
    items,
    gesehen: gedaechtnis,
    schreibTag: heute,
    verzug,
    // Alles seit dem letzten Sichern, plus dieses hier.
    schreibungen: (zaehlerGilt ? bestand.schreibungen || 0 : 0) + offeneSchreibungen + 1,
    /*
     * Auch die abgewiesenen Versuche wandern mit in den Bestand.
     *
     * Im Arbeitsspeicher allein nuetzten sie nichts: /health landet in einem
     * anderen Isolat als der Tick und sah dort immer null. Abgelegt gibt die
     * Zahl das, worum es geht - stossen wir an die tausend, oder nicht.
     */
    schreibVersuche: (zaehlerGilt ? bestand.schreibVersuche || 0 : 0) + versucheSeitAblage,
    schreibFehler: (zaehlerGilt ? bestand.schreibFehler || 0 : 0) + fehlerSeitAblage,
    /*
     * Der Taktgeber gehoert hierher, nicht in den Urteilsspeicher.
     * Dort wurde er nur alle zehn Minuten und nur bei frischen Urteilen
     * erneuert - und stand deshalb stundenlang auf einem alten Eintrag,
     * waehrend der Taktgeber laengst wieder lief.
     */
    ticks: (() => {
      const zusammen = {
        ...(bestand?.ticks || {}),
        // Aus demselben Grund wie beim Verzug: KV kann eingefroren sein.
        // Sonst verschwand ein Taktgeber aus der Anzeige, obwohl er lief.
        ...(z.ticks || {}),
        ...taktVermerk,
        [quelle]: {
          zeit: new Date().toISOString(),
          meldungen: items.length,
          offen: items.filter(brauchtPruefung).length,
        },
      };
      /*
       * Verstummte Taktgeber nach zwei Stunden vergessen.
       *
       * Sonst sammeln sich Eintraege aus frueheren Fassungen und einmaligen
       * Aufrufen an, und die Liste wird laenger statt aussagekraeftiger. Wer
       * zwei Stunden nichts von sich hoeren liess, ist kein Taktgeber mehr.
       */
      const grenze = Date.now() - 2 * 3600_000;
      for (const [q, t] of Object.entries(zusammen)) {
        if (new Date(t.zeit).getTime() < grenze) delete zusammen[q];
      }
      return zusammen;
    })(),
  };

  /*
   * Sichern, wenn es etwas zu sichern gibt.
   *
   * Zwingend bei neuen Meldungen und bei frischen Urteilen. Sonst genuegt ein
   * Herzschlag alle fuenf Minuten, damit der Zeitstempel nicht einfriert; die
   * uebrigen Durchgaenge liefern ihr Ergebnis aus, ohne es abzulegen -
   * berechnet wird es ohnehin jedes Mal neu.
   */
  /*
   * Nahe am Limit nur noch das Nötigste.
   *
   * Neue Meldungen müssen abgelegt werden — sonst gelten sie beim nächsten
   * Durchgang wieder als neu. Der Herzschlag hält dagegen nur den Zeitstempel
   * frisch und darf warten, bis sich das Kontingent um Mitternacht erneuert.
   */
  const mussSichern = kandidaten.length > 0
    || neueUrteile > 0
    || (!sparsam && alterMs(bestand) >= BESTAND_HERZSCHLAG_MS);
  const gesichert = mussSichern
    ? await schreiben(env, ctx, KEY, data, BESTAND_TTL)
    : false;
  // Die Summe ist verbucht; das Zaehlwerk faengt von vorn an.
  /*
   * Buchfuehrung ins Durable Object, nebenher.
   *
   * Zaehler, Taktgeber, Verzug und der Zeitpunkt des letzten Nachlaufs liegen
   * dort - unabhaengig davon, ob KV gerade schreiben kann. Nur so stimmt die
   * Anzeige auch dann, wenn das Kontingent erschoepft ist.
   */
  const buchung = {
    /*
     * Auch die Modellauskunft gehoert hierher.
     *
     * Sie entsteht im Arbeitsspeicher desjenigen Prozesses, der gerade Groq
     * anfragt - und /health antwortet fast immer aus einem anderen. Ohne diese
     * Buchung stand dort dauerhaft "noch keine Anfrage seit dem Start",
     * waehrend nebenan der Pruefzaehler stieg.
     */
    ...(Object.keys(gewaehlteModelle).length ? { kiModelle: { ...gewaehlteModelle } } : {}),
    ...(Object.keys(kontingent).length ? { kiKontingent: { ...kontingent } } : {}),
    schreibVersuche: versucheSeitAblage,
    schreibFehler: fehlerSeitAblage,
    // Der Zeitpunkt des letzten Fehlschlags gehoert dorthin, wo ihn jeder
    // Aufruf sieht - im Isolat sah ihn nur der, in dem er passiert war.
    ...(letzterAblageFehler ? { letzteAblageStoerung: letzterAblageFehler } : {}),
    ...(letzterVersandbuchFehler ? { letzteVersandStoerung: letzterVersandbuchFehler } : {}),
    ...(nachlaufErgebnis ? { nachlaufErgebnis } : {}),
    /*
     * Nur den neueren Stand behalten.
     *
     * Der Vermerk sprang in der Anzeige hin und her - 1 min, dann 9, dann 4 -,
     * weil jedes Isolat seinen eigenen Arbeitsspeicher hineinschrieb und dabei
     * einen neueren Eintrag ueberschrieb. Ein Zeitpunkt, der zurueckspringt,
     * taugt nicht zur Entscheidung, ob der alte Weg noch benutzt wird.
     */
    ...(adressZugangZuletzt
      && (!z.adressZugang || adressZugangZuletzt.zeit > z.adressZugang.zeit)
      ? { adressZugang: adressZugangZuletzt } : {}),
    /*
     * Zusammenfuehren, nicht ersetzen.
     *
     * Diese Felder sind Objekte, und das Durable Object ersetzt Objekte als
     * Ganzes. Kam der Wert nur aus dem eingefrorenen Bestand, loeschte jede
     * Buchung die Eintraege wieder, die ein anderes Isolat beigesteuert hatte
     * - der zweite Taktgeber verschwand so aus der Anzeige, obwohl er lief.
     */
    ticks: { ...(z.ticks || {}), ...data.ticks },
    verzug: { ...(z.verzug || {}), ...data.verzug },
    // Wird als Ganzes ersetzt - deshalb hier vollstaendig neu gebildet.
    ...(gescheitert.length || Object.keys(pruefBuch).length
      ? { pruefFehler: fehlerbuchFortschreiben(pruefBuch, gescheitert, items),
          pruefFehlerStand: ANWEISUNG_STAND }
      : { pruefFehlerStand: ANWEISUNG_STAND }),
  };
  if (speicher.letzterNachlauf) buchung.letzterNachlauf = speicher.letzterNachlauf;
  ctx.waitUntil(zustand(env, buchung));

  versucheSeitAblage = 0;
  fehlerSeitAblage = 0;
  if (gesichert) offeneSchreibungen = 0;

  /*
   * Melden. Ob das Ablegen gelang, spielt dafuer keine Rolle mehr.
   *
   * Bis eben galt: ohne erfolgreiche Ablage keine Meldung, weil sonst dieselbe
   * Nachricht beim naechsten Durchgang wieder als neu gegolten haette. Das war
   * die richtige Vorsicht, solange das Gedaechtnis in KV lag - und es kostete
   * jede Benachrichtigung, sobald das Schreibkontingent erschoepft war.
   *
   * Diese Frage beantwortet jetzt das Versandbuch, und zwar verlaesslich. Also
   * darf wieder gemeldet werden, auch wenn gerade nichts abgelegt werden kann.
   */
  const versand = bestand
    ? await pushen(env, ctx, kandidaten)
    : { versucht: false, grund: 'erster Lauf' };

  // Das Wochenbuch ist Chronik, keine Betriebsnotwendigkeit - es tritt zurueck.
  if (!sparsam) ctx.waitUntil(wochenbuchPflegen(env, ctx, items));
  return { data, neue: kandidaten, versand, gesichert };
}

/**
 * Nur den Kalender nachziehen — der billigste Weg zu frischen Zahlen.
 *
 * Fällt die Kalenderquelle aus (MyFXBook sperrt Anfragen aus Rechenzentren
 * zeitweise mit 403), ist der Bestand trotzdem aktuell: Die übrigen fünfzehn
 * Quellen pflegt der Cron weiter. Der Zeitstempel darf deshalb nicht auf dem
 * alten Stand einfrieren — sonst meldet die App fälschlich veraltete Daten.
 */
async function kalenderNachziehen(env, ctx, regime, bestand) {
  let frisch = [];
  let fehler = null;
  try {
    frisch = enrich(await loadCalendar(regime));
  } catch (err) {
    fehler = `Wirtschaftskalender: ${err.message}`;
  }

  const { items, neue } = zusammenfuehren(bestand, frisch);
  const errors = fehler
    ? [...(bestand.errors || []).filter((e) => !e.startsWith('Wirtschaftskalender')), fehler]
    : (bestand.errors || []).filter((e) => !e.startsWith('Wirtschaftskalender'));

  /*
   * Auch dieser Pfad pflegt das Gedaechtnis.
   *
   * Er laeuft bei jeder Anfrage der App, also alle zwoelf Sekunden, und kann
   * dabei neue Kalendereintraege in den Bestand holen. Wurden sie hier nicht
   * vermerkt, galten sie spaeter - nach dem Herausrotieren und erneutem
   * Auftauchen - als unbekannt und loesten eine Benachrichtigung aus.
   */
  const gesehen = new Set(bestand.gesehen || []);
  for (const n of items) gesehen.add(n.id);

  const data = {
    ...bestand, items, errors,
    count: items.length,
    updated: new Date().toISOString(),
    gesehen: [...gesehen].slice(-GESEHEN_MAX),
  };
  /*
   * Bewusst ohne Ablage: Das Ergebnis gilt nur fuer diese eine Antwort. Der
   * Tick holt den Kalender ohnehin bei jedem Durchgang mit und legt ihn ab.
   */
  ctx.waitUntil(wochenbuchPflegen(env, ctx, items));
  return { data, neue };
}

/**
 * Laesst neue Meldungen vom Sprachmodell gegenlesen und korrigiert das Urteil.
 *
 * Stichworte allein tragen nur so weit. Ueber die Zeit hat sich ein Dutzend
 * Faelle gezeigt, in denen dasselbe Wort das Gegenteil bedeutete: "tames rate
 * hike hopes" ist keine Straffung, "inflation cooling faster than expected"
 * keine Beschleunigung, "travel to end the war" keine Eskalation, "unless the
 * Fed cuts rates" keine Zinssenkung. Jeder Fall liess sich als Regel nachtragen
 * - der naechste kommt trotzdem, weil Sprache mehr Wendungen kennt, als sich
 * aufschreiben lassen.
 *
 * Deshalb liest das Modell alles gegen, was ueberhaupt handelbar sein koennte.
 * Widerspricht es dem Regelwerk deutlich, gilt seine Einschaetzung: Es liest
 * den Satz, das Regelwerk nur die Woerter darin. Die Herleitung der Regel
 * bleibt sichtbar, damit nachvollziehbar ist, wie es zum ersten Urteil kam.
 */
async function gegenlesen(items, env, hoechstens = GEGENPROBE_MAX, buch = {}, zweck = 'pruefung') {
  if (hoechstens <= 0) return 0;
  if (!env.GROQ_KEY) return;

  const kandidaten = items
    // Wer dreimal nicht durchging, kommt nicht wieder an die Reihe.
    .filter((n) => brauchtPruefung(n) && (buch[n.id] || 0) < PRUEF_VERSUCHE_MAX)
    .sort((a, b) => Math.abs(b.scores.crypto) * b.priority
                  - Math.abs(a.scores.crypto) * a.priority)
    .slice(0, hoechstens);

  if (!kandidaten.length) return 0;

  // Nebeneinander abfragen: nacheinander summierte sich die Wartezeit.
  /*
   * Im Stapel fragen, nicht einzeln.
   *
   * Einzeln kostete eine Pruefung rund 4.800 Token, weil die Anweisung jedes
   * Mal vollstaendig mitging und das Modell jedes Mal neu nachdachte. Bei acht
   * Meldungen faellt beides einmal an statt achtmal.
   */
  const deutungen = await deutenStapel(kandidaten, env, zweck);

  // Was nicht durchging, wird vermerkt - sonst wiederholt es sich endlos.
  /*
   * Ausgenommen sind Kontingentabsagen.
   *
   * Sie sagen nichts ueber die Meldung, sondern nur ueber den Zeitpunkt. Wer
   * sie mitzaehlt, gibt beim schnellen Aufholen ausgerechnet die Meldungen
   * auf, die er gerade nachziehen will - nach drei Absagen waeren sie
   * dauerhaft aussortiert.
   */
  const gescheitert = kandidaten
    .filter((n, i) => {
      const d = deutungen[i];
      if (!d) return true;
      if (!d.fehler) return false;
      return !/Kontingent|429|rate limit|zu viele/i.test(d.fehler);
    })
    .map((n) => n.id);

  kandidaten.forEach((n, i) => {
    const deutung = deutungen[i];
    if (!deutung || deutung.fehler) return;

    n.ki = deutung;
    n.kiWiderspruch = widerspruch(n.scores.crypto, deutung);

    if (!n.kiWiderspruch) return;

    // Urteil korrigieren, die urspruengliche Bewertung aufheben.
    /*
     * Die urspruengliche Bewertung nur beim ersten Mal festhalten.
     *
     * Wird eine bereits berichtigte Meldung erneut geprueft, steht in n.scores
     * schon das Urteil des Modells - ohne diese Bedingung ginge die Herleitung
     * des Regelwerks verloren und die Anzeige "Regel sagte ..." zeigte den
     * eigenen Wert der KI.
     */
    if (!n.kiKorrigiert) {
      n.regelScores = n.scores;
      n.regelLabel = n.label;
    }
    n.kiKorrigiert = true;

    const kiWert = deutung.richtung === 'neutral' ? 0
      : (deutung.richtung === 'bullish' ? 1 : -1) * deutung.staerke;

    // Dieselben Verhaeltnisse zwischen den Anlageklassen wie im Regelwerk:
    // Was Krypto stuetzt, stuetzt Aktien etwas schwaecher und belastet den Dollar.
    n.scores = {
      crypto: +kiWert.toFixed(3),
      stocks: +(kiWert * 0.85).toFixed(3),
      gold: +(kiWert * 0.8).toFixed(3),
      usd: +(-kiWert).toFixed(3),
    };
    n.label = label(kiWert);
    n.labelText = LABEL_TEXT[n.label];
  });

  // Der Verbrauch wird zentral in deuten.mjs gefuehrt; hier zaehlt nur, wie
  // viele Meldungen durchgegangen sind - und welche nicht.
  return {
    anzahl: kandidaten.length,
    gescheitert,
    // Der erste Grund, warum etwas nicht durchging - fuer die Ablage unten.
    fehler: (deutungen.find((d) => d?.fehler) || {}).fehler || null,
    genommen: kandidaten.filter((n) => n.ki?.inhalt !== undefined && !deutungen[kandidaten.indexOf(n)]?.fehler).length,
  };
}

// --- Benachrichtigungen ---------------------------------------------------
/** Welche der neuen Meldungen verdienen eine Push-Nachricht? */
function meldenswert(items, abo) {
  const asset = abo.asset || 'crypto';

  return items.filter((n) => {
    // Was die Einstufung als Rauschen kennzeichnet, gehoert nie in eine
    // Benachrichtigung - Kursprognosen und Projektmeldungen etwa erschienen
    // sonst mehrfach am Tag, weil die Redaktionen sie laufend neu fassen.
    if (n.impactLevel === 'ignore') return false;

    // Bei "nur starke Signale" zaehlt auch die Handelswirkung, nicht allein
    // die Richtung: Ein starkes Sentiment ohne Marktwirkung weckt niemanden.
    if (abo.stufe === 'strong' && n.impactLevel === 'low') return false;

    const l = label(n.scores?.[asset] ?? 0);
    return abo.stufe === 'strong' ? l.startsWith('strong') : l !== 'neutral';
  });
}

/*
 * Fragt das Versandbuch, was davon wirklich noch nicht hinausging.
 *
 * Der Eintrag geschieht dort im selben Zug wie die Abfrage, und ein zweiter
 * Aufruf wartet, bis dieser fertig ist. Zwei gleichzeitige Durchgaenge koennen
 * dieselbe Meldung also nicht beide als neu sehen. Damit sind mehrere
 * Taktgeber im Minutentakt wieder unbedenklich - die Zusicherung, die KV nicht
 * geben konnte.
 *
 * Faellt das Versandbuch aus, geht nichts hinaus. Das ist Absicht: Bei
 * dieser Frage ist eine verpasste Meldung das kleinere Uebel als dieselbe zum
 * dritten Mal.
 */
let letzterVersandbuchFehler = null;

// Verbrauch der Uebersetzung, bis der naechste Durchgang ihn mitverbucht.

/*
 * Bremsen, die ohne Ablage auskommen.
 *
 * Alle Drosseln hingen bisher an Werten aus KV: wann zuletzt nachgeprueft
 * wurde, wie viele Token der Tag schon gekostet hat. Kann KV nicht schreiben,
 * bleiben diese Werte stehen - und der Worker haelt bei jedem Durchgang fuer
 * neu, was er eine Minute zuvor schon getan hat. Aus einer Pruefung alle zehn
 * Minuten wurden so drei je Minute, und Groq wies dreitausend Anfragen am Tag
 * ab. Die Absicherung hatte sich selbst ausgehebelt.
 *
 * Diese beiden Werte leben im Arbeitsspeicher des Isolats und ueberstehen
 * einen Ausfall der Ablage. Sie sind nicht exakt - ein neues Isolat faengt bei
 * null an -, aber sie begrenzen den Schaden auf ein Vielfaches statt auf ein
 * Vielhundertfaches.
 */
let nachlaufZuletzt = 0;
let tokenSeitStart = 0;

/**
 * Liest oder ergaenzt den kleinen Betriebszustand im Durable Object.
 *
 * Ohne Argument nur lesen. Mit `aenderung` werden Zahlen addiert und alles
 * andere ersetzt; zurueck kommt der neue Stand. Faellt das Objekt aus, gibt es
 * null - der Betrieb laeuft dann ohne Buchfuehrung weiter, statt zu scheitern.
 */
async function zustand(env, aenderung = null) {
  if (!env.VERSANDBUCH) return null;
  try {
    const stub = env.VERSANDBUCH.get(env.VERSANDBUCH.idFromName('global'));
    const res = await stub.fetch('https://versandbuch.intern/zustand', aenderung
      ? { method: 'POST', body: JSON.stringify(aenderung) }
      : undefined);
    return res.ok ? await res.json() : null;
  } catch (err) {
    console.log('Zustand:', err.message);
    return null;
  }
}

async function nochNichtGemeldet(env, items, nurLesen = false) {
  if (!env.VERSANDBUCH) return items;          // ohne Bindung wie bisher

  try {
    const stub = env.VERSANDBUCH.get(env.VERSANDBUCH.idFromName('global'));
    const res = await stub.fetch('https://versandbuch.intern/', {
      method: 'POST',
      body: JSON.stringify({ ids: items.map((n) => n.id), nurLesen }),
    });
    if (!res.ok) throw new Error(`Versandbuch ${res.status}`);

    const { neu } = await res.json();
    const erlaubt = new Set(neu);
    return items.filter((n) => erlaubt.has(n.id));
  } catch (err) {
    console.log('Versandbuch:', err.message);
    letzterVersandbuchFehler = { zeit: new Date().toISOString(), fehler: err.message.slice(0, 120) };
    // Ist das Versandbuch selbst gestoert, kann auch das hier fehlschlagen -
    // zustand() faengt das ab und liefert null. Dann bleibt der Wert im Isolat.
    await zustand(env, { letzteVersandStoerung: letzterVersandbuchFehler });
    return [];
  }
}

async function pushen(env, ctx, neueItems) {
  const abo = await lesen(env, ABO_KEY);
  if (!abo?.ziele?.length) return { versucht: false, grund: 'kein Abo hinterlegt' };
  if (abo.stufe === 'off') return { versucht: false, grund: 'Benachrichtigungen aus' };
  if (!neueItems?.length) return { versucht: false, grund: 'nichts Neues' };

  const vorauswahl = meldenswert(neueItems, abo);
  if (!vorauswahl.length) {
    return { versucht: false, grund: `${neueItems.length} neu, aber keine mit Richtung` };
  }

  // Erst hier faellt die Entscheidung, und sie faellt genau einmal je Meldung.
  const treffer = await nochNichtGemeldet(env, vorauswahl);
  if (!treffer.length) {
    return {
      versucht: false,
      grund: letzterVersandbuchFehler
        ? 'Versandbuch nicht erreichbar - nichts gemeldet'
        : `${vorauswahl.length} bereits gemeldet`,
    };
  }

  /*
   * Ruhezeit. Der Worker läuft alle zwei Minuten; ohne Abstand wären das bis zu
   * 720 Nachrichten am Tag, und kostenlose Push-Dienste sperren lange vorher.
   * Zehn Minuten Abstand halten den Kanal brauchbar, ohne dass etwas verloren
   * geht: Was in der Ruhezeit auflief, steht in der nächsten Sammelmeldung.
   * Extremereignisse - Börsen-Hack, Zinsentscheid - kommen sofort durch.
   */
  const dringend = treffer.some((n) => n.impactLevel === 'extreme');

  // Nur Kanäle mit Tageslimit werden gedrosselt; alle anderen bekommen sofort.
  const gedrosselt = abo.ziele.filter((z) => BRAUCHT_RUHE.has(z.typ));
  const sofort = abo.ziele.filter((z) => !BRAUCHT_RUHE.has(z.typ));

  let ziele = abo.ziele;
  if (gedrosselt.length && !dringend) {
    const sperre = await lesen(env, SPERRE_KEY);
    const seitLetztem = sperre?.zeit ? Date.now() - sperre.zeit : Infinity;
    if (seitLetztem < RUHE_MS) {
      if (!sofort.length) {
        return {
          versucht: false,
          grund: `Ruhezeit für ${gedrosselt.map((z) => z.typ).join(', ')}, noch ${Math.ceil((RUHE_MS - seitLetztem) / 60000)} Min`,
          zurueckgestellt: treffer.length,
        };
      }
      ziele = sofort;   // Discord und Co. bekommen die Meldung trotzdem
    }
  }

  const sprache = abo.lang === 'en' ? 'en' : 'de';
  const asset = abo.asset || 'crypto';
  const top = treffer.sort((a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]))[0];

  const l = label(top.scores[asset]);
  const titelText = `${l.startsWith('strong') ? 'STARK ' : ''}${l.replace('strong_', '').toUpperCase()} · ${asset.toUpperCase()}`;
  const body = [
    sprache === 'de' ? (top.titleDe || top.title) : top.title,
    `${IMPACT_TEXT[sprache][top.impactLevel]} · ${DURATION_TEXT[sprache][top.duration]}`,
    // Sind sich Regelwerk und Modell uneins, steht das dabei - wer danach
    // handelt, soll es vorher wissen.
    top.kiWiderspruch
      ? (sprache === 'de'
          ? `KI-Analyse weicht ab: ${top.ki.grund}`
          : `AI analysis differs: ${top.ki.grund}`)
      : '',
    treffer.length > 1 ? `+${treffer.length - 1} ${sprache === 'de' ? 'weitere' : 'more'}` : '',
  ].filter(Boolean).join('\n');

  const ergebnis = await sendeAn(ziele, titelText, body);
  if (ergebnis.gesendet && ziele.some((z) => BRAUCHT_RUHE.has(z.typ))) {
    await schreiben(env, ctx, SPERRE_KEY, { zeit: Date.now() }, BESTAND_TTL);
  }
  return {
    versucht: true,
    dringend,
    treffer: treffer.length,
    gesendet: ergebnis.gesendet,
    fehler: ergebnis.fehler,
    titel: titelText,
    kanaele: ziele.map((z) => z.typ),
    // Woruber benachrichtigt wurde - der Aufrufer vermerkt es im Bestand.
    ids: ergebnis.gesendet ? treffer.map((n) => n.id) : [],
  };
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);

    /*
     * Doppelte Schraegstriche zusammenziehen.
     *
     * Traegt die hinterlegte Worker-Adresse einen Schraegstrich am Ende, wird
     * daraus //tick. Das traf auf keinen der Wege zu und fiel still auf die
     * Meldungsliste durch - mit HTTP 200, im Protokoll also nicht von einem
     * Erfolg zu unterscheiden. Der Bestand waere unbemerkt eingefroren.
     */
    url.pathname = url.pathname.replace(/\/{2,}/g, '/');

    const regime = env.REGIME || 'policy';

    if (!zugangGeprueft(request, url, env)) {
      return json({ fehler: 'Zugangswort fehlt oder stimmt nicht' }, 401);
    }

    if (url.pathname === '/health') {
      const bestand = await lesen(env, KEY);
      const abo = await lesen(env, ABO_KEY);
      const buch = await lesen(env, WOCHE_KEY);
      const urteilSpeicher = await lesen(env, URTEILE_KEY);
      const zNow = (await zustand(env)) || {};
      return json({
        ok: true,
        zeit: new Date().toISOString(),
        ablage: env.STORE ? 'kv' : 'cache',
        /*
         * Kein Probeschreiben mehr.
         *
         * Es schrieb bei jedem Aufruf von /health einen eigenen Eintrag und
         * verbrauchte damit genau das Kontingent, ueber das es Auskunft geben
         * sollte - bei einer App, die regelmaessig nachfragt, ein spuerbarer
         * Posten. Und es log: Es meldete "blockiert", waehrend der Bestand
         * nachweislich weiter abgelegt wurde.
         *
         * Stattdessen zaehlt der letzte tatsaechliche Fehlschlag. Liegt keiner
         * vor oder ist er alt, laeuft die Ablage.
         */
        /*
         * Aus dem Durable Object, nicht aus diesem Isolat.
         *
         * Sonst meldete /health "ja", waehrend der Zaehler daneben abgewiesene
         * Versuche auswies - der Fehlschlag war in einem anderen Isolat
         * passiert und hier schlicht unbekannt.
         */
        ablageSchreibt: (() => {
          // Kuerzere Frist als bei der Stoerungsliste: Ob gerade geschrieben
          // werden kann, ist eine Aussage ueber jetzt, keine Chronik.
          const st = zNow.letzteAblageStoerung || letzterAblageFehler;
          if (!st || Date.now() - new Date(st.zeit).getTime() > 10 * 60_000) return 'ja';
          return `NEIN - ${st.fehler}`;
        })(),
        zweitmeinung: env.GROQ_KEY ? 'eingerichtet' : 'kein Schluessel',
        uebersetzung: env.GROQ_KEY ? 'Groq'
          : (env.DEEPL_KEY ? 'DeepL' : 'MyMemory (ohne Schluessel)'),
        wochenbuch: buch?.tage ? `${Object.keys(buch.tage).length} Tage` : 'noch leer',
        /*
         * Steht das Zugangswort noch in Adressen?
         *
         * Dann liegt es in den Protokollen von Cloudflare und des Taktgebers.
         * Erst wenn hier laengere Zeit nichts mehr auftaucht, kann der Weg
         * ueber die Adresse gefahrlos geschlossen werden.
         */
        zugangInAdresse: (() => {
          const a = zNow.adressZugang || adressZugangZuletzt;
          if (!a) return 'nein - nur noch ueber die Kopfzeile';
          const min = Math.round((Date.now() - new Date(a.zeit).getTime()) / 60000);
          return `JA - zuletzt vor ${min} min auf ${a.pfad}`;
        })(),
        zugang: env.ZUGANG
          ? 'geschuetzt'
          : 'OFFEN - jeder mit dieser Adresse kann das Abo aendern und das Kontingent verbrauchen',
        meldungen: bestand?.items?.length ?? 0,
        alterSekunden: Math.round(alterMs(bestand) / 1000),
        schreibvorgaenge: `${zNow.schreibVersuche ?? 0} von ${ABLAGE_TAGESLIMIT}`
          + (zNow.schreibFehler ? ` — ${zNow.schreibFehler} abgewiesen` : '')
          + ((zNow.schreibVersuche ?? 0) >= ABLAGE_SPARSAM_AB ? ' · Sparbetrieb' : ''),
        /*
         * Alle drei aus dem Durable Object, mit dem eigenen Isolat als Notnagel.
         *
         * Vorher lasen sie nur den Arbeitsspeicher dieses Prozesses - und der
         * hat nie geschrieben, nie getickt, nie gemeldet. Die Anzeige stand
         * deshalb auf "keiner seit dem Start", waehrend der Zaehler daneben
         * 25 abgewiesene Schreibvorgaenge auswies. Die Stoerungsliste der App
         * haengt an genau diesen Feldern und blieb damit dauerhaft leer.
         */
        letzterTickFehler: frischeStoerung(zNow.letzteTickStoerung, letzterTickFehler)
          ?? 'keiner seit dem Start',
        letzterAblageFehler: frischeStoerung(zNow.letzteAblageStoerung, letzterAblageFehler)
          ?? 'keiner seit dem Start',
        versandbuch: env.VERSANDBUCH
          ? (frischeStoerung(zNow.letzteVersandStoerung, letzterVersandbuchFehler) ?? 'bereit')
          : 'NICHT gebunden - Doppelmeldungen moeglich',
        /*
         * Gemessen an dem, was überhaupt geprüft wird.
         *
         * Vorher stand hier "46 von 245" — verglichen mit allen Meldungen,
         * obwohl 191 davon als "ignorieren" eingestuft sind und nie angefragt
         * werden. Das las sich wie 19 Prozent, tatsächlich waren 85 Prozent
         * des Relevanten erledigt. Eine Zahl, die schlechter aussieht als die
         * Lage, taugt zur Beurteilung so wenig wie eine geschönte.
         */
        geprueft: (() => {
          const alle = bestand?.items || [];
          /*
           * Dasselbe Merkmal wie der Nachlauf, nicht ein eigenes.
           *
           * Sonst zaehlte die Anzeige ein Urteil aus veralteten Regeln als
           * erledigt, waehrend es im Hintergrund neu geprueft wurde - und
           * meldete 68 von 82 fertig, obwohl 82 offen waren.
           */
          const handelbar = alle.filter((n) => n.impactLevel !== 'ignore');
          const fertig = handelbar.length - handelbar.filter(brauchtPruefung).length;
          if (!handelbar.length) return 'nichts Handelbares im Bestand';
          /*
           * Aufgegebene getrennt ausweisen.
           *
           * Sonst stuenden Meldungen, die nach drei Fehlversuchen nicht mehr
           * angefragt werden, dauerhaft als "offen" da - eine Zahl, die sich
           * nie bewegt und nichts mehr bedeutet.
           */
          const buch = zNow.pruefFehler || {};
          const offen = handelbar.filter(brauchtPruefung);
          const aufgegeben = offen.filter((n) => (buch[n.id] || 0) >= PRUEF_VERSUCHE_MAX).length;

          return `${fertig} von ${handelbar.length} handelbaren`
            + (offen.length - aufgegeben > 0 ? ` · ${offen.length - aufgegeben} offen` : '')
            + (aufgegeben ? ` · ${aufgegeben} aufgegeben (${PRUEF_VERSUCHE_MAX}x vergeblich)` : '')
            + ` (${alle.length - handelbar.length} ohne Handelsbezug)`;
        })(),
        berichtigt: bestand?.items?.filter((n) => n.kiKorrigiert).length ?? 0,
        /*
         * Groqs eigene Abrechnung, wenn sie vorliegt.
         *
         * Der eigene Zaehler kennt nur, was dieses Isolat gesehen hat. Nach
         * einem Umzug der Ablage stand er bei 904, waehrend Groq 199.710
         * meldete - die Zahl war unbrauchbar. Groq nennt seinen Stand in jeder
         * Ablehnung; sobald er vorliegt, gilt er.
         */
        /*
         * Je Modell, nicht als Summe.
         *
         * Die Summe meldete "205.159 von 200.000", obwohl kein Modell auch nur
         * in die Naehe seiner Grenze kam: Die Last verteilte sich auf zwei
         * Kontingente zu je 200.000. Eine Zahl, die Erschoepfung meldet, wo
         * keine ist, ist so schaedlich wie eine, die sie verschweigt.
         */
        kiJeModell: (() => {
          const eig = zNow.tokenJeModell || {};
          if (!Object.keys(eig).length) return 'noch nichts verbraucht';
          const zahl = (n) => Math.round(n).toLocaleString('de-DE');
          return Object.entries(eig)
            .sort((a, b) => b[1] - a[1])
            .map(([m, n]) => `${aufgabeVon(m, zNow.kiModelle)}: ${zahl(n)} von 200.000`)
            .join(' · ');
        })(),
        kiBudget: (() => {
          const staende = { ...(zNow.groqTag || {}), ...tagesverbrauch };
          const frisch = Object.entries(staende)
            .filter(([, g]) => Date.now() - new Date(g.stand).getTime() < 6 * 3600_000);

          if (!frisch.length) {
            const eigen = budgetRest({ tag: zNow.tag, tokens: zNow.tokens }).verbraucht;
            return `mindestens ${eigen.toLocaleString('de-DE')} von 200.000 Token heute`
              + ` (selbst gezaehlt; Groq nennt seinen Stand erst, wenn ein Limit greift)`;
          }
          const zahl = (n) => n.toLocaleString('de-DE');
          return frisch
            .map(([m, g]) => `${aufgabeVon(m)}: ${zahl(g.verbraucht)} von ${zahl(g.limit)}`)
            .join(' · ') + ' Token heute (Angabe von Groq)';
        })(),
        /*
         * Wer gerade was macht.
         *
         * Jedes Modell hat bei Groq sein eigenes Tageskontingent. Die Zuordnung
         * ist der Grund, warum eine erschoepfte Dauerpruefung eine eigene Frage
         * nicht mehr blockiert - deshalb steht sie hier sichtbar.
         */
        kiModelle: (() => {
          const belegung = { ...(zNow.kiModelle || {}), ...gewaehlteModelle };
          return Object.keys(belegung).length
            ? Object.entries(belegung)
                .map(([zweck, m]) => `${AUFGABE[zweck] || zweck}: ${m}`).join(' · ')
            : 'noch keine Anfrage seit dem Start';
        })(),
        /*
         * Die abgeschlossenen Tage, neueste zuerst.
         *
         * Die laufenden Zaehler springen um Mitternacht UTC auf null. Ohne
         * dieses Tagebuch muesste man genau den Moment davor treffen, um die
         * Bilanz eines Tages zu sehen - eine Minute zu spaet, und sie ist weg.
         */
        tagebuch: Object.entries(zNow.tage || {})
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([tag, w]) => {
            const zahl = (n) => (n ?? 0).toLocaleString('de-DE');
            /*
             * Nur echte Modellstaende ausgeben.
             *
             * Frueher lag unter groqTag ein einzelner, modellloser Stand. Ohne
             * diese Pruefung wurden dessen Felder als Modelle gelesen, und im
             * Tagebuch stand "Groq: limit 0/0, verbraucht 0/0, stand 0/0" -
             * genau so ist der erste Eintrag herausgekommen.
             */
            const staende = Object.entries(w.groq || {})
              .filter(([, g]) => g && typeof g === 'object' && typeof g.verbraucht === 'number');
            const groq = staende.length
              ? ' · Groq: ' + staende
                  .map(([m, g]) => `${aufgabeVon(m, zNow.kiModelle)} ${zahl(g.verbraucht)}/${zahl(g.limit)}`)
                  .join(', ')
              : '';
            return `${tag}: ${zahl(w.ablagen)} Ablagen`
              + (w.abgewiesen ? ` (${zahl(w.abgewiesen)} abgewiesen)` : '')
              + ` · ${zahl(w.tokens)} Token` + groq;
          }),
        // Wie viele Meldungen der Nachlauf nicht mehr anfasst - ohne das war
        // nicht zu erkennen, warum der Zaehler stehenblieb.
        aufgegeben: (() => {
          const buch = (zNow.pruefFehlerStand || 0) === ANWEISUNG_STAND ? (zNow.pruefFehler || {}) : {};
          const n = Object.values(buch).filter((v) => v >= PRUEF_VERSUCHE_MAX).length;
          return n ? `${n} nach ${PRUEF_VERSUCHE_MAX} Fehlversuchen` : 'keine';
        })(),
        urteile: Object.keys(urteilSpeicher?.urteile || {}).length,
        letzterNachlauf: urteilSpeicher?.letzterNachlauf ?? 'noch keiner',
        // Was der letzte Nachlauf tatsaechlich bewirkt hat.
        nachlaufErgebnis: zNow.nachlaufErgebnis ?? 'noch keiner',
        /*
         * Minutenfenster je Modell, so wie Groq es in den Kopfzeilen meldet.
         *
         * Stehen hier zwei Modelle mit eigenen Restwerten, ist damit belegt,
         * dass tatsaechlich getrennt abgerechnet wird - das ist keine Annahme,
         * sondern Groqs eigene Auskunft zu jeder einzelnen Anfrage.
         */
        kontingent: (() => {
          const staende = { ...(zNow.kiKontingent || {}), ...kontingent };
          return Object.keys(staende).length
            ? Object.fromEntries(Object.entries(staende)
                .map(([m, k]) => [`${aufgabeVon(m, zNow.kiModelle)} (${m})`, k]))
            : 'seit dem Start keine Anfrage an Groq';
        })(),
        /*
         * Wer den Bestand auffrischt, mit Zeitstempel.
         *
         * cron-job.org schaltet einen Auftrag nach genuegend Fehlversuchen ab
         * und meldet das per E-Mail - die man auch uebersehen kann. Ohne diese
         * Zeile faellt ein stiller Taktgeber erst auf, wenn Meldungen
         * ausbleiben, und dann sucht man an der falschen Stelle.
         */
        /*
         * Wo die Zeit verlorengeht.
         *
         * Der Wert ist der mittlere Abstand zwischen dem Zeitstempel einer
         * Meldung und dem Moment, in dem wir sie erstmals sehen - ueber die
         * letzten dreissig Meldungen der Quelle. Ein hoher Wert liegt an der
         * Quelle, nicht an uns: Der Tick laeuft jede Minute.
         */
        verzug: Object.entries({ ...(bestand?.verzug || {}), ...(zNow.verzug || {}) })
          .map(([quelle, e]) => {
            const proben = e.proben?.length ?? 0;
            return proben >= VERZUG_MIN_PROBEN
              ? { quelle, sekunden: e.median ?? e.mittel ?? 0, proben }
              : { quelle, proben, hinweis: `noch ${VERZUG_MIN_PROBEN - proben} Proben noetig` };
          })
          .sort((a, b) => (b.sekunden ?? -1) - (a.sekunden ?? -1)),

        taktgeber: Object.entries(zNow.ticks || bestand?.ticks || {})
          .map(([quelle, t]) => ({ quelle, zeit: t.zeit, meldungen: t.meldungen, offen: t.offen }))
          .sort((a, b) => (b.zeit || '').localeCompare(a.zeit || '')),
        // Ohne hinterlegtes Abo verschickt der Worker nichts. Zeigt nur, ob
        // und wohin - niemals Token oder Themennamen.
        abo: abo ? {
          stufe: abo.stufe,
          kanaele: (abo.ziele || []).map((z) => z.typ + (z.token ? ' (mit Token)' : ' (ohne Token)')),
          anlageklasse: abo.asset,
        } : null,
      });
    }

    // Sofortversand, ausgelöst von der geöffneten App.
    if (url.pathname === '/notify' && request.method === 'POST') {
      try {
        const { titel, text, ziele } = await request.json();
        const r = await sendeAn(ziele, titel || 'Market Bias', text || '');
        return json(r, r.gesendet ? 200 : 502);
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    /**
     * Ersatz für den Cron-Trigger. Cloudflares eigener Zeitgeber lief bei
     * diesem Worker nicht an und meldet Fehlläufe auch nicht, deshalb lässt
     * sich derselbe Ablauf von außen anstoßen — durch die GitHub-Action oder
     * einen kostenlosen Cron-Dienst. Macht genau das, was scheduled() tut:
     * eine Feed-Gruppe abgleichen und fällige Benachrichtigungen verschicken.
     */
    /*
     * Der Taktgeber. Antwortet immer mit 200 - auch im Fehlerfall.
     *
     * Das ist bewusst so. cron-job.org zaehlt Fehlercodes und schaltet einen
     * Auftrag nach genuegend Fehlversuchen selbsttaetig ab; genau das ist
     * passiert, als das Schreibkontingent von KV erschoepft war und der Tick
     * mit 500 abbrach. Sechsundzwanzig Fehlversuche spaeter war der Taktgeber
     * still, und niemand hat es gemerkt - die App zeigte weiter Meldungen,
     * nur eben keine neuen mehr.
     *
     * Ein vorruebergehender Fehler darf den Taktgeber nicht kosten. Was
     * schiefging, steht im Rumpf unter `fehler` und im Systemzustand, nicht
     * im Statuscode.
     */
    if (url.pathname === '/tick') {
      // Herkunft kurz benennen: "cron-job.org" statt der ganzen Kennung.
      const roh = request.headers.get('x-quelle')
        || request.headers.get('user-agent') || '';
      const quelle = /cron-job\.org/i.test(roh) ? 'cron-job.org'
        : /github-action/i.test(roh) ? 'github-action'
        : (roh.match(/[A-Za-z][\w.-]{2,}/) || ['unbekannt'])[0].slice(0, 30);

      taktVermerk[quelle] = { zeit: new Date().toISOString() };

      try {
        const bestand = await lesen(env, KEY);

        /*
         * Reserve-Taktgeber treten zurueck, solange der Bestand frisch ist.
         *
         * Das ist der Kern gegen Doppelmeldungen: Wo nur ein Durchgang laeuft,
         * kann kein zweiter dieselbe Meldung fuer neu halten.
         */
        if (url.searchParams.get('fallback') === '1'
            && alterMs(bestand) < RESERVE_AB_MS) {
          /*
           * Auch der Rueckzug ist eine Lebenszeichen.
           *
           * Bisher meldete sich ein Reservetaktgeber nur an, wenn er
           * tatsaechlich tickte. Lief der Haupttaktgeber durch, stand er in
           * der Anzeige stundenlang auf "zuletzt vor 2 h" und wurde rot -
           * obwohl er im Minutentakt anfragte und pflichtgemaess zurueckwich.
           * Eine Warnung fuer richtiges Verhalten ist schlimmer als keine.
           */
          ctx.waitUntil(zustand(env, {
            ticks: { ...(((await zustand(env)) || {}).ticks || {}),
              [quelle]: { zeit: new Date().toISOString(), zurueckgetreten: true } },
          }));
          return json({
            ok: true,
            quelle,
            uebersprungen: true,
            grund: `Haupttaktgeber laeuft (Bestand ${Math.round(alterMs(bestand) / 1000)} s alt)`,
          });
        }

        const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;

        const { data, neue, versand, gesichert } =
          await teilAbgleich(env, ctx, regime, bestand, gruppe, quelle);

        return json({
          ok: true,
          quelle,
          gruppe,
          meldungen: data.count,
          nochNieGemeldet: neue.length,
          gesichert,
          versand,
          errors: data.errors,
        });
      } catch (err) {
        console.log('Tick fehlgeschlagen:', err.message);
        letzterTickFehler = { zeit: new Date().toISOString(), quelle, fehler: err.message.slice(0, 200) };
        // Auch hierhin, sonst kennt ihn nur dieses Isolat - und /health
        // antwortet fast immer aus einem anderen.
        ctx.waitUntil(zustand(env, { letzteTickStoerung: letzterTickFehler }));
        return json({ ok: false, quelle, fehler: err.message.slice(0, 300) });
      }
    }

    /**
     * Testversand über das hinterlegte Abo. Prüft genau den Weg, den auch die
     * automatischen Meldungen nehmen — im Unterschied zum Knopf in der App,
     * der bei geöffneter App direkt aus dem Browser sendet und deshalb an
     * anderen Sperren vorbeikommt. Zugangsdaten müssen dafür nirgends
     * eingegeben werden, sie liegen bereits im Abo.
     */
    if (url.pathname === '/testpush') {
      const abo = await lesen(env, ABO_KEY);
      if (!abo?.ziele?.length) return json({ ok: false, grund: 'kein Abo hinterlegt' }, 400);

      const r = await sendeAn(
        abo.ziele,
        'BULLISH · TEST',
        'Testnachricht über den Worker.' + String.fromCharCode(10) + 'Kommt sie an, funktioniert der Versand auch bei geschlossener App.'
      );
      return json({
        ok: r.gesendet > 0,
        gesendet: r.gesendet,
        fehler: r.fehler,
        kanaele: abo.ziele.map((z) => z.typ),
      }, r.gesendet ? 200 : 502);
    }

    /**
     * Kurzer Lagebericht zum Tag.
     *
     * Die Zahlen im Dashboard zeigen, wie einseitig der Tag ist - nicht, woran
     * es liegt. Das Ergebnis wird eine Viertelstunde vorgehalten: Der Bestand
     * aendert sich langsamer, und jeder Aufruf kostet sonst eine Anfrage.
     */
    if (url.pathname === '/tageslage') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);

      const klasse = (url.searchParams.get('asset') || 'crypto').slice(0, 12);
      const vorhanden = await lesen(env, LAGE_KEY);
      if (vorhanden?.[klasse] && Date.now() - new Date(vorhanden[klasse].stand) < LAGE_FRISCH_MS) {
        return json({ ...vorhanden[klasse], gespeichert: true });
      }

      const bestand = await lesen(env, KEY);
      if (!bestand?.items?.length) return json({ fehler: 'kein Bestand' }, 503);

      // Die gewichtigsten Meldungen des Tages, nicht einfach die neuesten.
      const grenze = Date.now() - 24 * 3600 * 1000;
      const auswahl = bestand.items
        .filter((n) => new Date(n.date).getTime() > grenze && n.impactLevel !== 'ignore')
        .sort((a, b) => Math.abs(b.scores[klasse] ?? 0) * b.priority
                      - Math.abs(a.scores[klasse] ?? 0) * a.priority)
        .slice(0, 14)
        .map((n) => ({ titel: n.title, wertung: (n.scores[klasse] ?? 0).toFixed(2) }));

      const ergebnis = await tageslage(auswahl, klasse, env);
      tokenBuchen(env, ctx);
      if (ergebnis?.lage) {
        await schreiben(env, ctx, LAGE_KEY, { ...vorhanden, [klasse]: ergebnis }, BESTAND_TTL);
      }
      return json(ergebnis || { fehler: 'keine Antwort' }, ergebnis?.fehler ? 502 : 200);
    }

    /**
     * Uebersetzt Anrisse auf Abruf.
     *
     * Die App schickt den Originaltext, nicht eine Kennung: So bleibt der
     * Worker zustandslos gegenueber dem Bestand, und ein Text, der in zwei
     * Meldungen gleich lautet, wird nur einmal uebersetzt.
     */
    if (url.pathname === '/uebersetzen' && request.method === 'POST') {
      let eingang;
      try {
        const body = await request.json();
        if (!Array.isArray(body?.texte) || !body.texte.length) {
          return json({ fehler: 'nichts zu uebersetzen' }, 400);
        }
        eingang = body.texte
          .slice(0, UEBERSETZUNG_JE_ABRUF)
          .map((t) => String(t).slice(0, 600))
          .filter(Boolean);
      } catch (err) {
        return json({ fehler: 'ungueltige Anfrage' }, 400);
      }
      if (!eingang.length) return json({ fehler: 'nichts zu uebersetzen' }, 400);

      const speicher = (await lesen(env, UEBERSETZUNG_KEY)) || {};
      const fehlend = [...new Set(eingang.filter((t) => !speicher[t]))];

      if (fehlend.length) {
        /*
         * Groq zuerst. Ein Sprachmodell trifft Boersensprache besser als ein
         * reiner Uebersetzungsdienst - MyMemory machte aus "hawkish bets"
         * woertlich "Falkenwetten". Der Schluessel liegt ohnehin schon hier.
         *
         * Ausdruecklich auf dem Uebersetzungsmodell: Es hat sein eigenes
         * Tageskontingent. Was hier verbraucht wird, fehlt damit weder der
         * laufenden Pruefung noch einer eigenen Frage.
         */
        const frisch = await uebersetze(fehlend, {
          groqKey: env.GROQ_KEY || '',
          modell: env.GROQ_KEY
            ? await modellWaehlen(env, 'uebersetzung').catch(() => undefined)
            : undefined,
          deeplKey: env.DEEPL_KEY || '',
          email: env.KONTAKT_MAIL || '',
        });
        fehlend.forEach((t, i) => { if (frisch.texte[i]) speicher[t] = frisch.texte[i]; });

        /*
         * Auch die Uebersetzung zahlt aus demselben Topf.
         *
         * Sie laeuft ueber docs/engine, nicht ueber deuten.mjs, und wurde
         * deshalb vom zentralen Zaehler nicht erfasst. uebersetze() meldet den
         * Verbrauch zurueck; hier wandert er in dieselbe Rechnung.
         */
        tokenBuchen(env, ctx, frisch.tokens || 0,
          await modellWaehlen(env, 'uebersetzung').catch(() => null));

        // Beschneiden, sonst waechst der Eintrag ueber die Groessengrenze von KV.
        const schluessel = Object.keys(speicher);
        const zuviel = schluessel.length - UEBERSETZUNG_MAX;
        if (zuviel > 0) for (const k of schluessel.slice(0, zuviel)) delete speicher[k];

        await schreiben(env, ctx, UEBERSETZUNG_KEY, speicher, BESTAND_TTL);
      }

      return json({ uebersetzungen: eingang.map((t) => speicher[t] ?? null) });
    }

    /**
     * Das Wochenbuch, roh.
     *
     * Bewusst unaufbereitet: Die Tage tragen alle vier Anlageklassen bei sich,
     * also kann die App zwischen Klassen und Wochen wechseln, ohne erneut zu
     * fragen - und der Worker bleibt weit unter seiner Rechenzeitgrenze.
     */
    if (url.pathname === '/woche') {
      const buch = await lesen(env, WOCHE_KEY);
      if (!buch?.tage) return json({ fehler: 'noch keine Aufzeichnung' }, 503);
      return json(buch);
    }

    /**
     * Pruefstelle fuer das Versandbuch.
     *
     * Standardmaessig folgenlos: Sie sieht nach, ob eine Kennung schon
     * gemeldet wurde, und traegt nichts ein. Andernfalls waere sie eine Falle
     * - wer die Kennung einer echten Meldung abfragt, haette damit deren
     * Benachrichtigung unterdrueckt.
     *
     * Mit `eintragen=1` wird stattdessen der echte Zug ausgefuehrt, also
     * nachsehen und im selben Schritt eintragen. Damit laesst sich belegen,
     * dass gleichzeitige Durchgaenge sich nicht ins Gehege kommen: Von
     * beliebig vielen Aufrufen mit derselben Kennung meldet genau einer
     * "neu". Fuer eine Kennung, die im Bestand steht, nie benutzen.
     */
    if (url.pathname === '/versandprobe') {
      const kennung = (url.searchParams.get('id') || '').slice(0, 200);
      if (!kennung) return json({ fehler: 'keine Kennung' }, 400);
      if (!env.VERSANDBUCH) return json({ fehler: 'Versandbuch nicht gebunden' }, 501);

      const eintragen = url.searchParams.get('eintragen') === '1';
      const gefiltert = await nochNichtGemeldet(env, [{ id: kennung }], !eintragen);
      return json({
        kennung,
        schonGemeldet: gefiltert.length === 0,
        eingetragen: eintragen,
      });
    }

    // Zeigt, welche Modelle das hinterlegte Konto nutzen darf. Nuetzlich,
    // wenn Groq wieder eines ausmustert und die Zweitmeinung schweigt.
    if (url.pathname === '/modelle') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);
      try {
        return json({ modelle: await verfuegbareModelle(env) });
      } catch (err) {
        return json({ fehler: err.message }, 502);
      }
    }

    /**
     * Einschaetzung zu einer einzelnen Meldung, auf Abruf aus der App.
     * Der Zugangsschluessel liegt im Worker und verlaesst ihn nie.
     */
    if (url.pathname === '/deuten' && request.method === 'POST') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);
      try {
        const { titel, text } = await request.json();
        if (!titel) return json({ fehler: 'keine Schlagzeile' }, 400);
        // Zweitmeinung auf Knopfdruck - also aus dem Topf fuer eigene Fragen.
        const deutung = await deuten(titel, env, text, 'interaktiv');
        tokenBuchen(env, ctx);
        return json(deutung || { fehler: 'keine Antwort' }, deutung?.fehler ? 502 : 200);
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    /**
     * Freie Frage zu einer Meldung, auf Abruf aus der App.
     *
     * Anders als die Zweitmeinung laeuft das nie von selbst - es kostet nur
     * etwas, wenn jemand tatsaechlich fragt. Deshalb zaehlt es auch nicht
     * gegen das Tagesbudget des Nachlaufs, das den Bestand durchsieht.
     */
    if (url.pathname === '/frage' && request.method === 'POST') {
      if (!env.GROQ_KEY) return json({ fehler: 'kein Schluessel hinterlegt' }, 501);
      try {
        const { titel, text, frage, sprache, kontext, verlauf, url: quelle } = await request.json();
        if (!titel) return json({ fehler: 'keine Meldung' }, 400);
        if (!frage?.trim()) return json({ fehler: 'keine Frage' }, 400);

        /*
         * Den Artikel holen - nur hier, nur auf Nachfrage.
         *
         * Bei rund 240 Meldungen am Tag waere ein Abruf fuer jede ein
         * Vielfaches an Token fuer Text, den fast niemand liest. Wer eine
         * Frage stellt, liest dagegen mit Sicherheit.
         *
         * Schlaegt der Abruf fehl - Bot-Sperre, Zeitueberschreitung, kein
         * Fliesstext -, geht die Frage trotzdem raus: Schlagzeile, Anriss und
         * Bewertung stehen ja weiter zur Verfuegung. Der Grund wandert in die
         * Antwort, damit nicht raetselhaft bleibt, warum der Artikel fehlt.
         */
        let artikel = '';
        let artikelHinweis = null;
        if (quelle) {
          const schluessel = artikelSchluessel(quelle);
          const gemerkt = await lesen(env, schluessel);
          if (gemerkt?.text) {
            artikel = gemerkt.text;
          } else {
            const geholt = await artikelHolen(quelle);
            if (geholt.text) {
              artikel = geholt.text;
              ctx.waitUntil(schreiben(env, ctx, schluessel, { text: artikel }, ARTIKEL_TTL));
            } else {
              artikelHinweis = geholt.fehler;
            }
          }
        }

        const ergebnis = await fragen(titel, text, frage, env,
          sprache === 'en' ? 'en' : 'de', kontext,
          // Nur wohlgeformte Eintraege, und hoechstens drei - der Rest
          // kostete Token, ohne die Rueckfrage verstaendlicher zu machen.
          (Array.isArray(verlauf) ? verlauf : [])
            .filter((e) => e && e.frage && e.antwort).slice(-3),
          artikel);

        // Bei einer Absage den Kontingentstand mitgeben: Ein Minutenlimit ist
        // nach einer Minute vorbei, ein Tageslimit erst morgen.
        tokenBuchen(env, ctx);
        if (ergebnis.fehler) return json({ ...ergebnis, kontingent }, 502);
        return json({ ...ergebnis, artikel: artikel ? 'gelesen' : artikelHinweis });
      } catch (err) {
        return json({ fehler: err.message.slice(0, 200) }, 400);
      }
    }

    // Abo hinterlegen, damit der Cron auch bei geschlossener App verschickt.
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        /*
         * Das Ergebnis weiterreichen, nicht verschlucken.
         *
         * schreiben() faengt seit Neuestem selbst ab, damit ein erschoepftes
         * Kontingent nicht den ganzen Aufruf mitreisst - und dadurch meldete
         * diese Stelle "gespeichert", obwohl nichts abgelegt wurde. Wer eine
         * neue Webhook-Adresse eintraegt, glaubt sie dann hinterlegt zu haben
         * und bekommt nachts nichts. Das ist die schlimmste Sorte Fehler:
         * einer, der sich als Erfolg meldet.
         */
        const ok = await schreiben(env, ctx, ABO_KEY, await request.json(), 30 * 86400);
        return json(ok
          ? { ok: true, dauerhaft: !!env.STORE }
          : { ok: false, fehler: letzterAblageFehler?.fehler || 'Ablage fehlgeschlagen' },
          ok ? 200 : 503);
      } catch (err) {
        return json({ ok: false, fehler: err.message }, 400);
      }
    }

    try {
      const bestand = await lesen(env, KEY);

      // Noch kein Bestand: eine Gruppe holen, den Rest übernimmt der Cron.
      if (!bestand) {
        const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;
        const { data } = await teilAbgleich(env, ctx, regime, null, gruppe);
        return json({ ...ohneAlteSaetze(data), quelle: 'worker' });
      }

      // Sonst reicht der Kalender — er trägt die zeitkritischen Zahlen.
      let stand = bestand;
      if (Date.now() - kalenderZuletzt > KAL_MS) {
        kalenderZuletzt = Date.now();
        stand = (await kalenderNachziehen(env, ctx, regime, bestand)).data;
      }

      const kennung = inhaltsKennung(stand);

      // Cloudflare schwaecht die Kennung bei komprimierten Antworten ab und
      // stellt ihr W/ voran; der Browser schickt sie in dieser Form zurueck.
      const gesendet = (request.headers.get('if-none-match') || '').replace(/^W\//, '').trim();
      if (gesendet === kennung) {
        // Unveraendert: Die App uebernimmt den Zeitpunkt aus dem Kopfbereich
        // und weiss dadurch trotzdem, dass die Verbindung frisch ist.
        return new Response(null, {
          status: 304,
          headers: { ...CORS, 'etag': kennung, 'x-stand': stand.updated },
        });
      }

      return json({ ...ohneAlteSaetze(stand), quelle: 'worker' }, 200, { 'etag': kennung });
    } catch (err) {
      const fallback = await lesen(env, KEY);
      if (fallback) return json({ ...ohneAlteSaetze(fallback), quelle: 'worker-cache', fehler: err.message });
      return json({ fehler: err.message, items: [] }, 502);
    }
  },

  // Cron: rollierend eine Gruppe abarbeiten und über Neues benachrichtigen.
  async scheduled(event, env, ctx) {
    const regime = env.REGIME || 'policy';
    const bestand = await lesen(env, KEY);
    const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;

    // Cloudflares eigener Zeitplan - in wrangler.toml unter [triggers].
    const { versand } = await teilAbgleich(env, ctx, regime, bestand, gruppe, 'cloudflare-cron');
    if (versand?.fehler?.length) console.log('Versand fehlgeschlagen:', versand.fehler.join(' | '));
  },
};
