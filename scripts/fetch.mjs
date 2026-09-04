import { writeFileSync, mkdirSync } from 'node:fs';
import { collectNews } from '../docs/engine/feeds.mjs';

// Grundversorgung über GitHub Actions. Der Live-Betrieb im Minutentakt läuft
// über den Cloudflare Worker (siehe worker/); diese Datei stellt sicher, dass
// die App auch ohne Worker immer einen aktuellen Stand ausliefert.

const data = await collectNews({ regime: process.env.REGIME || 'policy' });

mkdirSync('docs/data', { recursive: true });
writeFileSync('docs/data/news.json', JSON.stringify(data, null, 1));

console.log(`${data.count} Meldungen geschrieben.`);
if (data.errors.length) console.log('Fehlerhafte Quellen:', data.errors.join(' | '));
const stark = data.items.filter((n) => n.label.startsWith('strong'));
console.log(`Davon stark gewertet: ${stark.length}`);
stark.slice(0, 5).forEach((n) => console.log(`  [${n.labelText}] ${n.title.slice(0, 88)}`));
