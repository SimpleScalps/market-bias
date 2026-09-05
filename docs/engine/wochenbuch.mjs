// Wochenbuch: was an welchem Tag los war.
//
// Der Bestand reicht nur 24 Stunden zurück — für den Handel ist ältere Ware
// nutzlos. Für die Frage "wie lief die Woche" fehlt damit aber alles vor
// gestern. Deshalb wird jeder Tag festgehalten, bevor er aus dem Fenster
// fällt: einmal am Tag entsteht ein Schnappschuss, der stehen bleibt.
//
// Der heikle Teil ist das Fortschreiben. Rechnet man den Montag am Mittwoch
// neu, liegt von ihm keine einzige Meldung mehr vor — ein naiver Neuaufbau
// würde den Tag also leeren. Darum gilt: Ein Tag darf nie schrumpfen.

import { label } from './sentiment.mjs';

export const ZONE = 'Europe/Berlin';
export const KLASSEN = ['crypto', 'stocks', 'gold', 'usd'];

/** Wie viele Tage aufbewahrt werden — zwei Wochen, damit man zurückblicken kann. */
export const TAGE_MAX = 14;
const TOP_MAX = 8;

/** Kalendertag einer Zeitangabe, in der Zone des Nutzers: 'YYYY-MM-DD'. */
export function tagesSchluessel(datum, zone = ZONE) {
  const teile = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(datum));
  const v = (typ) => teile.find((t) => t.type === typ).value;
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** 0 = Montag … 6 = Sonntag. Mittags gerechnet, damit keine Zone daneben liegt. */
export function wochentag(tag) {
  return (new Date(`${tag}T12:00:00Z`).getUTCDay() + 6) % 7;
}

