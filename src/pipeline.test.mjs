// Tests für die Teile der Pipeline, die bisher ohne Absicherung liefen:
// das Zeitfenster, den Profilfilter, die Handelseinstufung und die
// Formprüfung der Stapelübersetzung.

import test from 'node:test';
import assert from 'node:assert/strict';

import { imFenster, FENSTER_MS } from '../docs/engine/feeds.mjs';
import { profilPassung, STANDARD_PROFIL } from '../docs/engine/profile.mjs';
import { tradeImpact } from '../docs/engine/tradeimpact.mjs';
import { uebersetze } from '../docs/engine/translate.mjs';

const JETZT = Date.parse('2026-09-05T12:00:00Z');
const vorStunden = (h) => new Date(JETZT - h * 3600_000).toISOString();

// ───────────────────────────── Zeitfenster ─────────────────────────────

test('Das Fenster behält einen Tag und verwirft, was älter ist', () => {
  const drin = imFenster([
    { date: vorStunden(0.1) },
    { date: vorStunden(23.9) },
  ], JETZT);
  assert.equal(drin.length, 2);

  const raus = imFenster([
    { date: vorStunden(24.1) },
    { date: vorStunden(72) },
  ], JETZT);
  assert.equal(raus.length, 0);
  assert.equal(FENSTER_MS, 24 * 3600_000);
});

test('Eine unbrauchbare Zeitangabe wirft nicht, sondern fällt heraus', () => {
  const items = [{ date: 'kein Datum' }, { date: vorStunden(1) }];
  const drin = imFenster(items, JETZT);
  assert.equal(drin.length, 1);
});

test('Eine leicht in der Zukunft liegende Meldung bleibt stehen', () => {
  // Redaktionen setzen Zeitstempel gelegentlich vor; das darf eine Meldung
  // nicht verschwinden lassen, sie ist ja gerade erst gekommen.
  const drin = imFenster([{ date: new Date(JETZT + 120_000).toISOString() }], JETZT);
  assert.equal(drin.length, 1);
});

// ────────────────────────────── Profilfilter ─────────────────────────────

const meldung = (extra = {}) => ({
  title: 'Beliebige Meldung',
  impactLevel: 'high', duration: 'intraday', scope: 'market', coins: [],
  priority: 60, scores: { crypto: 0.5 },
  ...extra,
});

test('Ohne aktives Profil geht alles durch', () => {
  const aus = { ...STANDARD_PROFIL, aktiv: false };
  assert.equal(profilPassung(meldung({ impactLevel: 'low', duration: 'long' }), aus), 1);
});

test('Projektrauschen fliegt auch mit Profil immer raus', () => {
  const an = { ...STANDARD_PROFIL, aktiv: true };
  assert.equal(profilPassung(meldung({ impactLevel: 'ignore' }), an), null);
});

test('Scalping blendet Schwaches und Langfristiges aus', () => {
  const an = { ...STANDARD_PROFIL, aktiv: true, stil: 'scalping' };
  assert.equal(profilPassung(meldung({ impactLevel: 'low' }), an), null,
    'unter der Mindestwirkung');
  assert.equal(profilPassung(meldung({ duration: 'long' }), an), null,
    'wirkt zu lang nach');
  assert.ok(profilPassung(meldung({ duration: 'scalp' }), an) > 0);
});

test('Ein Extremereignis wird nie ausgeblendet', () => {
  const an = { ...STANDARD_PROFIL, aktiv: true, stil: 'scalping' };
  // Selbst mit der Dauer, die sonst herausfällt.
  const wert = profilPassung(meldung({ impactLevel: 'extreme', duration: 'long' }), an);
  assert.ok(wert > 0, 'bleibt sichtbar');
});

test('Meldungen zu fremden Coins verschwinden, Marktmeldungen nicht', () => {
  const an = { ...STANDARD_PROFIL, aktiv: true, coins: ['BTC', 'ETH'] };
  assert.equal(
    profilPassung(meldung({ coins: ['DOGE'], scope: 'project' }), an), null);
  assert.ok(
    profilPassung(meldung({ coins: ['DOGE'], scope: 'market' }), an) > 0,
    'eine Marktmeldung gilt unabhaengig vom genannten Coin');
});

test('Ein Coin aus dem Profil wiegt schwerer als einer ohne', () => {
  const an = { ...STANDARD_PROFIL, aktiv: true, coins: ['BTC'] };
  const mit = profilPassung(meldung({ coins: ['BTC'], scope: 'market' }), an);
  const ohne = profilPassung(meldung({ coins: [], scope: 'market' }), an);
  assert.ok(mit > ohne);
});

