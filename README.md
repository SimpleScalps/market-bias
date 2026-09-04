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
- **Trading-Profil** — Stil, Zeitrahmen und Coins (siehe unten)
- **Quellen** — alle Feeds mit Trefferzahl, einzeln ab- und zuschaltbar

## Trading Impact und Wirkungsdauer

Unter jeder Meldung stehen zwei Angaben, die eine reine Bullish/Bearish-Marke
nicht liefert:

**Trading Impact** — wie stark bewegt die Meldung überhaupt?
`IGNORIEREN` · `GERING` · `MITTEL` · `HOCH` · `EXTREM`

**Erwartete Dauer** — wie lange wirkt sie nach?
`SCALP < 1 STD` · `INTRADAY 1–24 STD` · `SWING 1–7 TAGE` · `LANGFRISTIG > 7 TAGE`

Beides kommt aus dem Ereignistyp, nicht aus dem Sentiment. Eine Whale-Bewegung
ist ein Scalp-Signal: sofort da, schnell vorbei. Eine ETF-Zulassung wirkt
Wochen. Beide können bullish sein und verlangen völlig verschiedene Trades.

Die Krypto-Ereignistypen stehen in `docs/engine/cryptoevents.mjs` — von
Börsen-Hack und Auszahlungsstopp (extrem, Swing) über Whale-Bewegung und
Liquidationen (mittel, Scalp) bis Projekt-Update und Kursprognose, die als
`IGNORIEREN` eingestuft werden.

## Trading-Profil

Im Zahnrad unter *Trading-Profil* lässt sich einstellen:

- **Stil** — Scalping, Intraday, Swing oder Langfristig
- **Zeitrahmen** — 1m bis 4h (setzt den passenden Stil automatisch)
- **Coins** — BTC, ETH, SOL, XRP, BNB, DOGE

Aktiviert man *Nur was zählt*, verschwindet alles, was auf diesem Zeitrahmen
nicht handelbar ist: Projekt-Updates, Kursprognosen, Partnerschaften und alles,
was nur andere Coins betrifft. Im Test blieben von 300 Meldungen 40 übrig.

Extremereignisse kommen immer durch, unabhängig vom Profil — ein Börsen-Hack
interessiert auch den Langfristanleger, und eine ETF-Entscheidung auch den
Scalper.

## Benachrichtigungen

Drei Kanäle, einzeln zuschaltbar:

| Kanal | Bei geschlossener App | Ohne Worker | Einrichtung |
|---|---|---|---|
| **ntfy** | ja, über den Worker | ja | nur ein Themenname |
| **Telegram** | ja, über den Worker | ja | Bot-Token + Chat-ID |
| **Discord** | ja, über den Worker | nein | Webhook-Adresse |
| **Browser** | nein | — | ein Klick |

ntfy ist der einfachste Weg: kein Konto, kein Bot, eigene App mit eigenem
Symbol je Richtung (📈 bullish, 📉 bearish, 🚀 stark bullish, 🚨 stark bearish).

Telegram und Discord laufen bewusst über den Cloudflare Worker: Nur der kann
zustellen, während die App geschlossen ist — und das ist der Normalfall, wenn
das Handy in der Tasche steckt. Die App hinterlegt dafür ihre Einstellungen
beim Worker (`/subscribe`), der Cron-Job prüft jede Minute auf neue Meldungen
und verschickt sie.

