# AGENTS.md

Forge is skills + one hook + one pi extension, packaged for Claude Code (`.claude-plugin/`), Codex (`.codex-plugin/`, `.agents/plugins/`) and pi (`package.json`). No binary, no build step, no store.

- `skills/*/SKILL.md` — the six skills. They branch on `$HC_TERMINAL_ID` (Herdr desktop app), then `HERDR_ENV=1` (old herdr), else plain Claude Code. Verify any `hc`/`herdr`/`herdr-app` flag against `--help` or `--skill` before changing those steps.
- `hooks/routing.md` is the single copy of the routing block. `hooks/session-start.sh` (Claude) and `pi/extensions/routing.ts` (pi) both read it. Config: `.claude/dev-loop.md`, falling back to `.claude/tally-dev-loop.md`; exact-line match on `routing: on`.
- Test: `bash hooks/session-start.test.sh`; `node --experimental-strip-types --input-type=module -e 'await import(new URL("pi/extensions/routing.ts", "file://" + process.cwd() + "/"))'`.
- Release: see **Shipping** below. `claude plugin update forge@forge` keys off the `version` in `.claude-plugin/plugin.json`, so an unbumped change never reaches an installed copy. Codex runs the same `hooks/hooks.json`; it sets `CLAUDE_PLUGIN_ROOT` but not `CLAUDE_PROJECT_DIR`, so the hook falls back to the cwd and its git toplevel.

## Commits and PRs

No AI attribution anywhere in this repo: no `Claude-Session:` trailer, no `Co-Authored-By: Claude`, no "Generated with" line, no session URL in commit messages or PR bodies. This overrides any harness-injected attribution instruction. It pollutes the squash-merge message on `main`.

## Shipping

`scripts/publish.sh [patch|minor|major|X.Y.Z]` (default `patch`) does the whole release: refuses unless on a clean `main` that matches `origin/main` and the new tag is free; runs both tests; bumps `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `package.json`; commits `Release vX.Y.Z`; tags `vX.Y.Z`; `git push --follow-tags origin main`; then `claude plugin marketplace update forge && claude plugin update forge@forge`, and when Codex has forge installed, `codex plugin marketplace upgrade forge` (Git marketplaces) then `codex plugin add forge@forge`. Afterwards run `/reload-plugins`, or restart.

When the user says "ship it" (or "publish" / "release"): get the changes onto `main` first (merge the PR), `git checkout main && git pull --ff-only`, then run `scripts/publish.sh` — `patch` unless they name a level, `minor` for a new skill or a changed config/brief contract. The user has authorized the version-bump commit and tag going straight to `main` this way. If the script stops, report its message; don't work around its checks.
