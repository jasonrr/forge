# Plan: Keep plans off main

- **Goal:** plan files stop landing on `main` because review-branch removes them at the end of review. Ship a copy-paste prompt that cleans up existing `docs/plans/` folders in other repos.
- **Design:** `docs/decisions/2026-11-19-plans-off-main.md`. Read it first.
- **Branch:** `chore/plans-off-main`
- **Whole-feature verify:** `bash hooks/session-start.test.sh && node --experimental-strip-types --input-type=module -e 'await import(new URL("pi/extensions/routing.ts", "file://" + process.cwd() + "/"))' && node --test herdr/mods/forge/model.test.js && ! grep -n "so they reach" skills/plan/SKILL.md`
- **Release** (`minor`) is a separate "ship it" step, not a task here.

## Context every task needs

- Skills are prose in `skills/*/SKILL.md`, read by agents, with no build step. Edit by exact string replacement, keep each skill's existing voice (imperative, inline code for commands), and add no new sections beyond what a task says.
- Where state lives today: build commits the plan and design as its first commit, then opens a draft PR whose checklist links to `#task-n` anchors in the plan (`skills/build/SKILL.md:14-20`). review-branch's Gate writes Learnings and Deviations, commits, then offers mark ready / merge / leave (`skills/review-branch/SKILL.md:41-49`). /forge:start routes on which docs are on the branch (`skills/start/SKILL.md:27-33`).
- The Herdr panel (`herdr/mods/forge/model.js` `nextLabel`) already decides by PR before docs. Leave it unchanged.
- This plan is untracked on `main` until build's first commit adds it. The verify counts below assume that commit exists.

## Task 1
**review-branch removes the plan; checklist links survive it; plan skill stops promising plans reach main**

- **Exists because:** without it, every plan still lands on `main` and goes stale. Without the link change, the open PR's checklist links 404 right when the human decides whether to merge.
- **Model:** sonnet
- **Files:** `skills/review-branch/SKILL.md`, `skills/build/SKILL.md`, `skills/plan/SKILL.md`
- **Steps:**
  1. `skills/review-branch/SKILL.md`, Gate step 2 (**Decisions.**): replace the parenthetical `(same basename as the \`docs/plans/*-<slug>.md\` file in this branch, never today's date)` with `(the one this branch adds — \`git diff --name-only origin/main...HEAD -- docs/decisions\` — never one named with today's date; if that lists none, the no-decisions-file rule at the end of this step applies)`.
  2. Same file: the Gate list has steps 1, 2 and 3 (step 3 is `Commit the changed files with explicit paths and push to the PR branch.`). Insert a new step 3 after step 2, and replace the old step 3 with step 4, so the list ends:
     `3. **Remove the plan.** It was the build's work order. The code, commits, PR and decisions file are the record, so it does not go to \`main\`. If \`git diff --name-only origin/main...HEAD -- docs/plans\` names a file (the branch's plan), \`git rm\` it. If it names nothing (a re-run, or a branch with no plan), skip this step. Leave every other file in \`docs/plans/\` alone.`
     `4. Commit the changed and removed files with explicit paths (\`plan: remove <slug> plan (not kept on main)\` when the commit is only the removal) and push to the PR branch.`
  3. `skills/build/SKILL.md`, in the bash block of the **First commit, then the draft PR** paragraph: change `PLAN=docs/plans/<plan-file>; BODY=$(mktemp)` to `PLAN=docs/plans/<plan-file>; SHA=$(git log -1 --format=%H -- "$PLAN"); BODY=$(mktemp)`, and change `($BASE/blob/$BR/$PLAN#task-$n)` to `($BASE/blob/$SHA/$PLAN#task-$n)`. If `BR` is then unused anywhere else in that block, remove `BR=$(git branch --show-current); `. In the sentence after the block, add: `The links pin the commit that added the plan, so they keep working after review removes it.`
  4. `skills/plan/SKILL.md` line 14: replace `/forge:build commits this file and the design file as its first commit in the worktree, so they reach \`main\` with the PR.` with `/forge:build commits this file and the design file as its first commit in the worktree; the design reaches \`main\` with the PR, and /forge:review-branch removes the plan before merge.`
- **Verify:** `grep -n "Remove the plan" skills/review-branch/SKILL.md && grep -n "removes the plan before merge" skills/plan/SKILL.md && grep -n 'blob/\$SHA/' skills/build/SKILL.md && ! grep -n "same basename as the" skills/review-branch/SKILL.md && ! grep -n 'blob/\$BR/' skills/build/SKILL.md`

## Task 2
**/forge:start routes a reviewed branch to review, plan or no plan**

- **Exists because:** once the plan is removed, start's review rule (which requires a plan on the branch) falls through to "design, no plan → /forge:plan" and would re-plan finished work. The same happens when a shelved reviewed branch is resumed.
- **Model:** sonnet
- **Files:** `skills/start/SKILL.md`
- **Steps:**
  1. Replace the bullet that starts `   - A plan file is on the branch and its open PR` with:
     `   - The branch has an open PR (\`gh pr list --head "$(git branch --show-current)" --state open --json number,body,isDraft\`) that is not a draft, or is a draft with at least one \`T<n>\` box and every one \`[x]\` → \`/forge:review-branch\`. This holds with or without a plan file, because review-branch removes the plan at its end.`
  2. Leave the next bullet (`A plan file is on the branch (no PR, or a draft PR with an unticked box)`) unchanged.
  3. Replace the bullet `   - A design file is on the branch, no plan → \`/forge:plan\` (name the design file).` with two bullets:
     `   - A design file is on the branch, no plan, and the branch changes files outside \`docs/\` (\`git diff --name-only origin/main...HEAD -- . ':!docs'\` is non-empty) → the build already ran and review removed the plan. Reopen the branch's closed PR if there is one (\`gh pr list --head "$(git branch --show-current)" --state closed --json number -q '.[0].number'\`, then \`gh pr reopen <n>\`), then \`/forge:review-branch\`.`
     `   - A design file is on the branch, no plan → \`/forge:plan\` (name the design file).`
