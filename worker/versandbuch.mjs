/*
 * Versandbuch: Wer wurde schon gemeldet?
 *
 * Warum ein eigenes Bauteil und nicht wieder KV: KV gibt einen Lesestand bis
 * zu einer Minute veraltet zurueck. Zwei Durchgaenge kurz hintereinander lesen
 * also womoeglich beide den Stand von vorher, halten beide dieselbe Meldung
 * fuer neu und senden beide. Genau so kam eine Nachricht dreimal an. Daran
 * aendert auch die richtige Reihenfolge - erst speichern, dann melden - nichts:
 * Der zweite Durchgang weiss vom ersten schlicht noch nichts.
 *
 * Ein Durable Object hat dieses Problem nicht. Es gibt davon genau eines, alle
 * Anfragen laufen nacheinander hindurch, und was es schreibt, liest es beim
 * naechsten Mal garantiert zurueck. Damit ist "schon gemeldet?" endlich eine
 * Frage mit einer verlaesslichen Antwort - unabhaengig davon, wie viele
 * Taktgeber im Minutentakt anklopfen.
 *
 * Es fuehrt bewusst nur diese eine Liste. Der Meldungsbestand bleibt in KV,
 * wo seine Groesse hingehoert; hier stehen nur Kennungen und Zeitpunkte.
 */

/** Wie lange eine Kennung als gemeldet gilt. Deutlich laenger als das
 *  Anzeigefenster von 24 Stunden, damit eine wiederauftauchende Meldung
 *  nicht ein zweites Mal hinausgeht. */
const BEHALTEN_MS = 4 * 24 * 3600 * 1000;

export class Versandbuch {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const pfad = new URL(request.url).pathname;

    /*
     * Kleiner Betriebszustand: Zaehler, Taktgeber, Verzug, Drosselwerte.
     *
     * Er lag bisher in KV und war damit genau dann blind, wenn man ihn
     * braucht: Ist das Tageskontingent erschoepft, kann sich ein Zaehler in KV
     * nicht mehr selbst hochzaehlen - die Anzeige stand auf "0 von 1.000",
     * waehrend daneben "limit exceeded" gemeldet wurde.
     *
     * Hier gibt es kein Tageslimit. Und weil alle Anfragen nacheinander durch
     * dieses eine Objekt laufen, koennen zwei Durchgaenge den Zaehler auch
     * nicht gegenseitig ueberschreiben.
     */
    if (pfad === '/zustand') {
      const jetzt = await this.state.storage.get('zustand') || {};

      if (request.method !== 'POST') {
        return new Response(JSON.stringify(jetzt),
          { headers: { 'content-type': 'application/json' } });
      }

      let aenderung = {};
      try { aenderung = await request.json(); } catch { /* leer */ }

      // Tageswechsel: Zaehler zuruecksetzen, Verzug und Taktgeber behalten.
      /*
       * Tageswechsel: erst Bilanz ziehen, dann zuruecksetzen.
       *
       * Die Zaehler springen um Mitternacht UTC auf null. Wer die Bilanz eines
       * Tages sehen will, muesste also genau den letzten Moment davor treffen -
       * eine Minute zu spaet, und der Tag ist unwiederbringlich weg. Das ist
       * eine unzumutbare Bedingung fuer eine Zahl, auf die es ankommt.
       *
       * Deshalb wandert der abgeschlossene Tag hier in ein kleines Tagebuch.
       * Vierzehn Eintraege genuegen: Wer nach zwei Wochen nachsieht, sucht
       * ohnehin einen Trend und keinen einzelnen Tag.
       */
      const heute = new Date().toISOString().slice(0, 10);
      const tage = { ...(jetzt.tage || {}) };
      if (jetzt.tag && jetzt.tag !== heute) {
        tage[jetzt.tag] = {
          ablagen: jetzt.schreibVersuche || 0,
          abgewiesen: jetzt.schreibFehler || 0,
          tokens: jetzt.tokens || 0,
          // Was Groq selbst am Ende des Tages je Modell gemeldet hat.
          ...(jetzt.groqTag ? { groq: jetzt.groqTag } : {}),
        };
        for (const alt of Object.keys(tage).sort().slice(0, -14)) delete tage[alt];
      }

      const basis = jetzt.tag === heute ? jetzt : {
        tag: heute, schreibVersuche: 0, schreibFehler: 0, tokens: 0,
        ticks: jetzt.ticks, verzug: jetzt.verzug, letzterNachlauf: jetzt.letzterNachlauf,
      };
      basis.tage = tage;

      const neu = { ...basis, tag: heute };
      // Zahlenfelder werden addiert, alles andere ersetzt.
      for (const [k, v] of Object.entries(aenderung)) {
        neu[k] = (typeof v === 'number' && typeof basis[k] === 'number')
          ? basis[k] + v
          : v;
      }

      await this.state.storage.put('zustand', neu);
      return new Response(JSON.stringify(neu),
        { headers: { 'content-type': 'application/json' } });
    }

    let ids, nurLesen;
    try {
      ({ ids, nurLesen } = await request.json());
    } catch {
      return new Response('{"fehler":"ungueltig"}', { status: 400 });
    }
    if (!Array.isArray(ids) || !ids.length) {
      return new Response('{"neu":[]}', { headers: { 'content-type': 'application/json' } });
    }

    // Auf 128 begrenzt: mehr nimmt storage.get in einem Zug nicht entgegen.
    const gefragt = ids.slice(0, 128).map((x) => String(x).slice(0, 200));

    /*
     * Der entscheidende Teil. Lesen und Eintragen geschehen im selben
     * Durchlauf, und ein zweiter Aufruf wartet, bis dieser fertig ist. Zwei
     * gleichzeitige Durchgaenge koennen dieselbe Kennung also nicht beide als
     * neu sehen - genau diese Zusicherung fehlte in KV.
     */
    const vorhanden = await this.state.storage.get(gefragt);
    const jetzt = Date.now();
    const neu = [];
    const eintragen = {};

    for (const id of gefragt) {
      if (vorhanden.has(id)) continue;
      neu.push(id);
      eintragen[id] = jetzt;
    }

    /*
     * Nachsehen, ohne einzutragen.
     *
     * Fuer den Versand ist das Eintragen der Kern des Verfahrens - dort darf
     * es nicht fehlen. Wer aber nur wissen will, ob eine Meldung schon
     * hinausging, wuerde sie damit versehentlich als erledigt abhaken und
     * genau die Benachrichtigung unterdruecken, nach der er fragt.
     */
    if (nurLesen) {
      return new Response(JSON.stringify({ neu, nurGelesen: true }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (neu.length) {
      await this.state.storage.put(eintragen);
      // Beilaeufig aufraeumen; ein eigener Weckruf waere hier zu viel Aufwand.
      if (Math.random() < 0.05) await this.aufraeumen(jetzt);
    }

    return new Response(JSON.stringify({ neu }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  /** Entfernt, was laenger zurueckliegt als BEHALTEN_MS. */
  async aufraeumen(jetzt) {
    try {
      const alle = await this.state.storage.list({ limit: 2000 });
      const weg = [];
      for (const [id, zeit] of alle) if (jetzt - zeit > BEHALTEN_MS) weg.push(id);
      if (weg.length) await this.state.storage.delete(weg);
    } catch { /* Nebensache */ }
  }
}
