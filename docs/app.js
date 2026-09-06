// Die Schwellen kommen aus der Engine, nicht aus einer zweiten Fassung hier:
// Sonst zeigt die Liste "bullish", während die Benachrichtigung schweigt.
import { label } from './engine/sentiment.mjs';
import { wochenSicht, tageZusammenfuehren, tagesSchluessel } from './engine/wochenbuch.mjs';

const CAT_ORDER = ['us-data', 'geopolitics', 'fed', 'crypto', 'us-markets', 'global-data', 'markets'];
const ASSET_KEYS = ['crypto', 'stocks', 'gold', 'usd'];
const VERSION = 'v51';           // in der Fußzeile sichtbar, erleichtert die Fehlersuche
const LIVE_INTERVAL = 12000;    // mit Worker: alle 12 Sekunden
const STATIC_INTERVAL = 60000;  // ohne Worker: news.json einmal pro Minute

/**
 * Bringt eine eingegebene Worker-Adresse in eine brauchbare Form.
 *
 * Fehlt das Protokoll, behandelt der Browser die Angabe als relativen Pfad und
 * fragt den eigenen Server ab. Das scheitert lautlos: Die App faellt auf die
 * mitgelieferten Daten zurueck, meldet trotzdem Live-Betrieb, und weder
 * Benachrichtigungs-Abo noch Versand erreichen jemals den Worker.
 */
function urlNormalisieren(roh) {
  const u = String(roh || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

const P = {
  get(k, f) { try { return localStorage.getItem(k) ?? f; } catch { return f; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privater Modus */ } },
};

let data = { items: [] };
let asset = P.get('asset', 'crypto');
let cat = P.get('cat', 'all');
let sent = P.get('sent', 'nonneutral');
let sort = P.get('sort', 'priority');
let lang = P.get('lang', navigator.language?.startsWith('en') ? 'en' : 'de');
let theme = P.get('theme', 'system');
let notify = P.get('notify', 'off');
let liveUrl = urlNormalisieren(P.get('liveUrl', '') || window.MARKET_BIAS_LIVE_URL || '');
let ausQuellen = new Set(JSON.parse(P.get('ausQuellen', '[]')));
let kanaele = new Set(JSON.parse(P.get('kanaele', '["browser"]')));
let tg = JSON.parse(P.get('tg', '{}'));
let dc = JSON.parse(P.get('dc', '{}'));
let ntfy = JSON.parse(P.get('ntfy', '{}'));
let zugang = P.get('zugang', '');   // schuetzt die schreibenden Wege des Workers
let query = '';
// Aufgeklappte Artikel und geöffnete Langfassungen überdauern das Neuzeichnen.
let offen = new Set();
let detailsOffen = new Set();
/*
 * Nachfragen überdauern es ebenfalls.
 *
 * Sie taten es zuerst nicht — mit der Begründung, die Antworten veralteten mit
 * der Meldung. Das trifft nicht zu: Die Meldung bleibt stehen, nur die Liste
 * wird neu gebaut, und zwar jedes Mal, wenn sich irgendwo eine Bewertung
 * ändert. Wer eine Frage stellte, sah die Antwort deshalb wieder
 * verschwinden, während er sie noch las.
 */
let frageOffen = new Set();
let frageVerlauf = new Map();   // Meldungskennung -> [{ frage, antwort, fehler }]
let letzteSignatur = '';
let kennung = '';   // Inhaltskennung der zuletzt geladenen Daten
let gesehen = new Set();
let frischeIds = new Set();
let timer = null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const feed = $('#feed');
const T = () => window.I18N[lang];

/**
 * Kopfzeilen für Anfragen an den Worker.
 *
 * Die Adresse des Workers ist erratbar; ohne Zugangswort könnte jeder das
 * Benachrichtigungs-Abo überschreiben oder das Kontingent des Sprachmodells
 * aufbrauchen. Ist keines gesetzt, bleibt es beim bisherigen Verhalten.
 */
const workerKopf = (weitere = {}) =>
  zugang ? { ...weitere, 'X-Zugang': zugang } : weitere;

const zeit = (iso) => new Date(iso).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour: '2-digit', minute: '2-digit' });
const grund = (n) => (lang === 'en' ? (n.whyEn || n.why) : n.why) || T().keineBegruendung;
// Die Schlagzeile bleibt immer im Original — Fachbegriffe wie "payrolls" oder
// "hawkish" verlieren beim Übersetzen an Schärfe. Die deutsche Fassung steht
// aufgeklappt darunter.
const titel = (n) => n.title;
// Die Übersetzung hängt bewusst nicht an der Menüsprache: Wer die Oberfläche
// auf Englisch stellt, will trotzdem die Möglichkeit haben, eine Schlagzeile
// auf Deutsch nachzulesen. Sie erscheint nur aufgeklappt, nie in der Liste.
const uebersetzt = (n) => (n.titleDe && n.titleDe !== n.title ? n.titleDe : null);
// Beim Anriss gilt dasselbe: Wer ihn zum Prüfen liest, soll das auf Deutsch
// können — sofern eine Übersetzung vorliegt.
/*
 * Übersetzte Anrisse.
 *
 * Anders als die Titel werden sie nicht vorab übersetzt, sondern erst beim
 * Aufklappen — vorab wären es rund 32.000 Zeichen am Tag und damit das
 * Monatskontingent in zehn Tagen, für Text, den man fast nie öffnet. Das
 * Ergebnis bleibt auf dem Gerät liegen, damit dieselbe Meldung nie zweimal
 * durchgeschickt wird.
 */
const anrissSpeicher = (() => {
  try { return JSON.parse(localStorage.getItem('anrisseDe') || '{}'); }
  catch { return {}; }
})();

function anrissMerken(original, deutsch) {
  anrissSpeicher[original] = deutsch;
  const keys = Object.keys(anrissSpeicher);
  // Der Bestand reicht 24 Stunden zurück; mehr als ein paar hundert Anrisse
  // kann man in der Zeit nicht aufklappen.
  if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete anrissSpeicher[k];
  try { localStorage.setItem('anrisseDe', JSON.stringify(anrissSpeicher)); } catch { /* voll */ }
}

const anrissText = (n) => (lang === 'de'
  ? (n.textDe || anrissSpeicher[n.text] || n.text)
  : n.text);

/*
 * Übersetzung der Anrisse, gesammelt statt einzeln.
 *
 * Jedes Aufklappen brauchte zuvor eine eigene Anfrage. Wer beim Durchsehen
 * mehrere Meldungen kurz hintereinander öffnet — auf dem Handy der Normalfall —
 * löste damit ein Dutzend Anfragen in derselben Minute aus und lief in das
 * Minutenlimit des Dienstes. Danach bekam er für jede weitere Meldung, und für
 * eine eigene Nachfrage gleich mit, eine Absage.
 *
 * Jetzt sammelt eine Warteschlange, was offen ist, und schickt es in Gruppen
 * von fünf nacheinander los. Aus zwölf Anfragen werden drei.
 */
const anrissWarteschlange = [];
let anrissLaeuft = false;

function anrissUebersetzen(n, el) {
  if (lang !== 'de' || !liveUrl || !n.text) return;
  if (n.textDe || anrissSpeicher[n.text]) return;
  if (anrissWarteschlange.some((x) => x.n.text === n.text)) return;

  anrissWarteschlange.push({ n, el });
  anrissAbarbeiten();
}

async function anrissAbarbeiten() {
  if (anrissLaeuft) return;
  anrissLaeuft = true;

  try {
    while (anrissWarteschlange.length) {
      // Der Worker nimmt fünf je Aufruf entgegen.
      const stapel = anrissWarteschlange.splice(0, 5);
      const texte = stapel.map((x) => x.n.text);

      let ergebnis = [];
      try {
        const res = await fetch(`${liveUrl}/uebersetzen`, {
          method: 'POST',
          headers: workerKopf({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ texte }),
        });
        const j = await res.json();
        ergebnis = j?.uebersetzungen || [];
      } catch {
        return;                 // Original bleibt stehen, Rest verwerfen
      }

      stapel.forEach((x, i) => {
        const deutsch = ergebnis[i];
        if (!deutsch) return;
        anrissMerken(x.n.text, deutsch);
        // Nur eintragen, wenn die Zeile noch dieselbe Meldung zeigt: Die Liste
        // kann sich zwischenzeitlich neu aufgebaut haben.
        if (x.el.isConnected) x.el.textContent = deutsch;
      });
    }
  } finally {
    anrissLaeuft = false;
  }
}

