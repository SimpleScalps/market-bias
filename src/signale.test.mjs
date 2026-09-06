/*
 * Vollständige Prüfung aller Signale und Annahmen.
 *
 * Jede Regel bekommt eine echte Schlagzeile, die sie auslösen muss — und
 * daneben eine Falle, die sie nicht auslösen darf. Die Fallen sind der
 * eigentliche Wert: Ein Signal, das zu oft anspringt, ist schlimmer als eines,
 * das fehlt, weil es sich als Gewissheit ausgibt.
 *
 * Entstanden aus einem Durchgang durch alle 38 Stichwort-Signale, 8
 * geopolitischen Regeln und 4 Sonderregeln. Er förderte sieben Fehler zutage,
 * die hier festgehalten sind, damit sie nicht zurückkehren.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreHeadline } from '../docs/engine/sentiment.mjs';

/** '-' bearish, '+' bullish, '0' ohne Richtung. */
function richtung(titel) {
  const c = scoreHeadline(titel, 'policy')?.scores?.crypto ?? 0;
  return c < -0.05 ? '-' : c > 0.05 ? '+' : '0';
}

const pruefe = (faelle) => {
  for (const [titel, soll] of faelle) {
    assert.equal(richtung(titel), soll,
      `"${titel}" sollte ${soll} sein, ist ${richtung(titel)}`);
  }
};

test('Zinskanal: restriktive Signale sind bearish', () => {
  pruefe([
    ['Fed raises rates by 25 basis points', '-'],
    ['Powell strikes hawkish tone at Jackson Hole', '-'],
    ['Fed signals higher for longer rates', '-'],
    ['ECB begins quantitative tightening', '-'],
    ['CPI inflation accelerates to 4.1% in August', '-'],
    ['Treasury yields surge to 5%', '-'],
    ['Markets price in a rate hike for December', '-'],
    ['US payrolls beat forecasts with strong jobs growth', '-'],
  ]);
});

test('Zinskanal: lockernde Signale sind bullish', () => {
  pruefe([
    ['Fed cuts rates by 50 basis points', '+'],
    ['Powell sounds dovish on future policy', '+'],
    ['ECB announces quantitative easing programme', '+'],
    ['Inflation cools faster than expected', '+'],
    ['Fed holds rates steady, signals pause', '+'],
    ['US jobless claims jump, labor market weakens', '+'],
  ]);
});

// "US inflation proves sticky at 3.5%" ergab null: Die Regel verlangte
// "sticky inflation" in dieser Reihenfolge.
test('Hartnäckige Inflation auch in umgekehrter Wortstellung', () => {
  pruefe([
    ['US inflation proves sticky at 3.5%', '-'],
    ['Sticky inflation keeps the Fed on hold', '-'],
    ['Inflation remains stubborn across the euro zone', '-'],
  ]);
});

// "Oil price shock lifts energy costs sharply" ergab null: Die Regel sprang
// ausschliesslich auf "record high" an.
test('Energiepreisschock auch ohne Rekordhoch', () => {
  pruefe([
    ['Oil price shock lifts energy costs sharply', '-'],
    ['Natural gas prices spike after pipeline halt', '-'],
    ['Crude hits all-time high', '-'],
  ]);
});

/*
 * Verneinung: Zwischen Wort und Stichwort dürfen Füllwörter stehen — aber die
 * Satzgrenze hält. "Without doubt, inflation accelerates" wurde zum Kaufsignal,
 * weil der Prüftext alle Satzzeichen durch Leerzeichen ersetzt und das Komma
 * damit unsichtbar war.
 */
test('Verneinung greift über Füllwörter, aber nicht über Satzzeichen', () => {
  pruefe([
    ['Bailey tames rate hike hopes', '+'],
    ['Fed rules out rate hike this year', '+'],
    ['Analysts unlikely to see rate hike', '+'],
    ['No decision yet, Fed raises rates by 25 bp', '-'],
    ['Without doubt, inflation accelerates further', '-'],
  ]);
});

test('Marktrisiko wird richtig eingeordnet', () => {
  pruefe([
    ['Stocks rally to record high as sentiment improves', '+'],
    ['Wall Street plunges in broad sell-off', '-'],
    ['Recession fears mount as credit spreads widen', '-'],
    ['US and China escalate trade war with new tariffs', '-'],
    ['US government shutdown looms as debt ceiling nears', '-'],
    ['Regional bank fails, contagion fears spread', '-'],
    ['Trade talks collapse without agreement', '-'],
  ]);
});

