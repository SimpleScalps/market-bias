# Market Bias

Finanznachrichten-Portal im Stil von FinancialJuice — mit dem Unterschied, dass
neben jeder Meldung steht, ob sie **Stark Bullish, Bullish, Neutral, Bearish
oder Stark Bearish** ist. Läuft als statische Webapp auf GitHub Pages und lässt
sich auf dem iPhone als App auf den Homescreen legen.

## Warum es das gibt

Am 4. September 2026 kamen die US-Arbeitsmarktdaten mit 162k statt der
erwarteten 56k herein. Gute Nachricht für die Wirtschaft — der Krypto-Markt fiel
trotzdem. Das ist kein Widerspruch, sondern der Zinskanal:

```
starke Daten  ->  Fed bleibt/wird restriktiv  ->  weniger Liquidität  ->  Risk-Assets fallen
```

Genau diese Übersetzung nimmt dieses Tool ab und schreibt sie bei jeder Meldung
als Begründung dazu.

## Wie bewertet wird

**1. Wirtschaftsdaten mit Zahlen** (der genaue Weg)

Aus dem Wirtschaftskalender kommen Actual, Prognose und Vorwert. Daraus:

| Schritt | Beispiel NFP |
|---|---|
| Überraschung | 162k − 56k = +106k |
| Normalisiert an der typischen Streuung des Events | +106 / 45 ≈ 2,4 |
| Polarität des Events (höher = stärkere Wirtschaft?) | Ja, +1 |
| Kanal (Inflation wiegt schwerer als Wachstum) | Wachstum |
| Relevanz des Landes (nur was die Fed bewegt) | USA, ×1,0 |
| → geldpolitischer Impuls | stark restriktiv |
| → Krypto | **Stark Bearish** (−0,89) |

Die Polarität ist entscheidend und wird pro Event gepflegt: Bei der
Arbeitslosenquote oder den Erstanträgen bedeutet ein *höherer* Wert eine
*schwächere* Wirtschaft — dort dreht sich das Vorzeichen um.

**2. Schlagzeilen mit Zahlen im Text**

`"US Nonfarm Payrolls rise by 162K vs. 56K forecast"` wird genauso exakt
bewertet wie ein Kalendereintrag — die Zahlen werden aus dem Text gezogen.

**3. Reine Textschlagzeilen**

Gewichtete Signalwörter, mit zwei Fallen, die bewusst behandelt werden:

- **Dämpfende Verben:** `"Bailey tames rate hike hopes"` enthält „rate hike",
  ist aber dovish. Wörter wie *tames, cools, downplays, pushes back on* drehen
  das Signal um.
- **Verbrichtung:** `"inflation cools more than expected"` enthält „more than
  expected", ist aber bullish — das Verb *cools* bestimmt die Richtung.

Geopolitik (Angriffe, Eskalation) wirkt als Risk-off: Krypto und Aktien runter,
Gold rauf.

## Vier Perspektiven

Dieselbe Meldung ist nicht für alles gleich. Die NFP-Zahl ist für Krypto stark
bearish und für den Dollar stark bullish. Deshalb lässt sich oben zwischen
**Krypto, Aktien, Gold und USD** umschalten — und aufgeklappt zeigt jede Meldung
alle vier Werte nebeneinander. Wer sich unsicher ist, was eine Nachricht
bedeutet, sieht hier am schnellsten, dass „bullish" ohne Anlageklasse keine
Aussage ist.

## Einrichten

**1. Repository anlegen und hochladen**

```bash
git remote add origin https://github.com/DEIN-NAME/market-bias.git
git push -u origin main
```

**2. GitHub Pages aktivieren**

Repository → *Settings* → *Pages* → Source: `Deploy from a branch`,
Branch: `main`, Ordner: `/docs` → *Save*.

Nach etwa einer Minute liegt die Seite auf
`https://DEIN-NAME.github.io/market-bias/`.

**3. Automatische Aktualisierung**

`.github/workflows/update-news.yml` holt alle 10 Minuten neue Meldungen,
bewertet sie und committet `docs/data/news.json`. Dafür muss unter
*Settings → Actions → General → Workflow permissions* die Option
**Read and write permissions** aktiv sein.

> GitHub-Cronjobs laufen unter Last auch mal 5–15 Minuten später als angegeben.
> Für echte Sekundenaktualität bräuchte es einen eigenen Server mit Websocket —
> für die Einordnung von Wirtschaftsdaten reicht dieser Takt.

**4. Auf dem iPhone installieren**

Seite in Safari öffnen → Teilen-Symbol → *Zum Home-Bildschirm*. Die App startet
danach ohne Browserleiste, merkt sich die gewählte Anlageklasse und funktioniert
dank Service Worker auch offline mit dem zuletzt geladenen Stand.

## Anpassen

| Was | Wo |
|---|---|
| Neues Wirtschaftsevent aufnehmen | `src/events.mjs` |
| Signalwörter ergänzen | `src/keywords.mjs` |
| Länder-/Notenbankgewichte | `src/relevance.mjs` |
| Schwellen für „stark" (±0,55) und „normal" (±0,16) | `label()` in `src/sentiment.mjs` **und** `docs/app.js` |
| Nachrichtenquellen | `FEEDS` in `scripts/fetch.mjs` |

**Marktregime umstellen.** Standard ist `policy`: der Zinskanal dominiert, gute
Daten sind schlecht für Krypto. Kippt der Markt in eine Phase, in der
Rezessionsangst wichtiger ist als die Zinsfrage, dreht `REGIME: growth` im
Workflow die Logik um. Diese Einstellung ist die wichtigste Annahme des ganzen
Tools — sie steht bewusst an einer Stelle und wird unten in der App angezeigt.

## Tests

```bash
node --test src/sentiment.test.mjs
```

Zwölf Tests sichern die Richtungen ab — darunter der NFP-Fall, die invertierte
Polarität der Arbeitslosenquote, die dämpfenden Verben und die Gegenprobe, dass
irrelevante Volkswirtschaften verworfen werden.

## Quellen

Wirtschaftskalender von MyFXBook (Actual/Prognose/Vorwert), Schlagzeilen per RSS
von FXStreet, CoinDesk, Cointelegraph, CNBC, MarketWatch und der Federal
Reserve. Alles öffentliche Feeds — FinancialJuice selbst wird nicht abgegriffen,
deren Squawk läuft über eine geschlossene Websocket-Verbindung.

## Grenzen

Die Bewertung ist eine regelbasierte Ersteinordnung, keine Anlageberatung. Sie
kennt keine Positionierung, kein bereits eingepreistes Erwartungsbild und keine
Revisionen der Vormonate — alles Dinge, die die tatsächliche Marktreaktion
mitbestimmen. Sie ist als Lesehilfe gedacht, die die Richtung und ihre Begründung
liefert; die Entscheidung bleibt beim Menschen davor.
