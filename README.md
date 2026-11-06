# Forge

A code factory for coding agents. One request in, a reviewed PR out:

1. `/forge:brainstorm` — explore, cut scope, land an approved design in `docs/decisions/`.
2. `/forge:plan` — turn it into a plan a zero-context agent can run (`docs/plans/`), then dispatch the build into its own worktree (Herdr app, herdr, or `EnterWorktree`).
3. `/forge:build` — task by task with fresh subagents, TDD, per-task review. The ledger is a draft PR checklist.
4. `/forge:review-branch` — adversarial whole-branch review; p1s fixed on the PR, p2/p3 become issues.

Also `/forge:start` (the entry point: an issue or a brief in, the right loop skill out), `/forge:shelve` (park a track as an issue), `/forge:debug` (root cause first) and `/forge:setup` (consent-gated session routing + reviewer lenses, written to `.claude/dev-loop.md`).

State lives in git and GitHub only. Requires `gh` logged in and a GitHub remote.

## Install

Claude Code:

    claude plugin marketplace add jasonrr/forge
    claude plugin install forge@forge

pi: `pi install git:github.com/jasonrr/forge`.

Codex:

    codex plugin marketplace add jasonrr/forge
    codex plugin add forge@forge

Codex skips plugin hooks until you trust them: accept forge's SessionStart hook when Codex asks, or routing stays off.

**New machine:** Claude Code and pi reinstall forge from your settings files if they list it. Codex needs the two commands above, because its `config.toml` holds installs and hook trust. Per repo, a committed `.claude/dev-loop.md` comes back with the clone; a gitignored one doesn't, so run `/forge:setup` there again.

## Coming from tally ≤ 0.2.x

The dev-loop skills used to ship inside the [tally](https://github.com/jasonrr/herdr-tally) plugin as `/tally:*`. They are the same skills, store-free. Your `.claude/tally-dev-loop.md` keeps working; `/forge:setup` offers to rename it. If you still have `learnings`-tagged tally scratchpads, copy their bullets into `docs/learnings.md` once — Forge reads only the file.

## Herdr work panel

In the Herdr desktop app, a bundled mod shows your forge work: a **Home** tab across every repo (waiting on you, in flight including drafts on main, planned, done), a **track pane** per worktree (design / plan / PR / issues, Shelve), a per-repo **backlog**, and a **Start work** dialog. Start work and Shelve run `/forge:start` and `/forge:shelve` in an agent tab.

Install it with `bash scripts/install-herdr-mod.sh`. It symlinks `herdr/mods/forge` into `~/.config/herdr-app/mods/forge`, adds ⌘⇧H (Home), ⌘⇧N (Start work) and ⌘⇧J (track pane) to `keys.json` without replacing a binding you already have, and prints the command to hide the old docked block. To go back to the docked sidebar, run the script from a checkout of the older version, and run `herdr-app do layout.show '{"id":"<id>"}'`.

MIT.