// ---------- Filterkette ----------
function matches(n) {
  if (cat !== 'all' && n.category !== cat) return false;
  if (ausQuellen.has(n.source)) return false;

  const l = label(n.scores[asset] ?? 0);
  if (sent === 'strong' && !l.startsWith('strong')) return false;
  if (sent === 'bull' && !l.includes('bullish')) return false;
  if (sent === 'bear' && !l.includes('bearish')) return false;
  if (sent === 'nonneutral' && l === 'neutral') return false;

  if (query) {
    const hay = `${n.title} ${n.titleDe || ''} ${n.source} ${n.categoryLabel} ${n.eventType || ''}`.toLowerCase();
    if (!query.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function ordered(list) {
  const by = {
    priority: (a, b) => {
      const fa = a.priority ?? 0;
      const fb = b.priority ?? 0;
      return fb - fa || new Date(b.date) - new Date(a.date);
    },
    time: (a, b) => new Date(b.date) - new Date(a.date),
    /*
     * Nach Eingang, nicht nach Erscheinen.
     *
     * Entspricht dem, was Discord meldet: die Reihenfolge, in der die
     * Meldungen bei uns ankamen. Wo der Zeitpunkt fehlt — ältere Einträge —
     * dient das Erscheinen als Ersatz.
     */
    eingang: (a, b) => new Date(b.gesehenAm || b.date) - new Date(a.gesehenAm || a.date),
    impact: (a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]) || b.priority - a.priority,
  };
  return [...list].sort(by[sort]);
}

// ---------- Tagesübersicht ----------
/**
 * Gesamtbild der letzten 24 Stunden: gewichtetes Mittel aller Bewertungen.
 * Relevante Meldungen zählen stärker, damit ein NFP-Tag nicht von zwanzig
 * beiläufigen Schlagzeilen verwässert wird.
 */
function tagesbild() {
  const grenze = Date.now() - 24 * 3600 * 1000;
  const heute = data.items.filter((n) => new Date(n.date).getTime() > grenze && !ausQuellen.has(n.source));
  if (!heute.length) return null;

  let summe = 0, gewichte = 0, bull = 0, bear = 0, neut = 0;
  for (const n of heute) {
    const s = n.scores[asset] ?? 0;
    const g = Math.pow((n.priority ?? 30) / 100, 1.5);
    summe += s * g;
    gewichte += g;
    const l = label(s);
    if (l.includes('bullish')) bull++;
    else if (l.includes('bearish')) bear++;
    else neut++;
  }

  const score = gewichte ? summe / gewichte : 0;
  const treiber = [...heute]
    .filter((n) => Math.abs(n.scores[asset] ?? 0) >= 0.4)
    .sort((a, b) => Math.abs(b.scores[asset]) * b.priority - Math.abs(a.scores[asset]) * a.priority)
    .slice(0, 3);

  return { score, bull, bear, neut, anzahl: heute.length, treiber };
}

let treiberOffen = false;
let lageText = null;      // Lagebericht des Tages, einmal geholt

/*
 * Wochenansicht.
 *
 * Das Wochenbuch wird einmal je Sitzung geholt und dann hier gerechnet: Es
 * traegt alle vier Anlageklassen bei sich, also kostet der Wechsel zwischen
 * Klassen oder Wochen keinen neuen Abruf.
 */
let ansicht = P.get('ansicht', 'tag');   // 'tag' | 'woche'
let wochenbuch = null;                   // { tag: schnappschuss }
let wochenVersatz = 0;                   // 0 = laufende Woche, -1 = vorige
let wochenTagOffen = null;               // aufgeklappter Tag
let wochenFehler = null;
let wochenLaeuft = false;   // verhindert doppelte Abrufe

const escape = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/** Umschalter Tag/Woche — steht in beiden Ansichten an derselben Stelle. */
function ansichtWahl() {
  const T_ = T();
  return `<div class="ansichtWahl" role="tablist">
    <button data-ansicht="tag"   role="tab" aria-selected="${ansicht === 'tag'}"
      class="${ansicht === 'tag' ? 'aktiv' : ''}">${T_.sichtTag}</button>
    <button data-ansicht="woche" role="tab" aria-selected="${ansicht === 'woche'}"
      class="${ansicht === 'woche' ? 'aktiv' : ''}">${T_.sichtWoche}</button>
  </div>`;
}

/** Hängt den Umschalter an — in jeder Ansicht dieselbe Verdrahtung. */
function wahlVerdrahten(box) {
  for (const b of box.querySelectorAll('.ansichtWahl button')) {
    b.addEventListener('click', async () => {
      if (b.dataset.ansicht === ansicht) return;
      ansicht = b.dataset.ansicht;
      P.set('ansicht', ansicht);
      renderTages();
      // Das Wochenbuch wird erst geholt, wenn es gebraucht wird.
      if (ansicht === 'woche' && !wochenbuch && !wochenLaeuft) {
        wochenLaeuft = true;
        wochenbuch = await wochenbuchLaden();
        wochenLaeuft = false;
        renderTages();
      }
    });
  }
}

function renderTages() {
  return ansicht === 'woche' ? renderWoche() : renderTag();
}

function renderTag() {
  const t = tagesbild();
  const box = $('#tages');
  const T_ = T();
  if (!t) {
    box.innerHTML = `${ansichtWahl()}<p class="tagesLeer">${T_.tagesbildLeer}</p>`;
    wahlVerdrahten(box);
    return;
  }

  // Für die Tagessicht ist die Skala enger — ein Tagesmittel von 0,3 ist viel.
  const l = label(t.score * 1.8);
  const datum = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE',
    { day: '2-digit', month: 'short', year: 'numeric' });

  // Verteilung als Band: auf einen Blick sichtbar, wie einseitig der Tag ist.
  const g = t.bull + t.bear + t.neut || 1;
  const band = `<div class="band" role="img" aria-label="${T_.verteilung(t.bull, t.neut, t.bear)}">
    <i class="b" style="width:${(t.bull / g) * 100}%"></i>
    <i class="n" style="width:${(t.neut / g) * 100}%"></i>
    <i class="r" style="width:${(t.bear / g) * 100}%"></i>
  </div>`;

  const treiberListe = t.treiber.map((n) => {
    const ll = label(n.scores[asset]);
    const ueb = uebersetzt(n);
    return `<li class="${ll}">
      <span class="tw">${T_.labels[ll]}</span>
      <span class="tt">${escape(titel(n))}</span>
      ${ueb ? `<span class="tu">${escape(ueb)}</span>` : ''}
    </li>`;
  }).join('');

  box.innerHTML = `
    <div class="tagesKopf">
      ${ansichtWahl()}
      <span class="tagesDatum">${datum}</span>
    </div>

    <div class="tagesHaupt">
      <div class="tagesScore">
        <span class="badge gross ${l}">${T_.labels[l]}</span>
        <span class="tagesZahl">${t.score > 0 ? '+' : ''}${t.score.toFixed(2)}</span>
      </div>
      <span class="meter gross"><i style="${meterStyle(t.score * 1.8)}"></i></span>
      <p class="tagesSub">${T_.tagesHinweis} · ${T_.assets[asset]}</p>
    </div>

    ${band}
    <p class="tagesVerteilung">${T_.verteilung(t.bull, t.neut, t.bear)}</p>

    <div class="lageZeile">
      <button class="lageBtn">${lageText ? T_.lagebericht : T_.lagebericht}</button>
    </div>
    ${lageText ? `<div class="lageText${lageText.fehler ? ' fehler' : ''}">${
      escape(lageText.fehler || lageText.lage)}</div>` : ''}

    ${t.treiber.length ? `
      <button class="treiberBtn" aria-expanded="${treiberOffen}">
        <span class="pfeil">${treiberOffen ? '▾' : '▸'}</span>
        ${treiberOffen ? T_.treiberVerbergen : T_.treiberZeigen}
        <b>${t.treiber.length}</b>
      </button>
      <div class="treiber" ${treiberOffen ? '' : 'hidden'}>
        <ul>${treiberListe}</ul>
      </div>` : ''}`;

  const btn = $('.treiberBtn', box);
  if (btn) btn.addEventListener('click', () => {
    treiberOffen = !treiberOffen;
    renderTages();
  });

  const lageBtn = $('.lageBtn', box);
  if (lageBtn) lageBtn.addEventListener('click', async () => {
    lageBtn.disabled = true;
    lageBtn.textContent = T().lageLaeuft;
    lageText = await lagebericht();
    renderTages();
  });

  wahlVerdrahten(box);
}

/**
 * Die Woche als Säulenreihe.
 *
 * Jeder Tag steht für sich: Säule nach oben heißt, der Tag trug die Anlage,
 * nach unten heißt, er belastete sie. Tage, die noch ausstehen, bleiben leer
 * statt auf der Nulllinie zu liegen — ein Donnerstag ohne Daten ist nicht
 * dasselbe wie ein Donnerstag ohne Ausschlag.
 */
function renderWoche() {
  const box = $('#tages');
  const T_ = T();

  if (!wochenbuch) {
    box.innerHTML = `${ansichtWahl()}<p class="tagesLeer">${
      wochenFehler || T_.wocheLaedt}</p>`;
    wahlVerdrahten(box);
    return;
  }

  const w = wochenSicht(wochenbuch, asset, Date.now(), undefined, wochenVersatz);
  const kurz = (tag) => new Date(`${tag}T12:00:00Z`)
    .toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: 'short' });

  // Die Skala richtet sich nach dem stärksten Tag, sonst bleibt bei ruhiger
  // Woche alles flach und man sieht keine Unterschiede.
  const spitze = Math.max(0.15, ...w.tage.filter((d) => !d.leer).map((d) => Math.abs(d.score)));

  const saeulen = w.tage.map((d) => {
    if (d.leer) {
      return `<div class="wtag leer${d.kuenftig ? ' kuenftig' : ''}">
        <span class="wtName">${T_.wochentage[d.wochentag]}</span>
        <span class="wtSaeule"></span>
        <span class="wtZahl">–</span>
      </div>`;
    }
    const l = label(d.score * 1.8);
    // Gemessen wird ab der Mittellinie, also steht der vollen Saeule nur die
    // halbe Kastenhoehe zur Verfuegung.
    const hoehe = Math.round((Math.abs(d.score) / spitze) * 50);
    return `<button class="wtag ${l}${d.heute ? ' heute' : ''}${
      wochenTagOffen === d.tag ? ' offen' : ''}" data-tag="${d.tag}"
      aria-expanded="${wochenTagOffen === d.tag}">
      <span class="wtName">${T_.wochentage[d.wochentag]}</span>
      <span class="wtSaeule"><i class="${d.score >= 0 ? 'auf' : 'ab'}"
        style="height:${hoehe}%"></i></span>
      <span class="wtZahl">${d.score > 0 ? '+' : ''}${d.score.toFixed(2)}</span>
      <span class="wtAnzahl">${d.anzahl}</span>
    </button>`;
  }).join('');

  const lw = label(w.score * 1.8);
  const g = w.bull + w.bear + w.neut || 1;

  const offen = wochenTagOffen && w.tage.find((d) => d.tag === wochenTagOffen && !d.leer);
  const liste = (eintraege) => eintraege.map((x) => {
    const wert = x.scores?.[asset] ?? 0;
    const ll = label(wert);
    const zeit = new Date(x.zeit).toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE',
      { hour: '2-digit', minute: '2-digit' });
    const ueb = lang === 'de' && x.titelDe && x.titelDe !== x.titel ? x.titelDe : null;
    return `<li class="${ll}">
      <span class="tkopf"><span class="tw">${T_.labels[ll]}</span>
        <span class="tz">${zeit}</span></span>
      <span class="tt">${escape(x.titel)}</span>
      ${ueb ? `<span class="tu">${escape(ueb)}</span>` : ''}
    </li>`;
  }).join('');

  box.innerHTML = `
    <div class="tagesKopf">
      ${ansichtWahl()}
      <span class="tagesDatum">${kurz(w.von)} – ${kurz(w.bis)}</span>
    </div>

    <div class="tagesHaupt">
      <div class="tagesScore">
        <span class="badge gross ${lw}">${T_.labels[lw]}</span>
        <span class="tagesZahl">${w.score > 0 ? '+' : ''}${w.score.toFixed(2)}</span>
      </div>
      <span class="meter gross"><i style="${meterStyle(w.score * 1.8)}"></i></span>
      <p class="tagesSub">${T_.wocheHinweis(w.tageBelegt, w.meldungen)} · ${T_.assets[asset]}</p>
    </div>

    <div class="wochenGitter">${saeulen}</div>

    <div class="band" role="img" aria-label="${T_.verteilung(w.bull, w.neut, w.bear)}">
      <i class="b" style="width:${(w.bull / g) * 100}%"></i>
      <i class="n" style="width:${(w.neut / g) * 100}%"></i>
      <i class="r" style="width:${(w.bear / g) * 100}%"></i>
    </div>
    <p class="tagesVerteilung">${T_.verteilung(w.bull, w.neut, w.bear)}</p>

    ${offen ? `
      <div class="treiber wochenTag">
        <p class="wtKopf">${kurz(offen.tag)} · ${T_.wocheTagMeldungen(offen.anzahl)}</p>
        <ul>${offen.top.length ? liste(offen.top) : `<li class="leerZeile">${T_.wocheOhneSignal}</li>`}</ul>
      </div>` : `
      ${w.top.length ? `
        <button class="treiberBtn" aria-expanded="${treiberOffen}">
          <span class="pfeil">${treiberOffen ? '▾' : '▸'}</span>
          ${treiberOffen ? T_.treiberVerbergen : T_.treiberZeigen}
          <b>${w.top.length}</b>
        </button>
        <div class="treiber" ${treiberOffen ? '' : 'hidden'}>
          <ul>${liste(w.top)}</ul>
        </div>` : ''}`}

    <div class="wochenBlaettern">
      <button class="wbZurueck" ${wochenVersatz <= -1 ? 'disabled' : ''}>◂ ${T_.wocheVorige}</button>
      <button class="wbVor" ${wochenVersatz >= 0 ? 'disabled' : ''}>${T_.wocheNaechste} ▸</button>
    </div>`;

  for (const b of box.querySelectorAll('.wtag[data-tag]')) {
    b.addEventListener('click', () => {
      wochenTagOffen = wochenTagOffen === b.dataset.tag ? null : b.dataset.tag;
      renderWoche();
    });
  }

  const tb = $('.treiberBtn', box);
  if (tb) tb.addEventListener('click', () => { treiberOffen = !treiberOffen; renderWoche(); });

  $('.wbZurueck', box).addEventListener('click', () => {
    wochenVersatz = Math.max(-1, wochenVersatz - 1);
    wochenTagOffen = null;
    renderWoche();
  });
  $('.wbVor', box).addEventListener('click', () => {
    wochenVersatz = Math.min(0, wochenVersatz + 1);
    wochenTagOffen = null;
    renderWoche();
  });

  wahlVerdrahten(box);
}

