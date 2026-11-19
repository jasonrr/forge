# Clean up docs/plans

Paste everything below the line into a coding agent at the root of a repo that has a `docs/plans/` folder. It does a one-time sweep on its own branch and opens a PR for you to review. Nothing lands until you merge it.

---

Clean up this repo's `docs/plans/` folder in one pass.

Why: a plan is a work order. Once the work merges, the code, commits and PR record what was built, and a plan that review changed is stale and misleads whoever reads it next, agents included. Design rationale is worth keeping: the problem, the options, why this one, what was cut. That belongs in `docs/decisions/`.

Rules: work in a fresh worktree so my checkout is untouched. Never push to the default branch and never merge. Set it up like this:

```bash
DEF=$(gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null) || DEF=
[ -n "$DEF" ] || DEF=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|^origin/||')
git fetch origin && git worktree add -b chore/clean-up-plans "../$(basename "$PWD")-clean-up-plans" "origin/$DEF"
```

If `DEF` is still empty, or the branch or folder already exists, stop and tell me. Do everything below in the new worktree.

1. List every file under `docs/plans/`.
2. Set aside any file still in flight: one named in an open PR's diff or body (`gh pr list --state open --limit 1000 --json number,body,files`), or a plan whose work is not in the code yet. Leave these in place.
3. Read each remaining file whole and judge it by its content, not its name:
   - **Design:** any problem statement, options, chosen approach, trade-offs, rejected alternatives or evaluation results, even when tasks follow. Move the whole file to `docs/decisions/` with `git mv`, keeping its name. If that name is already taken there, leave it in place and call it Unclear.
   - **Plan:** only tasks, steps, checklists, code to copy and verify commands. Delete it with `git rm`. Git history keeps it.
   - **Unclear:** leave it in place.
4. For every file you moved or deleted, search the whole repo for its name (`git grep -n "<file name>"`), including code comments, tests, configs and other docs. Moved: update the path. Deleted: point the reference at the `docs/decisions/` file that covers the same work if one exists. Otherwise remove the pointer, and keep the surrounding text true.
5. If you changed any code or config, run the repo's tests and lint. If they fail for reasons unrelated to your change (missing dependencies or env in the fresh worktree), say so in the PR instead of fixing them.
6. `git push -u origin chore/clean-up-plans`, then open the PR. Body: a table with one row per file (`file | deleted / moved / left | one-line why`), the in-flight files you skipped, and the references you changed. Ask me to review it, and tell me the worktree's path so I can `git worktree remove` it once the PR merges.