/** Verschiebt einen Tagesschlüssel um n Tage. */
export function tagPlus(tag, n) {
  const d = new Date(`${tag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Die sieben Tage der Woche, in der `tag` liegt — Montag zuerst. */
export function wochenTage(tag) {
  const montag = tagPlus(tag, -wochentag(tag));
  return Array.from({ length: 7 }, (_, i) => tagPlus(montag, i));
}

/** Stärkstes Signal einer Meldung über alle Anlageklassen. */
const staerke = (n) => Math.max(...KLASSEN.map((a) => Math.abs(n.scores?.[a] ?? 0)));

/** Nach Wucht sortieren: starkes Signal aus wichtiger Quelle zuerst. */
const nachWucht = (a, b) => staerke(b) * (b.priority ?? 30) - staerke(a) * (a.priority ?? 30);

/**
 * Baut den Schnappschuss eines Tages aus den vorliegenden Meldungen.
 *
 * Gewichtet wie das Tagesdashboard, damit dieselbe Meldung in beiden Ansichten
 * gleich schwer wiegt. Die Kennzahlen entstehen für alle vier Anlageklassen —
 * das kostet fast nichts und erspart es, beim Umschalten neu zu rechnen.
 */
export function tagesSchnappschuss(items, tag, zone = ZONE) {
  const desTages = items.filter((n) => tagesSchluessel(n.date, zone) === tag);
  if (!desTages.length) return null;

  const klassen = {};
  for (const a of KLASSEN) {
    let summe = 0, gewichte = 0, bull = 0, bear = 0, neut = 0;
    for (const n of desTages) {
      const s = n.scores?.[a] ?? 0;
      const g = Math.pow((n.priority ?? 30) / 100, 1.5);
      summe += s * g;
      gewichte += g;
      const l = label(s);
      if (l.includes('bullish')) bull++;
      else if (l.includes('bearish')) bear++;
      else neut++;
    }
    klassen[a] = { score: +(gewichte ? summe / gewichte : 0).toFixed(4), bull, bear, neut };
  }

  const top = desTages
    .filter((n) => staerke(n) >= 0.4 && n.impactLevel !== 'ignore')
    .sort(nachWucht)
    .slice(0, TOP_MAX)
    .map((n) => ({
      id: n.id,
      titel: n.title,
      ...(n.titleDe ? { titelDe: n.titleDe } : {}),
      quelle: n.source,
      ...(n.url ? { url: n.url } : {}),
      zeit: n.date,
      scores: n.scores,
      priority: n.priority ?? 30,
      ...(n.kiKorrigiert ? { korrigiert: true } : {}),
    }));

  return { tag, stand: new Date().toISOString(), anzahl: desTages.length, klassen, top };
}

/**
 * Führt einen frisch gerechneten Tag mit dem gespeicherten zusammen.
 *
 * Die vollere Aufnahme gewinnt. Rechnet man einen Tag nach, von dem nur noch
 * ein Rest im Fenster liegt, fällt der Neubau kleiner aus als das Gespeicherte
 * — dann bleibt das Gespeicherte stehen. Die Spitzenmeldungen beider Fassungen
 * werden vereinigt, damit nichts verlorengeht, was einmal oben stand.
 */
export function tageZusammenfuehren(alt, neu) {
  if (!alt) return neu;
  if (!neu) return alt;

  const basis = neu.anzahl >= alt.anzahl ? neu : alt;
  const andere = basis === neu ? alt : neu;

  const top = [...basis.top];
  const bekannt = new Set(top.map((x) => x.id));
  for (const x of andere.top) if (!bekannt.has(x.id)) top.push(x);
  top.sort(nachWucht);

  return { ...basis, stand: neu.stand, top: top.slice(0, TOP_MAX) };
}

/**
 * Schreibt das Wochenbuch mit dem aktuellen Bestand fort.
 *
 * Angefasst werden nur die Tage, zu denen überhaupt Meldungen vorliegen —
 * meist heute und gestern. Alles davor bleibt unberührt stehen.
 */
export function fortschreiben(buch, items, jetzt = Date.now(), zone = ZONE) {
  const raus = { ...(buch || {}) };

  const betroffen = new Set(items.map((n) => tagesSchluessel(n.date, zone)));
  for (const tag of betroffen) {
    raus[tag] = tageZusammenfuehren(raus[tag], tagesSchnappschuss(items, tag, zone));
  }

  // Alte Tage abräumen, sonst wächst der Eintrag endlos.
  const grenze = tagPlus(tagesSchluessel(jetzt, zone), -(TAGE_MAX - 1));
  for (const tag of Object.keys(raus)) if (tag < grenze) delete raus[tag];

  return raus;
}

/**
 * Stellt eine Woche zur Anzeige zusammen.
 *
 * Zurück kommen immer sieben Felder, Montag bis Sonntag. Tage ohne Aufnahme
 * bleiben leer — an einem Mittwoch stehen Donnerstag bis Sonntag eben noch aus,
 * und das soll man sehen statt es als Nulllinie misszuverstehen.
 */
export function wochenSicht(buch, klasse = 'crypto', jetzt = Date.now(), zone = ZONE, versatz = 0) {
  const heute = tagesSchluessel(jetzt, zone);
  const tage = wochenTage(tagPlus(heute, versatz * 7));

  const felder = tage.map((tag) => {
    const s = buch?.[tag];
    return {
      tag,
      wochentag: wochentag(tag),
      kuenftig: tag > heute,
      heute: tag === heute,
      ...(s ? { anzahl: s.anzahl, ...s.klassen[klasse], top: s.top, stand: s.stand } : { leer: true }),
    };
  });

  // Wochenmittel: nach Meldungszahl gewichtet, damit ein ruhiger Sonntag mit
  // drei Meldungen den Schnitt nicht so stark zieht wie ein voller Freitag.
  const belegt = felder.filter((f) => !f.leer);
  const meldungen = belegt.reduce((s, f) => s + f.anzahl, 0);
  const score = meldungen
    ? belegt.reduce((s, f) => s + f.score * f.anzahl, 0) / meldungen
    : 0;

  return {
    von: tage[0],
    bis: tage[6],
    tage: felder,
    tageBelegt: belegt.length,
    meldungen,
    score: +score.toFixed(4),
    bull: belegt.reduce((s, f) => s + f.bull, 0),
    bear: belegt.reduce((s, f) => s + f.bear, 0),
    neut: belegt.reduce((s, f) => s + f.neut, 0),
    top: belegt.flatMap((f) => f.top).sort(nachWucht).slice(0, TOP_MAX),
  };
}
