import { profilPassung, STANDARD_PROFIL } from './engine/profile.mjs';

const CAT_ORDER = ['us-data', 'geopolitics', 'fed', 'crypto', 'us-markets', 'global-data', 'markets'];
const ASSET_KEYS = ['crypto', 'stocks', 'gold', 'usd'];
const VERSION = 'v10';           // in der Fußzeile sichtbar, erleichtert die Fehlersuche
const LIVE_INTERVAL = 12000;    // mit Worker: alle 12 Sekunden
const STATIC_INTERVAL = 60000;  // ohne Worker: news.json einmal pro Minute

// Identische Schwellen wie in docs/engine/sentiment.mjs
function label(s) {
  if (s >= 0.55) return 'strong_bullish';
  if (s >= 0.16) return 'bullish';
  if (s <= -0.55) return 'strong_bearish';
  if (s <= -0.16) return 'bearish';
  return 'neutral';
}

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
let sent = 'all';
let sort = P.get('sort', 'priority');
let lang = P.get('lang', navigator.language?.startsWith('en') ? 'en' : 'de');
let theme = P.get('theme', 'system');
let notify = P.get('notify', 'off');
let liveUrl = urlNormalisieren(P.get('liveUrl', '') || window.MARKET_BIAS_LIVE_URL || '');
let ausQuellen = new Set(JSON.parse(P.get('ausQuellen', '[]')));
let profil = { ...STANDARD_PROFIL, ...JSON.parse(P.get('profil', '{}')) };
let kanaele = new Set(JSON.parse(P.get('kanaele', '["browser"]')));
let tg = JSON.parse(P.get('tg', '{}'));
let dc = JSON.parse(P.get('dc', '{}'));
let ntfy = JSON.parse(P.get('ntfy', '{}'));
let query = '';
let gesehen = new Set();
let frischeIds = new Set();
let timer = null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const feed = $('#feed');
const T = () => window.I18N[lang];

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

// ---------- Filterkette ----------
function matches(n) {
  if (cat !== 'all' && n.category !== cat) return false;
  if (ausQuellen.has(n.source)) return false;
  if (profilPassung(n, profil) === null) return false;

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
      const fa = (a.priority ?? 0) * (profil.aktiv ? (profilPassung(a, profil) ?? 0) : 1);
      const fb = (b.priority ?? 0) * (profil.aktiv ? (profilPassung(b, profil) ?? 0) : 1);
      return fb - fa || new Date(b.date) - new Date(a.date);
    },
    time: (a, b) => new Date(b.date) - new Date(a.date),
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

const escape = (s) => String(s).replace(/[<>&"]/g, (c) =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function renderTages() {
  const t = tagesbild();
  const box = $('#tages');
  const T_ = T();
  if (!t) { box.innerHTML = `<p class="tagesLeer">${T_.tagesbildLeer}</p>`; return; }

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
      <span class="tagesTitel">${T_.tagesbild}</span>
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

  // 4) Wirkung je Anlageklasse
  blocks.push(`<div class="dblock"><h4>${t.detailWirkung}</h4>${bars(n)}</div>`);

  // 5) Einordnung für den Handel
  const typ = lang === 'en' ? (n.eventTypeEn || n.eventType) : n.eventType;
  blocks.push(`<div class="dblock"><h4>${t.detailHandel}</h4>
    ${zeile(t.tradingImpact, t.impact[n.impactLevel] || '—')}
    ${zeile(t.erwarteteDauer, t.dauer[n.duration] || '—')}
    ${typ ? zeile(t.dTyp, typ) : ''}
    ${zeile(t.dRelevanz, `${n.priority}/100`)}
    ${zeile(t.dQuelle, n.source + (n.alsoIn?.length ? ` +${n.alsoIn.length}` : ''))}</div>`);

  // 6) Die Annahme, auf der alles beruht
  blocks.push(`<div class="dblock"><h4>${t.detailAnnahme}</h4>
    <p class="dtext">${data.regime === 'growth' ? t.annahmeGrowth : t.annahmePolicy}</p></div>`);

  return blocks.join('');
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
    render();
  }));
}

