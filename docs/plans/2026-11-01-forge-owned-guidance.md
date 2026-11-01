# Plan: forge owns its own guidance

- **Goal:** forge's routing block reaches Claude Code, pi and Codex from the plugin alone, with no copy in the user's dotfiles. Codex installs forge as a plugin, runs the same hook, and can follow the skills inline.
- **Design:** `docs/decisions/2026-11-01-forge-owned-guidance.md`
- **Branch:** `feat/forge-owned-guidance`
- **Verify (whole feature):** `bash hooks/session-start.test.sh && node --experimental-strip-types --no-warnings --input-type=module -e 'await import(new URL("pi/extensions/routing.ts", "file://" + process.cwd() + "/"))' && v=$(jq -r .version .claude-plugin/plugin.json) && [ "$v" = "$(jq -r .version .codex-plugin/plugin.json)" ] && [ "$v" = "$(jq -r .version package.json)" ]`
- **Out of scope:**
  - The edits to `~/.dotfiles/codex/.codex/AGENTS.md` (delete section 3; replace the "Dispatching work…" paragraph with the generic line in the design). The user makes these; forge never writes there. Put them in the PR body under "After merge (yours)".
  - Dispatching a build from a **Codex** session inside the Herdr app or herdr. `/forge:plan`'s Dispatch bullets launch only claude and pi kinds; Codex sessions use Inline. This is filed as a GitHub issue, not part of this plan.

Invariants this plan must keep (from `.claude/dev-loop.md`):
- `hooks/routing.md` is the only copy of the block.
- `session-start.sh` and `routing.ts` resolve config identically.
- The hook is a silent no-op without opt-in.
- A release bumps every manifest together.

## Task 1
**Hook and pi extension find the config from a subdirectory**

- **Exists because:** Codex doesn't set `CLAUDE_PROJECT_DIR` and runs plugin hooks in the session's working directory (developers.openai.com/codex/hooks, "Plugin-bundled hooks"; confirmed: the Codex 0.164 binary references `CLAUDE_PLUGIN_ROOT` but not `CLAUDE_PROJECT_DIR`). A Codex session started in `repo/src` therefore misses `repo/.claude/dev-loop.md` and routing silently stays off.
  - The rule is: start directory first, then the git toplevel. A subdirectory's own config still wins, so nobody who relies on a nested config today regresses.
  - `routing.ts` gets the identical rule; the two resolving config the same way is an invariant.
- **Model:** sonnet
- **Files:** `hooks/session-start.test.sh`, `hooks/session-start.sh`, `pi/extensions/routing.ts`.
- **Produces:** the root rule. Task 2's Codex support depends on it.
- **Steps, test-first.** The code below was run in a scratch copy: the new test fails on the current code (exit 4) and passes on the new code. Transcribe it exactly.
  1. Replace `hooks/session-start.test.sh` with the content below. What changed from today:
     - `GIT_CEILING_DIRECTORIES="$t"`, so git discovery never escapes the temp dir.
     - Three hook cases with `CLAUDE_PROJECT_DIR` unset via `env -u` (it is set inside Claude Code sessions).
     - Three more parity cases.
     Run `bash hooks/session-start.test.sh`. It must fail (non-zero exit, no `OK`).

```bash
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
mkdir -p "$t/gitrepo/.claude" "$t/gitrepo/a/b" "$t/nested/.claude" "$t/nested/sub/.claude"
git -C "$t/gitrepo" init -q; git -C "$t/nested" init -q
printf 'routing: on\n' > "$t/gitrepo/.claude/dev-loop.md"
printf 'routing: off\n' > "$t/nested/.claude/dev-loop.md"
printf 'routing: on\n' > "$t/nested/sub/.claude/dev-loop.md"
(cd "$t/gitrepo/a/b" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
(cd "$t/nested/sub" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh") | jq -e '.hookSpecificOutput.additionalContext | test("<dev-loop>")' >/dev/null
[ -z "$(cd "$t/nested" && env -u CLAUDE_PROJECT_DIR bash "$here/session-start.sh")" ]
node --experimental-strip-types --no-warnings --input-type=module -e '
const { routingEnabled } = await import(process.argv[1]);
const got = ["new", "old", "off", "none", "locked", "gitrepo/a/b", "nested/sub", "nested"].map((d) => routingEnabled(`${process.argv[2]}/${d}`));
if (got.join() !== "true,true,false,false,false,true,true,false") throw new Error(`routing.ts disagrees with hook: ${got}`);
' "file://$here/../pi/extensions/routing.ts" "$t"
echo "session-start.test.sh: OK"
```
  2. Replace `hooks/session-start.sh` with:

