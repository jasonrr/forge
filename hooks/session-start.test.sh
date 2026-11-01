#!/usr/bin/env bash
# Runs session-start.sh against temp repos: new name, old name, routing off, no file,
# new name unreadable (must not fall through to the old one), and via a symlink.
# Then checks pi/extensions/routing.ts agrees with the hook on the same repos.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
run() { CLAUDE_PROJECT_DIR="$1" bash "$here/session-start.sh"; }
t="$(mktemp -d)"; export GIT_CEILING_DIRECTORIES="$t"; trap 'chmod -R u+rwx "$t"; rm -rf "$t"' EXIT
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
# No CLAUDE_PROJECT_DIR (Codex, pi): config at the git root is found from a subdirectory,
# and a subdirectory's own config wins over the root's.
mkdir -p "$t/blocked/.claude"; printf 'routing: on\n' > "$t/blocked/.claude/dev-loop.md"; chmod 000 "$t/blocked/.claude"
[ -z "$(run "$t/blocked")" ]
# Unsearchable .claude in a subdir is skipped like a missing file: the git root's config decides.
mkdir -p "$t/blk2/.claude" "$t/blk2/s/.claude"; git -C "$t/blk2" init -q
printf 'routing: on\n' > "$t/blk2/.claude/dev-loop.md"; chmod 000 "$t/blk2/s/.claude"
(cd "$t/blk2/s" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
mkdir -p "$t/gitrepo/.claude" "$t/gitrepo/a/b" "$t/nested/.claude" "$t/nested/sub/.claude"
git -C "$t/gitrepo" init -q; git -C "$t/nested" init -q
printf 'routing: on\n' > "$t/gitrepo/.claude/dev-loop.md"
printf 'routing: off\n' > "$t/nested/.claude/dev-loop.md"
printf 'routing: on\n' > "$t/nested/sub/.claude/dev-loop.md"
(cd "$t/gitrepo/a/b" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
(cd "$t/nested/sub" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
[ -z "$(cd "$t/nested" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh")" ]
# A repo dir whose name ends in a space: the hook's $(...) keeps it, so routing.ts must too.
mkdir -p "$t/sp /.claude" "$t/sp /a"; git -C "$t/sp " init -q
printf 'routing: on\n' > "$t/sp /.claude/dev-loop.md"
(cd "$t/sp /a" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
node --experimental-strip-types --no-warnings --input-type=module -e '
const { routingEnabled } = await import(process.argv[1]);
const got = ["new", "old", "off", "none", "locked", "gitrepo/a/b", "nested/sub", "nested", "blocked", "blk2/s", "sp /a"].map((d) => routingEnabled(`${process.argv[2]}/${d}`));
if (got.join() !== "true,true,false,false,false,true,true,false,false,true,true") throw new Error(`routing.ts disagrees with hook: ${got}`);
' "file://$here/../pi/extensions/routing.ts" "$t"
echo "session-start.test.sh: OK"