$('#zustandBtn').addEventListener('click', zustandZeigen);

// ---------- Zweitmeinung ----------
/**
 * Holt die Einschätzung eines Sprachmodells zu einer einzelnen Meldung.
 *
 * Die Regeln bleiben die Grundlage — sie sind sofort da und erklären sich. Das
 * Modell hilft bei Meldungen, deren Wortlaut die Regeln nicht recht fassen.
 * Der Zugangsschlüssel liegt im Worker, deshalb geht die Anfrage über ihn.
 */
async function zweitmeinung(titelText, anriss = '') {
  if (!liveUrl) return { fehler: T().zweitmeinungOhneWorker };
  try {
    const res = await fetch(`${liveUrl}/deuten`, {
      method: 'POST',
      headers: workerKopf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ titel: titelText, text: anriss }),
    });
    const j = await res.json();
    return res.ok ? j : { fehler: j.fehler || T().zweitmeinungFehler };
  } catch {
    return { fehler: T().zweitmeinungFehler };
  }
}

/** Stellt eine Einschätzung dar — die des Modells oder eine bereits geprüfte. */
function kiDarstellen(box, deutung, regelWert, korrigiert = false) {
  if (deutung.fehler) {
    box.className = 'kiAntwort fehler';
    box.textContent = deutung.fehler;
    box.hidden = false;
    return;
  }

  const kiWert = deutung.richtung === 'neutral' ? 0
    : (deutung.richtung === 'bullish' ? 1 : -1) * deutung.staerke;
  const uneins = Math.sign(kiWert) !== 0 && Math.sign(regelWert) !== 0
    && Math.sign(kiWert) !== Math.sign(regelWert) && Math.abs(kiWert) >= 0.3;

  box.className = 'kiAntwort' + (uneins ? ' uneins' : '');
  box.innerHTML = `
    <div class="kiKopf">
      <span class="kiMarke">${T().zweitmeinung}</span>
      <span class="kiWert ${deutung.richtung}">${T().kiRichtung[deutung.richtung]} ${deutung.staerke.toFixed(2)}</span>
    </div>
    ${deutung.inhalt ? `<p class="kiInhalt">${escape(deutung.inhalt)}</p>` : ''}
    ${deutung.grund ? `<p class="kiGrund">${escape(deutung.grund)}</p>` : ''}
    ${korrigiert
      ? `<p class="kiWarnung">${T().kiKorrigiert} · ${T().regelSagte} ${regelWert > 0 ? '+' : ''}${regelWert.toFixed(2)}</p>`
      : (uneins ? `<p class="kiWarnung">${T().kiWidersprichtKurz}</p>` : '')}`;
  box.hidden = false;
}

/**
 * Stellt dem Sprachmodell eine eigene Frage zu einer Meldung.
 *
 * Die Zweitmeinung beantwortet immer dieselbe Frage — bullish oder bearish.
 * Hier geht es um alles andere: was ein Begriff bedeutet, wen es betrifft,
 * was daraus folgen könnte. Der Schlüssel liegt im Worker und verlässt ihn
 * nie, deshalb führt der Weg über ihn.
 */
async function frageStellen(n, text) {
  if (!liveUrl) return { fehler: T().frageOhneWorker };
  try {
    const res = await fetch(`${liveUrl}/frage`, {
      method: 'POST',
      headers: workerKopf({ 'Content-Type': 'application/json' }),
      /*
       * Die eigene Einschätzung fährt mit.
       *
       * Ohne sie antwortete das Modell auf "wie lange wirkt das nach?" mit
       * "steht nicht in der Meldung" — obwohl das Werkzeug die Dauer längst
       * berechnet hat und sie zwei Zeilen darüber steht.
       */
      body: JSON.stringify({
        titel: n.title, text: n.text, frage: text, sprache: lang,
        /*
         * Die Adresse des Artikels.
         *
         * Der Worker holt daraufhin den vollen Text - aber nur hier, beim
         * Nachfragen. Automatisch fuer alle 240 Meldungen am Tag waere es ein
         * Vielfaches an Token fuer Text, den fast niemand liest.
         */
        url: n.url || '',
        /*
         * Der bisherige Verlauf faehrt mit.
         *
         * Ohne ihn stand eine Rueckfrage wie "kannst du die Infos nicht
         * herausfinden?" ohne Bezug da, und das Modell antwortete auf etwas
         * anderes. Fehlgeschlagene Runden bleiben draussen - eine
         * Fehlermeldung ist kein Gespraechsinhalt.
         */
        verlauf: (frageVerlauf.get(n.id) || [])
          .filter((e) => e.antwort).slice(-3)
          .map((e) => ({ frage: e.frage, antwort: e.antwort })),
        kontext: {
          label: T().labels[n.label] || n.label,
          wert: n.scores?.[asset],
          wirkung: T().impact?.[n.impactLevel] || n.impactLevel,
          dauer: T().dauer?.[n.duration] || n.duration,
          quelle: n.source,
          begruendung: grund(n),
        },
      }),
    });
    const j = await res.json();
    return res.ok && j.antwort ? j : { fehler: j.fehler || T().frageFehler };
  } catch {
    return { fehler: T().frageFehler };
  }
}

// ---------- Ausführliche Erklärung ----------
const zeile = (k, v) => `<div class="dz"><span>${k}</span><b>${v}</b></div>`;

/**
 * Baut die Langfassung: woher die Zahlen kommen, wie daraus ein
 * geldpolitischer Impuls wird und was das für den Handel bedeutet.
 * Alles stammt aus Feldern, die ohnehin in der Meldung stecken.
 */
