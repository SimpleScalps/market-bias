import { collectNews, loadCalendar, enrich, imFenster } from '../docs/engine/feeds.mjs';
import { dedupe } from '../docs/engine/dedupe.mjs';
import { profilPassung, STANDARD_PROFIL } from '../docs/engine/profile.mjs';
import { label, LABEL_TEXT } from '../docs/engine/sentiment.mjs';
import { IMPACT_TEXT, DURATION_TEXT } from '../docs/engine/tradeimpact.mjs';
import { uebersetze } from '../docs/engine/translate.mjs';
import { fortschreiben, TAGE_MAX } from '../docs/engine/wochenbuch.mjs';
import { sendeAn } from './notify.mjs';
import { deuten, widerspruch, verfuegbareModelle, tageslage, modellWaehlen, fragen, kontingent } from './deuten.mjs';

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
const NACHZIEHEN_MAX = 3;
const NACHZIEHEN_ABSTAND_MS = 10 * 60_000;

/*
 * Tagesbudget fuer das Sprachmodell - gerechnet in Token, nicht in Anfragen.
 *
 * Die kostenlose Stufe von Groq erlaubt fuer gpt-oss-120b 1.000 Anfragen und
 * 200.000 Token am Tag. Bindend sind die Token, und zwar deutlich: Als das
 * Tageslimit erstmals griff, waren noch 436 Anfragen frei, die Token aber
 * aufgebraucht. Ein Zaehler, der Anfragen zaehlt, misst also das Falsche - er
 * stand bei 19 von 150, waehrend nichts mehr ging.
 *
 * Aus demselben Topf bezahlen inzwischen vier Dinge: die Pruefung der
 * Meldungen, die Uebersetzung der Titel und Anrisse, der Tagesbericht und die
 * Nachfragen. Nur das erste laeuft von selbst, also bekommt es eine Grenze,
 * die den anderen dreien Luft laesst. Was tatsaechlich verbraucht wurde,
 * meldet Groq bei jeder Antwort - geschaetzt wird hier nichts.
 */
const KI_TOKEN_MAX = 120_000;

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
const BESTAND_HERZSCHLAG_MS = 5 * 60_000;

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
const brauchtPruefung = (n) => n.impactLevel !== 'ignore' && !n.ki?.inhalt;

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
  '/modelle', '/tick', '/uebersetzen', '/frage'];

