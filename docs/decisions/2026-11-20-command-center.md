# Forge Home as the command center

Date: 2026-11-20 · Follows `2026-11-06-forge-home.md`. Mod: `herdr/mods/forge/`. Status: draft, awaiting approval.

## Problem

Home lists only work that has a git worktree, so non-code work (the Linear Personal/Todos inbox: "Answer Sipra…", "Send F5 the run of show") cannot appear or be assigned to an agent. Home also reads as generated, not designed: every row is one line of five to seven muted mono cells led by the repo name, each lane header has its own hue, every row carries a filled button, sizes and radii have no scale, and nothing works from the keyboard. cockpit was tried and dropped: its model did not fit and its to-dos are a standalone list.

## Chosen approach

**Forge owns no list and stays stateless.** GitHub and Linear are the lists; Forge reads them and writes back to them. What is running is derived from folders and Herdr's agents. No binary, no daemon, no store beyond the existing `shared()` cache.

**The unit becomes a work item**: title, source (GitHub issue/PR, Linear issue, one-line brief), whose move it is. A code item runs in a worktree, as today. A task item runs in a plain folder named for its id (`~/.herdr/tasks/PER-198`) with an agent in a Herdr space; that folder is the "in flight" marker, as a worktree is for code.

**Lanes by whose move**: Needs you (agent blocked, PR to review, draft ready), Running, Up next, Done this week.

```
Forge                                 Search or start work  ⌘K            GitHub ok · 2m

NEEDS YOU  3
 ●  Admin UI: role editor                                               Answer ⏎
    radicalcandorai · claude is asking a question
 ◆  Answer Sipra about the Streamyard backup link                   Review draft
    Personal · draft ready
 ◆  Fix YAML parsing of skill descriptions                         Review PR #27
    forge · checks passed · 1h

RUNNING  3
 ◐  Edit report flow                                         3 of 5      PR #210
    radicalcandorai · building
 ○  Home refresh                                                          Resume
    forge · no agent · 4 commits ahead · 2h

UP NEXT  12                                              All   Code   Personal
 PER-129  Build analytical framework for Liza's two-week…   due today     Assign
 #31      Board follows focus                               forge · 2d
          10 more

DONE THIS WEEK  7  ›
```

Three steps, each shippable on its own:

1. **Redesign on today's data.** Copy the needed parts of cockpit's `ui.js` (MIT, imports only `gpui-kit`/`gpui-base`/`herdr`) into the mod with its notice: tokens, type/radius scale, `ListRow`, `SectionHeader`, `Button`, `Chip`, `Kbd`, `KeyHints`, `Skeleton`, `Empty`, icons. Two-line rows in Needs you and Running (title in the UI font, one muted sentence), dense one-line rows in Up next, colour only on the status glyph, mono only for identifiers, one action per row (filled on the selected row only), `j`/`k`/`⏎`/`a`/`o`, one health indicator in the header, empty lanes hidden, Done collapsed. Dock badge = Needs-you count (`setBadge`).
2. **Linear as a source.** Open issues assigned to me in the Personal team, in Up next beside GitHub issues, with Assign. Read with `curl` against Linear's GraphQL API through the shared cache; the personal API key lives in the macOS Keychain (`security find-generic-password`). `scripts/install-herdr-mod.sh` explains the one `security add-generic-password` line.
3. **Task runs.** Assign opens the task folder's space with `/forge:start PER-198`; `start` gains a "task" route: do or draft the work, post the result as a comment on the Linear issue, move it to a review status, stop. Home shows it under Needs you as "draft ready" (Linear status) with the comment a click away; approving marks it Done in Linear and removes the folder.

Step 1 as planned (`docs/plans/2026-11-20-command-center.md`) differs from the mockup in four ways: the second lane is titled "In progress" (it also holds tracks with no agent); the header has no search box (Home has no search today; a palette is new scope); the `a` key waits for step 2 (until Linear it equals Enter); the health indicator shows only when a source failed, never "ok · 2m". The per-repo Backlog section stays on Home, restyled.