function detailText(n) {
  const t = T();
  const blocks = [];
  const fmtZahl = (v) => (v > 0 ? '+' : '') + Number(v).toFixed(2);

  // 1) Datenlage — nur bei Meldungen mit echten Zahlen
  if (n.actual != null && n.consensus != null) {
    const ueber = typeof n.surprise === 'number'
      ? (n.surprise > 0 ? '+' : '') + (Number.isInteger(n.surprise) ? n.surprise : n.surprise.toFixed(1))
      : '—';
    blocks.push(`<div class="dblock"><h4>${t.detailDaten}</h4>
      ${zeile(t.dVeroeffentlicht, n.actual)}
      ${zeile(t.dErwartet, n.consensus)}
      ${n.previous ? zeile(t.dVormonat, n.previous) : ''}
      ${zeile(t.dUeberraschung, ueber)}</div>`);
  }

  // 2) Signalwörter — bei reinen Textschlagzeilen
  if (n.signals?.length) {
    blocks.push(`<div class="dblock"><h4>${t.detailSignale}</h4>
      <ul class="dliste">${n.signals.map((x) => `<li>${x}</li>`).join('')}</ul></div>`);
  }

  // 3) Übertragung zur Geldpolitik
  const kanalNamen = { inflation: t.kanalInflation, growth: t.kanalWachstum, policy: t.kanalPolitik };
  const impulsTxt = typeof n.hawkish === 'number'
    ? `${fmtZahl(n.hawkish)} (${n.hawkish > 0 ? t.restriktiv : t.locker})`
    : '—';
  blocks.push(`<div class="dblock"><h4>${t.detailUebertragung}</h4>
    ${n.channel ? zeile(t.dKanal, kanalNamen[n.channel] || n.channel) : ''}
    ${n.region ? zeile(t.dRegion, n.region) : ''}
    ${zeile(t.dImpuls, impulsTxt)}</div>`);

  // Die Wirkung je Anlageklasse steht bereits in der kompakten Ansicht.

  // 5) Einordnung für den Handel
  const typ = lang === 'en' ? (n.eventTypeEn || n.eventType) : n.eventType;
  blocks.push(`<div class="dblock"><h4>${t.detailHandel}</h4>
    ${zeile(t.tradingImpact, t.impact[n.impactLevel] || '—')}
    ${zeile(t.erwarteteDauer, t.dauer[n.duration] || '—')}
    ${typ ? zeile(t.dTyp, typ) : ''}
    ${zeile(t.dRelevanz, `${n.priority}/100`)}
    ${zeile(t.dQuelle, n.source + (n.alsoIn?.length ? ` +${n.alsoIn.length}` : ''))}</div>`);

  /*
   * 6) Die Annahme, auf der die Bewertung beruht — die zutreffende.
   *
   * Hier stand bisher bedingungslos die Zinskanal-Erklärung, auch unter einer
   * Meldung über Deeskalation in der Ukraine mit geldpolitischem Impuls 0.00.
   * Das ist nicht bloß überflüssig, sondern irreführend: Es behauptet, die
   * Einstufung komme über Zinsen und Liquidität zustande, während sie über die
   * Risikoneigung kam. Wer danach handelt, hält die falsche Ursache für die
   * richtige.
   *
   * Welcher Kanal galt, sagen die Daten selbst: Ein geldpolitischer Impuls
   * ungleich null oder ein benannter Kanal heißt Zinsweg. Bewegt sich die
   * Bewertung ohne beides, lief sie über die Risikoneigung. Bewegt sie sich
   * gar nicht, wurde nichts angenommen — dann bleibt der Block weg.
   */
  const ueberZins = !!n.channel || (typeof n.hawkish === 'number' && n.hawkish !== 0);
  const bewegt = Math.abs(n.scores?.[asset] ?? 0) > 0.001;
  const annahme = ueberZins
    ? (data.regime === 'growth' ? t.annahmeGrowth : t.annahmePolicy)
    : (bewegt ? t.annahmeRisiko : null);

  if (annahme) {
    blocks.push(`<div class="dblock"><h4>${t.detailAnnahme}</h4>
      <p class="dtext">${annahme}</p></div>`);
  }

  return blocks.join('');
}

/**
 * Holt den Lagebericht zum Tag.
 *
 * Die Zahlen im Dashboard zeigen, wie einseitig der Tag ausfällt — nicht,
 * woran es liegt. Der Worker stellt die gewichtigsten Meldungen zusammen und
 * lässt daraus zwei bis drei Sätze schreiben; das Ergebnis hält er eine
 * Viertelstunde vor, damit nicht jeder Klick eine Anfrage kostet.
 */
async function lagebericht() {
  if (!liveUrl) return { fehler: T().lageOhneWorker };
  try {
    const res = await fetch(`${liveUrl}/tageslage?asset=${encodeURIComponent(asset)}`,
      { headers: workerKopf() });
    const j = await res.json();
    return res.ok && j.lage ? j : { fehler: j.fehler || T().lageFehler };
  } catch {
    return { fehler: T().lageFehler };
  }
}

/**
 * Holt das Wochenbuch — aus der Datei und, wenn vorhanden, vom Worker.
 *
 * Beide Wege werden zusammengefuehrt: Die Datei ist die belastbare Fassung
 * (sie liegt im Verzeichnis und ueberlebt jeden Ausfall), der Worker liefert
 * den frischeren Stand des laufenden Tages. Faellt einer aus, traegt der andere.
 */
async function wochenbuchLaden() {
  const hole = async (url, kopf) => {
    try {
      const res = await fetch(url, kopf ? { headers: kopf } : undefined);
      if (!res.ok) return null;
      const j = await res.json();
      return j?.tage || null;
    } catch { return null; }
  };

  const [ausDatei, vomWorker] = await Promise.all([
    hole(`data/woche.json?t=${Date.now()}`),
    liveUrl ? hole(`${liveUrl}/woche`, workerKopf()) : Promise.resolve(null),
  ]);

  if (!ausDatei && !vomWorker) {
    wochenFehler = T().wocheLeer;
    return null;
  }

  const zusammen = { ...(ausDatei || {}) };
  for (const [tag, schnapp] of Object.entries(vomWorker || {})) {
    zusammen[tag] = tageZusammenfuehren(zusammen[tag], schnapp);
  }
  wochenFehler = null;
  return zusammen;
}

// ---------- Darstellung ----------
function meterStyle(v) {
  const b = Math.max(-1, Math.min(1, v));
  const w = Math.abs(b) * 50;
  const col = b > 0 ? 'var(--bull)' : b < 0 ? 'var(--bear)' : 'var(--neut)';
  return b >= 0
    ? `left:50%;width:${w}%;background:${col}`
    : `left:${50 - w}%;width:${w}%;background:${col}`;
}