```bash
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
```
  3. Replace `pi/extensions/routing.ts` with:

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Single copy of the routing block, shared with hooks/session-start.sh.
// Read at import so a wrong path fails loudly at load, not silently per turn.
// Assumes pi loads this file in place (it does today); a bundler would break the relative path.
const DEV_LOOP_BLOCK = readFileSync(new URL("../../hooks/routing.md", import.meta.url), "utf8").trimEnd();

// Mirrors hooks/session-start.sh: look in cwd first, then its git toplevel; in each,
// .claude/dev-loop.md then the older .claude/tally-dev-loop.md. The first that is a
// regular file (`[ -f ]`) decides alone — an unreadable one means off, never a
// fall-through. A `routing: on` line, exact (no CRLF).
export function routingEnabled(cwd: string): boolean {
  for (const dir of [cwd, gitToplevel(cwd)]) {
    if (!dir) continue;
    for (const name of ["dev-loop.md", "tally-dev-loop.md"]) {
      const p = join(dir, ".claude", name);
      if (!statSync(p, { throwIfNoEntry: false })?.isFile()) continue;
      try {
        return readFileSync(p, "utf8").split("\n").some((line) => line === "routing: on");
      } catch {
        return false;
      }
    }
  }
  return false;
}

// ponytail: one git call per turn (~ms); cache per cwd if it ever shows up in profiles.
function gitToplevel(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // Injected every turn (not once per session): pi resets systemPrompt to
    // base before each call, so a once-per-session flag would only ever fire
    // on turn 1. Content-guarded instead, so re-injection is a no-op if pi
    // ever starts accumulating systemPrompt across turns.
    if (!routingEnabled(ctx.cwd)) return;
    if (event.systemPrompt.includes(DEV_LOOP_BLOCK)) return;
    // Framework-free test marker: greppable on stderr in -p mode. Only there —
    // in the interactive TUI, stderr paints over the "Working" line every turn.
    if (!ctx.hasUI) console.error("[loop-routing] dev-loop routing injected");
    return { systemPrompt: `${event.systemPrompt}\n\n${DEV_LOOP_BLOCK}` };
  });
}
```
  4. Run `bash hooks/session-start.test.sh`. It must print `session-start.test.sh: OK`.
- **Verify:** `bash hooks/session-start.test.sh`

## Task 2
**Ship forge as a Codex plugin; release and refresh all three manifests together**

- **Exists because:** the user runs the loop from Codex. Without a Codex manifest and marketplace file, Codex can't install forge's skills or hook. Without the `publish.sh` change, the Codex manifest's version falls behind and a Codex install never updates.
- **Model:** sonnet
- **Files:** `.codex-plugin/plugin.json` (new), `.agents/plugins/marketplace.json` (new), `scripts/publish.sh`, `AGENTS.md`, `.claude/dev-loop.md`.
- **Consumes:**
  - Task 1's root rule.
  - `hooks/hooks.json`, used unchanged: Codex discovers `hooks/hooks.json` in the plugin root by default, sets `CLAUDE_PLUGIN_ROOT`, and its SessionStart sources include `startup`, `clear` and `compact` (developers.openai.com/codex/hooks).
- **Steps:**
  1. Create `.codex-plugin/plugin.json`:
     - Set `version` and `description` to the exact strings in `.claude-plugin/plugin.json` at build time (`jq -r .version` / `jq -r .description`).
     - Keep the `"version": "X.Y.Z"` formatting (one space after the colon). `publish.sh`'s perl bump matches that exact text.
     - No `hooks` field: Codex's manifest validator rejects it, and default discovery is what we want.
     - Fields follow the installed `charter-rc` plugin (`~/.codex/plugins/cache/rc-ops-ai/charter-rc/1.21.6/.codex-plugin/plugin.json`).
     ```json
     {
       "name": "forge",
       "version": "0.1.1",
       "description": "Forge — a code factory for agents: brainstorm → plan → build in fresh worktrees → adversarial branch review → PR. Designs and plans are committed files, the task ledger is a draft PR checklist, follow-ups are GitHub issues. Needs only git and gh.",
       "author": { "name": "Jason Rosoff" },
       "homepage": "https://github.com/jasonrr/forge",
       "repository": "https://github.com/jasonrr/forge",
       "license": "MIT",
       "keywords": ["dev-loop", "skills", "agents", "herdr"],
       "skills": "./skills/"
     }
     ```
     If `.claude-plugin/plugin.json` no longer says `0.1.1` or that description, use its current values instead.
  2. Create `.agents/plugins/marketplace.json`. It follows rc-ops-ai's (`~/.codex/.tmp/marketplaces/rc-ops-ai/.agents/plugins/marketplace.json`). `"path": "./"` is the repo root; Codex 0.164 accepted it in a scratch `CODEX_HOME`.
     ```json
     {
       "name": "forge",
       "interface": { "displayName": "Forge" },
       "plugins": [
         {
           "name": "forge",
           "source": { "source": "local", "path": "./" },
           "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
           "category": "Productivity"
         }
       ]
     }
     ```
  3. `scripts/publish.sh` — edit **bottom-up**, so the line numbers below are today's:
     - Lines 36–41 (the `if command -v claude` block): after its closing `fi`, append:
       ```bash
       if command -v codex >/dev/null && codex plugin marketplace list 2>/dev/null | grep -q '^forge[[:space:]]'; then
         codex plugin marketplace upgrade forge && echo "publish: Codex marketplace refreshed — restart Codex to load it"
       fi
       ```
     - Line 32: `git commit -q -m "Release v$new" -- .claude-plugin/plugin.json package.json` → `git commit -q -m "Release v$new" -- .claude-plugin/plugin.json .codex-plugin/plugin.json package.json`
     - Line 30: replace with `[ "$(jq -r .version .claude-plugin/plugin.json)$(jq -r .version .codex-plugin/plugin.json)$(jq -r .version package.json)" = "$new$new$new" ] || die "version bump failed"`
     - Line 29: in the perl line, change the file list `.claude-plugin/plugin.json package.json` → `.claude-plugin/plugin.json .codex-plugin/plugin.json package.json`.
     - After line 15, insert `[ "$cur" = "$(jq -r .version .codex-plugin/plugin.json)" ] || die "plugin.json ($cur) and .codex-plugin/plugin.json versions differ"`.
     - Line 2: `# Ship forge: test, bump the version in plugin.json + package.json, commit, tag,` → `# Ship forge: test, bump the version in the Claude, Codex and pi manifests, commit, tag,`.
     - Line 3: `# push to main, then refresh the local Claude Code install.` → `# push to main, then refresh the local Claude Code and Codex installs.`
  4. `AGENTS.md`:
     - Line 3 begins `Forge is skills + one hook + one pi extension.` Replace that first sentence with `Forge is skills + one hook + one pi extension, packaged for Claude Code (`.claude-plugin/`), Codex (`.codex-plugin/`, `.agents/plugins/`) and pi (`package.json`).` Keep the rest of the line.
     - In the Release bullet, append: ` Codex runs the same `hooks/hooks.json`; it sets `CLAUDE_PLUGIN_ROOT` but not `CLAUDE_PROJECT_DIR`, so the hook falls back to the cwd and its git toplevel.`
     - In **Shipping**, `bumps `version` in `.claude-plugin/plugin.json` and `package.json`` → `bumps `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json``. After `claude plugin marketplace update forge && claude plugin update forge@forge`, add `, and `codex plugin marketplace upgrade forge` when Codex has the forge marketplace`.
  5. `.claude/dev-loop.md` line 7 (invariants lens): `a release bumps plugin.json and package.json together` → `a release bumps .claude-plugin/plugin.json, .codex-plugin/plugin.json and package.json together`.
  6. Live check in a throwaway Codex home. This never touches `~/.codex`:
     ```bash
     CH=$(mktemp -d) && CODEX_HOME="$CH" codex plugin marketplace add "$(git rev-parse --show-toplevel)" >/dev/null && CODEX_HOME="$CH" codex plugin list 2>&1 | grep -E '^forge@forge[[:space:]]'; rm -rf "$CH"
     ```
     It must print a `forge@forge` row. If Codex rejects the manifest or the path, stop and report rather than improvise.
