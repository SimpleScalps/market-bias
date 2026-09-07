import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmEntscheiden } from '../worker/index.mjs';

/*
 * Der Waechter ueber den Taktgebern. Geprueft wird die Entscheidung, nicht der
 * Versand - denn genau die laeuft im Ernstfall zum ersten Mal, und sie laeuft
 * in ctx.waitUntil, wo ein Fehler spurlos verschwindet.
 *
 * Anlass: Cloudflares Cron wurde an einem Tag zweimal stundenlang nicht mehr
 * aufgerufen. Beide Male hat es ein Mensch gemerkt, nicht das System.
 */

const MIN = 60_000;
const jetzt = Date.now();
const takt = (min) => ({ zeit: new Date(jetzt - min * MIN).toISOString() });

test('Alle frisch: nichts zu melden', () => {
  const r = alarmEntscheiden({ a: takt(1), b: takt(3) }, {}, jetzt);
  assert.deepEqual(r.stumm, []);
  assert.deepEqual(r.meldungen, []);
  assert.equal(r.aendert, false);
});

test('Ein verstummter Taktgeber wird sofort gemeldet', () => {
  const r = alarmEntscheiden({ 'cloudflare-cron': takt(58), 'cron-job.org': takt(1) }, {}, jetzt);
  assert.deepEqual(r.stumm, ['cloudflare-cron']);
  assert.equal(r.meldungen.length, 1);
  const [titel, text] = r.meldungen[0];
  assert.match(titel, /stumm/i);
  assert.match(text, /cloudflare-cron seit 58 min/);
  // Der Leser soll wissen, ob der Betrieb weiterlaeuft.
  assert.match(text, /laeuft weiter ueber cron-job\.org/);
});

test('Fällt der letzte aus, steht das ausdrücklich da', () => {
  const r = alarmEntscheiden({ 'cron-job.org': takt(40) }, {}, jetzt);
  assert.match(r.meldungen[0][1], /kein weiterer Taktgeber/);
});

test('Derselbe Ausfall wird nicht jede Minute wiederholt', () => {
  const ticks = { 'cloudflare-cron': takt(58), 'cron-job.org': takt(1) };
  const z = { alarmStumm: ['cloudflare-cron'], alarmZuletzt: new Date(jetzt - 5 * MIN).toISOString() };
  const r = alarmEntscheiden(ticks, z, jetzt);
  assert.deepEqual(r.meldungen, [], 'vor Ablauf der Stunde nichts');
  assert.equal(r.aendert, false);
});

test('Nach einer Stunde wird erinnert', () => {
  const ticks = { 'cloudflare-cron': takt(90), 'cron-job.org': takt(1) };
  const z = { alarmStumm: ['cloudflare-cron'], alarmZuletzt: new Date(jetzt - 65 * MIN).toISOString() };
  const r = alarmEntscheiden(ticks, z, jetzt);
  assert.equal(r.meldungen.length, 1);
  assert.match(r.meldungen[0][1], /seit 90 min/);
});

test('Die Rückkehr wird gemeldet', () => {
  const ticks = { 'cloudflare-cron': takt(1), 'cron-job.org': takt(1) };
  const z = { alarmStumm: ['cloudflare-cron'], alarmZuletzt: new Date(jetzt - 5 * MIN).toISOString() };
  const r = alarmEntscheiden(ticks, z, jetzt);
  assert.equal(r.meldungen.length, 1);
  assert.match(r.meldungen[0][0], /wieder da/i);
  assert.deepEqual(r.stumm, [], 'der Stand wird geleert');
  assert.equal(r.aendert, true);
});

test('Ein zweiter Ausfall meldet sich, obwohl der erste noch läuft', () => {
  const ticks = { 'cloudflare-cron': takt(90), 'cron-job.org': takt(30), 'github-action': takt(2) };
  const z = { alarmStumm: ['cloudflare-cron'], alarmZuletzt: new Date(jetzt - 5 * MIN).toISOString() };
  const r = alarmEntscheiden(ticks, z, jetzt);
  assert.deepEqual(r.stumm, ['cloudflare-cron', 'cron-job.org']);
  assert.equal(r.meldungen.length, 1);
  assert.match(r.meldungen[0][1], /cron-job\.org seit 30 min/);
  assert.doesNotMatch(r.meldungen[0][1], /cloudflare/, 'der bekannte Ausfall wird nicht wiederholt');
});

test('Ein Taktgeber ohne Zeitstempel wird übergangen', () => {
  const r = alarmEntscheiden({ kaputt: {}, gut: takt(1) }, {}, jetzt);
  assert.deepEqual(r.stumm, []);
});