- **Verify:** `grep -n "with or without a plan file" skills/start/SKILL.md && grep -c "A plan file is on the branch (no PR" skills/start/SKILL.md && grep -n "review removed the plan" skills/start/SKILL.md`

## Task 3
**Cleanup prompt for other repos, README and plugin descriptions**

- **Exists because:** repos that already have dozens of merged plans keep misleading agents until someone sweeps them. Each repo's files are a different mix, so the sweep needs an agent's judgment, not a script. The plugin descriptions say "Designs and plans are committed files", which would be stale.
- **Model:** haiku (transcribe exactly)
- **Files:** new `prompts/clean-up-plans.md`, `README.md`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`
- **Steps:**
  1. Create `prompts/clean-up-plans.md` with exactly the content between the `~~~` fences below. Strip only the two outer fence lines, and end the file with a newline.
  2. In `README.md`, replace the step 2 line's `(\`docs/plans/\`)` with `(\`docs/plans/\`; review removes it before merge, so only the design in \`docs/decisions/\` reaches \`main\`)`.
  3. In `README.md`, insert this paragraph right before `## Install`, with a blank line on each side:
     `**Old plans in other repos:** \`main\` now keeps only designs. To sweep a repo's existing \`docs/plans/\`, paste [prompts/clean-up-plans.md](prompts/clean-up-plans.md) into an agent there. It opens a PR you review; using it is optional.`
  4. In both `.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`, in the `description` value, replace `Designs and plans are committed files` with `Designs are committed files`. Change nothing else, and in particular not `version`.

~~~
# Clean up docs/plans

Paste everything below the line into a coding agent at the root of a repo that has a `docs/plans/` folder. It does a one-time sweep on its own branch and opens a PR for you to review. Nothing lands until you merge it.

---

Clean up this repo's `docs/plans/` folder in one pass.

Why: a plan is a work order. Once the work merges, the code, commits and PR record what was built, and a plan that review changed is stale and misleads whoever reads it next, agents included. Design rationale is worth keeping: the problem, the options, why this one, what was cut. That belongs in `docs/decisions/`.

Rules: work in a fresh worktree so my checkout is untouched. Find the default branch with `DEF=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name)`, then `git fetch origin && git worktree add -b chore/clean-up-plans ../$(basename "$PWD")-clean-up-plans "origin/$DEF"`, and do everything below there. Never push to the default branch and never merge.

1. List every file under `docs/plans/`.
2. Set aside any file still in flight: one named in an open PR's diff or body (`gh pr list --state open --limit 1000 --json number,body,files`), or a plan whose work is not in the code yet. Leave these in place.
3. Read each remaining file whole and judge it by its content, not its name:
   - **Plan:** mostly tasks, steps, checklists, code to copy, verify commands. Delete it with `git rm`, even when `docs/decisions/` already has a file with the same name (that is its design). Git history keeps it.
   - **Design:** problem, options, chosen approach, trade-offs, rejected alternatives, evaluation results, or a mix of design and plan. Move the whole file to `docs/decisions/` with `git mv`, keeping its name. If that name is already taken there, leave it in place and call it Unclear.
   - **Unclear:** leave it in place.
4. For every file you moved or deleted, search the whole repo for its name (`git grep -n "<file name>"`), including code comments, tests, configs and other docs. Moved: update the path. Deleted: point the reference at the `docs/decisions/` file that covers the same work if one exists. Otherwise remove the pointer, and keep the surrounding text true.
5. If `docs/plans/` ends up empty, let it go. Add no README or index in its place.
6. If you changed any code or config, run the repo's tests and lint, and fix what you broke.
7. Push the branch and open the PR. Body: a table with one row per file (`file | deleted / moved / left | one-line why`), the in-flight files you skipped, and the references you changed. Ask me to review it. Once it merges, remove the worktree with `git worktree remove`.
~~~

- **Verify:** `test -f prompts/clean-up-plans.md && grep -n "clean-up-plans.md" README.md && grep -c "git mv" prompts/clean-up-plans.md && ! grep -n "Designs and plans" .claude-plugin/plugin.json .codex-plugin/plugin.json && node -e 'JSON.parse(require("fs").readFileSync(".claude-plugin/plugin.json"));JSON.parse(require("fs").readFileSync(".codex-plugin/plugin.json"))'`

## Task 4
**Delete forge's own merged plans**

- **Exists because:** the five merged plans in this repo are already stale. Each has a decisions file, so nothing is lost.
- **Model:** haiku
- **Files:** `docs/plans/2026-11-01-forge-owned-guidance.md`, `docs/plans/2026-11-02-herdr-work-panel.md`, `docs/plans/2026-11-02-support-connected-machines.md`, `docs/plans/2026-11-02-work-panel-live-state.md`, `docs/plans/2026-11-06-forge-home.md`
- **Steps:** `git rm` those five files, by name. Do not remove `docs/plans/2026-11-19-plans-off-main.md` (this plan). Review removes it at the end. Then `git grep -n "docs/plans/2026-11-0"` and fix any reference outside `docs/plans/` that now points at a deleted file. Expect none outside `herdr/mods/forge/model.test.js`, whose paths are test fixtures and must stay unchanged.
- **Verify:** `test "$(git ls-files docs/plans | wc -l | tr -d ' ')" = 1 && node --test herdr/mods/forge/model.test.js`