- **Verify:** `jq -e --slurpfile c .claude-plugin/plugin.json '.skills == "./skills/" and (has("hooks") | not) and .version == $c[0].version and .description == $c[0].description' .codex-plugin/plugin.json >/dev/null && jq -e '.plugins[0].source.path == "./"' .agents/plugins/marketplace.json >/dev/null && bash -n scripts/publish.sh && [ "$(grep -c 'codex-plugin/plugin.json' scripts/publish.sh)" = 4 ] && grep -q 'codex plugin marketplace upgrade forge' scripts/publish.sh && grep -q 'codex-plugin/plugin.json' .claude/dev-loop.md`

## Task 3
**Skills name a fallback wherever they rely on a Claude-only tool**

- **Exists because:** Codex and pi have no `EnterWorktree`, Agent tool, or Monitor/wakeup. Today the build's in-session isolation, plan's Inline/Outside-herdr branches, implementer dispatch and review-branch's outside-herdr fan-out give no instruction there.
  - Every `AskUserQuestion` mention already says "when available", so those are left alone.
  - The `herdr agent prompt` report path is already harness-agnostic.
- **Model:** sonnet
- **Files:** `skills/build/SKILL.md`, `skills/plan/SKILL.md`, `skills/review-branch/SKILL.md`. No interfaces.
- **The fallback sentence (FB).** Insert it **verbatim** everywhere below, so one grep finds every copy:
  > No `EnterWorktree` in your harness (Codex, pi)? Run `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)"); WT="$ROOT/.claude/worktrees/<slug>"; git -C "$ROOT" fetch origin main && git -C "$ROOT" worktree add --no-track -b <type>/<slug> "$WT" origin/main && cd "$WT"` in its place; the branch is then exactly `<type>/<slug>`.

  It defines its own `ROOT` and `WT`, so it stands alone wherever it lands. `--no-track` matches the existing desktop Dispatch bullet: without it the branch tracks `origin/main`, and git's own hint on a bare push is `git push origin HEAD:main`.
