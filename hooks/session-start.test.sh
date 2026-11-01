#!/usr/bin/env bash
# Runs session-start.sh against temp repos: new name, old name, routing off, no file,
# new name unreadable (must not fall through to the old one), and via a symlink.
# Then checks pi/extensions/routing.ts agrees with the hook on the same repos.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
run() { CLAUDE_PROJECT_DIR="$1" bash "$here/session-start.sh"; }
t="$(mktemp -d)"; trap 'chmod -R u+rwx "$t"; rm -rf "$t"' EXIT
mkdir -p "$t/new/.claude" "$t/old/.claude" "$t/off/.claude" "$t/none" "$t/locked/.claude"
printf '# dev loop\nrouting: on\n' > "$t/new/.claude/dev-loop.md"
printf '# dev loop\nrouting: on\n' > "$t/old/.claude/tally-dev-loop.md"
printf '# dev loop\nrouting: off\n' > "$t/off/.claude/dev-loop.md"
printf 'routing: on\n' > "$t/locked/.claude/dev-loop.md"; chmod 000 "$t/locked/.claude/dev-loop.md"
printf 'routing: on\n' > "$t/locked/.claude/tally-dev-loop.md"
run "$t/new" | jq -e '.hookSpecificOutput.additionalContext | test("/forge:plan") and test("<dev-loop>") and (test("tally") | not)' >/dev/null
run "$t/old" | jq -e '.hookSpecificOutput.additionalContext | test("/forge:build")' >/dev/null
[ -z "$(run "$t/off")" ]
[ -z "$(run "$t/none")" ]
[ -z "$(run "$t/locked")" ]
ln -s "$here/session-start.sh" "$t/link.sh"
CLAUDE_PROJECT_DIR="$t/new" bash "$t/link.sh" | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
node --experimental-strip-types --no-warnings --input-type=module -e '
const { routingEnabled } = await import(process.argv[1]);
const got = ["new", "old", "off", "none", "locked"].map((d) => routingEnabled(`${process.argv[2]}/${d}`));
if (got.join() !== "true,true,false,false,false") throw new Error(`routing.ts disagrees with hook: ${got}`);
' "file://$here/../pi/extensions/routing.ts" "$t"
echo "session-start.test.sh: OK"
