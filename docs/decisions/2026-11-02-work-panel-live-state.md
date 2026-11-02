# Work panel: live agent state, collapse rail, Done as merged PRs

Date: 2026-11-02 · Follow-up to `2026-11-02-herdr-work-panel.md` (PR #11). Mod: `herdr/mods/forge/`.

## Problem

1. **No way to hide the panel.** It is docked as its own layout block at the window edge. The Files/Changes/Automations buttons live in `tabs-plus`, which is not Herdr's: the Automations mod ships a forked tab bar plus a `main-plus` layout to get its button. We will not fork the tab bar.
2. **State is derived from docs, so it does not move.** The card's stage (Idea → Design → Plan → Build → Review → Merged) comes from which docs and PR exist. A fix started from an issue sat at "Idea" until its PR appeared, though an agent was working the whole time. Feature tracks are only slightly better: nothing changes between "plan exists" and "PR opened".
3. **Done empties itself.** A track is a worktree; removing the worktree after merge drops the track, so Done is almost always empty.

## Chosen approach

**Collapse.** A `‹` button in the sidebar header runs `layout.resize` on the mod's own block (found via `layout()`: the block whose `content.mod` is `forge`) to 44px, saving the expanded width in `setShared("forge.width")` (the pattern `workspace-chrome` uses for `sidebar.width`). Collapsed is "block narrower than 100px" from `on_size_change`, no stored flag. The rail draws `›`, the Needs-you count (blocked color) and the In-flight count (accent); clicking anywhere on it restores `shared("forge.width") ?? 340`. Board, backlog and detail views are unaffected.

**Live state.** The four groups stay as-is (`group()` is already agent/PR driven). Remove `STAGES`, `stage()`, `pips()`, the stage chip and the stage-indexed `reason()`. The card's primary line:
- an agent present → `● <status> · <message>`, the message from `hc get <address>` (`.status.msg`; `agents()` has no message field) fetched for agents on tracks only, every 5s on the existing `relocate` timer, cached per address;
- no agent → `○ no agent · <n> commits ahead · <pr state or "no PR"> · <age>`; `n` from `git rev-list --count <base>..HEAD` per worktree in `refresh`.
Facts chips stay (design, plan, PR, issues) and the plan checklist bar stays. `next()` keeps its labels but picks them from facts (`!design → Start`, `!plan → Plan`, `!pr → Build`, `pr.isDraft → Resume`, else `Review`); merged → Remove worktree as today. Shelve shows when the PR is not merged.

**Done = merged PRs, 7 days.** From the PR list already fetched (`--state all` includes `mergedAt`): PRs with `mergedAt` within `7 * 86400 * 1000` ms. A merged PR whose worktree remains is the existing track (keeps Remove worktree); otherwise a worktree-less item with title, `#n`, branch, `merged <ago>`, PR link, no actions. Dedupe by PR number; sort by `mergedAt` desc. Group header reads `DONE · 7 days`.

## Cut and why

- Key binding / palette command for the toggle: the chevron covers it. Add when a mouse-free toggle is missed.
- Forking `tabs-plus` for a tab-bar button: permanent maintenance of someone else's mod.
- Per-track status history or "last seen": the live message answers "what is it doing"; history is the PR and git log.
- Configurable Done window: one constant.
- Keeping the stage chip alongside the message: two states on one card is the confusion we are removing.

## Open questions

None blocking. Two Herdr feedback items drafted via `herdr-app feedback` (the person reviews and sends): expose the agent's status message in `agents()` so the `hc get` poll can go; a panel registration so a mod can get a tab-bar button without forking `tabs-plus`.

## Deviations

- T1 commit 6dddd78, 8a0f27a — deviation: review fix added (an OPEN PR wins over an older MERGED one on a reused branch; the plan took the first non-closed PR in input order). Review findings on nextLabel for merged tracks and null-path ids dropped: Task 3 `next()` handles merged/PR-only items first, and ids key by PR number — parked: none
- T2 commit d0020a3 — deviation: none (review: p3s only — transient hc failure blanks msg for one tick, detail view polls all tracks, no hc timeout; accepted as plan-intended) — parked: none
- T3 commit 507b94b, 88a8540 — deviation: review fix added `chip(t)` in model.js (status chip follows the agent that decides the group: blocked/working wins over merged; the plan used `agents[0]` and let merged win). Live: board and backlog tabs verified clean; the docked sidebar copy kept the old build after the symlink repoint, and hide/show to remount it could not be confirmed (window frames stopped repainting) — human to check the panel — parked: none
- T4 commit 7621ab1 — deviation: none in code (RAIL const sits before MONO, right after GH_EVERY). Live: layout.resize to 44 and back ran clean (errors []), but the screenshot showed no docked forge panel at all, so the rail is unseen live — human to check the panel — parked: none
