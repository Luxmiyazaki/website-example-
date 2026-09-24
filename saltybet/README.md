# Salty Brawl 🧂🥊

Ein Klon von [SaltyBet](https://www.saltybet.com): KI-Kämpfer prügeln sich ununterbrochen,
und du wettest Spielgeld ("Salt") darauf, wer gewinnt. Kein echtes Geld.

![Ablauf](https://img.shields.io/badge/Matchmaking_100-→_Turnier_16-→_Exhibitions_25-ffd23f)

## Starten

**Variante 1: Solo (ohne Installation)**
`saltybet/index.html` einfach im Browser öffnen (Doppelklick).
Alles läuft im Browser, die anderen Wetter sind Bots, dein Fortschritt wird gespeichert.
Funktioniert auch auf GitHub Pages: `https://<user>.github.io/<repo>/saltybet/`

**Variante 2: Online / Multiplayer** (Node.js 18 oder neuer, keine Pakete nötig)

```bash
cd saltybet
npm start            # -> http://localhost:3000
```

Alle, die die Seite öffnen, sehen dieselben Kämpfe, wetten in dieselben Pots und teilen sich
den Chat. Anmeldung nur mit Namen. Der Spielstand liegt in `saltybet/data/league.json`.

Optionale Umgebungsvariablen: `PORT=3000`, `BET_SECONDS=30`, `BOTS=60`, `MATCHMAKING=100`,
`EXHIBITIONS=25`, `DATA_DIR=./data`, `TRUST_PROXY=1` (hinter nginx o. ä.).

## Was alles drin ist

- **Live-"Stream"**: 2D-Kampfspiel auf einem Canvas mit 6 Stages, Lebensbalken, Rundentimer,
  Best-of-3 (bis zu 5 Runden bei Unentschieden), Combos, Blocken, Projektilen, Beams, Teleports,
  Uppercuts, Super-Moves mit Power-Leiste, K.O.-Zeitlupe, "PERFECT", Kamera-Schwenk, Screenshake.
- **78 eigene Charaktere** in den Tiers **X** (kaputt stark), **S**, **A**, **B**, **P** (Potato),
  jeder mit eigenen Werten, Aussehen, Spezial- und Super-Move. Die KI kämpft selbst.
- **Wetten wie bei SaltyBet**: Wettfenster mit Countdown, eine Wette pro Match, Schnellbuttons
  (10 %, 25 %, 50 %, ALL IN). Die Pots werden erst beim Schließen der Wetten sichtbar.
  Statusmeldungen wie im Original: *"Bets are OPEN!"*, *"Bets are locked. …"*, *"X wins! Payouts to Team Red."*
- **Parimutuel-Auszahlung**: Gewinn = Einsatz × (Verlierer-Pot ÷ Gewinner-Pot). Quoten wie `1 : 4.2`.
- **Bailout**: Wer pleite ist, bekommt beim nächsten Match $100 plus einen Bonus je nach Rang. Start: $400.
- **Spielmodi im Zyklus**: 100 Matchmaking-Kämpfe (gleiches Tier), dann ein 16er-Turnier mit
  eigenem Turnier-Guthaben ($1,000 + Rangbonus, man fällt nie darunter, Gewinne gehen danach
  aufs echte Konto), dann 25 Exhibitions (alle gegen alle).
- **Tier-Auf- und Abstieg**: 8 von 10 gewonnen → Aufstieg, 8 von 10 verloren → Abstieg.
- **Ränge** nach Anzahl der Wetten (25, 50, 75, 100, 150 … bis "Omega Salty").
- **Stats für alle** (im Original "Illuminati"): Bilanz, Siegquote, Serie, Elo, letzte 10 Kämpfe
  und Werte jedes Kämpfers. Dazu Wetter-Liste mit Einsätzen und Gewinnen, Verlauf,
  Rangliste, Kompendium und ein Chat mit Bots, die mitlästern.
- Synthetisierte Soundeffekte (🔇/🔊 oben rechts), Handy-Layout.

### Solo-Extras
- **Turbo** (⚙️): kürzeres Wettfenster, doppelt so schnelle Kämpfe.
- Test-Parameter: `index.html?fast=1` (sehr schnell), `index.html?fast=1&tournamentIn=1` (Turnier sofort).
- Die Zeit steht still, solange der Tab im Hintergrund ist. So verpasst du deinen eigenen Kampf nicht.

## Wie es technisch funktioniert

Der Kampf ist eine **deterministische Simulation** (`js/core/fight.js`): gleicher Seed + gleiche
Kämpfer = exakt derselbe Kampf auf jedem Rechner. Sobald die Wetten schließen, rechnet die Liga
den ganzen Kampf in ein paar Millisekunden durch und weiß den Sieger. Die Browser bekommen nur
den Seed und spielen den Kampf in Echtzeit ab. Wer später dazukommt, spult vor.
Die Liga (`js/core/league.js`) läuft unverändert im Browser (Solo) oder auf dem Server (Online).

```
saltybet/
  index.html, css/style.css
  js/core/     rng.js · roster.js · fight.js · league.js   (Browser + Node)
  js/client/   render.js · audio.js · feeds.js · app.js    (nur Browser)
  server/      server.js                                    (Online-Modus, ohne Abhängigkeiten)
  tests/       node --test
```

## Tests

```bash
cd saltybet
npm test
```

Die Tests prüfen unter anderem: Determinismus, dass jeder Kampf endet, Tier-Balance,
Auszahlungsformel, Bailout, den kompletten Zyklus Matchmaking → Turnier → Exhibitions,
die Rückerstattung offener Wetten nach einem Neustart, die Server-API und dass der Server
keine internen Dateien (z. B. den Spielstand mit den Login-Tokens) ausliefert.