function bars(n) {
  return ASSET_KEYS.map((k) => {
    const v = n.scores[k] ?? 0;
    return `<div class="row"><span>${T().assets[k]}</span>
      <span class="track"><i style="${meterStyle(v)}"></i></span>
      <span class="val">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
  }).join('');
}

function renderCats() {
  const counts = { all: 0 };
  for (const n of data.items) {
    if (ausQuellen.has(n.source)) continue;
    counts.all++;
    counts[n.category] = (counts[n.category] || 0) + 1;
  }

  $('#cats').innerHTML = ['all', ...CAT_ORDER.filter((c) => counts[c])]
    .map((c) => `<button data-cat="${c}" class="${c === cat ? 'on' : ''}">${T().cats[c] || c}<b>${counts[c]}</b></button>`)
    .join('');

  $$('#cats button').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    P.set('cat', cat);
    renderCats();
    render(true);
  }));
}

/**
 * Zeichnet die Liste neu — aber nur, wenn nötig.
 *
 * Die App fragt alle zwölf Sekunden neue Daten ab. Wurde dabei jedes Mal die
 * gesamte Liste neu aufgebaut, schloss sich ein gerade geöffneter Artikel
 * wieder und die Seite sprang an den Anfang zurück. Auf dem Handy war Lesen
 * damit kaum möglich. Ändert sich nichts, bleibt das Bild deshalb stehen.
 */
function render(erzwingen = false) {
  const items = ordered(data.items.filter(matches));
  $('#count').textContent = `${items.length}/${data.items.length}`;

  // Kennung des sichtbaren Zustands: Reihenfolge, Bewertung und Sprache.
  const signatur = `${lang}|${asset}|${items.map((n) => n.id + label(n.scores[asset] ?? 0)).join()}`;
  if (!erzwingen && signatur === letzteSignatur && feed.children.length) return;
  letzteSignatur = signatur;

  /*
   * Die Blickposition festhalten.
   *
   * Der Neuaufbau ersetzt alle Karten. Der Browser kann die Bildlaufhoehe
   * dann nicht halten - man las etwas in der Mitte der Liste und stand
   * unvermittelt wieder oben, ohne dass man selbst etwas getan haette. Als
   * Anker dient die oberste noch sichtbare Karte samt ihrem Abstand zum
   * oberen Rand; danach wird genau dieser Abstand wiederhergestellt.
   *
   * Anhand der Kennung, nicht anhand der Bildlaufhoehe: Kommen Meldungen
   * hinzu oder fallen welche heraus, aendert sich die Hoehe ueber der Karte -
   * die reine Zahl waere dann wieder daneben.
   */
  const anker = (() => {
    for (const el of feed.children) {
      const r = el.getBoundingClientRect();
      if (r.bottom > 0 && el.dataset.id) return { id: el.dataset.id, oben: r.top };
    }
    return null;
  })();

  feed.innerHTML = '';

  if (!items.length) {
    feed.innerHTML = `<p class="empty">${T().keineTreffer}</p>`;
    return;
  }

  const tpl = $('#row');
  const frag = document.createDocumentFragment();

  for (const n of items) {
    const node = tpl.content.cloneNode(true);
    const score = n.scores[asset] ?? 0;
    const l = label(score);
    const item = $('.item', node);

    item.classList.add(l);
    item.dataset.id = n.id;   // Ankerpunkt beim Neuaufbau, siehe render()
    if (frischeIds.has(n.id)) item.classList.add('neu');

    /*
     * Erscheinen und Eingang auseinanderhalten.
     *
     * Weicht der Eingang um mehr als drei Minuten ab, steht er dabei — sonst
     * wirkt eine soeben eingetroffene Meldung 15 Minuten alt, weil ihr
     * Zeitstempel vom Anbieter stammt und nicht von uns.
     */
    const zeitEl = $('time', node);
    zeitEl.textContent = zeit(n.date);
    if (n.gesehenAm && new Date(n.gesehenAm) - new Date(n.date) > 180000) {
      zeitEl.textContent = `${zeit(n.date)} · ${T().eingang} ${zeit(n.gesehenAm)}`;
      zeitEl.title = T().eingangHinweis;
    }

    const c = $('.cat', node);
    c.textContent = T().cats[n.category] || (n.categoryLabel || '').toUpperCase();
    c.dataset.c = n.category;

    $('.title', node).textContent = titel(n);
    $('.meter i', node).style.cssText = meterStyle(score);

    const badge = $('.badge', node);
    badge.textContent = T().labels[l];
    badge.classList.add(l);

    const imp = $('.impact', node);
    imp.textContent = T().impact[n.impactLevel] || '';
    imp.dataset.lvl = n.impactLevel || '';
    $('.dauer', node).textContent = T().dauer[n.duration] || '';
    const typ = lang === 'en' ? (n.eventTypeEn || n.eventType) : n.eventType;
    $('.etyp', node).textContent = typ || '';

    // Ein Widerspruch soll schon in der Liste auffallen, nicht erst
    // aufgeklappt: Wer danach handelt, soll vorher hinsehen.
    if (n.kiWiderspruch) item.classList.add('uneins');
    // Wurde das Urteil ersetzt, gehoert der Hinweis an die Bewertung selbst.
    if (n.kiKorrigiert) item.classList.add('korrigiert');

    const anzahl = n.alsoIn?.length || 0;
    const auch = anzahl ? ` · +${anzahl} ${anzahl > 1 ? T().quellenMehr : T().quellen}` : '';
    /*
     * Staatsnahe Quellen ausweisen.
     *
     * Steht in der Quellenzeile, nicht als eigenes Abzeichen: Es gehoert zur
     * Herkunft der Meldung, nicht zu ihrer Bewertung. Wer TASS oder IRNA
     * liest, soll das sehen, bevor er auf die Einstufung schaut - die
     * Bewertung selbst wird bewusst nicht gedaempft.
     */
    $('.src', node).textContent =
      `${n.source.toUpperCase()}${n.staatlich ? ' · ' + T().staatlich : ''}`
      + `${n.region ? ' · ' + n.region : ''}${auch} · REL ${n.priority}`;

    // Deutsche Fassung der Schlagzeile, falls vorhanden.
    const ueb = $('.uebersetzung', node);
    const deutsch = uebersetzt(n);
    if (deutsch) { ueb.textContent = deutsch; ueb.hidden = false; }

    // Der Anriss aus dem Feed sagt oft, was die Überschrift verschweigt.
    const anriss = anrissText(n);
    if (anriss) {
      const an = $('.anriss', node);
      an.textContent = anriss;
      an.hidden = false;
    }

    $('.reason', node).textContent = grund(n);
    $('.bars', node).innerHTML = bars(n);

    const link = $('.link', node);
    if (n.url) { link.href = n.url; link.textContent = T().quelleOeffnen; } else link.remove();

    // Langfassung wird erst auf Wunsch gebaut — spart Arbeit bei 300 Einträgen.
    const mehr = $('.mehrBtn', node);
    const detail = $('.detail', node);
    // Zweitmeinung: entweder schon vom Worker geprüft, oder auf Knopfdruck.
    const kiBtn = $('.kiBtn', node);
    const kiBox = $('.kiAntwort', node);
    kiBtn.textContent = T().zweitmeinung;

    if (n.ki && !n.ki.fehler) {
      kiDarstellen(kiBox, n.ki, n.regelScores?.[asset] ?? score, n.kiKorrigiert);
      kiBtn.hidden = true;          // liegt bereits vor
    }

    kiBtn.addEventListener('click', async () => {
      kiBtn.disabled = true;
      kiBtn.textContent = T().zweitmeinungLaeuft;
      const deutung = await zweitmeinung(n.title, n.text);
      kiDarstellen(kiBox, deutung, score);
      kiBtn.hidden = !deutung.fehler;
      kiBtn.disabled = false;
      kiBtn.textContent = T().zweitmeinung;
    });

    /*
     * Nachfragen.
     *
     * Der Verlauf bleibt am geöffneten Eintrag stehen, solange die Zeile
     * aufgeklappt ist — man fragt selten nur einmal. Über einen Neuaufbau der
     * Liste hinaus wird er nicht bewahrt: Die Antworten hängen an genau dieser
     * Meldung und veralten mit ihr.
     */
    const frageBtn = $('.frageBtn', node);
    const frageBox = $('.frageBox', node);
    const frageFeld = $('.frageFeld', node);
    const frageAb = $('.frageAb', node);
    const verlauf = $('.frageVerlauf', node);

    frageBtn.textContent = T().frage;
    frageAb.textContent = T().frageSenden;
    frageFeld.placeholder = T().fragePlatzhalter;

    /** Hängt eine Frage oder Antwort in den sichtbaren Verlauf. */
    const zeile = (art, text) => {
      const p = document.createElement('p');
      p.className = art;
      p.textContent = text;
      verlauf.appendChild(p);
      return p;
    };

    // Was vor dem Neuaufbau schon dastand, kommt zurück.
    const bisher = frageVerlauf.get(n.id) || [];
    for (const e of bisher) {
      zeile('fEigene', e.frage);
      zeile(e.fehler ? 'fAntwort fehler' : 'fAntwort', e.fehler || e.antwort);
    }
    if (frageOffen.has(n.id)) frageBox.hidden = false;

    frageBtn.addEventListener('click', () => {
      frageBox.hidden = !frageBox.hidden;
      if (frageBox.hidden) frageOffen.delete(n.id); else frageOffen.add(n.id);
      if (!frageBox.hidden) frageFeld.focus();
    });

    const absenden = async () => {
      const text = frageFeld.value.trim();
      if (!text || frageAb.disabled) return;

      zeile('fEigene', text);
      const antwort = zeile('fAntwort laeuft', T().frageLaeuft);

      frageFeld.value = '';
      frageAb.disabled = true;

      const erg = await frageStellen(n, text);
      antwort.classList.remove('laeuft');
      if (erg.fehler) {
        antwort.classList.add('fehler');
        antwort.textContent = erg.fehler;
      } else {
        antwort.textContent = erg.antwort;
        /*
         * Sagen, worauf die Antwort beruht.
         *
         * Ob der Artikel gelesen werden konnte, entscheidet darüber, wie viel
         * die Antwort wert ist — bei einer Bot-Sperre stützt sie sich nur auf
         * Schlagzeile und Anriss. Das gehört sichtbar dazu, nicht ins
         * Verborgene.
         */
        if (erg.artikel) {
          zeile('fHinweis', erg.artikel === 'gelesen'
            ? T().artikelGelesen
            : `${T().artikelFehlt}: ${erg.artikel}`);
        }
      }

      // Merken, damit der Verlauf einen Neuaufbau der Liste übersteht.
      const buch = frageVerlauf.get(n.id) || [];
      buch.push({ frage: text, antwort: erg.antwort, fehler: erg.fehler });
      frageVerlauf.set(n.id, buch);
      frageAb.disabled = false;
      frageFeld.focus();
    };

    frageAb.addEventListener('click', absenden);
    frageFeld.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); absenden(); }
    });

    const head = $('.head', node);
    const why = $('.why', node);

    const detailZeigen = (an) => {
      if (an && !detail.dataset.gebaut) {
        detail.innerHTML = detailText(n);
        detail.dataset.gebaut = '1';
      }
      mehr.setAttribute('aria-expanded', String(an));
      mehr.textContent = an ? T().wenigerDetails : T().mehrDetails;
      detail.hidden = !an;
    };

    mehr.textContent = T().mehrDetails;
    mehr.addEventListener('click', () => {
      const an = mehr.getAttribute('aria-expanded') !== 'true';
      if (an) detailsOffen.add(n.id); else detailsOffen.delete(n.id);
      detailZeigen(an);
    });

    head.addEventListener('click', () => {
      const an = head.getAttribute('aria-expanded') !== 'true';
      if (an) {
        offen.add(n.id);
      } else {
        offen.delete(n.id);
        detailsOffen.delete(n.id);
      }
      head.setAttribute('aria-expanded', String(an));
      why.hidden = !an;
      if (an) anrissUebersetzen(n, $('.anriss', node));
      if (!an) detailZeigen(false);
    });

    // Zustand aus der vorherigen Darstellung übernehmen.
    if (offen.has(n.id)) {
      head.setAttribute('aria-expanded', 'true');
      why.hidden = false;
      anrissUebersetzen(n, $('.anriss', node));
      if (detailsOffen.has(n.id)) detailZeigen(true);
    }

    frag.appendChild(node);
  }
  feed.appendChild(frag);

  /*
   * Zurueck an dieselbe Stelle.
   *
   * Nur wenn die Karte noch da ist - sonst waere jeder Sprung geraten. Und
   * nur, wenn ueberhaupt gescrollt wurde: Steht man ohnehin oben, gibt es
   * nichts wiederherzustellen.
   */
  if (anker) {
    /*
     * Erst im naechsten Bild korrigieren.
     *
     * Das Leeren der Liste laesst die Seite auf null zusammenfallen; der
     * Browser setzt die Bildlaufhoehe daraufhin selbst zurueck - und tut das
     * nicht zwingend vor der naechsten Zeile. Eine Korrektur an dieser Stelle
     * wurde dadurch teilweise wieder ueberschrieben, im Versuch um 155 Pixel.
     * Nach dem naechsten Bild steht der Aufbau, und die Messung stimmt.
     */
    requestAnimationFrame(() => {
      const el = feed.querySelector(`[data-id="${CSS.escape(anker.id)}"]`);
      if (!el) return;   // Meldung ist weg - jeder Sprung waere geraten
      const versatz = el.getBoundingClientRect().top - anker.oben;
      if (Math.abs(versatz) > 1) window.scrollBy(0, versatz);
    });
  }
}

function renderFoot() {
  const t = data.updated
    ? new Date(data.updated).toLocaleString(lang === 'en' ? 'en-GB' : 'de-DE')
    : '—';
  const regime = data.regime === 'growth' ? T().wachstumskanal : T().zinskanal;
  const modus = liveUrl ? `LIVE · ${LIVE_INTERVAL / 1000}s` : T().liveInaktiv;
  const fehler = data.errors?.length ? `<br>${T().quellenFehler(data.errors.length)}` : '';

  $('#foot').innerHTML =
    `${modus} · ${T().stand} ${t} · ${VERSION}<br>${T().regime} ${regime} · ${T().bewertungFuer} ${T().assets[asset]}${fehler}` +
    `<br>${T().haftung}`;
}

// ---------- Oberflächentexte ----------
function renderTexte() {
  /*
   * Fehlende Elemente ueberspringen statt daran zu scheitern.
   *
   * Diese Funktion beschriftet die halbe Oberflaeche. Faellt ein Element weg -
   * etwa weil ein Abschnitt aus den Einstellungen entfernt wurde -, warf der
   * direkte Zugriff, und der Rest der Beschriftung lief nie: Die App blieb
   * leer, ohne dass die Ursache irgendwo sichtbar gewesen waere. Genau das ist
   * beim Ausbau des Trading-Profils passiert.
   */
  const setze = (sel, wert) => { const el = $(sel); if (el) el.textContent = wert; };
  document.documentElement.lang = lang;
  $('#q').placeholder = T().suchePlatzhalter;
  setze('#lblSignal', T().signal);
  setze('#lblSort', T().sortieren);
  $$('.seg button').forEach((b) => { b.textContent = T().assets[b.dataset.asset]; });

  $('#sent').innerHTML = Object.entries(T().signalOpt)
    .map(([v, txt]) => `<option value="${v}">${txt}</option>`).join('');
  $('#sent').value = sent;
  $('#sort').innerHTML = Object.entries(T().sortOpt)
    .map(([v, txt]) => `<option value="${v}">${txt}</option>`).join('');
  $('#sort').value = sort;

  setze('#mTitel', T().einstellungen);
  setze('#lSprache', T().sprache);
  setze('#lDesign', T().design);
  setze('#lBenach', T().benachrichtigungen);
  setze('#lLive', T().liveQuelle);
  setze('#lQuellen', T().quellenListe);
  setze('#hLive', T().liveHinweis);
  $('#zugangInput').placeholder = T().zugangPlatzhalter;
  setze('#lKanaele', T().kanaele);
  setze('#hTelegram', T().telegramHinweis);
  setze('#hDiscord', T().discordHinweis);
  setze('#hNtfy', T().ntfyHinweis);
  setze('#testSenden', T().testen);
  setze('#hQuellen', T().quellenHinweis);
  $$('#theme button').forEach((b) => { b.textContent = T().designOpt[b.dataset.theme]; });
  setze('#tZustand', T().zustand);
  setze('#zustandBtn', T().zustandPruefen);
  $$('#benach button').forEach((b) => { b.textContent = T().benachrichtigungOpt[b.dataset.notify]; });
  hinweisBenachrichtigung();
}

// ---------- Design ----------
function themeAnwenden() {
  const dunkel = theme === 'system'
    ? matchMedia('(prefers-color-scheme: dark)').matches
    : theme === 'dark';
  document.documentElement.dataset.theme = dunkel ? 'dark' : 'light';
  $('meta[name="theme-color"]').content = dunkel ? '#07090d' : '#f4f6fa';
  $$('#theme button').forEach((b) => b.classList.toggle('on', b.dataset.theme === theme));
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme === 'system') themeAnwenden();
});

// ---------- Benachrichtigungen ----------
function hinweisBenachrichtigung() {
  const el = $('#hBenach');
  if (notify === 'off') { el.textContent = ''; return; }

  // Der Hinweis gilt nur für den Browser-Kanal; Telegram funktioniert immer.
  if (!kanaele.has('browser')) { el.textContent = ''; return; }
  if (!('Notification' in window)) { el.textContent = T().benachrichtigungHinweis; return; }
  el.textContent = Notification.permission === 'denied'
    ? T().benachrichtigungAbgelehnt
    : Notification.permission === 'granted'
      ? ''
      : T().benachrichtigungHinweis;
}

function benachrichtigungSetzen(wert) {
  notify = wert;
  P.set('notify', notify);
  $$('#benach button').forEach((b) => b.classList.toggle('on', b.dataset.notify === notify));
  hinweisBenachrichtigung();
  kanaeleAnzeigen();
  aboSenden();
}

/**
 * Die Browser-Berechtigung wird erst abgefragt, wenn dieser Kanal auch wirklich
 * gewählt wird. Telegram und Discord laufen unabhängig davon — sie an dieselbe
 * Erlaubnis zu koppeln, hätte den Telegram-Weg unerreichbar gemacht.
 */
async function browserKanalAnfragen() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

function melde(frisch) {
  if (notify === 'off') return;

  const relevant = frisch.filter((n) => {
    const l = label(n.scores[asset] ?? 0);
    return notify === 'strong' ? l.startsWith('strong') : l !== 'neutral';
  });
  if (!relevant.length) return;

  const top = relevant.sort((a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]))[0];
  const rest = relevant.length - 1;
  const kopf = `${T().labels[label(top.scores[asset])]} · ${T().assets[asset]}`;
  const rumpf = `${titel(top)}\n${T().impact[top.impactLevel]} · ${T().dauer[top.duration]}`;

  /*
   * Telegram und Discord bedient der Worker - und nur er kennt das Versandbuch.
   *
   * Schickte die App zusaetzlich selbst, kaeme dieselbe Meldung mehrfach an:
   * einmal vom Worker, und einmal von jedem geoeffneten Geraet. Genau so
   * standen drei Nachrichten im Kanal, zwei davon mit deutschem Titel (die
   * App uebersetzt die Anlageklasse, der Worker nicht) - daran liessen sich
   * die Absender auseinanderhalten.
   *
   * Ohne Worker bleibt der direkte Weg die einzige Moeglichkeit; dann gibt es
   * auch keinen zweiten Absender, mit dem er sich ins Gehege kommen koennte.
   */
  if (!liveUrl && (kanaele.has('telegram') || kanaele.has('discord'))) {
    anKanaele(kopf, rumpf);
  }

  if (!kanaele.has('browser') || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(`${T().labels[label(top.scores[asset])]} · ${T().assets[asset]}`, {
      body: titel(top) + (rest > 0 ? `\n+${rest} ${rest > 1 ? T().neueMeldungen : T().neueMeldung}` : ''),
      icon: 'icon.png',
      tag: 'market-bias',
    });
  } catch { /* Browser verweigert */ }
}

// ---------- Benachrichtigungskanäle ----------
function kanaeleAnzeigen() {
  $('#kanaele').hidden = notify === 'off';
  $$('#kanalWahl button').forEach((b) => b.classList.toggle('on', kanaele.has(b.dataset.kanal)));
  $('#ntfyFelder').hidden = !kanaele.has('ntfy');
  $('#tgFelder').hidden = !kanaele.has('telegram');
  $('#dcFelder').hidden = !kanaele.has('discord');
  $('#ntfyTopic').value = ntfy.topic || '';
  $('#ntfyToken').value = ntfy.token || '';
  $('#tgToken').value = tg.token || '';
  $('#tgChat').value = tg.chat || '';
  $('#dcHook').value = dc.hook || '';
}

/**
 * Schickt eine Meldung an die aktiven Kanäle. Telegram und Discord laufen über
 * den Worker: nur der kann zustellen, während die App geschlossen ist.
 */
/** Alle aktiven Ziele mit vollständigen Angaben. */
function zielListe() {
  const ziele = [];
  if (kanaele.has('ntfy') && ntfy.topic) ziele.push({ typ: 'ntfy', ...ntfy });
  if (kanaele.has('telegram') && tg.token && tg.chat) ziele.push({ typ: 'telegram', ...tg });
  if (kanaele.has('discord') && dc.hook) ziele.push({ typ: 'discord', hook: dc.hook });
  return ziele;
}

async function anKanaele(titelText, text) {
  const ziele = zielListe();
  if (!ziele.length) return { ok: false, grund: 'kein Ziel' };

  // Mit Worker: der verschickt, dann kommt es auch bei geschlossener App an.
  if (liveUrl) {
    try {
      const res = await fetch(`${liveUrl}/notify`, {
        method: 'POST',
        headers: workerKopf({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ titel: titelText, text, ziele }),
      });
      if (res.ok) return { ok: true };
    } catch { /* Worker weg — unten direkt versuchen */ }
  }

  // Ohne Worker direkt aus dem Browser. Telegram erlaubt das (CORS offen),
  // Discord blockt es — dort bleibt der Worker Voraussetzung. Diese Variante
  // funktioniert nur, solange die App geöffnet ist.
  return direktSenden(ziele, titelText, text);
}

async function direktSenden(ziele, titelText, text) {
  let ok = 0;
  let letzterGrund = '';

  for (const z of ziele) {
    if (z.typ === 'ntfy') {
      try {
        const server = (z.server || 'https://ntfy.sh').replace(/\/$/, '');
        const stark = /STARK|STRONG/i.test(titelText);
        const tag = /BEARISH/i.test(titelText) ? (stark ? 'rotating_light' : 'chart_with_downwards_trend')
                  : /BULLISH/i.test(titelText) ? (stark ? 'rocket' : 'chart_with_upwards_trend')
                  : 'newspaper';
        const res = await fetch(`${server}/${encodeURIComponent(z.topic)}`, {
          method: 'POST',
          headers: { 'Title': titelText, 'Priority': stark ? 'urgent' : 'high', 'Tags': tag },
          body: text,
        });
        if (res.ok) ok++; else letzterGrund = `ntfy ${res.status}`;
      } catch { letzterGrund = 'ntfy nicht erreichbar'; }
      continue;
    }
    if (z.typ !== 'telegram') { letzterGrund = 'Discord braucht den Worker'; continue; }
    try {
      const res = await fetch(`https://api.telegram.org/bot${z.token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: z.chat,
          text: `*${titelText}*\n${text}`,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) ok++;
      else letzterGrund = j.description || `HTTP ${res.status}`;
    } catch {
      letzterGrund = 'Telegram nicht erreichbar';
    }
  }

  return ok ? { ok: true, direkt: true } : { ok: false, grund: letzterGrund || 'kein Ziel' };
}

