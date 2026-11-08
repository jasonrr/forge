---
name: start
description: >-
  The one way to begin work — on an issue (`/forge:start #42`) or a one-line brief. Reads what it is given and routes to /forge:debug, /forge:brainstorm, /forge:plan or /forge:build; resumes a shelved branch. Used by the Herdr work panel's Start work; also fine from a shell.
---

# Start

You are the router. The person (or the Herdr forge panel) gave you an issue number, an issue URL, or a brief. Decide how to begin by **reading**, then hand off to exactly one loop skill. Nothing here maintains state: the branch and the repo say where the work is.

## Where you are

`ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`; `HERE=$(git rev-parse --show-toplevel)`.

- **`HERE` ≠ `ROOT`** — you are in a worktree (the panel put you here, or it is a build worktree under `.claude/worktrees/`). Work in place, whatever the branch is called. Never make another.
- **`HERE` = `ROOT`** (you were run in the main checkout): make the track's worktree first, then go on **inside it**.
  - **Branch**, exactly as the panel computes it (`herdr/mods/forge/model.js` `branchFor`): a **shelf** issue's body (the `shelved` label or a `Shelved:` title) names it (`Branch: \`…\``) — a `Branch:` line on any other issue is ignored; use it if it matches `^[A-Za-z0-9][A-Za-z0-9._/-]*$`; else `fix/<slug>` when the issue carries the `bug` label, else `feat/<slug>`. Slug = title (or brief) lower-cased, every run of characters outside `a-z0-9` → `-`, leading/trailing `-` removed, cut to 40 characters, trailing `-` removed again; if the slug comes out empty (e.g. a non-Latin title), use `issue-<n>` for an issue, else `work`.
  - **Path**: `P="$HOME/.herdr/worktrees/$(basename "$ROOT")/<branch with / replaced by ->"`. If `$P` exists already, stop and say so.
  - **Create** (desktop app or plain Claude Code): `git -C "$ROOT" fetch -q origin main`. If the branch did not come from a shelf issue and already exists locally, don't reuse it: take the first free `<branch>-2`, `-3`, … (up to `-9`; free = no local ref and not on `origin` per `git ls-remote --exit-code --heads origin refs/heads/<b>`, where exit 2 means absent and any other failure means stop and say so), and derive `$P` from that name; if `-2`…`-9` are all taken, stop and ask for another title. If it came from a shelf: when it exists only on `origin`, run `git -C "$ROOT" fetch -q origin <b>:<b>` first (if that fails, stop and say so); when it exists locally too, run the same fetch to fast-forward it, ignoring a refusal. Then, if `git -C "$ROOT" show-ref --verify --quiet refs/heads/<branch>`: `git -C "$ROOT" worktree add "$P" <branch>`; else `git -C "$ROOT" worktree add --no-track -b <branch> "$P" origin/main`.
  - **Hand off, Herdr desktop app** (`$HC_TERMINAL_ID` set): put the task in a variable with a quoted heredoc — `TASK=$(cat <<'EOF'` / `/forge:start <what you were given, verbatim>` / `EOF` / `)` — then `herdr-app do space.new --folder "$P" --argv '<argv>' --task "$TASK"` and stop; the new space's agent takes it from here. `<argv>` is your own CLI, no model flag: your kind from `hc ls --json | jq -r --arg t "$HC_TERMINAL_ID" '.terminals[] | select(.address==$t) | .agent'` → **claude-code** `["claude"]`, **pi** `["pi","--provider","<PI_PROVIDER>","--model","<PI_MODEL>"]` (substituting the env values, both non-empty), **codex** `["codex","--no-daemon"]`, anything else, or on a connected machine without a Herdr window (`$HC_TERMINAL_ID` set but `herdr-app status >/dev/null 2>&1` fails): do not dispatch; `cd "$P"` and continue below.
  - **Hand off, herdr** (`HERDR_ENV=1`, no `$HC_TERMINAL_ID`): instead of the git commands run `herdr worktree create --cwd "$ROOT" --branch <branch> --no-focus`; the pane id is `.result.root_pane.pane_id` of its output. Then `herdr agent start build-<slug> --kind <kind> --pane <pane-id>` — claude gets no model tail; pi gets `-- --provider "$PI_PROVIDER" --model "$PI_MODEL"` (both non-empty), as /forge:plan's **Dispatch** bullet does — then `herdr agent prompt <pane-id>` with the same `/forge:start` line, and stop. If `herdr worktree create` refuses because the branch already exists, fall back to the git commands above and continue in-session (`cd "$P"`).
  - **Plain Claude Code**: `cd "$P"` (every later command runs there) and continue below.

## Read, then route

1. If given a number or URL: `gh issue view <n> --json number,title,body,labels,url,comments`. Read it whole, including comments. Labels are a hint only; the text decides.
2. Look at the branch: `git diff --name-only origin/main...HEAD -- docs/decisions docs/plans; git ls-files --others --exclude-standard docs/decisions docs/plans`.
3. If the brief said to also open an issue, do that first — `gh issue create --title '<brief, one line, no quote characters>' --body-file -` with a quoted `<<'EOF'` heredoc holding the brief and `Started from the Herdr forge panel on branch <branch>.` Then route — the first that applies:
   - The issue is a shelved track (title starts `Shelved:` or it carries the `shelved` label): tell the person in two lines what the body says (stage, why it stopped) and that you are resuming, run `gh issue close <n> --comment "Resumed on branch <branch>."` (the work continues on the branch; the issue was only the shelf), then continue down this list for the artifacts on the branch; if none, the issue body is the brief for /forge:brainstorm. The shelf's `Done:` line names the tasks its closed PR had ticked: when this list lands on /forge:build, pass them along — `/forge:build docs/plans/<file> done: T1 T2` (omit `done:` when the line says `none`) — so the new draft PR starts with those boxes ticked instead of every task re-verified.
   - A plan file is on the branch and its open PR (`gh pr list --head "$(git branch --show-current)" --state open --json number,body,isDraft`) is not a draft, or is a draft whose every `T<n>` box is `[x]` → `/forge:review-branch`.
   - A plan file is on the branch (no PR, or a draft PR with an unticked box) → `/forge:build docs/plans/<file>`.
   - A design file is on the branch, no plan → `/forge:plan` (name the design file).
   - The text describes something that is broken — an error, a wrong result, a failing test, "used to work" — → `/forge:debug` with the issue as the report.
   - Otherwise → `/forge:brainstorm` with the issue or brief as the request.
4. Say the route in one line ("#42 reads as a bug → /forge:debug") and run that skill. Do not ask which; if the text is genuinely both, debug first — a fix that turns out to need a design exits into /forge:plan on its own.

## Never

- Pick by label alone. Open a second worktree for the same slug. Write any state file. Decide in the UI's place — this skill is the decision.
