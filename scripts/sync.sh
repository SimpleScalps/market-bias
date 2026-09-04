#!/usr/bin/env bash
# Holt die Bot-Commits, setzt die eigene Arbeit obendrauf und laedt hoch.
# Die Automatik committet alle zehn Minuten news.json; ohne diesen Ablauf
# lehnt GitHub den Push ab.
set -e
cd "$(dirname "$0")/.."

# Merge-Regel fuer generierte Dateien sicherstellen (ist repo-lokal).
git config merge.generiert.name "Generierte Datei: lokale Fassung behalten"
git config merge.generiert.driver true

git fetch origin
if [ "$(git rev-list --count HEAD..origin/main)" -gt 0 ]; then
  echo "Neue Commits vom Bot werden eingearbeitet..."
  git rebase origin/main
fi
git push origin main
echo "Fertig."