/**
 * Hinterlegt die Benachrichtigungseinstellungen beim Worker. Ohne das würde
 * nur gepusht, solange die App offen ist — genau dann braucht man es am
 * wenigsten.
 */
/*
 * Meldet die Einstellungen an den Worker.
 *
 * Wichtiger als es aussieht: Der Worker benachrichtigt nach seiner eigenen
 * Kopie dieser Werte, nicht nach denen im Browser. Laufen beide auseinander,
 * meldet er Dinge, die die App ausblendet - oder schweigt, wo man eine
 * Meldung erwartet.
 *
 * Frueher verschluckte diese Stelle jeden Fehler. Waehrend der Zugangs-Kopf
 * an der Vorabfrage des Browsers scheiterte, schlug damit jede Uebertragung
 * lautlos fehl - monatelang haetten sich die beiden Kopien auseinander
 * entwickeln koennen, ohne dass irgendetwas darauf hingewiesen haette.
 * Deshalb wird das Ergebnis jetzt festgehalten und im Systemzustand gezeigt.
 */
let aboStand = null;   // { ok, zeit, grund }

async function aboSenden() {
  if (!liveUrl) { aboStand = null; return { ok: false, grund: 'keine Live-Quelle' }; }
  const ziele = zielListe();

  try {
    const res = await fetch(`${liveUrl}/subscribe`, {
      method: 'POST',
      headers: workerKopf({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ stufe: notify, ziele, asset, lang }),
    });
    /*
     * Den Grund des Servers weiterreichen, nicht nur den Statuscode.
     *
     * Seit die Versandziele geprüft werden, kann hier eine Ablehnung mit
     * Begründung kommen — „Adresse nicht erlaubt: example.com". Als bloßes
     * „HTTP 400" wäre sie nicht zu deuten, und man suchte den Fehler
     * anderswo.
     */
    let grund = null;
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      grund = (j && (j.fehler || j.grund)) || `HTTP ${res.status}`;
    }
    aboStand = { ok: res.ok, zeit: new Date().toISOString(), grund };
  } catch (err) {
    aboStand = { ok: false, zeit: new Date().toISOString(), grund: String(err.message).slice(0, 60) };
  }
  return aboStand;
}

