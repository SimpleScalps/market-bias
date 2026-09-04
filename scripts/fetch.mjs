import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { collectNews } from '../docs/engine/feeds.mjs';
import { trimCache } from '../docs/engine/translate.mjs';

// Grundversorgung über GitHub Actions. Der Live-Betrieb im Minutentakt läuft
// über den Cloudflare Worker (siehe worker/); diese Datei stellt sicher, dass
// die App auch ohne Worker immer einen aktuellen Stand ausliefert.

const CACHE_DATEI = 'docs/data/translations.json';

// Einmal übersetzte Titel bleiben übersetzt — das schont das Tageskontingent.
let cache = {};
if (existsSync(CACHE_DATEI)) {
  try { cache = JSON.parse(readFileSync(CACHE_DATEI, 'utf8')); } catch { cache = {}; }
}
const vorher = Object.keys(cache).length;

const data = await collectNews({
  regime: process.env.REGIME || 'policy',
  translate: {
    cache,
    max: Number(process.env.TRANSLATE_MAX || 40),
    deeplKey: process.env.DEEPL_KEY || '',
    email: process.env.TRANSLATE_EMAIL || '',
  },
});

mkdirSync('docs/data', { recursive: true });
writeFileSync('docs/data/news.json', JSON.stringify(data, null, 1));
writeFileSync(CACHE_DATEI, JSON.stringify(trimCache(cache), null, 0));

console.log(`${data.count} Meldungen geschrieben.`);
console.log(`Übersetzt: ${data.uebersetzung?.uebersetzt ?? 0} neu, ${vorher} aus dem Zwischenspeicher.`);
if (data.errors.length) console.log('Hinweise:', data.errors.join(' | '));

const stark = data.items.filter((n) => n.label.startsWith('strong'));
console.log(`Stark gewertet: ${stark.length}`);
stark.slice(0, 4).forEach((n) =>
  console.log(`  [${n.labelText}] [${n.impactLevel}/${n.duration}] ${(n.titleDe || n.title).slice(0, 76)}`));
