#!/usr/bin/env bash
# Link the forge-show skill where OpenMausBot's bots (and any Claude Code session) load personal skills:
# ~/.claude/skills/forge-show -> openmausbot/forge-show in this checkout. Idempotent.
# Run it from the main checkout: a link into a worktree breaks when the worktree is removed.
# A real folder already there is moved out of skills/ (or it would load as a second skill), never deleted.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)/openmausbot/forge-show"
dst="$HOME/.claude/skills/forge-show"
[ -f "$src/SKILL.md" ] || { echo "install-openmausbot-skill: $src/SKILL.md missing" >&2; exit 1; }
[ -f "$src/../../.git" ] && echo "install-openmausbot-skill: warning: linking into a worktree; the link breaks when it is removed. Run it from the main checkout." >&2
mkdir -p "$(dirname "$dst")"
if [ -L "$dst" ]; then
  if [ "$(readlink "$dst")" = "$src" ]; then echo "install-openmausbot-skill: already linked"; exit 0; fi
  rm "$dst"
elif [ -e "$dst" ]; then
  mv "$dst" "$HOME/.claude/forge-show-skill.bak-$(date +%Y%m%d%H%M%S)-$$"
fi
ln -s "$src" "$dst"
echo "install-openmausbot-skill: $dst -> $src"