## Cut and why

- **Forking cockpit.** ~17,500 lines plus a compiled hub over TCP; the hub's model is what did not fit. Only its UI kit is taken.
- **A Forge to-do list, manual ordering, snooze.** Each would be state with no home in a source. Order comes from Linear priority and due date.
- **Mail, calendar, meetings.** Not agentic work to assign; nothing breaks without them.
- **Kanban columns.** Home lives in panes of any width; stacked lanes hold up, columns do not.
- **Timers like "waiting 4m".** Nothing records when an agent became blocked. Shown only where a source has the time (PR, issue, commit).

## What stateless costs (accepted)

- Badge, notifications and cache warming run only while a Forge view is open somewhere.
- Changes arrive by polling (about 60 s), never pushed.
- No history: no "what changed since this morning", no time-in-lane.
- Every state must live in a source, so Forge writes labels, statuses and comments into Linear and GitHub.
- Revisit if notifications are wanted with no Forge view open, or history becomes a real need.

## Linear mapping (Personal team, existing statuses and labels; nothing new is created)

| Linear | Home |
|---|---|
| Todo | Up next. `prepared` shows as a chip: Val's prep is attached, the task is still mine. |
| In Progress, or label `agent` | Running. Label `agent` without a Herdr space reads "hermes". |
| In Review, or label `needs-review` | Needs you ("draft ready" / "decide"). |
| label `blocked` | stays in its lane with a "blocked" chip (waiting on someone else, not on me). |
| Done (last 7 days) | Done this week. |
| Triage, Snoozed, Backlog, Canceled, Duplicate | not shown. |

A Forge task run moves the issue to In Progress on Assign and to In Review when its draft is posted.

Assign on Home always runs the agent in a Herdr space (decided 2026-11-20). Forge never adds the `agent` label; it only displays items hermes picked up through it.

## Open questions

None.

## Deviations

- T1 commit 1ef1211 — deviation: none (review was a mechanical verbatim diff against cockpit's ui.js and icons, no reviewer subagent) — parked: none
- T2 commit ab47d23 — deviation: none (review p3, not fixed: a merged track's row key changes from worktree path to PR url when its worktree is removed, so the selection falls back to the first row — acceptable after a deliberate removal) — parked: none
- T3 commit f9d7209 + c3eb950 — deviation: review fix c3eb950: hereErr counts in Home's errors only while its backlog is shown (a stale one showed a permanent warning and would freeze T5's badge). Not fixed (p3): an empty lane reads 'A source failed' when any unrelated source failed — cautious, not wrong state — parked: none
- T4 commit e7e959d + 76bdc1a + f028790 — deviation: 76bdc1a re-indents homeView/renderHome (T3 pasted the plan's code 3 spaces deep) and puts each comment above its method; review fix f028790: the delayed initial focus is skipped when a terminal holds focus (a Home restored in a background tab must not take the keys). Refuted: Enter double-firing via a focused Button (ui.js Button has no track_focus). Not fixed (p3): the ⏎ hint shows while Home lacks focus (known limit on the checklist) — parked: none
- T5 commit 7ece9b6 — deviation: none (reviewed inline by the controller, ~15 lines; accepted per the design's invariant: while any source fails the badge keeps its last count, so a long-unreachable machine leaves it stale) — parked: none
- T6 commit 68444ac — deviation: run by the controller, not a subagent (an interactive screenshot loop). Wide and half-width shots rendered with no error card: sentence-case lanes with counts, two-line rows, dense backlog rows, Done folded, key-hint footer; titles truncate and buttons stay in the pane. Symlink restored to the main checkout. Cosmetic, not fixed: the Backlog header count reads 500 for a repo with more open issues (gh's list limit) — parked: none
- review commit d3ab380 — deviation: a Refresh pressed mid-refresh now runs right after it (the spinner made the plan's 'next tick' wait visible); held keys never repeat Enter/o/r — parked: https://github.com/jasonrr/forge/issues/48 https://github.com/jasonrr/forge/issues/49
