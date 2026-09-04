# Market Bias

Nachrichtenportal im Stil von FinancialJuice — mit dem Unterschied, dass neben
jeder Meldung steht, ob sie **Stark Bullish, Bullish, Neutral, Bearish oder
Stark Bearish** ist. Schwerpunkt: US-Wirtschaftsdaten und weltwirtschaftlich
brisante Lagen. Läuft als Webapp auf GitHub Pages und lässt sich auf dem iPhone
auf den Homescreen legen.

## Warum es das gibt

Am 4. September 2026 kamen die US-Arbeitsmarktdaten mit 162k statt der
erwarteten 56k herein. Gute Nachricht für die Wirtschaft — der Krypto-Markt fiel
trotzdem. Das ist kein Widerspruch, sondern der Zinskanal:

```
starke Daten  ->  Fed bleibt/wird restriktiv  ->  weniger Liquidität  ->  Risk-Assets fallen
```

Genau diese Übersetzung nimmt das Tool ab und schreibt sie bei jeder Meldung als
Begründung dazu.

## Wie bewertet wird

**1. Wirtschaftsdaten mit Zahlen** (der genaue Weg)

Aus dem Wirtschaftskalender kommen Actual, Prognose und Vorwert:

| Schritt | Beispiel NFP |
|---|---|
| Überraschung | 162k − 56k = +106k |
| Normalisiert an der typischen Streuung des Events | +106 / 45 ≈ 2,4 |
| Polarität (höher = stärkere Wirtschaft?) | ja, +1 |
| Kanal (Inflation wiegt schwerer als Wachstum) | Wachstum |
| Relevanz des Landes (nur was die Fed bewegt) | USA, ×1,0 |
| → geldpolitischer Impuls | stark restriktiv |
| → Krypto | **Stark Bearish** (−0,89) |

Die Polarität wird pro Event gepflegt: Bei Arbeitslosenquote und Erstanträgen
bedeutet ein *höherer* Wert eine *schwächere* Wirtschaft — dort dreht sich das
Vorzeichen um.

**2. Schlagzeilen mit Zahlen im Text**

`US Nonfarm Payrolls rise by 162K vs. 56K forecast` wird genauso exakt bewertet
wie ein Kalendereintrag — die Zahlen werden aus dem Text gezogen.

**3. Reine Textschlagzeilen**

Gewichtete Signalwörter, mit drei bewusst behandelten Fallen:

- **Dämpfende Verben:** `Bailey tames rate hike hopes` enthält "rate hike", ist
  aber dovish. *tames, cools, downplays, pushes back on* drehen das Signal.
- **Verbrichtung:** `inflation cools more than expected` enthält "more than
  expected", ist aber bullish — das Verb *cools* bestimmt die Richtung.
- **Preisschock statt Rally:** `Diesel hits record high` ist kein Kursanstieg,
  sondern Inflationsdruck — und damit bearish für Risk-Assets.

Geopolitik (Angriffe, Eskalation) wirkt als Risk-off: Krypto und Aktien runter,
Gold rauf.

## Vier Perspektiven

Dieselbe Meldung wirkt nicht überall gleich. Die NFP-Zahl ist für Krypto stark
bearish und für den Dollar stark bullish. Oben lässt sich zwischen **Krypto,
Aktien, Gold und USD** umschalten; aufgeklappt zeigt jede Meldung alle vier
Werte nebeneinander. Das macht sichtbar, dass "bullish" ohne Anlageklasse keine
Aussage ist.

## Filter

- **Volltextsuche** über Titel, Quelle und Event
- **Kategorien** mit Trefferzahl: US-Daten, Geopolitik, Notenbank, Krypto,
  US-Märkte, Weltdaten, Märkte
- **Signal**: nur starke, nur bullish, nur bearish, nur mit Richtung
- **Sortierung**: Relevanz, Zeit oder Signalstärke

Ratgeber- und Lifestyle-Artikel der großen Portale werden vorab aussortiert,
Dubletten über mehrere Quellen zu einem Eintrag zusammengefasst.

## Tagesübersicht

Über dem Feed steht das Gesamtbild der letzten 24 Stunden: ein gewichtetes
Mittel aller Bewertungen, die Verteilung aus bullish, bearish und neutral sowie
die drei stärksten Treiber des Tages. Relevante Meldungen zählen dabei mehr,
damit ein NFP-Tag nicht von zwanzig beiläufigen Schlagzeilen verwässert wird.
Die Übersicht folgt der oben gewählten Anlageklasse — dieselbe Nachrichtenlage
ist für Krypto bearish und für den Dollar bullish.

## Einstellungen

Über das Zahnrad oben rechts:

- **Sprache** — Deutsch oder Englisch, inklusive der Begründungstexte
- **Design** — Dunkel, Hell oder der Systemeinstellung folgend
- **Benachrichtigungen** — aus, nur bei starken Signalen oder bei allen
  gerichteten Meldungen. Auf dem iPhone erst verfügbar, wenn die Seite über
  "Zum Home-Bildschirm" installiert wurde.
- **Live-Quelle** — Adresse des Cloudflare Workers
- **Quellen** — alle Feeds mit Trefferzahl, einzeln ab- und zuschaltbar

## Aktualität

Hier wird die Architektur entschieden. Es gibt zwei Betriebsarten:

| Betrieb | Takt | Aufwand |
|---|---|---|
| **Standard** — GitHub Actions schreibt `news.json` | 5–15 Minuten | nichts weiter zu tun |
| **Live** — Cloudflare Worker | ~1 Minute, bei geöffneter App 12–20 Sekunden | einmalig einrichten |

