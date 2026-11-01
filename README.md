# Forge

A code factory for coding agents. One request in, a reviewed PR out:

1. `/forge:brainstorm` — explore, cut scope, land an approved design in `docs/decisions/`.
2. `/forge:plan` — turn it into a plan a zero-context agent can run (`docs/plans/`), then dispatch the build into its own worktree (Herdr app, herdr, or `EnterWorktree`).
3. `/forge:build` — task by task with fresh subagents, TDD, per-task review. The ledger is a draft PR checklist.
4. `/forge:review-branch` — adversarial whole-branch review; p1s fixed on the PR, p2/p3 become issues.

Also `/forge:debug` (root cause first) and `/forge:setup` (consent-gated session routing + reviewer lenses, written to `.claude/dev-loop.md`).

State lives in git and GitHub only. Requires `gh` logged in and a GitHub remote.

## Install

Claude Code:

    claude plugin marketplace add jasonrr/forge
    claude plugin install forge@forge

pi: `pi install git:github.com/jasonrr/forge`.

## Coming from tally ≤ 0.2.x

The dev-loop skills used to ship inside the [tally](https://github.com/jasonrr/herdr-tally) plugin as `/tally:*`. They are the same skills, store-free. Your `.claude/tally-dev-loop.md` keeps working; `/forge:setup` offers to rename it. If you still have `learnings`-tagged tally scratchpads, copy their bullets into `docs/learnings.md` once — Forge reads only the file.

MIT.
