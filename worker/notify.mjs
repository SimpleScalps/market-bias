// Versand an Telegram und Discord.
//
// Der Versand läuft bewusst über den Worker und nicht direkt aus dem Browser:
// nur so kommt eine Meldung auch an, während die App geschlossen ist — und das
// ist der Normalfall, wenn das Handy in der Tasche steckt.

const kuerzen = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function anTelegram(ziel, titel, text) {
  const res = await fetch(`https://api.telegram.org/bot${ziel.token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: ziel.chat,
      text: `*${titel}*\n${text}`,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}`);
}

async function anDiscord(ziel, titel, text) {
  const res = await fetch(ziel.hook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Market Bias',
      embeds: [{
        title: kuerzen(titel, 250),
        description: kuerzen(text, 1800),
        color: /BEARISH|BEAR/i.test(titel) ? 0xff4d5e : /BULLISH|BULL/i.test(titel) ? 0x10d98a : 0x5a6879,
        timestamp: new Date().toISOString(),
      }],
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}`);
}

/** Schickt an alle Ziele; ein fehlerhaftes Ziel stoppt die übrigen nicht. */
export async function sendeAn(ziele, titel, text) {
  const ergebnisse = await Promise.allSettled(
    (ziele || []).map((z) => {
      if (z.typ === 'telegram' && z.token && z.chat) return anTelegram(z, titel, text);
      if (z.typ === 'discord' && z.hook) return anDiscord(z, titel, text);
      return Promise.reject(new Error('Ziel unvollständig'));
    })
  );

  return {
    gesendet: ergebnisse.filter((r) => r.status === 'fulfilled').length,
    fehler: ergebnisse.filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  };
}
