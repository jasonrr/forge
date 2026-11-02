#!/usr/bin/env bash
# Point Herdr at the forge mod in this checkout: ~/.config/herdr-app/mods/forge -> herdr/mods/forge.
# Idempotent. A real folder already there (the old hand-made mod) is moved aside, never deleted.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)/herdr/mods/forge"
dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/forge"
[ -f "$src/main.js" ] || { echo "install-herdr-mod: $src/main.js missing" >&2; exit 1; }
mkdir -p "$(dirname "$dst")"
if [ -L "$dst" ]; then
  [ "$(readlink "$dst")" = "$src" ] && { echo "install-herdr-mod: already linked"; exit 0; }
  rm "$dst"
elif [ -e "$dst" ]; then
  mv "$dst" "$(dirname "$(dirname "$dst")")/forge-mod.bak-$(date +%Y%m%d%H%M%S)" # out of mods/, or Herdr loads the backup as a second mod
fi
ln -s "$src" "$dst"
echo "install-herdr-mod: $dst -> $src"
