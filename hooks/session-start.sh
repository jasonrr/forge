#!/usr/bin/env bash
# SessionStart hook for the forge plugin (Claude Code and Codex). Emits the dev-loop
# routing block ONLY when this repo opted in via .claude/dev-loop.md (or the older
# .claude/tally-dev-loop.md) containing `routing: on` — the file /forge:setup
# writes. Silent no-op everywhere else: consent lives in the repo, not the install.
set -euo pipefail

# Claude Code sets CLAUDE_PROJECT_DIR; Codex runs plugin hooks in the session's cwd,
# which may be a subdirectory. Look in the start dir first, then the git toplevel;
# the first dev-loop.md / tally-dev-loop.md that is a regular file decides.
start="${CLAUDE_PROJECT_DIR:-$PWD}"
top="$(git -C "$start" rev-parse --show-toplevel 2>/dev/null || true)"
cfg=""
for d in "$start" "$top"; do
  [ -n "$d" ] || continue
  for n in dev-loop.md tally-dev-loop.md; do
    if [ -f "$d/.claude/$n" ]; then cfg="$d/.claude/$n"; break 2; fi
  done
done
if [ -z "$cfg" ] || ! grep -q '^routing: on$' "$cfg" 2>/dev/null; then
  exit 0
fi

# routing.md is the single copy of the block; JSON-escape it for additionalContext.
ctx="$(awk '{ gsub(/\r/, ""); gsub(/\\/, "\\\\"); gsub(/"/, "\\\""); gsub(/\t/, "\\t"); printf "%s\\n", $0 }' "$(dirname "$(readlink -f "$0" 2>/dev/null || echo "$0")")/routing.md")"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$ctx"
