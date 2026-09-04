// Dieselbe Meldung läuft oft über fünf Portale. CryptoPanic fasst solche
// Duplikate zu einem Eintrag mit Quellenzähler zusammen; das macht diese
// Funktion ebenso, damit der Feed nicht von einer Nachricht geflutet wird.

const STOP = new Set([
  'the','a','an','and','or','of','to','in','on','for','with','as','at','by','from',
  'is','are','was','were','be','been','has','have','had','will','says','said','after',
  'over','into','amid','its','it','that','this','new','more','than','up','down','vs',
  'der','die','das','und','von','mit','für','auf','im','ist','nach','bei',
]);

/** Signaturschlüssel: die sechs längsten bedeutungstragenden Wörter, sortiert. */
export function signature(title) {
  const words = title.toLowerCase()
    .replace(/[^a-z0-9äöüß\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

  return [...new Set(words)].sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 6).sort().join('|');
}

/**
 * Fasst Duplikate zusammen. Behalten wird der Eintrag mit der höchsten
 * Relevanz; die übrigen Quellen werden als `alsoIn` vermerkt.
 */
export function dedupe(items) {
  const bySig = new Map();

  for (const n of items) {
    const sig = signature(n.title);
    if (sig.split('|').length < 3) { bySig.set(n.id, n); continue; }  // zu kurz für sichere Aussage

    const prev = bySig.get(sig);
    if (!prev) { bySig.set(sig, { ...n, alsoIn: [] }); continue; }

    const sieger = (n.priority ?? 0) > (prev.priority ?? 0) ? n : prev;
    const verlierer = sieger === n ? prev : n;
    const quellen = [...new Set([...(prev.alsoIn || []), ...(n.alsoIn || []), verlierer.source])]
      .filter((s) => s !== sieger.source);

    bySig.set(sig, { ...sieger, alsoIn: quellen });
  }

  return [...bySig.values()];
}