function render() {
  const items = ordered(data.items.filter(matches));
  $('#count').textContent = `${items.length}/${data.items.length}`;
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
    if (frischeIds.has(n.id)) item.classList.add('neu');

    $('time', node).textContent = zeit(n.date);

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

    const anzahl = n.alsoIn?.length || 0;
    const auch = anzahl ? ` · +${anzahl} ${anzahl > 1 ? T().quellenMehr : T().quellen}` : '';
    $('.src', node).textContent =
      `${n.source.toUpperCase()}${n.region ? ' · ' + n.region : ''}${auch} · REL ${n.priority}`;

    // Deutsche Fassung der Schlagzeile, falls vorhanden.
    const ueb = $('.uebersetzung', node);
    const deutsch = uebersetzt(n);
    if (deutsch) { ueb.textContent = deutsch; ueb.hidden = false; }

    $('.reason', node).textContent = grund(n);
    $('.bars', node).innerHTML = bars(n);

    const link = $('.link', node);
    if (n.url) { link.href = n.url; link.textContent = T().quelleOeffnen; } else link.remove();

    // Langfassung wird erst auf Wunsch gebaut — spart Arbeit bei 300 Einträgen.
    const mehr = $('.mehrBtn', node);
    const detail = $('.detail', node);
    mehr.textContent = T().mehrDetails;
    mehr.addEventListener('click', () => {
      const offen = mehr.getAttribute('aria-expanded') === 'true';
      if (!offen && !detail.dataset.gebaut) {
        detail.innerHTML = detailText(n);
        detail.dataset.gebaut = '1';
      }
      mehr.setAttribute('aria-expanded', String(!offen));
      mehr.textContent = offen ? T().mehrDetails : T().wenigerDetails;
      detail.hidden = offen;
    });

    const head = $('.head', node);
    const why = $('.why', node);
    head.addEventListener('click', () => {
      const offen = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!offen));
      why.hidden = offen;
    });

    frag.appendChild(node);
  }
  feed.appendChild(frag);
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
  document.documentElement.lang = lang;
  $('#q').placeholder = T().suchePlatzhalter;
  $('#lblSignal').textContent = T().signal;
  $('#lblSort').textContent = T().sortieren;
  $$('.seg button').forEach((b) => { b.textContent = T().assets[b.dataset.asset]; });

  $('#sent').innerHTML = Object.entries(T().signalOpt)
    .map(([v, txt]) => `<option value="${v}">${txt}</option>`).join('');
  $('#sent').value = sent;
  $('#sort').innerHTML = Object.entries(T().sortOpt)
    .map(([v, txt]) => `<option value="${v}">${txt}</option>`).join('');
  $('#sort').value = sort;

  $('#mTitel').textContent = T().einstellungen;
  $('#lSprache').textContent = T().sprache;
  $('#lDesign').textContent = T().design;
  $('#lBenach').textContent = T().benachrichtigungen;
  $('#lLive').textContent = T().liveQuelle;
  $('#lQuellen').textContent = T().quellenListe;
  $('#hLive').textContent = T().liveHinweis;
  $('#lProfil').textContent = T().profil;
  $('#lStil').textContent = T().stil;
  $('#lZeit').textContent = T().zeitrahmen;
  $('#lCoins').textContent = T().muenzen;
  $('#lKanaele').textContent = T().kanaele;
  $('#hTelegram').textContent = T().telegramHinweis;
  $('#hDiscord').textContent = T().discordHinweis;
  $('#hNtfy').textContent = T().ntfyHinweis;
  $('#testSenden').textContent = T().testen;
  $$('#profilAn button')[0].textContent = T().profilAus;
  $$('#profilAn button')[1].textContent = T().profilAn;
  $$('#stil button').forEach((b) => { b.textContent = T().stilOpt[b.dataset.stil]; });
  profilHinweis();
  $('#hQuellen').textContent = T().quellenHinweis;
  $$('#theme button').forEach((b) => { b.textContent = T().designOpt[b.dataset.theme]; });
  $$('#benach button').forEach((b) => { b.textContent = T().benachrichtigungOpt[b.dataset.notify]; });
  hinweisBenachrichtigung();
}

// ---------- Trading-Profil ----------
function profilHinweis() {
  const el = $('#hProfil');
  if (!profil.aktiv) { el.textContent = T().profilHinweis; return; }
  const passend = data.items.filter((n) => profilPassung(n, profil) !== null).length;
  el.textContent = `${T().profilAktivHinweis(passend, data.items.length)} ${T().profilHinweis}`;
}