Der Standardbetrieb reicht zum Nachlesen, nicht zum Handeln: GitHub-Cronjobs
laufen unter Last spürbar später als angegeben. Für den Live-Betrieb liegt im
Ordner `worker/` ein fertiger Cloudflare Worker.

> **Warum kein reines Browser-Polling?** Keiner der Feeds sendet CORS-Header,
> die Seite darf sie also nicht direkt laden. Öffentliche CORS-Proxys brauchten
> im Test über 20 Sekunden pro Abruf und fielen zeitweise ganz aus — als
> Grundlage untauglich. Der Worker holt die Quellen serverseitig und liefert
> sie mit CORS aus.

> **Ehrliche Grenze:** FinancialJuice ist sekundenschnell, weil dort eine
> Redaktion an lizenzierten Reuters- und Bloomberg-Wires sitzt. Mit offenen
> Feeds ist das nicht erreichbar. Realistisch sind 30–90 Sekunden nach
> Veröffentlichung; beim Wirtschaftskalender, der für NFP und CPI zählt, meist
> schneller.

## Einrichten

**1. Repository anlegen und hochladen**

```bash
git remote add origin https://github.com/DEIN-NAME/market-bias.git
```

```bash
git push -u origin main
```

**2. GitHub Pages aktivieren**

*Settings* → *Pages* → Source: `Deploy from a branch`, Branch: `main`,
Ordner: `/docs` → *Save*. Die Seite liegt danach auf
`https://DEIN-NAME.github.io/market-bias/`.

Unter *Settings → Actions → General → Workflow permissions* muss
**Read and write permissions** aktiv sein, damit die Automatik committen darf.

**3. Live-Betrieb einrichten (empfohlen)**

```bash
npm install -g wrangler
```

```bash
wrangler login
```

```bash
cd worker && wrangler deploy
```

Wrangler nennt am Ende eine Adresse der Form
`https://market-bias.DEIN-NAME.workers.dev`. Diese Adresse entweder in
`docs/config.js` eintragen oder in der App über das Zahnrad unter
**Live-Quelle** einfügen. Der Cron-Trigger hält den Cache im
Minutentakt warm; die App fragt dann alle 12 Sekunden ab.

Das kostenlose Cloudflare-Kontingent (100.000 Anfragen pro Tag) reicht dafür
weit aus — Dauerbetrieb im 12-Sekunden-Takt sind rund 7.200 Anfragen am Tag.

**4. Auf dem iPhone installieren**

Seite in Safari öffnen → Teilen → *Zum Home-Bildschirm*. Die App startet ohne
Browserleiste, merkt sich Anlageklasse und Filter und zeigt dank Service Worker
auch offline den zuletzt geladenen Stand. Neue Meldungen erscheinen mit
Hinweisbalken und farblich hervorgehoben; bei starken Signalen vibriert das
Gerät, sofern es das unterstützt.

## Aufbau

```
docs/                     von GitHub Pages ausgeliefert
  engine/                 Bewertungslogik, geteilt von Node, Worker und Browser
  data/news.json          von der Automatik erzeugt
worker/                   Cloudflare Worker für den Live-Betrieb
scripts/fetch.mjs         Einstieg für GitHub Actions
src/sentiment.test.mjs    Tests
```

## Anpassen

| Was | Wo |
|---|---|
| Neues Wirtschaftsevent | `docs/engine/events.mjs` |
| Signalwörter | `docs/engine/keywords.mjs` |
| Länder- und Notenbankgewichte | `docs/engine/relevance.mjs` |
| Kategorien, Rauschfilter, Relevanz | `docs/engine/priority.mjs` |
| Nachrichtenquellen | `FEEDS` in `docs/engine/feeds.mjs` |
| Schwellen für stark (±0,55) und normal (±0,16) | `label()` in `docs/engine/sentiment.mjs` **und** `docs/app.js` |

**Marktregime umstellen.** Standard ist `policy`: der Zinskanal dominiert, gute
Daten sind schlecht für Krypto. Kippt der Markt in eine Phase, in der
Rezessionsangst wichtiger wird als die Zinsfrage, dreht `REGIME: growth` die
Logik um — im Workflow und in `worker/wrangler.toml`. Das ist die wichtigste
Annahme des Tools; sie steht deshalb an einer Stelle und wird in der App unten
angezeigt.

## Tests

```bash
node --test src/sentiment.test.mjs
```

Zwölf Tests sichern die Richtungen ab: der NFP-Fall, die invertierte Polarität
der Arbeitslosenquote, dämpfende Verben, das Regime-Umschalten und die
Gegenprobe, dass irrelevante Volkswirtschaften verworfen werden.

## Quellen

Wirtschaftskalender von MyFXBook (Actual, Prognose, Vorwert). Schlagzeilen per
RSS von CNBC (Economy und World), FXStreet, Benzinga, BBC World, Al Jazeera,
MarketWatch und der Federal Reserve; für Krypto CoinDesk, Cointelegraph,
Decrypt, The Block, BeInCrypto und U.Today — dieselben offenen Feeds, die auch
CryptoPanic aggregiert. FinancialJuice selbst wird nicht abgegriffen: deren
Squawk läuft über eine geschlossene Websocket-Verbindung.

## Grenzen

Die Bewertung ist eine regelbasierte Ersteinordnung, keine Anlageberatung. Sie
kennt keine Marktpositionierung, kein bereits eingepreistes Erwartungsbild und
keine Revisionen der Vormonate — alles Dinge, die die tatsächliche Reaktion
mitbestimmen. Sie liefert Richtung und Begründung; die Entscheidung bleibt beim
Menschen davor.