**Telegram einrichten:** In Telegram [@BotFather](https://t.me/BotFather)
anschreiben, `/newbot` senden, den Token kopieren. Dem neuen Bot einmal
schreiben, damit Telegram die Chat-ID kennt. Dann:

```bash
node scripts/telegram-setup.mjs DEIN-TOKEN
```

Das Skript prüft den Token, nennt die Chat-ID und verschickt eine
Testnachricht. Der Token wird nicht gespeichert und geht nur an Telegram selbst.

Ohne Worker sendet die App direkt an Telegram — das funktioniert, solange sie
geöffnet ist. Erst der Worker stellt auch bei geschlossener App zu. Discord
braucht den Worker in jedem Fall, weil dessen Webhooks keine Browser-Aufrufe
annehmen.

**ntfy einrichten (empfohlen):** Braucht weder Konto noch Bot — nur einen
selbst gewählten Themennamen. Eigene App, eigenes Symbol je Richtung, damit
Marktmeldungen von privaten Nachrichten unterscheidbar bleiben.

```bash
node scripts/ntfy-setup.mjs
```

Das Skript erzeugt einen sicheren Zufallsnamen und verschickt drei
Testnachrichten in den Stufen, die die App später nutzt. Danach den Namen in
der ntfy-App abonnieren und in den Einstellungen eintragen. Der Themenname ist
zugleich das Zugangsgeheimnis: Wer ihn kennt, liest mit — deshalb nichts
Erratbares wählen.

**Discord einrichten:** Servereinstellungen → Integrationen → Webhooks → Neuer
Webhook → Adresse kopieren.

> Damit Benachrichtigungen einen Neustart des Workers überleben, empfiehlt sich
> ein KV-Speicher. Ohne ihn liegen die Einstellungen nur im flüchtigen Cache:
> ```bash
> wrangler kv namespace create STORE
> ```
> Die ausgegebene ID in `worker/wrangler.toml` unter `[[kv_namespaces]]`
> eintragen und erneut deployen.

## Sprache der Schlagzeilen

Die Feeds liefern englische Titel. Kalendereinträge baut die Pipeline selbst in
beiden Sprachen — dort ist die Fassung exakt. Echte Schlagzeilen werden
übersetzt und dauerhaft in `docs/data/translations.json` zwischengespeichert;
ein einmal übersetzter Titel wird nie erneut angefragt.

Ohne Konfiguration läuft das über MyMemory mit rund 5.000 Zeichen pro Tag —
das reicht für etwa 60 Schlagzeilen täglich. Zwei Wege, das zu erhöhen:

| Weg | Kontingent | Einrichtung |
|---|---|---|
| `TRANSLATE_EMAIL` | 50.000 Zeichen/Tag | eigene E-Mail als Umgebungsvariable |
| `DEEPL_KEY` | 500.000 Zeichen/Monat, bessere Qualität | kostenloser Schlüssel bei DeepL |

Beides wird im Workflow unter *Settings → Secrets and variables → Actions*
hinterlegt. Schlägt die Übersetzung fehl, bleibt der englische Titel stehen —
die Bewertung selbst ist davon nie betroffen, weil sie auf dem Originaltext
arbeitet.

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

> **Rechenzeit:** Der Gratisplan erlaubt 10 ms pro Aufruf. Alle Feeds zusammen
> zu verarbeiten braucht gemessen rund 19 ms, deshalb arbeitet der Cron
> rollierend eine von drei Feed-Gruppen pro Minute ab (rund 4 ms). Der
> Wirtschaftskalender läuft in jedem Durchgang mit, weil NFP und CPI auf die
> Sekunde zählen — er kostet nur 0,4 ms. Nach drei Minuten ist jede Quelle
> einmal durch; die zeitkritischen Zahlen sind trotzdem sofort da.

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
    cryptoevents.mjs      Krypto-Ereignistypen mit Wirkung und Dauer
    tradeimpact.mjs       Trading Impact und erwartete Wirkungsdauer
    profile.mjs           Filter nach Trading-Profil
    translate.mjs         Übersetzung mit Zwischenspeicher
  data/news.json          von der Automatik erzeugt
  data/translations.json  Zwischenspeicher der Übersetzungen
worker/                   Cloudflare Worker für den Live-Betrieb
  notify.mjs              Versand an Telegram und Discord
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
| Krypto-Ereignistypen, Wirkung und Dauer | `docs/engine/cryptoevents.mjs` |
| Regeln je Handelsstil | `STIL_REGELN` in `docs/engine/profile.mjs` |
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
