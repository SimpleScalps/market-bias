const ASSETS = { crypto: 'KRYPTO', stocks: 'AKTIEN', gold: 'GOLD', usd: 'USD' };
const TEXT = {
  strong_bullish: 'STARK BULLISH', bullish: 'BULLISH', neutral: 'NEUTRAL',
  bearish: 'BEARISH', strong_bearish: 'STARK BEARISH',
};
// Reihenfolge der Kategorie-Chips: der Arbeitsschwerpunkt zuerst.
const CAT_ORDER = ['us-data', 'geopolitics', 'fed', 'crypto', 'us-markets', 'global-data', 'markets'];

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

let data = { items: [] };
let asset = localStorage.getItem('asset') || 'crypto';
let cat = localStorage.getItem('cat') || 'all';
let sent = 'all';
let sort = localStorage.getItem('sort') || 'priority';
let query = '';
let liveUrl = localStorage.getItem('liveUrl') || window.MARKET_BIAS_LIVE_URL || '';
let gesehen = new Set();        // bereits angezeigte Meldungs-IDs
let frischeIds = new Set();     // seit dem letzten Blick hinzugekommen
let timer = null;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const feed = $('#feed');

const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

// ---------- Filterkette ----------
function matches(n) {
  if (cat !== 'all' && n.category !== cat) return false;

  const l = label(n.scores[asset] ?? 0);
  if (sent === 'strong' && !l.startsWith('strong')) return false;
  if (sent === 'bull' && !l.includes('bullish')) return false;
  if (sent === 'bear' && !l.includes('bearish')) return false;
  if (sent === 'nonneutral' && l === 'neutral') return false;

  if (query) {
    const hay = `${n.title} ${n.source} ${n.categoryLabel} ${n.event || ''}`.toLowerCase();
    if (!query.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function ordered(list) {
  const by = {
    priority: (a, b) => b.priority - a.priority || new Date(b.date) - new Date(a.date),
    time: (a, b) => new Date(b.date) - new Date(a.date),
    impact: (a, b) => Math.abs(b.scores[asset]) - Math.abs(a.scores[asset]) || b.priority - a.priority,
  };
  return [...list].sort(by[sort]);
}

// ---------- Darstellung ----------
function meterStyle(v) {
  const w = Math.abs(v) * 50;
  const col = v > 0 ? 'var(--bull)' : v < 0 ? 'var(--bear)' : 'var(--neut)';
  return v >= 0
    ? `left:50%;width:${w}%;background:${col}`
    : `left:${50 - w}%;width:${w}%;background:${col}`;
}

function bars(n) {
  return Object.entries(ASSETS).map(([k, name]) => {
    const v = n.scores[k] ?? 0;
    return `<div class="row"><span>${name}</span>
      <span class="track"><i style="${meterStyle(v)}"></i></span>
      <span class="val">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
  }).join('');
}

function renderCats() {
  const counts = { all: data.items.length };
  for (const n of data.items) counts[n.category] = (counts[n.category] || 0) + 1;

  const present = CAT_ORDER.filter((c) => counts[c]);
  const labels = { all: 'ALLE', ...Object.fromEntries(data.items.map((n) => [n.category, (n.categoryLabel || '').toUpperCase()])) };

  $('#cats').innerHTML = ['all', ...present]
    .map((c) => `<button data-cat="${c}" class="${c === cat ? 'on' : ''}">${labels[c] || c}<b>${counts[c]}</b></button>`)
    .join('');

  $$('#cats button').forEach((b) => b.addEventListener('click', () => {
    cat = b.dataset.cat;
    localStorage.setItem('cat', cat);
    renderCats();
    render();
  }));
}

function render() {
  const items = ordered(data.items.filter(matches));
  $('#count').textContent = `${items.length}/${data.items.length}`;
  feed.innerHTML = '';

  if (!items.length) {
    feed.innerHTML = '<p class="empty">KEINE TREFFER FÜR DIESEN FILTER</p>';
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

    $('time', node).textContent = time(n.date);

    const c = $('.cat', node);
    c.textContent = (n.categoryLabel || '').toUpperCase();
    c.dataset.c = n.category;

    $('.title', node).textContent = n.title;
    $('.meter i', node).style.cssText = meterStyle(score);

    const badge = $('.badge', node);
    badge.textContent = TEXT[l];
    badge.classList.add(l);

    const auch = n.alsoIn?.length ? ` · +${n.alsoIn.length} QUELLE${n.alsoIn.length > 1 ? 'N' : ''}` : '';
    $('.src', node).textContent =
      `${n.source.toUpperCase()}${n.region ? ' · ' + n.region : ''}${auch} · REL ${n.priority}`;

    $('.reason', node).textContent = n.why || 'Keine Begründung verfügbar.';
    $('.bars', node).innerHTML = bars(n);

    const link = $('.link', node);
    if (n.url) link.href = n.url; else link.remove();

    const head = $('.head', node);
    const why = $('.why', node);
    head.addEventListener('click', () => {
      const open = head.getAttribute('aria-expanded') === 'true';
      head.setAttribute('aria-expanded', String(!open));
      why.hidden = open;
    });

    frag.appendChild(node);
  }
  feed.appendChild(frag);
}

function renderFoot() {
  const t = data.updated ? new Date(data.updated).toLocaleString('de-DE') : '—';
  const regime = data.regime === 'growth' ? 'WACHSTUMSKANAL' : 'ZINSKANAL';
  const modus = liveUrl
    ? `LIVE · ${LIVE_INTERVAL / 1000}s-TAKT`
    : 'STANDARD · GITHUB-ACTIONS-TAKT';
  const fehler = data.errors?.length ? `<br>${data.errors.length} Quelle(n) nicht erreichbar` : '';

  $('#foot').innerHTML =
    `${modus} · STAND ${t}<br>REGIME ${regime} · BEWERTUNG FÜR ${ASSETS[asset]}${fehler}` +
    `<br><button id="setup" class="setup">${liveUrl ? 'LIVE-QUELLE ÄNDERN' : 'LIVE-QUELLE EINRICHTEN'}</button>` +
    `<br>Regelbasierte Ersteinordnung, keine Anlageberatung.`;

  $('#setup').addEventListener('click', () => {
    const eingabe = prompt(
      'URL des Cloudflare Workers für den Live-Betrieb.\n' +
      'Leer lassen, um wieder den Standardtakt zu nutzen.',
      liveUrl
    );
    if (eingabe === null) return;
    liveUrl = eingabe.trim().replace(/\/$/, '');
    localStorage.setItem('liveUrl', liveUrl);
    starteTakt();
    load();
  });
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
  }
  return neueDaten;
}

function zeigeBanner(frisch) {
  const stark = frisch.filter((n) => label(n.scores[asset] ?? 0).startsWith('strong'));
  const banner = $('#banner');
  banner.textContent = stark.length
    ? `${frisch.length} NEU · ${stark.length} MIT STARKEM SIGNAL`
    : `${frisch.length} NEUE MELDUNG${frisch.length > 1 ? 'EN' : ''}`;
  banner.classList.add('an', stark.length ? 'stark' : 'normal');
  banner.hidden = false;

  // Auf dem iPhone spürbar machen, wenn ein starkes Signal hereinkommt.
  if (stark.length && navigator.vibrate) navigator.vibrate([40, 60, 40]);

  clearTimeout(zeigeBanner.t);
  zeigeBanner.t = setTimeout(() => {
    banner.hidden = true;
    banner.classList.remove('an', 'stark', 'normal');
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
    // Live-Betrieb sollte unter 2 Minuten bleiben, der Standardtakt unter 45.
    $('#dot').classList.toggle('stale', alt > (liveUrl ? 120 : 2700));
  } catch (err) {
    $('#dot').classList.add('stale');
    if (liveUrl && !data.items.length) {
      // Worker nicht erreichbar: auf den mitgelieferten Stand zurückfallen.
      try {
        const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
        data = mergeNeu(await res.json());
      } catch { /* auch das schlug fehl */ }
    }
  }
  renderCats();
  renderFoot();
  render();
}

function starteTakt() {
  clearInterval(timer);
  timer = setInterval(load, liveUrl ? LIVE_INTERVAL : STATIC_INTERVAL);
}

// ---------- Bedienung ----------
$$('.seg button').forEach((b) => {
  b.setAttribute('aria-selected', String(b.dataset.asset === asset));
  b.addEventListener('click', () => {
    asset = b.dataset.asset;
    localStorage.setItem('asset', asset);
    $$('.seg button').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderFoot();
    render();
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
$('#sort').addEventListener('change', (e) => {
  sort = e.target.value; localStorage.setItem('sort', sort); render();
});
$('#sort').value = sort;

$('#banner').addEventListener('click', () => {
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Uhr in der Statuszeile
const tick = () => {
  $('#clock').textContent = new Date().toLocaleTimeString('de-DE', { hour12: false });
};
tick();
setInterval(tick, 1000);

load();
starteTakt();
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