// ETF-Flüsse, Käufe und Landesverbote gehören zu den stärksten Treibern —
// alle drei wurden von zu eng gefassten Regeln übersehen.
test('Krypto-Signale greifen auch in natürlicher Wortstellung', () => {
  pruefe([
    ['Bitcoin ETF sees record inflows of $1.2 billion', '+'],
    ['MicroStrategy buys another 5,000 BTC', '+'],
    ['SEC approves spot Ethereum ETF, regulatory clarity arrives', '+'],
    ['Crypto exchange hacked, $200 million stolen', '-'],
    ['SEC sues major crypto exchange in crackdown', '-'],
    ['China bans all cryptocurrency transactions', '-'],
    ['Bitcoin ETF outflows hit $500 million', '-'],
    ['Cascading liquidations wipe out crypto longs', '-'],
  ]);
});

// Dieselben Wörter ohne Kryptobezug dürfen den Kurs nicht bewegen.
test('Krypto-Wörter ohne Kryptobezug bleiben wirkungslos', () => {
  pruefe([
    ['German government portal hacked, data stolen', '0'],
    ['Utah bans VPN use for minors in new crackdown', '0'],
    ['Influencer indicted in fraud case', '0'],
    ['Gold miners expand output to record levels', '0'],
  ]);
});

test('Geopolitik: Eskalation belastet, Entspannung stützt', () => {
  pruefe([
    ['Russia launches invasion of neighbouring state', '-'],
    ['Iran threatens retaliation after strike', '-'],
    ['Missile attack hits port infrastructure', '-'],
    ['Ceasefire agreed, troops withdraw from border', '+'],
  ]);
});

// "Krieg" ist oft bildlich gemeint.
test('Bildlicher Krieg bewegt den Markt nicht', () => {
  pruefe([
    ['Streaming price war heats up between Netflix and Disney', '0'],
    ['Bidding war erupts for chipmaker', '0'],
    ['Companies wage war of words over patents', '0'],
  ]);
});

/*
 * Die Annahme muss zum Kanal passen, über den bewertet wurde. Unter einer
 * Meldung über Deeskalation stand die Zinskanal-Erklärung — sie behauptete
 * eine Ursache, die nicht gewirkt hatte.
 */
test('Der Kanal der Bewertung ist erkennbar', () => {
  const kanal = (titel) => {
    const s = scoreHeadline(titel, 'policy');
    const zins = !!s?.channel || (typeof s?.hawkish === 'number' && s.hawkish !== 0);
    if (zins) return 'zins';
    return Math.abs(s?.scores?.crypto ?? 0) > 0.001 ? 'risiko' : 'keiner';
  };
  assert.equal(kanal('Fed raises rates by 25 basis points'), 'zins');
  assert.equal(kanal('Inflation cools faster than expected'), 'zins');
  assert.equal(kanal('Missile attack hits port infrastructure'), 'risiko');
  assert.equal(kanal('Ceasefire agreed, troops withdraw from border'), 'risiko');
  assert.equal(kanal('Local council approves new bicycle lane'), 'keiner');
  assert.equal(kanal('Actor wins award at film festival'), 'keiner');
});

/*
 * Zwei Fehlalarme, gefunden beim Prüfen neuer Quellen.
 *
 * Sie sind das eigentliche Risiko beim Hinzufügen von Feeds: Je mehr Text
 * durchläuft, desto öfter trifft eine zu weit gefasste Regel etwas, das sie
 * nicht meint. Beide Regeln verlangen jetzt den Zusammenhang, nicht nur das
 * Wort.
 */
test('Eine einzelne Aktie ist kein Kursanstieg am Markt', () => {
  pruefe([
    ['Okta Jumps 20% as AI-Driven Security Features Boost Outlook', '0'],
    ['Stocks rally to record high as sentiment improves', '+'],
    ['Bitcoin surges past $80,000', '+'],
    ['Wall Street jumps after inflation data', '+'],
  ]);
});

test('Kernenergie ist keine Vergeltungsdrohung', () => {
  pruefe([
    ['Twelve Companies Make DOEs Latest Nuclear Shortlist', '0'],
    ['France expands nuclear power plant programme', '0'],
    ['North Korea tests nuclear weapon', '-'],
    ['Iran threatens nuclear retaliation', '-'],
    ['Russia raises nuclear threat level', '-'],
  ]);
});