- **Steps:**
  1. `skills/build/SKILL.md` line 8:
     - Find the sentence ending ``read the real one with `git branch --show-current`.``
     - Insert a space, then FB, immediately after it, before ``If the plan `mv` fails, stop and report.``
     - FB's own `ROOT=` stays; the paragraph's earlier `ROOT=` is for the plan-file move, which happens after FB in either branch.
  2. `skills/build/SKILL.md` line 28: replace ``Implementers dispatch through the Agent tool (cheap, model-pinned, serialized on one tree) — never a herdr pane;`` with ``Implementers dispatch through the Agent tool (cheap, model-pinned, serialized on one tree), or in a harness without it its own subagent tool (Codex: `spawn_agent`), passing the model when that tool accepts one — never a herdr pane;``. Change nothing else on the line.
  3. `skills/plan/SKILL.md` line 48 (**Inline** bullet): after its last sentence, add a space and FB.
  4. `skills/plan/SKILL.md` line 50 (**Outside herdr** bullet): after its last sentence, add a space and FB.
  5. `skills/plan/SKILL.md` line 117: replace ``or a wakeup sized to the plan's expected duration.`` with ``or a wakeup sized to the plan's expected duration; a harness with neither skips the check and tells the human what to watch.``
  6. `skills/review-branch/SKILL.md` line 35: replace ``Outside herdr: Agent-tool fan-out with the same briefs.`` with ``Outside herdr: Agent-tool fan-out (or the harness's own subagent tool, e.g. Codex `spawn_agent`) with the same briefs.``
- **Verify:** `[ "$(grep -c 'No `EnterWorktree` in your harness (Codex, pi)' skills/build/SKILL.md)" = 1 ] && [ "$(grep -c 'No `EnterWorktree` in your harness (Codex, pi)' skills/plan/SKILL.md)" = 2 ] && [ "$(grep -c 'worktree add --no-track -b <type>/<slug> "$WT" origin/main' skills/plan/SKILL.md)" = 2 ] && grep -q 'its own subagent tool (Codex: `spawn_agent`)' skills/build/SKILL.md && grep -q 'e.g. Codex `spawn_agent`) with the same briefs' skills/review-branch/SKILL.md && grep -q 'tells the human what to watch' skills/plan/SKILL.md`

## Task 4
**Install docs for all three harnesses and the new-machine path**

- **Exists because:** Codex's `~/.codex/config.toml` isn't stowed, and Codex skips plugin hooks until the user trusts them. Without these lines, a new Mac silently gets Codex without routing. A gitignored `dev-loop.md` isn't cloned either, and setup doesn't say so today.
- **Model:** haiku
- **Files:** `README.md`, `skills/setup/SKILL.md`.
- **Steps:**
  1. `README.md`: directly after the line that starts with `pi:` (the pi install line), and before `## Coming from tally`, insert this block. Command lines are indented four spaces, like the `claude plugin …` lines above them.
     ```
     
     Codex:
     
         codex plugin marketplace add jasonrr/forge
         codex plugin add forge@forge
     
     Codex skips plugin hooks until you trust them: accept forge's SessionStart hook when Codex asks, or routing stays off.
     
     **New machine:** Claude Code and pi reinstall forge from your settings files if they list it. Codex needs the two commands above, because its `config.toml` holds installs and hook trust. Per repo, a committed `.claude/dev-loop.md` comes back with the clone; a gitignored one doesn't, so run `/forge:setup` there again.
     ```
  2. `skills/setup/SKILL.md`: at the end of the bullet starting `- **Gitignore (default)**`, append ` On a new machine a gitignored file isn't cloned, so this repo needs `/forge:setup` again there.`
- **Verify:** `grep -q '^    codex plugin add forge@forge$' README.md && grep -q 'accept forge' README.md && grep -q '^\*\*New machine:\*\*' README.md && grep -q 'needs `/forge:setup` again there' skills/setup/SKILL.md`
