# Forge owns its own guidance

## Problem

Forge's guidance lives in two places today: section 3 of `~/.dotfiles/codex/.codex/AGENTS.md` (one line per skill, plus a "dispatch is the loop's job" paragraph in section 1) and `hooks/routing.md`. The two already overlap and will drift. Uninstalling forge leaves the dotfiles copy behind. Codex has no forge support at all, so it only gets the dotfiles lines. The goal: one copy of each rule; installing forge brings its guidance and uninstalling removes it, in Claude Code, pi and Codex, on reinstall and on a new Mac. Forge never writes to `~/.claude/CLAUDE.md`, `~/.codex/AGENTS.md` or `~/.dotfiles`.

## Chosen approach

**What belongs to forge.** Section 3 does: it describes forge's skills and is useless without them. The dispatch paragraph is half forge's. The part that says *which* skills dispatch is already in `/forge:plan` and `/forge:build`. What's left is a precedence rule ("a skill's own dispatch steps beat these general worktree rules"), and that belongs to the dotfiles, which own the worktree rules. **Herdr routing (section 2) stays in the dotfiles.** It governs `hc send` vs `herdr` for any "send to X", with or without forge, so uninstalling forge must not remove it. Its long-term home is herdr's own skill, not forge.

**Where forge's part lives: the per-repo routing hook, in all three harnesses.** `hooks/routing.md` stays the single copy, injected only in repos with `routing: on`. That is the same gate section 3 already states ("when a project uses forge"), so nothing is lost by deleting section 3.
- Claude Code: the plugin hook, unchanged.
- pi: `pi/extensions/routing.ts`, unchanged.
- Codex (new): add `.codex-plugin/plugin.json` and `.agents/plugins/marketplace.json`, following rc-ops-ai's dual layout. Codex discovers the existing `hooks/hooks.json` by default, sets `CLAUDE_PLUGIN_ROOT`, and takes the same `hookSpecificOutput.additionalContext` JSON (developers.openai.com/codex/hooks). The skills ship through `"skills": "./skills/"`.
- Two small fixes so Codex actually works:
  - The hook resolves the repo root with `git rev-parse --show-toplevel` when `CLAUDE_PROJECT_DIR` is unset. Codex runs hooks in the session's working directory, which may be a subdirectory.
  - Each skill that names a Claude-only tool (`EnterWorktree`, the Agent tool, `AskUserQuestion`) gets a one-line fallback for harnesses without it: `git worktree add`, the harness's subagent tool, a plain question.

Options compared:
| | Always-on plugin context | **Per-repo routing (chosen)** | Skill descriptions only |
|-|-|-|-|
| Consent | Injects into every repo; breaks per-repo opt-in | Per repo, as today | n/a |
| Reliability | High | High where opted in | Low: Claude Code already drops forge's descriptions from its skill listing when the listing is over budget (seen this session) |
| Copies | A second block beside routing.md | One | One, but weak |

**Dotfiles edits afterwards** (yours; forge never makes them):
- Delete section 3.
- In section 1, replace the "Dispatching work…" paragraph with one generic line: "These rules cover worktrees the human asks for and your own isolation; when a skill in use defines its own dispatch steps, follow the skill." It names no tool, so it stays correct with forge uninstalled.
- Sections 2 and 4 stay.

**Reinstall forge:** uninstalling removes the hook, the extension and the skills, so the guidance goes with them. Reinstalling brings it back. `.claude/dev-loop.md` stays in each repo and is inert without forge.
**New Mac:**
- Claude: the stowed `settings.json` enables forge.
- pi: the stowed `~/.pi/agent/settings.json` lists the package.
- Codex: `~/.codex/config.toml` isn't stowed, so run `codex plugin marketplace add jasonrr/forge && codex plugin add forge@forge` once, then trust forge's hook when Codex asks (Codex skips plugin hooks until they're trusted). The README documents this; your dotfiles bootstrap can call it.
- Per repo: committed `dev-loop.md` files come back with the clone. Gitignored ones don't, so re-run `/forge:setup` in those repos. Setup's gitignore option says this in one line.

## Cut and why

- **Always-on global block:** cut. It breaks per-repo consent, and in repos that don't use the loop it repeats what the skill descriptions say.
- **Moving the dispatch rule into routing.md:** cut. The skills already hold the steps; the precedence line belongs with the dotfiles' worktree rules.
- **Forge shipping herdr routing:** cut. It isn't forge's.
- **An installer or bootstrap script for Codex:** cut. Two native commands plus a README line are enough.

## Open questions

None blocking. The live `~/.claude/settings.json` is deliberately a regular file, not the stow symlink. The dotfiles copy only seeds a new install, so forge's entries must stay in that copy for the new-Mac path to work.

## Deviations

- T1 commit 25576c3, 068acc7 — deviation: review found routing.ts threw EACCES on an unsearchable `.claude` (statSync only suppresses ENOENT; bug predates this plan, the toplevel step widened it). Fixed in 068acc7 with an isFile helper that skips like bash `[ -f ]`, plus two test cases (`blocked`, `blk2/s`) — parked: none
- T2 commit 52c851a, 5274d72 — deviation: publish.sh Codex block now gates on forge being installed, skips `marketplace upgrade` for a local (non-Git) marketplace (it exits 1 there, after the push), and re-runs `codex plugin add forge@forge`, since a marketplace upgrade alone leaves the versioned install cache on the old version (verified in a throwaway CODEX_HOME) — parked: none
- T3 commit 63f1888, 57939c5 — deviation: FB tail extended with "(if it fails, stop and report)" and "every later command runs in `$WT` — pass it as the working directory where `cd` doesn't persist between commands" (Codex runs each command in a fresh process, so the bare `cd` would leave later commits in the main checkout); the no-Monitor clause now keeps the desktop one-shot `hc get` check. Ruled not fixed: p3 that the `spawn_agent` fallback may omit a model — Codex `spawn_agent` parameters unverified, and a pre-dispatch gate is machinery the plan did not ask for — parked: none
- T4 commit f77a7c7 — deviation: no separate per-task reviewer (10-line docs diff, read in full by the controller; covered by the whole-branch review) — parked: none
- review commit 8deaf4f — deviation: routing.ts toplevel strips only newlines (parity with bash on trailing-space paths, new test case); publish.sh Codex jq made non-fatal; plan skill one-shot check scoped to the desktop app — parked: https://github.com/jasonrr/forge/issues/9