// ---------- Laden ----------
function mergeNeu(neueDaten) {
  const erstesLaden = gesehen.size === 0;
  const frisch = [];
  for (const n of neueDaten.items) {
    if (!gesehen.has(n.id)) {
      gesehen.add(n.id);
      if (!erstesLaden) frisch.push(n);
    }
  }
  if (frisch.length) {
    frisch.forEach((n) => frischeIds.add(n.id));
    zeigeBanner(frisch);
    melde(frisch);
  }
  return neueDaten;
}

function zeigeBanner(frisch) {
  const stark = frisch.filter((n) => label(n.scores[asset] ?? 0).startsWith('strong'));
  const banner = $('#banner');
  banner.textContent = stark.length
    ? `${frisch.length} ${T().neu} · ${stark.length} ${T().mitStarkemSignal}`
    : `${frisch.length} ${frisch.length > 1 ? T().neueMeldungen : T().neueMeldung}`;
  banner.classList.add(stark.length ? 'stark' : 'normal');
  banner.hidden = false;

  if (stark.length && navigator.vibrate) navigator.vibrate([40, 60, 40]);

  clearTimeout(zeigeBanner.t);
  zeigeBanner.t = setTimeout(() => {
    banner.hidden = true;
    banner.classList.remove('stark', 'normal');
    frischeIds.clear();
    render(true);
  }, 15000);
}

async function load() {
  const ziel = liveUrl || `data/news.json?t=${Date.now()}`;
  try {
    /*
     * Beim Worker die Kennung des letzten Standes mitschicken. Hat sich nichts
     * geändert, antwortet er mit 304 und ohne Inhalt — statt der rund 35 KB,
     * die alle zwölf Sekunden sonst über die Mobilfunkverbindung gingen.
     */
    const kopf = liveUrl && kennung ? { 'If-None-Match': kennung } : undefined;
    const res = await fetch(ziel, { cache: 'no-store', headers: kopf });

    if (res.status === 304) {
      // Inhalt unverändert, Verbindung aber nachweislich frisch.
      const stand = res.headers.get('x-stand');
      if (stand) data.updated = stand;
      $('#dot').classList.remove('stale');
      $('#dot').title = T().punktLive;
      renderFoot();
      return;
    }

    if (!res.ok) throw new Error(res.status);
    const neu = await res.json();
    if (!neu.items) throw new Error('Antwort ohne Meldungen');
    kennung = res.headers.get('etag') || '';
    data = mergeNeu(neu);
    const alt = (Date.now() - new Date(data.updated)) / 1000;
    // Der Worker hält den Cache bis zu 90 s; mit Netzlaufzeit und Cron-Takt
    // sind zwei Minuten zu knapp bemessen und lösen Fehlalarm aus.
    const veraltet = alt > (liveUrl ? 300 : 2700);
    const punkt = $('#dot');
    punkt.classList.toggle('stale', veraltet);
    punkt.title = veraltet ? T().punktAlt : T().punktLive;
  } catch {
    const punkt = $('#dot');
    punkt.classList.add('stale');
    punkt.title = T().punktAlt;
    if (liveUrl && !data.items.length) {
      try {
        const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
        data = mergeNeu(await res.json());
      } catch { /* auch das schlug fehl */ }
    }
  }
  renderCats();
  renderQuellen();
  renderTages();
  renderFoot();
  render();

  /*
   * Stand die Ansicht beim letzten Mal auf "Woche", wird das Wochenbuch schon
   * hier geholt - sonst zeigte die App beim Start dauerhaft "wird geladen",
   * weil der Abruf bislang nur am Umschalter hing.
   */
  if (ansicht === 'woche' && !wochenbuch && !wochenLaeuft) {
    wochenLaeuft = true;
    wochenbuch = await wochenbuchLaden();
    wochenLaeuft = false;
    if (ansicht === 'woche') renderTages();
  }
}

function starteTakt() {
  clearInterval(timer);
  timer = setInterval(load, liveUrl ? LIVE_INTERVAL : STATIC_INTERVAL);
}

function alles() { renderCats(); renderTages(); renderFoot(); render(true); }

/**
 * Zeigt, ob der Worker gesund ist — ohne Konsole.
 *
 * Die Zahl, auf die es ankommt, ist das Schreibkontingent: Cloudflare
 * erlaubt tausend Ablagen am Tag, und ist das aufgebraucht, hört der Worker
 * still auf zu speichern. Von außen sieht dann alles normal aus, während
 * Benachrichtigungen ausbleiben. Genau diese Auskunft gehört dorthin, wo man
 * sie ohne Werkzeug erreicht.
 */
async function zustandZeigen() {
  const box = $('#zustand');
  const btn = $('#zustandBtn');
  const T_ = T();

  if (!liveUrl) {
    box.className = 'zustand fehler';
    box.textContent = T_.zustandOhneWorker;
    box.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = T_.zustandLaeuft;

  let d = null;
  try {
    const res = await fetch(`${liveUrl}/health`, { headers: workerKopf() });
    d = res.ok ? await res.json() : null;
  } catch { /* unten behandelt */ }

  btn.disabled = false;
  btn.textContent = T_.zustandPruefen;

  if (!d) {
    box.className = 'zustand fehler';
    box.textContent = T_.zustandFehler;
    box.hidden = false;
    return;
  }

  const schreibt = String(d.ablageSchreibt || '').startsWith('ja');
  // Das Versandbuch verhindert, dass dieselbe Meldung zweimal hinausgeht.
  // Es meldet 'bereit', sonst steht dort der letzte Fehlschlag.
  const versandOk = d.versandbuch === 'bereit';

  /*
   * Taktgeber zuerst — daran hängt alles andere.
   *
   * cron-job.org schaltet einen Auftrag nach genügend Fehlversuchen ab. Bleibt
   * das unbemerkt, zeigt die App weiter Meldungen, nur keine neuen mehr; man
   * sucht dann an der falschen Stelle. Älter als fünf Minuten ist auffällig.
   */
  const taktZeilen = (d.taktgeber || []).map((t) => {
    const min = (Date.now() - new Date(t.zeit).getTime()) / 60000;
    /*
     * Ein Reservetaktgeber, der zurückgetreten ist, ist kein Fehler.
     *
     * Er fragt im Minutentakt an und weicht pflichtgemäß, solange der
     * Haupttaktgeber frisch ist. Als Ausfall gewertet stand er stundenlang rot
     * da — eine Warnung für richtiges Verhalten ist schlimmer als keine.
     */
    const art = t.zurueckgetreten ? 'gut'
      : min > 15 ? 'schlecht' : min > 5 ? 'lau' : 'gut';
    const wert = t.zurueckgetreten ? T_.zReserve : T_.zVorMin(min);
    return [`${T_.zTakt} · ${t.quelle}`, wert, art];
  });

  /*
   * Stimmt die Kopie im Worker mit dem ueberein, was hier eingestellt ist?
   *
   * Sie muss es, denn danach wird benachrichtigt. Weicht sie ab, meldet der
   * Worker nach veralteten Regeln - man bekommt Meldungen, die die App nicht
   * zeigt, oder umgekehrt keine, die man erwartet.
   */
  const a = d.abo || {};
  const abweichung = [];
  if (a.stufe && a.stufe !== notify) abweichung.push(`${T_.zBenach}: ${a.stufe} \u2192 ${notify}`);
  if (a.anlageklasse && a.anlageklasse !== asset) abweichung.push(`${T_.zAsset}: ${a.anlageklasse} \u2192 ${asset}`);

  const zeilen = [
    ...(taktZeilen.length ? taktZeilen : [[T_.zTakt, T_.zTaktKeiner, 'lau']]),
    [T_.zVersand, versandOk ? T_.zJa : T_.zNein, versandOk ? 'gut' : 'schlecht'],
    [T_.zAbo, abweichung.length ? T_.zAbweichend : T_.zGleich, abweichung.length ? 'schlecht' : 'gut'],
    [T_.zSpeichern, schreibt ? T_.zJa : T_.zNein, schreibt ? 'gut' : 'schlecht'],
    [T_.zSchreib, d.schreibvorgaenge ?? '—', null],
    [T_.zBestand, `${d.meldungen ?? '—'} · ${d.alterSekunden ?? '?'} s`, null],
    [T_.zGeprueft, d.geprueft ?? '—', null],
    [T_.zBudget, String(d.kiBudget || '—').split(' (')[0], null],
    /*
     * Welches Modell welche Aufgabe traegt.
     *
     * Steht hier mehr als ein Modell, ist sichtbar belegt, dass die laufende
     * Pruefung und eigene Fragen aus getrennten Toepfen bezahlt werden - was
     * von selbst laeuft, kann das Budget fuer eine eigene Frage nicht mehr
     * aufbrauchen.
     */
    [T_.zModelle, d.kiModelle ?? '—', null],
    /*
     * Verbrauch je Modell, nicht als Summe.
     *
     * Die Summe meldete „205.159 von 200.000“, obwohl kein Modell in die Nähe
     * seiner Grenze kam — die Last verteilt sich auf zwei Kontingente zu je
     * 200.000.
     */
    [T_.zVerbrauch, d.kiJeModell ?? '—', null],
  ];

  /*
   * Gemeldete Fehler dazu, aber nur wenn es welche gibt.
   *
   * Der Worker führt sie ohnehin; sie nicht zu zeigen war derselbe Fehler wie
   * beim Doppelschutz — gebaut, aber nicht dorthin gebracht, wo man hinsieht.
   */
  const stoerungen = [
    ['Tick', d.letzterTickFehler],
    [T_.zSpeichern, d.letzterAblageFehler],
    [T_.zVersand, d.versandbuch],
  ].filter(([, v]) => v && typeof v === 'object' && v.fehler);

  box.className = 'zustand';
  box.innerHTML = zeilen.map(([k, v, art]) =>
    `<div class="zZeile"><span>${escape(k)}</span><b class="${art || ''}">${escape(String(v))}</b></div>`
  ).join('')
    + (abweichung.length
        ? `<p class="zWarnung">${escape(T_.zAboHinweis)}<br>${abweichung.map(escape).join('<br>')}</p>`
          + `<button class="zustandBtn" id="aboSync">${escape(T_.zAboUeber)}</button>`
        : '')
    + stoerungen.map(([k, v]) =>
        `<p class="zWarnung">${escape(k)}: ${escape(v.fehler)} (${escape(String(v.zeit).slice(11, 16))} UTC)</p>`
      ).join('')
    + (schreibt ? '' : `<p class="zWarnung">${escape(T_.zHinweis)}</p>`
        + `<p class="zTicks">${escape(T_.zSchreibHinweis)}</p>`);
  box.hidden = false;

  const sync = $('#aboSync', box);
  if (sync) sync.addEventListener('click', async () => {
    sync.disabled = true;
    sync.textContent = T().zustandLaeuft;
    const r = await aboSenden();
    if (r.ok) zustandZeigen();
    else { sync.disabled = false; sync.textContent = `${T().fehlgeschlagen} (${r.grund})`; }
  });
}

// ---------- Quellenliste ----------
function renderQuellen() {
  const zaehler = {};
  for (const n of data.items) zaehler[n.source] = (zaehler[n.source] || 0) + 1;

  $('#quellen').innerHTML = Object.entries(zaehler)
    .sort((a, b) => b[1] - a[1])
    .map(([s, c]) => `<button data-src="${s.replace(/"/g, '')}" class="${ausQuellen.has(s) ? '' : 'on'}">${s}<b>${c}</b></button>`)
    .join('');

  $$('#quellen button').forEach((b) => b.addEventListener('click', () => {
    const s = b.dataset.src;
    if (ausQuellen.has(s)) ausQuellen.delete(s); else ausQuellen.add(s);
    P.set('ausQuellen', JSON.stringify([...ausQuellen]));
    b.classList.toggle('on');
    alles();
  }));
}

// ---------- Bedienung ----------
$$('.seg button').forEach((b) => {
  b.addEventListener('click', () => {
    asset = b.dataset.asset;
    P.set('asset', asset);
    lageText = null;   // der Bericht galt der vorherigen Anlageklasse
    $$('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    alles();
  });
});

let typing;
$('#q').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  $('#clear').hidden = !query;
  clearTimeout(typing);
  typing = setTimeout(() => render(true), 120);
});
$('#clear').addEventListener('click', () => {
  $('#q').value = ''; query = ''; $('#clear').hidden = true; render(true);
});