// ───────────────────────────── Handelswirkung ────────────────────────────

test('Die Überraschung bestimmt die Wirkung von Wirtschaftsdaten', () => {
  const stark = tradeImpact({
    title: 'US CPI 3.8% vs 3.2% expected', kind: 'macro',
    scores: { crypto: -0.85 }, impact: 'high', priority: 90, event: 'CPI',
  });
  assert.equal(stark.impactLevel, 'extreme');
  assert.equal(stark.duration, 'intraday', 'Inflationsdaten wirken den Tag');

  const schwach = tradeImpact({
    title: 'US CPI 3.3% vs 3.2% expected', kind: 'macro',
    scores: { crypto: -0.1 }, impact: 'high', priority: 90, event: 'CPI',
  });
  assert.equal(schwach.impactLevel, 'low');
});

test('Ein Zinsentscheid wirkt über den Tag hinaus', () => {
  const t = tradeImpact({
    title: 'Fed interest rate decision: unchanged', kind: 'macro',
    scores: { crypto: -0.5 }, impact: 'high', priority: 90,
    event: 'Interest Rate Decision',
  });
  assert.equal(t.duration, 'swing');
});

test('Eine unwichtige Quelle kann kein Extremereignis melden', () => {
  const t = tradeImpact({
    title: 'US CPI 3.8% vs 3.2% expected', kind: 'macro',
    scores: { crypto: -0.9 }, impact: 'high', priority: 10, event: 'CPI',
  });
  assert.ok(['medium', 'low'].includes(t.impactLevel),
    `unwichtige Quelle darf nicht ${t.impactLevel} melden`);
});

test('Heiße Geopolitik wiegt schwerer als eine Meldung über Gespräche', () => {
  const heiss = tradeImpact({
    title: 'Israeli missile strike kills two in southern Lebanon',
    category: 'geopolitics', scores: { crypto: -0.4 }, priority: 80,
  });
  const kuehl = tradeImpact({
    title: 'Delegations meet in Geneva to discuss the conflict',
    category: 'geopolitics', scores: { crypto: -0.05 }, priority: 80,
  });
  assert.equal(heiss.impactLevel, 'high');
  assert.equal(heiss.duration, 'swing');
  assert.equal(kuehl.impactLevel, 'low');
});

// ──────────────────────────── Stapelübersetzung ──────────────────────────

/** Ersetzt fetch für einen Aufruf und stellt es danach wieder her. */
async function mitFetch(antwort, fn) {
  const echt = globalThis.fetch;
  globalThis.fetch = async () => antwort;
  try { return await fn(); } finally { globalThis.fetch = echt; }
}

const groqAntwort = (inhalt) => ({
  ok: true,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(inhalt) } }],
    usage: { total_tokens: 42 } }),
});

test('Eine passende Stapelantwort wird übernommen', async () => {
  const r = await mitFetch(groqAntwort({ de: ['eins', 'zwei'] }),
    () => uebersetze(['one', 'two'], { groqKey: 'x' }));
  assert.deepEqual(r.texte, ['eins', 'zwei']);
  assert.equal(r.dienst, 'groq');
  assert.equal(r.tokens, 42);
});

test('Eine Antwort mit falscher Länge wird verworfen, nicht versetzt übernommen', async () => {
  // Der gefaehrlichste Fall: Faenden zwei Uebersetzungen fuer drei Titel
  // Verwendung, stuende unter jeder Schlagzeile die falsche Fassung.
  const r = await mitFetch(groqAntwort({ de: ['eins', 'zwei'] }),
    () => uebersetze(['one', 'two', 'three'], { groqKey: 'x' }));
  assert.notEqual(r.dienst, 'groq', 'darf nicht als Erfolg gelten');
  assert.equal(r.texte.length, 3, 'ein Feld je Eingabe bleibt zugesichert');
});

test('Ein Fehler des Dienstes lässt das Original stehen', async () => {
  const r = await mitFetch({ ok: false, status: 429 },
    () => uebersetze(['one'], { groqKey: 'x' }));
  assert.equal(r.texte.length, 1);
  assert.equal(r.texte[0], null, 'kein Text ist besser als ein falscher');
});

test('Ohne Text wird nichts angefragt', async () => {
  let gerufen = 0;
  const echt = globalThis.fetch;
  globalThis.fetch = async () => { gerufen++; return groqAntwort({ de: [] }); };
  try {
    const r = await uebersetze([], { groqKey: 'x' });
    assert.deepEqual(r.texte, []);
    assert.equal(gerufen, 0);
  } finally { globalThis.fetch = echt; }
});
