// Einrichtungshilfe für Telegram-Benachrichtigungen.
//
// Aufruf:  node scripts/telegram-setup.mjs <BOT-TOKEN>
//
// Das Skript prüft den Token, sucht die Chat-ID aus den letzten Nachrichten
// an den Bot und verschickt zur Kontrolle eine Testnachricht. Der Token wird
// nirgends gespeichert und nirgendwo hingeschickt außer an Telegram selbst.

const token = process.argv[2]?.trim();

if (!token) {
  console.error(`
Aufruf: node scripts/telegram-setup.mjs <BOT-TOKEN>

So kommst du an den Token:
  1. In Telegram @BotFather anschreiben
  2. /newbot senden und den Anweisungen folgen
  3. Der Token sieht aus wie 1234567890:AAF3x...

Danach: dem neuen Bot in Telegram einmal irgendetwas schreiben
(z. B. "hallo") — sonst kennt Telegram die Chat-ID noch nicht.
`);
  process.exit(1);
}

const api = (methode, params) => {
  const url = new URL(`https://api.telegram.org/bot${token}/${methode}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetch(url, { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
};

// --- 1) Token prüfen -------------------------------------------------------
const me = await api('getMe');
if (!me.ok) {
  console.error(`\nToken abgelehnt: ${me.description}`);
  console.error('Prüfe, ob du ihn vollständig kopiert hast (mit dem Doppelpunkt).\n');
  process.exit(1);
}
console.log(`\nBot erkannt: @${me.result.username} (${me.result.first_name})`);

// --- 2) Chat-ID suchen -----------------------------------------------------
const updates = await api('getUpdates');
const chats = new Map();
for (const u of updates.result || []) {
  const c = u.message?.chat || u.channel_post?.chat;
  if (c) chats.set(c.id, c);
}

if (!chats.size) {
  console.error(`
Keine Chat-ID gefunden.

Öffne Telegram, suche @${me.result.username}, drücke START und schreibe dem
Bot irgendetwas. Danach dieses Skript noch einmal ausführen.
`);
  process.exit(1);
}

console.log('\nGefundene Chats:');
for (const [id, c] of chats) {
  const name = c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username || '—';
  console.log(`  Chat-ID ${id}   ${name} (${c.type})`);
}

// --- 3) Testnachricht ------------------------------------------------------
const [erstesId] = [...chats.keys()];
const test = await api('sendMessage', {
  chat_id: erstesId,
  text: '*Market Bias*\nEinrichtung erfolgreich — hier kommen künftig die Signale an.',
  parse_mode: 'Markdown',
});

if (test.ok) {
  console.log(`\nTestnachricht an Chat ${erstesId} verschickt. Schau in Telegram nach.`);
  console.log(`
Trage in der App unter Zahnrad -> Benachrichtigungen -> Telegram ein:

  Bot-Token:  ${token.slice(0, 12)}…   (den vollständigen Token)
  Chat-ID:    ${erstesId}
`);
} else {
  console.error(`\nVersand fehlgeschlagen: ${test.description}`);
  process.exit(1);
}
