---
name: start
description: The one way to begin work — on an issue (`/forge:start #42`) or a one-line brief. Reads what it is given and routes to /forge:debug, /forge:brainstorm, /forge:plan or /forge:build; resumes a shelved branch. Used by the Herdr work panel's Start work; also fine from a shell.
---

# Start

You are the router. The person (or the Herdr forge panel) gave you an issue number, an issue URL, or a brief. Decide how to begin by **reading**, then hand off to exactly one loop skill. Nothing here maintains state: the branch and the repo say where the work is.

## Where you are

`ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`; `HERE=$(git rev-parse --show-toplevel)`.

- **`HERE` ≠ `ROOT`** — you are in a worktree (the panel put you here, or it is a build worktree under `.claude/worktrees/`). Work in place, whatever the branch is called. Never make another.
- **`HERE` = `ROOT`** (you were run in the main checkout): make the track's worktree first, then go on **inside it**. The branch, exactly as the panel computes it (`herdr/mods/forge/model.js` `branchFor`): a shelved issue's body names it (`Branch: \`…\``) — use that if it matches `^[A-Za-z0-9][A-Za-z0-9._/-]*$`; else `fix/<slug>` when the issue carries the `bug` label, else `feat/<slug>`, where slug = title (or brief) lower-cased, every run of characters outside `a-z0-9` → `-`, leading/trailing `-` removed, cut to 40 characters, trailing `-` removed again. Path: `P="$HOME/.herdr/worktrees/$(basename "$ROOT")/<branch with / replaced by ->"`. `git -C "$ROOT" fetch -q origin main`. If `git -C "$ROOT" show-ref --verify --quiet refs/heads/<branch>`: `git -C "$ROOT" worktree add "$P" <branch>`; else `git -C "$ROOT" worktree add --no-track -b <branch> "$P" origin/main`. If `$P` exists already, stop and say so. Then, in the Herdr desktop app (`$HC_TERMINAL_ID` set): `herdr-app do space.new --folder "$P" --argv '<argv>' --task "/forge:start <what you were given, verbatim>"` and stop — the new space's agent takes it from here. `<argv>` is your own CLI, no model flag: your kind from `hc ls --json | jq -r --arg t "$HC_TERMINAL_ID" '.terminals[] | select(.address==$t) | .agent'` → **claude-code** `["claude"]`, **pi** `["pi","--provider","$PI_PROVIDER","--model","$PI_MODEL"]` (both non-empty), **codex** `["codex","--no-daemon"]`, anything else: do not dispatch; `cd "$P"` and continue below. In herdr (`HERDR_ENV=1`, no `$HC_TERMINAL_ID`): `herdr worktree create --cwd "$ROOT" --branch <branch>` in place of the git commands, then start your own kind in its root pane and prompt it with the same `/forge:start` line exactly as /forge:plan's **Dispatch** bullet does (`herdr agent get`, `herdr agent start build-<slug> --kind <kind> --pane <pane-id>` with the per-kind tail, `herdr agent prompt`), and stop. Plain Claude Code: `cd "$P"` (every later command runs there) and continue below.

## Read, then route

1. If given a number or URL: `gh issue view <n> --json number,title,body,labels,url,comments`. Read it whole, including comments. Labels are a hint only; the text decides.
2. Look at the branch: `git diff --name-only origin/main...HEAD -- docs/decisions docs/plans; git ls-files --others --exclude-standard docs/decisions docs/plans`.
3. Route — the first that applies:
   - A plan file is on the branch and its open PR (`gh pr list --head "$(git branch --show-current)" --state open --json number,body,isDraft`) is not a draft, or is a draft with every `- [ ] T` box ticked → `/forge:review-branch`.
   - A plan file is on the branch (no PR, or a draft PR with an unticked box) → `/forge:build docs/plans/<file>`.
   - A design file is on the branch, no plan → `/forge:plan` (name the design file).
   - The issue is a shelved track (title starts `Shelved:` or it carries the `shelved` label): its body says the stage and what stopped it. Tell the person in two lines what you found and which skill you are resuming with, then do the route above for the artifacts on the branch; if the branch has none, treat the body as the brief.
   - The text describes something that is broken — an error, a wrong result, a failing test, "used to work" — → `/forge:debug` with the issue as the report.
   - Otherwise → `/forge:brainstorm` with the issue or brief as the request.
Before any route: if the brief said to also open an issue, do that first — `gh issue create --title '<brief, one line, no quote characters>' --body-file -` with a quoted `<<'EOF'` heredoc holding the brief and `Started from the Herdr forge panel on branch <branch>.` And when resuming a shelved issue, `gh issue edit <n> --remove-label shelved` so the backlog's shelved strip stops offering it.
4. Say the route in one line ("#42 reads as a bug → /forge:debug") and run that skill. Do not ask which; if the text is genuinely both, debug first — a fix that turns out to need a design exits into /forge:plan on its own.

## Never

- Pick by label alone. Open a second worktree for the same slug. Write any state file. Decide in the UI's place — this skill is the decision.
