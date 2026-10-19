#!/usr/bin/env bash
# Install Rewind for Claude Code (Mac/Linux): ./install.sh
src="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
echo "=== Installing Rewind ==="
base="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
dir="$base/mods/rewind"
mkdir -p "$base/mods"
if [ "$src" != "$(cd "$dir" 2>/dev/null && pwd)" ]; then
  rm -rf "$dir"
  mkdir -p "$dir"
  cp -R "$src"/. "$dir"/
fi
echo "Mod copied to: $dir"
if ! command -v claude >/dev/null 2>&1; then
  echo 'Could not find the "claude" command. Install Claude Code first and try again.' >&2
  exit 1
fi
claude plugin uninstall replay-theater@replay-theater >/dev/null 2>&1
claude plugin marketplace remove replay-theater >/dev/null 2>&1
claude plugin marketplace add "$dir" || claude plugin marketplace update rewind
claude plugin install rewind@rewind || claude plugin update rewind@rewind
echo
claude plugin list
echo
echo "Done. Restart Claude Code (or quit Claude Desktop completely), open a NEW session and type /rewind."
echo "You can delete the folder you launched the script from: the mod is in $dir."
