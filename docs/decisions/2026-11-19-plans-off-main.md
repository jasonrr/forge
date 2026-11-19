# plans-off-main

## Problem

Plan files (`docs/plans/*.md`) reach `main` with every PR and are never updated after review changes the work. Code, commits and the PR already record what was built, so a merged plan only goes stale, and agents that grep `docs/plans/` take stale plans as current. Repos that used forge (and the superpowers loop before it) have piled them up: radicalcandorai 88, rc-data-tools 55, bot_service 22. Many of the older ones are design docs from before the design/plan split, and code points at some of them.

## Chosen approach

1. **review-branch removes the plan at the end of review.** After the consolidated fix pass and the Deviations bullets, and before it offers mark ready / merge / leave: `git rm docs/plans/<plan-file>`, commit `plan: remove <slug> plan (not kept on main)`, push. Merges done in the GitHub UI are covered too. The decision file (with Deviations) and `docs/learnings.md` stay as the durable record.
2. **/forge:start routing:** an open PR on the branch that isn't a draft, or is a draft with every `T<n>` box ticked, routes to `/forge:review-branch` whether or not a plan file is on the branch. Today that rule requires a plan, so a reviewed branch would fall through to `/forge:plan`.
3. **review-branch's decision-file lookup** keys off the decision file on the branch (`git diff --name-only origin/main...HEAD -- docs/decisions`), not the plan's basename, so re-running review after the plan is gone still works.
4. **Delete forge's own five merged plans.** Every one of them has a decision file.
5. **Cleanup prompt:** `prompts/clean-up-plans.md`, linked from the README. Copy-paste into an agent in any repo. It says to work on a branch and open a PR for review, and to leave in-flight plans alone (open PR, unmerged branch, uncommitted). Each file goes one of three ways: a pure task list is deleted (git history keeps it), a design/evaluation/rationale doc (or a mixed one) moves whole to `docs/decisions/` keeping its name, and anything unclear is left in place and listed. It then rewrites every reference to a moved or deleted file in code and docs, and puts a table (file → action → why) in the PR body. Using it is optional for other people.
6. Release as `minor`, since it changes the contract for what lands on main.

## Cut and why

- **Herdr panel changes.** The action button already decides by PR first. After review the panel loses task titles for that track, but the PR checklist still shows them. Nothing breaks.
- **/forge:shelve changes.** Its stage detection checks the PR before the plan. A resumed shelf of a reviewed branch is handled in /forge:start instead: design plus non-doc changes but no plan → reopen the PR → review.
- **A forge command or script for the sweep.** Every repo's files are a different mix and need judgment, so a prompt is enough.
- **Rewriting checklist links after the fact.** Build pins them to the commit that added the plan (`blob/<sha>/`), so they keep working after removal and merge.
- **Renaming `docs/decisions/`.** It's churn with nothing broken.

## Open questions

None.

## Deviations

- T1 commit a01df47 — deviation: implemented in-session, not by a dispatched subagent; the edits were exact replacements the plan spelled out, so per-task review was folded into review-branch — parked: none
- T2 commit c5b8d3c — deviation: same in-session note as T1 — parked: none
- T3 commit ab37492 — deviation: the prompt's last step tells the user the worktree path to remove after merge, instead of telling the agent to remove it once merged (the agent is gone by then) — parked: none
- T4 commit 87f9dc4 — deviation: none — parked: none
