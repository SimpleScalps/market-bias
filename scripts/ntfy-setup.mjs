// Einrichtungshilfe für ntfy-Benachrichtigungen.
//
// Aufruf:  node scripts/ntfy-setup.mjs [themenname]
//
// Ohne Argument wird ein sicherer Zufallsname vorgeschlagen. Das Skript
// verschickt drei Testnachrichten in den Stufen, die die App später nutzt,
// damit sichtbar wird, wie sie auf dem Handy ankommen.

import { randomBytes } from 'node:crypto';

const SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh';

// Ein Thema ist ohne Passwort zugänglich — wer den Namen kennt, liest mit.
// Deshalb wird ein langer Zufallsname erzeugt statt eines sprechenden.
const topic = process.argv[2]?.trim()
  || `marktbias-${randomBytes(5).toString('hex')}`;

if (!/^[A-Za-z0-9_-]{6,64}$/.test(topic)) {
  console.error(`
Ungültiger Themenname: "${topic}"

Erlaubt sind Buchstaben, Ziffern, Bindestrich und Unterstrich, 6 bis 64 Zeichen.
Ohne Angabe schlägt das Skript einen sicheren Namen vor:

  node scripts/ntfy-setup.mjs
`);
  process.exit(1);
}

const proben = [
  {
    titel: 'STARK BEARISH · KRYPTO',
    text: 'Non-Farm Payrolls: 162.0K statt 56.0K erwartet\nEXTREM · INTRADAY 1–24 STD',
    prio: 'urgent', tag: 'rotating_light',
  },
  {
    titel: 'BULLISH · KRYPTO',
    text: 'Bitcoin ETF inflows hit $731M, highest since January\nHOCH · INTRADAY 1–24 STD',
    prio: 'high', tag: 'chart_with_upwards_trend',
  },
  {
    titel: 'Market Bias',
    text: 'Einrichtung abgeschlossen — ab jetzt kommen hier die Signale an.',
    prio: 'default', tag: 'newspaper',
  },
];

console.log(`\nThema:  ${topic}`);
console.log(`Server: ${SERVER}\n`);

let ok = 0;
for (const p of proben) {
  try {
    const res = await fetch(`${SERVER}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        'Title': p.titel,
        'Priority': p.prio,
        'Tags': p.tag,
        'Content-Type': 'text/plain; charset=utf-8',
      },
      body: p.text,
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log(`  gesendet: ${p.titel}`);
    ok++;
  } catch (err) {
    console.error(`  fehlgeschlagen: ${p.titel} — ${err.message}`);
  }
}

if (!ok) {
  console.error('\nEs kam nichts durch. Läuft der Server und besteht eine Verbindung?\n');
  process.exit(1);
}

console.log(`
${ok} von ${proben.length} Nachrichten verschickt.

So geht es weiter:

  1. ntfy-App auf dem iPhone installieren (App Store: "ntfy")
  2. In der App auf + tippen und dieses Thema abonnieren:

       ${topic}

     Die drei Testnachrichten erscheinen sofort.

  3. In Market Bias: Zahnrad -> Benachrichtigungen -> Stufe waehlen
     -> Kanal "ntfy" -> denselben Themennamen eintragen.

Merke dir den Namen gut — er ist zugleich das Zugangsgeheimnis. Wer ihn
kennt, kann mitlesen und auch selbst Nachrichten hineinschicken.
`);
