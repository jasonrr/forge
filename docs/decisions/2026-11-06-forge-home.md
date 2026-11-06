# Forge Home + track panes

Date: 2026-11-06 · Experiment on its own branch; the docked-sidebar version stays on `main` to revert to. Follows `2026-11-02-herdr-work-panel.md` and `2026-11-02-work-panel-live-state.md`. Mod: `herdr/mods/forge/`.

## Problem

Agent state now lives in two places: Herdr's agent list (every project, click to jump) and Forge's docked sidebar (one repo, the same agents restated via a 5 s `hc get` poll). It's unclear which to look at. Herdr does agent state better. What only Forge knows is the shape of the work (track → design → plan → PR → issues), what's planned but not started, and what's done. The user wants one dashboard across all projects: what's waiting on them, what's in flight, what's planned, what's done, and an easy way to kick things off. The dock also depends on a special layout borrowed from the Automations mod's `main-plus`, which is not native Herdr. And every open view polls `gh` (200 PRs + 500 issues) on its own every 30 s, so more panes would mean proportionally more GitHub calls.

## Chosen approach

**No dock. Forge lives in ordinary panes and tabs.** `mod.json` becomes `{"place": "none", "overlay": {"width": 720, "height": 720}}`. Nothing depends on a custom layout.

**Track pane: one per track, pinned.** `{view: "track"}`. On init it resolves the focused pane's `cwd` once (`focused()` / `panes()`, as `location()` does today) to the linked worktree that contains it, then stays pinned to that worktree. It renders the existing detail view (Design | Plan | PR | Issues tabs, plan ledger, Shelve), laid out for pane width. If the cwd isn't in a linked worktree, it says "Not in a track" and offers **+ Start work** and **Home**. It shows no agent list and no `hc get` status messages; Herdr owns those.
- Start opens each new worktree space with the agent and a track pane side by side (`tab.new` for the agent, then `pane.split` right with `mod: "forge", props: {view: "track", root, on, track}`).
- Existing spaces get one with a key (below).

**Home: one tab across every repo.** `{view: "home"}` replaces the per-repo board.
- Repos: git roots behind `spaces()` folders (with their machine) ∪ entries of `~/.herdr/worktrees/*`, deduped by git common dir.
- Tracks: `git worktree list` per repo (the existing `refresh` body, looped).
- GitHub across repos: three searches (`gh search issues --assignee @me --state open`, `gh search issues --author @me --label shelved --state open`, `gh search prs --author @me --merged-at ">=<7 days ago>"`) plus each repo's cached PR list (below). `gh search prs` has no `headRefName`, so the track↔PR join uses the per-repo list.

```
FORGE · HOME                                              [+ Start ⌘⇧N]
WAITING ON YOU · 2
  radicalcandorai  feat/admin-ui         ● blocked  claude   [Go to pane]
  forge            fix/yaml-desc         PR #27 ready for review    [↗]
IN FLIGHT · 3
  radicalcandorai  feat/edit-report      ● working  ▓▓▓░ 3/5  PR #210 ↗
  charter          feat/prompt-engineer  ● working  design ✓ plan –
  forge            feat/forge-home       ○ no agent · 4 ahead · 2h  [Resume]
PLANNED · 4
  forge            #31  Board follows focus     assigned  2d     [Start]
  forge            #18  Done list paging        shelved   5d    [Resume]
  radicalcandorai  #402 Admin export CSV        assigned  1w     [Start]
  charter          #77  Sync status verb        assigned  3w     [Start]
  Backlogs: forge ↗ · radicalcandorai ↗ · charter ↗
DONE · 7 DAYS
  forge            #26  Fix YAML parsing of skill descriptions   1d  ↗
```