function profilAnzeigen() {
  $('#profilDetails').hidden = !profil.aktiv;
  $$('#profilAn button').forEach((b) =>
    b.classList.toggle('on', (b.dataset.profil === 'an') === profil.aktiv));
  $$('#stil button').forEach((b) => b.classList.toggle('on', b.dataset.stil === profil.stil));
  $$('#tf button').forEach((b) => b.classList.toggle('on', b.dataset.tf === profil.timeframe));
  $$('#coins button').forEach((b) => b.classList.toggle('on', profil.coins.includes(b.dataset.coin)));
  profilHinweis();
}

function profilSpeichern() {
  P.set('profil', JSON.stringify(profil));
  profilAnzeigen();
  aboSenden();
  alles();
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

  if (kanaele.has('telegram') || kanaele.has('discord')) anKanaele(kopf, rumpf);

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
        headers: { 'Content-Type': 'application/json' },
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
async function aboSenden() {
  if (!liveUrl) return;
  const ziele = zielListe();

  try {
    await fetch(`${liveUrl}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stufe: notify, ziele, profil, asset, lang }),
    });
  } catch { /* Worker gerade nicht erreichbar */ }
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
    render();
  }, 15000);
}

async function load() {
  const ziel = liveUrl || `data/news.json?t=${Date.now()}`;
  try {
    const res = await fetch(ziel, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const neu = await res.json();
    if (!neu.items) throw new Error('Antwort ohne Meldungen');
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
  profilHinweis();
  renderTages();
  renderFoot();
  render();
}

function starteTakt() {
  clearInterval(timer);
  timer = setInterval(load, liveUrl ? LIVE_INTERVAL : STATIC_INTERVAL);
}

function alles() { renderCats(); renderTages(); renderFoot(); render(); }

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
    $$('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    alles();
  });
});

let typing;
$('#q').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  $('#clear').hidden = !query;
  clearTimeout(typing);
  typing = setTimeout(render, 120);
});
$('#clear').addEventListener('click', () => {
  $('#q').value = ''; query = ''; $('#clear').hidden = true; render();
});

$('#sent').addEventListener('change', (e) => { sent = e.target.value; render(); });
$('#sort').addEventListener('change', (e) => { sort = e.target.value; P.set('sort', sort); render(); });
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

$('#liveInput').addEventListener('change', (e) => {
  liveUrl = urlNormalisieren(e.target.value);
  e.target.value = liveUrl;          // ergänzte Adresse sichtbar zurückschreiben
  P.set('liveUrl', liveUrl);
  starteTakt();
  load();
});


// Trading-Profil
$$('#profilAn button').forEach((b) => b.addEventListener('click', () => {
  profil.aktiv = b.dataset.profil === 'an';
  profilSpeichern();
}));
$$('#stil button').forEach((b) => b.addEventListener('click', () => {
  profil.stil = b.dataset.stil;
  profilSpeichern();
}));
$$('#tf button').forEach((b) => b.addEventListener('click', () => {
  profil.timeframe = b.dataset.tf;
  // Der Zeitrahmen legt den Stil nahe — ein Widerspruch wäre verwirrend.
  const passend = { '1m': 'scalping', '3m': 'scalping', '5m': 'scalping',
                    '15m': 'intraday', '1h': 'intraday', '4h': 'swing' }[profil.timeframe];
  if (passend) profil.stil = passend;
  profilSpeichern();
}));
$$('#coins button').forEach((b) => b.addEventListener('click', () => {
  const c = b.dataset.coin;
  profil.coins = profil.coins.includes(c)
    ? profil.coins.filter((x) => x !== c)
    : [...profil.coins, c];
  if (!profil.coins.length) profil.coins = ['BTC'];   // ohne Coin bliebe nichts übrig
  profilSpeichern();
}));

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

$('#testSenden').addEventListener('click', async () => {
  const st = $('#testStatus');
  st.textContent = '…';
  const r = await anKanaele('Market Bias', 'Test — die Verbindung steht.');
  st.textContent = r.ok
    ? `${T().gesendet}${r.direkt ? ' (nur bei offener App)' : ''}`
    : `${T().fehlgeschlagen}${r.grund ? ' (' + r.grund + ')' : ''}`;
  st.className = 'testStatus ' + (r.ok ? 'ok' : 'fehler');
  setTimeout(() => { st.textContent = ''; st.className = 'testStatus'; }, 6000);
});

// ---------- Start ----------
$$('.seg button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.asset === asset)));
$$('#sprache button').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
$$('#benach button').forEach((b) => b.classList.toggle('on', b.dataset.notify === notify));
$('#liveInput').value = liveUrl;

profilAnzeigen();
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
