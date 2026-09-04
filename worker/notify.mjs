// Versand an ntfy, Telegram und Discord.
//
// Der Versand läuft über den Worker und nicht direkt aus dem Browser: nur so
// kommt eine Meldung auch an, während die App geschlossen ist — und das ist der
// Normalfall, wenn das Handy in der Tasche steckt.

const kuerzen = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Symbol und Dringlichkeit aus der Richtung ableiten. */
function ntfyStil(titel) {
  const stark = /STARK|STRONG/i.test(titel);
  if (/BEARISH/i.test(titel)) {
    return { tag: stark ? 'rotating_light' : 'chart_with_downwards_trend', prio: stark ? 'urgent' : 'high' };
  }
  if (/BULLISH/i.test(titel)) {
    return { tag: stark ? 'rocket' : 'chart_with_upwards_trend', prio: stark ? 'urgent' : 'high' };
  }
  return { tag: 'newspaper', prio: 'default' };
}

async function anNtfy(ziel, titel, text) {
  const server = (ziel.server || 'https://ntfy.sh').replace(/\/$/, '');
  const { tag, prio } = ntfyStil(titel);

  const kopf = {
    'Title': titel,
    'Priority': prio,
    'Tags': tag,
    'Content-Type': 'text/plain; charset=utf-8',
  };
  // Eigene ntfy-Instanzen können ein Token verlangen.
  if (ziel.token) kopf['Authorization'] = `Bearer ${ziel.token}`;

  const res = await fetch(`${server}/${encodeURIComponent(ziel.topic)}`, {
    method: 'POST',
    headers: kopf,
    body: text,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    // ntfy legt der Antwort einen eigenen Fehlercode bei, der weit mehr sagt
    // als der Statuscode: 42901 heisst tageslimit erschoepft, 42908 zu viele
    // Anfragen pro Sekunde, 40101 fehlende Berechtigung.
    let detail = '';
    try {
      const koerper = await res.text();
      const j = JSON.parse(koerper);
      detail = ` (${j.code || '?'}: ${j.error || koerper.slice(0, 80)})`;
    } catch { /* kein JSON */ }
    throw new Error(`ntfy ${res.status}${detail}${ziel.token ? ' [mit Token]' : ' [ohne Token]'}`);
  }
}

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
        color: /BEARISH/i.test(titel) ? 0xff4d5e : /BULLISH/i.test(titel) ? 0x10d98a : 0x5a6879,
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
      if (z.typ === 'ntfy' && z.topic) return anNtfy(z, titel, text);
      if (z.typ === 'telegram' && z.token && z.chat) return anTelegram(z, titel, text);
      if (z.typ === 'discord' && z.hook) return anDiscord(z, titel, text);
      return Promise.reject(new Error(`Ziel unvollständig: ${z.typ || '?'}`));
    })
  );

  return {
    gesendet: ergebnisse.filter((r) => r.status === 'fulfilled').length,
    fehler: ergebnisse.filter((r) => r.status === 'rejected').map((r) => r.reason.message),
  };
}
