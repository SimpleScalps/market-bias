import { profilPassung, STANDARD_PROFIL } from './engine/profile.mjs';

const CAT_ORDER = ['us-data', 'geopolitics', 'fed', 'crypto', 'us-markets', 'global-data', 'markets'];
const ASSET_KEYS = ['crypto', 'stocks', 'gold', 'usd'];
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
let liveUrl = P.get('liveUrl', '') || window.MARKET_BIAS_LIVE_URL || '';
let ausQuellen = new Set(JSON.parse(P.get('ausQuellen', '[]')));
let profil = { ...STANDARD_PROFIL, ...JSON.parse(P.get('profil', '{}')) };
let kanaele = new Set(JSON.parse(P.get('kanaele', '["browser"]')));
let tg = JSON.parse(P.get('tg', '{}'));
let dc = JSON.parse(P.get('dc', '{}'));
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
// Deutsche Fassung nutzen, wo vorhanden — sonst bleibt der Originaltitel stehen.
const titel = (n) => (lang === 'de' ? (n.titleDe || n.title) : n.title);

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

function renderTages() {
  const t = tagesbild();
  const box = $('#tages');
  if (!t) { box.innerHTML = `<p class="tagesLeer">${T().tagesbildLeer}</p>`; return; }

  // Für die Tagessicht ist die Skala enger — ein Tagesmittel von 0,3 ist viel.
  const l = label(t.score * 1.8);
  const datum = new Date().toLocaleDateString(lang === 'en' ? 'en-GB' : 'de-DE',
    { day: '2-digit', month: '2-digit', year: 'numeric' });

  const treiber = t.treiber.length
    ? `<div class="treiber"><span>${T().treiber}</span><ul>${
        t.treiber.map((n) => `<li class="${label(n.scores[asset])}">${
          titel(n).replace(/[<>&]/g, '').slice(0, 74)}</li>`).join('')
      }</ul></div>`
    : '';

  box.innerHTML = `
    <div class="tagesKopf">
      <span class="tagesTitel">${T().tagesbild}</span>
      <span class="tagesDatum">${datum}</span>
    </div>
    <div class="tagesWert">
      <span class="meter gross"><i style="${meterStyle(t.score * 1.8)}"></i></span>
      <span class="badge ${l}">${T().labels[l]}</span>
      <span class="tagesZahl">${t.score > 0 ? '+' : ''}${t.score.toFixed(2)}</span>
    </div>
    <p class="tagesVerteilung">${T().verteilung(t.bull, t.neut, t.bear)}</p>
    ${treiber}`;
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

    $('.reason', node).textContent = grund(n);
    $('.bars', node).innerHTML = bars(n);

    const link = $('.link', node);
    if (n.url) { link.href = n.url; link.textContent = T().quelleOeffnen; } else link.remove();

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
    `${modus} · ${T().stand} ${t}<br>${T().regime} ${regime} · ${T().bewertungFuer} ${T().assets[asset]}${fehler}` +
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
  if (!('Notification' in window)) { el.textContent = T().benachrichtigungHinweis; return; }
  el.textContent = Notification.permission === 'denied'
    ? T().benachrichtigungAbgelehnt
    : T().benachrichtigungHinweis;
}

async function benachrichtigungSetzen(wert) {
  if (wert !== 'off' && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* abgelehnt */ }
  }
  notify = (wert !== 'off' && 'Notification' in window && Notification.permission !== 'granted') ? 'off' : wert;
  P.set('notify', notify);
  $$('#benach button').forEach((b) => b.classList.toggle('on', b.dataset.notify === notify));
  hinweisBenachrichtigung();
  kanaeleAnzeigen();
  aboSenden();
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
  $('#tgFelder').hidden = !kanaele.has('telegram');
  $('#dcFelder').hidden = !kanaele.has('discord');
  $('#tgToken').value = tg.token || '';
  $('#tgChat').value = tg.chat || '';
  $('#dcHook').value = dc.hook || '';
}

/**
 * Schickt eine Meldung an die aktiven Kanäle. Telegram und Discord laufen über
 * den Worker: nur der kann zustellen, während die App geschlossen ist.
 */
async function anKanaele(titelText, text) {
  if (!liveUrl) return { ok: false, grund: 'kein Worker' };
  const ziele = [];
  if (kanaele.has('telegram') && tg.token && tg.chat) ziele.push({ typ: 'telegram', ...tg });
  if (kanaele.has('discord') && dc.hook) ziele.push({ typ: 'discord', hook: dc.hook });
  if (!ziele.length) return { ok: false, grund: 'kein Ziel' };

  try {
    const res = await fetch(`${liveUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titel: titelText, text, ziele }),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false, grund: 'nicht erreichbar' };
  }
}

/**
 * Hinterlegt die Benachrichtigungseinstellungen beim Worker. Ohne das würde
 * nur gepusht, solange die App offen ist — genau dann braucht man es am
 * wenigsten.
 */
async function aboSenden() {
  if (!liveUrl) return;
  const ziele = [];
  if (kanaele.has('telegram') && tg.token && tg.chat) ziele.push({ typ: 'telegram', ...tg });
  if (kanaele.has('discord') && dc.hook) ziele.push({ typ: 'discord', hook: dc.hook });

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
    $('#dot').classList.toggle('stale', alt > (liveUrl ? 120 : 2700));
  } catch {
    $('#dot').classList.add('stale');
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
  liveUrl = e.target.value.trim().replace(/\/$/, '');
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
$$('#kanalWahl button').forEach((b) => b.addEventListener('click', () => {
  const k = b.dataset.kanal;
  if (kanaele.has(k)) kanaele.delete(k); else kanaele.add(k);
  P.set('kanaele', JSON.stringify([...kanaele]));
  kanaeleAnzeigen();
  aboSenden();
}));
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
  st.textContent = r.ok ? T().gesendet : `${T().fehlgeschlagen}${r.grund ? ' (' + r.grund + ')' : ''}`;
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