Groups reuse `grouped()`. Waiting on you = agent blocked or PR ready for review. A blocked row shows the agent's state and a **Go to pane** jump, never the status message. In flight = an agent working, or a worktree with no agent (that row shows the age). Planned = issues assigned to you plus shelf issues, minus issues already in a track (`takenIssues`). Done = your merged PRs in the last 7 days. Clicking a track row focuses its space. Start, Resume and Shelve hand `/forge:start` / `/forge:shelve` to an agent exactly as today. Backlog stays a per-repo view, opened from the Backlogs line.

**Drafts on main count as work.** While brainstorm/plan write their files uncommitted in a repo's main checkout (before any worktree exists), Home lists each draft in In flight as `on main` (design ✓/–, plan ✓/–), and a track pane on main lists them instead of only "Not in a track". Derived from `git status --porcelain -- docs/decisions docs/plans`; the item disappears when plan moves the files into the worktree and the track appears.

**GitHub calls scale with repos, not panes.**
- Each view fetches only what it shows. Each repo's PR list (`gh pr list --state open --limit 100` + `--state merged --limit 30`, bodies slimmed to checklist and `#ref` lines) is fetched once per minute through the shared cache and serves Home and every track pane in that repo. A track pane fetches a PR's full body only while its PR tab is open, and its linked issues by number only while the Issues tab is open. Home gets the three searches. Backlog gets the per-repo `gh issue list` only while it's open.
- One shared cache: before any `gh` call a view reads `shared("forge.gh.<key>")` (`{at, data}`; the key is the repo + query, or the search). If `at` is under 60 s old it uses `data`. Otherwise it fetches and `setShared`s the result, which re-renders every other view. `me` and `repoUrl` are cached the same way, with no expiry.
- Estimate: ~10 small calls a minute for 10 repos with panes open. Today it's ~800 points an hour per pane, against GitHub's 5,000/h.

**Keys.** These are plain Herdr commands, so no running mod has to receive them. `scripts/install-herdr-mod.sh` merges them into `~/.config/herdr-app/keys.json` and warns that any edit makes that file the person's (new Herdr default shortcuts stop arriving automatically):
- `cmd-shift-h` → `{"command": "tab.new", "args": {"name": "Forge", "mod": "forge", "props": {"view": "home"}}}`
- `cmd-shift-n` → `mod.open:forge` (overlay with no `view` = the Start dialog for the focused repo; with no repo focused, its first field picks one of Home's repos)
- `cmd-shift-j` → `{"command": "pane.split", "args": {"direction": "right", "mod": "forge", "props": {"view": "track"}}}`

## Cut and why

- **The docked sidebar, its collapse rail and the borrowed `main-plus` layout.** They duplicated Herdr's agent list and depended on another mod's layout.
- **Following focus.** A pane lives in one tab, so pinning it to its track is simpler and always correct.
- **Agent status messages (`hc get` poll).** Herdr shows them. Removing the poll also removes a process every 5 s per view.
- **The per-repo board view.** Home is the board.
- **Each view's own 30 s gh poll of 200 PRs + 500 issues.** Replaced by scoped fetches and the shared 60 s cache.
- **Reply to an agent from Forge (`hc send` on a blocked row).** Likely the first follow-up, but only once usage shows the agent's state is enough to answer without seeing the pane.
- **A standalone app over `hc`.** Revisit if Home becomes where the user lives and Herdr's chrome still gets in the way.
- **A `planned` label.** Assigning an issue to yourself is GitHub's own way to say "mine, to do".

## Open questions

None blocking. Verified live on 2026-11-06 with a throwaway probe mod: `mod.open` passes `props()` = `{overlay: "<id>"}` (no `view`); a `place: "none"` mod opens through `tab.new` and `pane.split`; `localStorage` is per mod copy. Not verified: whether `localStorage` survives an app restart (the plan has a fallback).

## Deviations

- T1 commit d8603b0 — deviation: none. Review: p2 null-nwo leaves track issues untaken → fixed in T2 (loadRepo keeps prev.nwo); p3s ruled no-change (future closedAt = clock skew, Done on:null unused, >30-merged dedupe gap, idle-agent hold rank, same repo on two machines) — parked: none
