# Forge

A code factory for coding agents. One request in, a reviewed PR out:

1. `/forge:brainstorm` — explore, cut scope, land an approved design in `docs/decisions/`.
2. `/forge:plan` — turn it into a plan a zero-context agent can run (`docs/plans/`; review removes it before merge, so only the design in `docs/decisions/` reaches `main`), then dispatch the build into its own worktree (Herdr app, herdr, or `EnterWorktree`).
3. `/forge:build` — task by task with fresh subagents, TDD, per-task review. The ledger is a draft PR checklist.
4. `/forge:review-branch` — adversarial whole-branch review; p1s fixed on the PR, p2/p3 become issues.

Also `/forge:start` (the entry point: an issue or a brief in, the right loop skill out), `/forge:shelve` (park a track as an issue), `/forge:debug` (root cause first) and `/forge:setup` (consent-gated session routing + reviewer lenses, written to `.claude/dev-loop.md`).

State lives in git and GitHub only. Requires `gh` logged in and a GitHub remote.

**Old plans in other repos:** `main` now keeps only designs. To sweep a repo's existing `docs/plans/`, paste [prompts/clean-up-plans.md](prompts/clean-up-plans.md) into an agent there. It opens a PR you review; using it is optional.

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

Home also shows the backlog of the repo whose space it is open in. Every view paints from its last result at once and refreshes behind it. Home lists every repo behind an open space or a `~/.herdr/worktrees` entry; to keep a repo on Home with neither, add its path to `~/.config/herdr-app/forge-repos` (one per line, `#` comments, `~` allowed).

Install it with `bash scripts/install-herdr-mod.sh`. It symlinks `herdr/mods/forge` into `~/.config/herdr-app/mods/forge`, adds ⌘⇧H (Home), ⌘⇧N (Start work) and ⌘⇧J (track pane) to `keys.json` without replacing a binding you already have, and prints the command to hide the old docked block. To go back to the docked sidebar, run the script from a checkout of the older version, and run `herdr-app do layout.show '{"id":"<id>"}'`.

## Show

Inside the Herdr desktop app, Claude can draw charts, stat tiles, tables, flow and sequence diagrams, Mermaid, images, diffs, logs and markdown in a pane beside the session. It can also ask a choice or confirm question in a floating window. It uses the `mcp__forge__show` tool, and the session's own words stay short because the picture carries the answer.

It needs the Herdr desktop app, `terminal-browser`, and `fzf` for choice and confirm questions. `bash scripts/install-herdr-mod.sh` links the `forge-show` helper mod (it supplies the app theme and opens the question window) along with the work panel mod. The page loads Chart.js and Mermaid from jsdelivr, so it needs a network connection.

It is on for every Claude Code session inside the Herdr app. No `routing: on` is needed, and it does nothing outside the app.

MIT.