$('#sent').addEventListener('change', (e) => { sent = e.target.value; P.set('sent', sent); render(true); });
$('#sort').addEventListener('change', (e) => { sort = e.target.value; P.set('sort', sort); render(true); });
$('#banner').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// Einstellungen öffnen und schließen
$('#gear').addEventListener('click', () => { $('#modal').hidden = false; });
$('#zu').addEventListener('click', () => { $('#modal').hidden = true; });
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') $('#modal').hidden = true; });

$$('#sprache button').forEach((b) => b.addEventListener('click', () => {
  lang = b.dataset.lang;
  P.set('lang', lang);
  $$('#sprache button').forEach((x) => x.classList.toggle('on', x === b));
  renderTexte();
  alles();
}));

$$('#theme button').forEach((b) => b.addEventListener('click', () => {
  theme = b.dataset.theme;
  P.set('theme', theme);
  themeAnwenden();
}));

$$('#benach button').forEach((b) => b.addEventListener('click', () => benachrichtigungSetzen(b.dataset.notify)));

$('#zugangInput').addEventListener('change', (e) => {
  zugang = e.target.value.trim();
  P.set('zugang', zugang);
  aboSenden();
});

$('#liveInput').addEventListener('change', (e) => {
  liveUrl = urlNormalisieren(e.target.value);
  e.target.value = liveUrl;          // ergänzte Adresse sichtbar zurückschreiben
  P.set('liveUrl', liveUrl);
  starteTakt();
  load();
});

// Benachrichtigungskanäle
$$('#kanalWahl button').forEach((b) => b.addEventListener('click', async () => {
  const k = b.dataset.kanal;
  if (kanaele.has(k)) {
    kanaele.delete(k);
  } else {
    if (k === 'browser') await browserKanalAnfragen();
    kanaele.add(k);
  }
  P.set('kanaele', JSON.stringify([...kanaele]));
  kanaeleAnzeigen();
  hinweisBenachrichtigung();
  aboSenden();
}));
$('#ntfyTopic').addEventListener('change', (e) => {
  ntfy.topic = e.target.value.trim(); P.set('ntfy', JSON.stringify(ntfy));
  aboSenden();
});
$('#ntfyToken').addEventListener('change', (e) => {
  ntfy.token = e.target.value.trim(); P.set('ntfy', JSON.stringify(ntfy));
  aboSenden();
});
$('#tgToken').addEventListener('change', (e) => {
  tg.token = e.target.value.trim(); P.set('tg', JSON.stringify(tg));
  aboSenden();
});
$('#tgChat').addEventListener('change', (e) => {
  tg.chat = e.target.value.trim(); P.set('tg', JSON.stringify(tg));
  aboSenden();
});
$('#dcHook').addEventListener('change', (e) => {
  dc.hook = e.target.value.trim(); P.set('dc', JSON.stringify(dc));
  aboSenden();
});

/**
 * Testet den Weg, den die automatischen Meldungen tatsächlich nehmen.
 *
 * Vorher schickte der Test an die Ziele aus diesem Formular. Das kann
 * gelingen, während der Betrieb schweigt — denn nachts verschickt der Worker
 * an das *gespeicherte* Abo, und wer eine Adresse geändert, aber nicht
 * gespeichert hat, prüft mit dem Formular etwas anderes als das, was läuft.
 * Genau diese Verwechslung hat hier schon einmal Stunden gekostet:
 * „Test senden funktioniert, aber neue News werden nicht gepusht."
 *
 * Mit Worker geht der Test deshalb über /testpush — dieselbe Ablage,
 * dieselben Ziele, derselbe Versandweg wie bei geschlossener App. Ohne
 * Worker bleibt nur der direkte Weg aus dem Browser, und der wird als
 * solcher benannt.
 */
$('#testSenden').addEventListener('click', async () => {
  const st = $('#testStatus');
  st.textContent = '…';

  let r;
  if (liveUrl) {
    try {
      const res = await fetch(`${liveUrl}/testpush`, { headers: workerKopf() });
      const j = await res.json();
      /*
       * Der Grund kann Liste oder Satz sein.
       *
       * Der Versand meldet eine Liste („Discord 401"), die Zugangsprüfung
       * einen Satz. Auf einem Satz .join() aufzurufen wirft — und der
       * Fehlschlag landete im catch darunter, das „Worker antwortet nicht"
       * meldete. Genau die Ursache, die dort stand, wurde damit verschluckt:
       * ein nicht passendes Zugangswort sah aus wie ein toter Worker.
       */
      const grundText = (w) => (Array.isArray(w) ? w.join('; ') : (w ? String(w) : ''));
      r = j.ok
        ? { ok: true, hinweis: (j.kanaele || []).join(', ') }
        : { ok: false, grund: grundText(j.grund) || grundText(j.fehler) || T().fehlgeschlagen };
    } catch {
      r = { ok: false, grund: T().zustandFehler };
    }
  } else {
    r = await anKanaele('Market Bias', 'Test — die Verbindung steht.');
    if (r.ok) r.hinweis = T().nurOffeneApp;
  }

  st.textContent = r.ok
    ? `${T().gesendet}${r.hinweis ? ' (' + r.hinweis + ')' : ''}`
    : `${T().fehlgeschlagen}${r.grund ? ' (' + r.grund + ')' : ''}`;
  st.className = 'testStatus ' + (r.ok ? 'ok' : 'fehler');
  setTimeout(() => { st.textContent = ''; st.className = 'testStatus'; }, 9000);
});

// ---------- Start ----------
$$('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.asset === asset)));
$$('#sprache button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
$$('#benach button').forEach((b) => b.classList.toggle('on', b.dataset.notify === notify));
$('#liveInput').value = liveUrl;
$('#zugangInput').value = zugang;

kanaeleAnzeigen();
$('#ver').textContent = VERSION;
themeAnwenden();
renderTexte();

const tick = () => {
  $('#clock').textContent = new Date().toLocaleTimeString(lang === 'en' ? 'en-GB' : 'de-DE', { hour12: false });
};
tick();
setInterval(tick, 1000);

load();
starteTakt();
aboSenden();
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Beim Start und danach stuendlich nach einer neuen Fassung sehen.
    reg.update().catch(() => {});
    setInterval(() => reg.update().catch(() => {}), 3600_000);

    // Uebernimmt eine neue Fassung die Kontrolle, einmal neu laden — sonst
    // liefe die Oberflaeche mit altem Code weiter.
    let neuGeladen = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (neuGeladen) return;
      neuGeladen = true;
      location.reload();
    });
  }).catch(() => {});
}
