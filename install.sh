#!/usr/bin/env bash
# Installa Rewind per Claude Code (Mac/Linux): ./install.sh
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Installazione di Rewind ==="
base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dir="$base/mods/rewind"
mkdir -p "$base/mods"
if [ "$src" != "$(cd "$dir" 2>/dev/null && pwd)" ]; then
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -R "$src"/. "$dir"/
fi
echo "Mod copiata in: $dir"
if ! command -v claude >/dev/null 2>&1; then
  echo 'Non trovo il comando "claude". Installa prima Claude Code e riprova.' >&2
  exit 1
fi
claude plugin uninstall replay-theater@replay-theater >/dev/null 2>&1
claude plugin marketplace remove replay-theater >/dev/null 2>&1
claude plugin marketplace add "$dir" || claude plugin marketplace update rewind
claude plugin install rewind@rewind || claude plugin update rewind@rewind
echo
claude plugin list
echo
echo "Fatto. Riavvia Claude Code (o chiudi del tutto Claude Desktop), apri una NUOVA sessione e scrivi /rewind."
echo "Puoi cancellare la cartella da cui hai lanciato lo script: la mod e' in $dir."
