const ASSETS = { crypto: 'Krypto', stocks: 'Aktien', gold: 'Gold', usd: 'USD' };
const TEXT = {
  strong_bullish: 'STARK BULLISH', bullish: 'BULLISH', neutral: 'NEUTRAL',
  bearish: 'BEARISH', strong_bearish: 'STARK BEARISH',
};

// Identische Schwellen wie in src/sentiment.mjs
function label(s) {
  if (s >= 0.55) return 'strong_bullish';
  if (s >= 0.16) return 'bullish';
  if (s <= -0.55) return 'strong_bearish';
  if (s <= -0.16) return 'bearish';
  return 'neutral';
}

let data = { items: [] };
let asset = localStorage.getItem('asset') || 'crypto';
let filter = 'all';

const $ = (s, r = document) => r.querySelector(s);
const feed = $('#feed');

const time = (iso) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });

function visible(n) {
  if (filter === 'moving') return n.tags?.includes('Market Moving') || n.impact === 'high';
  if (filter === 'data') return n.kind === 'macro';
  if (filter === 'signal') return label(n.scores[asset]) !== 'neutral';
  return true;
}

function bars(n) {
  return Object.entries(ASSETS).map(([k, name]) => {
    const v = n.scores[k] ?? 0;
    const w = Math.abs(v) * 50;
    const col = v > 0 ? 'var(--sb)' : v < 0 ? 'var(--sbr)' : 'var(--n)';
    const style = v >= 0
      ? `left:50%;width:${w}%;background:${col}`
      : `left:${50 - w}%;width:${w}%;background:${col}`;
    return `<div class="row"><span>${name}</span>
      <span class="track"><b></b><i style="${style}"></i></span>
      <span class="val">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
  }).join('');
}

function render() {
  const items = data.items.filter(visible);
  feed.innerHTML = '';

  if (!items.length) {
    feed.innerHTML = '<p class="empty">Keine Meldungen für diesen Filter.</p>';
    return;
  }

  const tpl = $('#row');
  for (const n of items) {
    const node = tpl.content.cloneNode(true);
    const score = n.scores[asset] ?? 0;
    const lab = label(score);

    $('.item', node).classList.add(lab);
    $('time', node).textContent = time(n.date);
    $('.title', node).textContent = n.title;
    $('.src', node).textContent = `${n.source}${n.region ? ' · ' + n.region : ''}`;

    const badge = $('.badge', node);
    badge.textContent = TEXT[lab];
    badge.classList.add(lab);

    $('.reason', node).textContent = n.why || '—';
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

    feed.appendChild(node);
  }
}

function setMeta() {
  const t = data.updated ? new Date(data.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '—';
  const regime = data.regime === 'growth' ? 'Wachstumskanal' : 'Zinskanal';
  $('#meta').textContent =
    `${data.items.length} Meldungen · Stand ${t} · Bewertung für ${ASSETS[asset]} · Regime: ${regime}`;
}

async function load() {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const res = await fetch(`data/news.json?t=${Date.now()}`, { cache: 'no-store' });
    data = await res.json();
  } catch {
    $('#meta').textContent = 'Daten konnten nicht geladen werden.';
  } finally {
    btn.classList.remove('spin');
  }
  setMeta();
  render();
}

// ---- Bedienung ----
document.querySelectorAll('.assets button').forEach((b) => {
  b.addEventListener('click', () => {
    asset = b.dataset.asset;
    localStorage.setItem('asset', asset);
    document.querySelectorAll('.assets button')
      .forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    setMeta();
    render();
  });
});

document.querySelectorAll('.chip').forEach((c) => {
  c.addEventListener('click', () => {
    filter = c.dataset.filter;
    document.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
    render();
  });
});

$('#refresh').addEventListener('click', load);

// gespeicherte Anlageklasse übernehmen
document.querySelectorAll('.assets button')
  .forEach((b) => b.setAttribute('aria-selected', String(b.dataset.asset === asset)));

load();
setInterval(load, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