function zugangGeprueft(request, url, env) {
  if (!env.ZUGANG) return true;                       // nicht eingerichtet
  if (!GESCHUETZT.includes(url.pathname)) return true; // offener Weg

  const mitgegeben = (request.headers.get('x-zugang') || url.searchParams.get('zugang') || '').trim();
  // Beim Hinterlegen ueber die Kommandozeile haengt leicht ein Zeilenumbruch
  // an; ohne diese Bereinigung stimmt dann nie etwas ueberein.
  const soll = String(env.ZUGANG).trim();
  if (mitgegeben.length !== soll.length) return false;
  let gleich = 0;
  for (let i = 0; i < soll.length; i++) gleich |= mitgegeben.charCodeAt(i) ^ soll.charCodeAt(i);
  return gleich === 0;
}
const LAGE_KEY = 'https://market-bias.internal/lage';
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
    try {
      await env.STORE.put(key, JSON.stringify(data), { expirationTtl: ttl });
      offeneSchreibungen++;
      return true;
    } catch (err) {
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
  const items = imFenster(dedupe([...bekannt.values()]))
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
async function teilAbgleich(env, ctx, regime, bestand, gruppe, quelle = 'unbekannt') {
  const teil = await collectNews({ regime, gruppe, gruppen: GRUPPEN, limit: 300 });
  const { items, neue } = zusammenfuehren(bestand, teil.items);

  // Urteile aus ihrem eigenen Speicher nachlegen - sie ueberleben dort auch
  // einen Bestand, der von einem veralteten Lesestand ueberschrieben wurde.
  const speicher = (await lesen(env, URTEILE_KEY)) || { urteile: {} };
  speicher.urteile ||= {};
  urteileAnlegen(items, speicher);

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

  // Vor dem Versand gegenlesen lassen: Ein Widerspruch gehoert in die
  // Benachrichtigung, nicht erst in die spaetere Ansicht.
  const budget = budgetRest(speicher);
  if (budget.rest > 0) {
    budget.verbraucht += await gegenlesen(kandidaten, env, GEGENPROBE_MAX);
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
  const seitNachlauf = Date.now() - new Date(speicher.letzterNachlauf || 0).getTime();
  if (seitNachlauf > NACHZIEHEN_ABSTAND_MS && budget.verbraucht < KI_TOKEN_MAX) {
    const nachzuholen = items.filter(brauchtPruefung);
    if (nachzuholen.length) {
      budget.verbraucht += await gegenlesen(nachzuholen, env, NACHZIEHEN_MAX);
      speicher.letzterNachlauf = new Date().toISOString();
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
    if (!n.ki?.inhalt || speicher.urteile[n.id]?.ki?.inhalt) continue;
    speicher.urteile[n.id] = urteilAuslesen(n);
    neueUrteile++;
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
    // Alles seit dem letzten Sichern, plus dieses hier.
    schreibungen: (zaehlerGilt ? bestand.schreibungen || 0 : 0) + offeneSchreibungen + 1,
    /*
     * Der Taktgeber gehoert hierher, nicht in den Urteilsspeicher.
     * Dort wurde er nur alle zehn Minuten und nur bei frischen Urteilen
     * erneuert - und stand deshalb stundenlang auf einem alten Eintrag,
     * waehrend der Taktgeber laengst wieder lief.
     */
    ticks: (() => {
      const zusammen = {
        ...(bestand?.ticks || {}),
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
  const mussSichern = kandidaten.length > 0
    || neueUrteile > 0
    || alterMs(bestand) >= BESTAND_HERZSCHLAG_MS;
  const gesichert = mussSichern
    ? await schreiben(env, ctx, KEY, data, BESTAND_TTL)
    : false;
  // Die Summe ist verbucht; das Zaehlwerk faengt von vorn an.
  if (gesichert) offeneSchreibungen = 0;

  /*
   * Erst ablegen, dann benachrichtigen - nicht umgekehrt.
   *
   * Vorher ging die Meldung raus, bevor das Gedaechtnis stand. Schlug das
   * Ablegen danach fehl - etwa weil das Tageskontingent von KV erschoepft war -
   * galt dieselbe Meldung beim naechsten Durchgang wieder als neu und ging
   * erneut raus. Genau so kam eine Nachricht dreimal an.
   *
   * Laesst sich nichts ablegen, wird lieber nicht gemeldet: Eine verpasste
   * Nachricht ist aergerlich, dieselbe zum dritten Mal ist schlimmer, und der
   * naechste Durchgang holt sie nach, sobald wieder geschrieben werden kann.
   */
  let versand;
  if (!bestand) {
    versand = { versucht: false, grund: 'erster Lauf' };
  } else if (kandidaten.length && !gesichert) {
    versand = {
      versucht: false,
      grund: 'Ablage nicht moeglich - zurueckgestellt, um Doppelungen zu vermeiden',
      zurueckgestellt: kandidaten.length,
    };
  } else {
    versand = await pushen(env, ctx, kandidaten);
  }

  ctx.waitUntil(wochenbuchPflegen(env, ctx, items));
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
async function gegenlesen(items, env, hoechstens = GEGENPROBE_MAX) {
  if (hoechstens <= 0) return 0;
  if (!env.GROQ_KEY) return;

  const kandidaten = items
    .filter(brauchtPruefung)
    .sort((a, b) => Math.abs(b.scores.crypto) * b.priority
                  - Math.abs(a.scores.crypto) * a.priority)
    .slice(0, hoechstens);

  if (!kandidaten.length) return 0;

  // Nebeneinander abfragen: nacheinander summierte sich die Wartezeit.
  const deutungen = await Promise.all(kandidaten.map((n) => deuten(n.title, env, n.text)));

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

  // Was der Durchgang wirklich gekostet hat, nicht wie viele Anfragen es waren.
  return deutungen.reduce((summe, d) => summe + (d?.tokens || 0), 0);
}

// --- Benachrichtigungen ---------------------------------------------------
/** Welche der neuen Meldungen verdienen eine Push-Nachricht? */
function meldenswert(items, abo) {
  const profil = abo.profil || STANDARD_PROFIL;
  const asset = abo.asset || 'crypto';

  return items.filter((n) => {
    // Was die Einstufung als Rauschen kennzeichnet, gehoert nie in eine
    // Benachrichtigung - Kursprognosen und Projektmeldungen etwa erschienen
    // sonst mehrfach am Tag, weil die Redaktionen sie laufend neu fassen.
    if (n.impactLevel === 'ignore') return false;
    if (profil.aktiv && profilPassung(n, profil) === null) return false;

    // Bei "nur starke Signale" zaehlt auch die Handelswirkung, nicht allein
    // die Richtung: Ein starkes Sentiment ohne Marktwirkung weckt niemanden.
    if (abo.stufe === 'strong' && n.impactLevel === 'low') return false;

    const l = label(n.scores?.[asset] ?? 0);
    return abo.stufe === 'strong' ? l.startsWith('strong') : l !== 'neutral';
  });
}

async function pushen(env, ctx, neueItems) {
  const abo = await lesen(env, ABO_KEY);
  if (!abo?.ziele?.length) return { versucht: false, grund: 'kein Abo hinterlegt' };
  if (abo.stufe === 'off') return { versucht: false, grund: 'Benachrichtigungen aus' };
  if (!neueItems?.length) return { versucht: false, grund: 'nichts Neues' };

  const treffer = meldenswert(neueItems, abo);
  if (!treffer.length) {
    return { versucht: false, grund: `${neueItems.length} neu, aber keine mit Richtung` };
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
          ? `Zweitmeinung weicht ab: ${top.ki.grund}`
          : `Second opinion differs: ${top.ki.grund}`)
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
        ablageSchreibt: !letzterAblageFehler
          || Date.now() - new Date(letzterAblageFehler.zeit).getTime() > 10 * 60_000
          ? 'ja'
          : `NEIN - ${letzterAblageFehler.fehler}`,
        zweitmeinung: env.GROQ_KEY ? 'eingerichtet' : 'kein Schluessel',
        uebersetzung: env.GROQ_KEY ? 'Groq'
          : (env.DEEPL_KEY ? 'DeepL' : 'MyMemory (ohne Schluessel)'),
        wochenbuch: buch?.tage ? `${Object.keys(buch.tage).length} Tage` : 'noch leer',
        zugang: env.ZUGANG
          ? 'geschuetzt'
          : 'OFFEN - jeder mit dieser Adresse kann das Abo aendern und das Kontingent verbrauchen',
        meldungen: bestand?.items?.length ?? 0,
        alterSekunden: Math.round(alterMs(bestand) / 1000),
        schreibvorgaenge: bestand?.schreibTag === new Date().toISOString().slice(0, 10)
          ? `${bestand.schreibungen} von 1.000`
          : 'heute noch keiner',
        letzterTickFehler: letzterTickFehler ?? 'keiner seit dem Start',
        letzterAblageFehler: letzterAblageFehler ?? 'keiner seit dem Start',
        geprueft: bestand?.items
          ? `${bestand.items.filter((n) => n.ki).length} von ${bestand.items.length}`
          : '0',
        berichtigt: bestand?.items?.filter((n) => n.kiKorrigiert).length ?? 0,
        kiBudget: `${budgetRest(urteilSpeicher).verbraucht.toLocaleString('de-DE')}`
          + ` von ${KI_TOKEN_MAX.toLocaleString('de-DE')} Token heute`
          + ` (Groq erlaubt 200.000, der Rest bleibt fuer Uebersetzung,`
          + ` Tagesbericht und Nachfragen)`,
        urteile: Object.keys(urteilSpeicher?.urteile || {}).length,
        letzterNachlauf: urteilSpeicher?.letzterNachlauf ?? 'noch keiner',
        kontingent: kontingent ?? 'seit dem Start keine Anfrage an Groq',
        /*
         * Wer den Bestand auffrischt, mit Zeitstempel.
         *
         * cron-job.org schaltet einen Auftrag nach genuegend Fehlversuchen ab
         * und meldet das per E-Mail - die man auch uebersehen kann. Ohne diese
         * Zeile faellt ein stiller Taktgeber erst auf, wenn Meldungen
         * ausbleiben, und dann sucht man an der falschen Stelle.
         */
        taktgeber: Object.entries(bestand?.ticks || {})
          .map(([quelle, t]) => ({ quelle, zeit: t.zeit, meldungen: t.meldungen, offen: t.offen }))
          .sort((a, b) => (b.zeit || '').localeCompare(a.zeit || '')),
        // Ohne hinterlegtes Abo verschickt der Worker nichts. Zeigt nur, ob
        // und wohin - niemals Token oder Themennamen.
        abo: abo ? {
          stufe: abo.stufe,
          kanaele: (abo.ziele || []).map((z) => z.typ + (z.token ? ' (mit Token)' : ' (ohne Token)')),
          anlageklasse: abo.asset,
          profilAktiv: !!abo.profil?.aktiv,
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
         * woertlich "Falkenwetten". Der Schluessel liegt ohnehin schon hier,
         * und ein Anriss kostet ein paar hundert Token gegen ein Tagesbudget
         * von 200.000.
         */
        const frisch = await uebersetze(fehlend, {
          groqKey: env.GROQ_KEY || '',
          modell: env.GROQ_KEY ? await modellWaehlen(env).catch(() => undefined) : undefined,
          deeplKey: env.DEEPL_KEY || '',
          email: env.KONTAKT_MAIL || '',
        });
        fehlend.forEach((t, i) => { if (frisch.texte[i]) speicher[t] = frisch.texte[i]; });

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
        const deutung = await deuten(titel, env, text);
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
        const { titel, text, frage, sprache, kontext } = await request.json();
        if (!titel) return json({ fehler: 'keine Meldung' }, 400);
        if (!frage?.trim()) return json({ fehler: 'keine Frage' }, 400);

        const ergebnis = await fragen(titel, text, frage, env,
          sprache === 'en' ? 'en' : 'de', kontext);

        // Bei einer Absage den Kontingentstand mitgeben: Ein Minutenlimit ist
        // nach einer Minute vorbei, ein Tageslimit erst morgen.
        if (ergebnis.fehler) return json({ ...ergebnis, kontingent }, 502);
        return json(ergebnis);
      } catch (err) {
        return json({ fehler: err.message.slice(0, 200) }, 400);
      }
    }

    // Abo hinterlegen, damit der Cron auch bei geschlossener App verschickt.
    if (url.pathname === '/subscribe' && request.method === 'POST') {
      try {
        await schreiben(env, ctx, ABO_KEY, await request.json(), 30 * 86400);
        return json({ ok: true, dauerhaft: !!env.STORE });
      } catch (err) {
        return json({ fehler: err.message }, 400);
      }
    }

    try {
      const bestand = await lesen(env, KEY);

      // Noch kein Bestand: eine Gruppe holen, den Rest übernimmt der Cron.
      if (!bestand) {
        const gruppe = Math.floor(Date.now() / 60000) % GRUPPEN;
        const { data } = await teilAbgleich(env, ctx, regime, null, gruppe);
        return json({ ...data, quelle: 'worker' });
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

      return json({ ...stand, quelle: 'worker' }, 200, { 'etag': kennung });
    } catch (err) {
      const fallback = await lesen(env, KEY);
      if (fallback) return json({ ...fallback, quelle: 'worker-cache', fehler: err.message });
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
