# Herdr work panel

Visual spec: https://claude.ai/artifact/4vN2FyMJkp81W5LjNzgLB4 (five artboards: work board, track detail, docked sidebar, start-work dialog, backlog; the sticky notes on the canvas are part of this design). Colours there are Herdr's live `theme()` tokens; the mod reads them at render, never hardcodes.

## Problem

Forge's artifacts (designs in `docs/decisions`, plans in `docs/plans`, the draft PR whose checklist is the ledger, the issues agents park as out of scope) are spread over files, `gh` and agent tabs. Nothing shows the state of a piece of work, what it is waiting on, or what to do next. The throwaway mod at `~/.config/herdr-app/mods/forge/` (list + markdown reader, 2026-11-01) proves the data is reachable but shows artifacts, not work. The user wants one panel: work in flight and on hold at a glance, the reason each thing is stuck, one obvious next action, and issues as the intake — harness-agnostic (no Claude-specific affordances).

## Chosen approach

**A track is a worktree.** Starting work always creates `~/.herdr/worktrees/<repo>/<type>-<slug>` on branch `<type>/<slug>`; a track exists exactly as long as its worktree does. Everything else is read off it: `docs/decisions/<slug>.md` and `docs/plans/<slug>.md` on that branch, the PR for that branch (`gh pr list --head`; its checklist = task progress), the issues linked from the PR body or design.

**No stored state.** The panel is a pure function of: `git worktree list` + the docs on each branch; `gh` (PRs with checklist, open issues); and the host's agents (`agents()` / `panes()` — status working | blocked | idle | done, joined to a track by the agent's `cwd` under the worktree). Stage = which artifacts exist (Idea → Design → Plan → Build → Review → Merged). Group: agent `blocked` or PR ready-for-review → **Needs you**; agent `working` → **In flight**; no agent on it → **On hold** (the card shows the age; no threshold); PR merged → **Done**. Re-render on `watchFolder` of the main checkout's `docs/`, a `gh` poll (≈60 s), and Herdr's own agent/pane change events. Every write (start, shelve, answer, edit a file) is done by an agent in a tab or by the person in the reader, never by the panel bookkeeping.

**Four views, one mod** (`mods/forge/`, branching on `props()`): docked sidebar (default, `place: right`, 340 px; four groups, one line per track, stage pips, reason; footer "View backlog"); work board (a tab-sized pane: cards with stage pills, artifact chips — missing ones dashed — task progress, agent line, primary action, secondary Shelve); track detail (tabs Design | Plan | PR | Issues; markdown read + edit saved to the worktree file with `writeTextFile(path, text, expected)`; a stale save (an agent rewrote the file meanwhile) is 3-way merged with `git merge-file` (base = `expected`, ours = the edit, theirs = disk) and saved; only if conflict markers remain does the panel open an agent tab in that worktree to resolve them — never a refusal, never panel-side merge logic; plan tab shows each task's ledger state — checkbox, commit, deviation — and a paused build's question inline; right rail: waiting on, next, agents on this track, activity); backlog (dense list sized for hundreds: `#`, kind tag only when the issue carries a `bug`/`feature`/`question` label, title + excerpt, parked-from, by, age, Start; "Shelved work" strip on top for issues with a branch waiting; chips Bugs / Features / Parked by agents / Yours; paged). Backlog never renders inline on the board or sidebar — only behind "View backlog".

**GitHub is one click from everything it summarises.** Every PR and issue reference is a link with `↗` (`exec("open", [url])`). The panel caches summaries; the full view is always GitHub.

**Start work** (dialog, from the board/sidebar `+` or a backlog row): *From an issue* (searchable open issues; ones already in a track greyed with "open it instead"; preview; link to GitHub) or *From scratch* (one line that becomes the slug; optional context; default-on "also open an issue"). Either way: create the worktree, open an agent tab there (`tab.new {argv: knownAgents default, task}`), and hand the agent the issue. **`/forge:start <issue | brief>` is the single entry point and the agent decides how to begin** by reading what it is given — labels are a hint, never the rule: a bug → `/forge:debug`; a feature → `/forge:brainstorm`; a branch that already holds a design → `/forge:plan`; a plan → `/forge:build`. The dialog carries no "how to start" state, and the panel has no other begin verb.

**Shelve is the inverse of Start** — `/forge:shelve`, run by an agent in the track's tab: write where it stopped (stage, tasks done, open question, branch) to the linked issue, else a new issue labelled `shelved`; close the draft PR unmerged; `git worktree remove`; keep the branch. The track leaves the board because its worktree is gone; the issue appears in the backlog's "Shelved work" strip; `/forge:start` on it later sees the branch and resumes.

**Where it ships.** `herdr/mods/forge/` in this repo (the mod is part of forge, versioned with the skills), plus `scripts/install-herdr-mod.sh` that symlinks it into `~/.config/herdr-app/mods/forge`. `herdr-app check` is the mod's test; run it in `scripts/publish.sh` when Herdr is installed.

## Cut and why

- **Attach an issue to an existing track** — marginal; the detail's Issues tab "+ Link an issue" covers it, and the agent can link in the PR body.
- **Stored "shelved" / "on hold" flags, a state file, a state machine** — everything is derivable (see above); a second copy of state would drift.
- **Rendering the backlog on the board or sidebar** — hundreds of rows; it is a view, not a section.
- **Choosing brainstorm vs debug vs resume in the UI** — the agent has the issue and the branch; the UI would be maintaining state it cannot verify.
- **Remote machines** — `exec … on` works for the list; the worktree/agent join is local-only in v1.
- **Claude-specific anything** — actions are "Start", "Shelve", "Answer", "Review", "an agent tab"; the agent comes from `knownAgents()`.

## Open questions

None deferred. Resolved while drafting: On hold has no day threshold (no agent = on hold); issue kind is shown from labels only and never used to decide; reader edits merge stale saves with `git merge-file` and hand true overlaps to an agent tab; `/forge:start` is the only entry point and routes by reading, replacing the old mod's "+ Brainstorm".
