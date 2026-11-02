# Plan: work panel — live agent state, collapse rail, Done as merged PRs

- **Goal:** the Herdr work panel (`herdr/mods/forge/`) shows what each track's agent is doing right now instead of a doc-derived stage ladder, can fold to a 44px rail from its own header, and keeps merged PRs under Done for 7 days after their worktree is gone.
- **Design:** `docs/decisions/2026-11-02-work-panel-live-state.md` (follow-up to `docs/decisions/2026-11-02-herdr-work-panel.md`, PR #11).
- **Branch:** `feat/work-panel-live-state`
- **Whole-feature verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && bash hooks/session-start.test.sh`

## Facts the implementer must not re-derive (verified live 2026-11-02, Herdr gpui-shell 0.7.1)

- The mod is installed by symlink: `~/.config/herdr-app/mods/forge -> <checkout>/herdr/mods/forge` (`scripts/install-herdr-mod.sh`). The symlink currently points at the **main** checkout. Run `bash scripts/install-herdr-mod.sh` from this worktree at the start of Task 3 (not earlier: the board and detail views are broken between Tasks 1 and 3) so the live app loads this branch's code, and again from the main checkout after merge (the PR body's "After merge" line). Saving any file under the mod hot-reloads it (AGENTS.md "Mods"); a broken save keeps the old build running and shows in `herdr-app status | jq .errors`.
- `exec(cmd, args, {cwd})` resolves `{code, stdout, stderr}` on any exit but **rejects** when the program cannot start or `cwd` does not exist (`herdr.d.ts`); every call sits behind try/catch, as `git()`/`gh()` in `main.js` already do.
- **Never define a method named `close` on the exported View** — it is Herdr's lifecycle hook and killed the previous build twice (`docs/learnings.md:14`). Never write `tab.close` without `--id` in a verify line; never `space.close`.
- `agents()` (`herdr.d.ts` `AgentInfo`) has `address, status ("working"|"blocked"|"done"|"idle"), app, title, pane…` and **no status message**. herdr-core has it: `hc get <address> --json` prints JSON with `.status.msg` — **only for `done` and `blocked` agents; a `working` agent reports `state` and no `msg`** (verified live on Claude Code) — e.g. `{"app":"claude-code","msg":"committed codex/.codex/AGENTS.md as 9cebf50 on main","state":"done"}`), or `.status` null for a non-agent terminal. Call it through the mod API's native `hc(args)` export (`herdr.d.ts:15-16`: "Runs `hc` (herdr-core)… Add `--json` for machine output"), never `exec("hc", …)` — no PATH dependency. It resolves `{code, stdout, stderr}` like `exec`.
- `layout()` (from `herdr`) returns the shown layout tree: nested `{id, type, content?, children?, size?: {px}|{weight}, hidden?}`; the docked panel is the block whose `content.mod === "forge"` (live: `{"id":"b17188af2f48ba6eb0510257cb79290bd","type":"block","content":{"mod":"forge"},"size":{"px":340}}`). Shipped mods find nodes the same way (`~/.config/herdr-app/mods/tabs-plus/main.js:5-11` `find(node,id)`; `mods/workspace-chrome/main.js:15-24` reads `find(layout(),"sidebar")?.size?.px`, saves it with `setShared("sidebar.width", …)` and runs `run("layout.resize", {id:"sidebar", px})`). Follow that pattern exactly. `layout.resize --id <id> --px 44` works from the CLI too (verified; the `layouts/<name>.json` file on disk lags the live tree by seconds to minutes, so verify against the window, never the file).
- `on_size_change` on the root element reports logical px (`herdr.d.ts:384`); `main.js` already stores it in `this.w` and `narrow(px)`. Collapsed = `this.w > 0 && this.w < 100`. No stored flag.
- `setShared(key, value)` / `shared(key)` (`herdr.d.ts:389-392`) are the app-wide key/value store; `sidebar.width` is the precedent for a remembered width.
- gpui: colors are `#rgb/#rrggbb/#rrggbbaa` literals only (use `NONE`/`alpha()` from `main.js`); every shrinkable flex row needs `.min_w(0)` or it pushes siblings off the pane (`docs/learnings.md:21`). Theme tokens used here: `blocked, accent, muted, dim, surface, hover, border, selection, ansi2`.
- Verifying a view in the live app (pattern from `docs/plans/2026-11-02-herdr-work-panel.md:691`): `SP=$(herdr-app ls | jq -r --arg t "$HC_TERMINAL_ID" '.spaces[] | select(any(.tabs[].terminals[]; .terminal == $t)) | .id')`, `T=$(herdr-app do tab.new --space "$SP" --mod forge --props '{…}' | jq -r .tab)`, guard `[ -n "$T" ] && [ "$T" != null ]`, `sleep 3`, `herdr-app status | jq -e '.errors == []'`, then `herdr-app do tab.close --id "$T" --confirmed true`.
- The old fixture in `model.test.js` (`input()`, `WT`) stays; tests that import `STAGES` must change because `STAGES` is deleted.

## Task 1
**model.js: drop the stage ladder, add `ahead`, agent messages, `nextLabel`, and Done from merged PRs**

- **Exists because:** every view reads `t.stage`/`STAGES`; the fix in the design is a derivation change, and the pure module is where it is testable without Herdr.
- **Model:** haiku (the code below is complete; transcribe it).
- **Files:** `herdr/mods/forge/model.js`, `herdr/mods/forge/model.test.js`, and one import line in `herdr/mods/forge/main.js`.
- **Interfaces produced:** `tracks(input)` now reads `input.ahead?: {[path]: number}`, `input.now?: number` (ms) and agent objects `{address, status, cwd, msg?: string|null}`; each track gains `ahead: number`, `merged: boolean`; `stage` is gone; Done items with no worktree have `path: null`. New export `nextLabel(t)`. `STAGES` is removed.

Steps:

1. In `model.test.js` replace the import line with
   `import { parseWorktrees, progress, linked, slugify, kind, planTasks, tracks, grouped, takenIssues, isParked, branchFor, shelfBranch, nextLabel, DONE_WINDOW_MS } from "./model.js";`
   Add `now: Date.parse("2026-11-02T12:00:00Z"),` to the object returned by `input()` (after `ages`). Delete the tests named `stage ladder` and `a draft PR with no docs is still Build`. In `tracks: one per non-main worktree; stage, group, issues, progress` replace `assert.equal(STAGES[t.stage], "Build");` with `assert.equal(nextLabel(t), "Resume"); assert.equal(t.merged, false); assert.equal(t.ahead, 0);`. In `a CLOSED PR (shelved) does not count` replace `assert.equal(STAGES[t.stage], "Plan");` with `assert.equal(nextLabel(t), "Build");`. Append these tests:

```js
test("nextLabel from facts: Start → Plan → Build → Resume → Review", () => {
  const t = (over) => tracks(input(over)).find((x) => x.branch === "feat/ring");
  assert.equal(nextLabel(t({ docs: {}, prs: [] })), "Start");
  assert.equal(nextLabel(t({ docs: { "/r/.claude/worktrees/ring": { design: "d" } }, prs: [] })), "Plan");
  assert.equal(nextLabel(t({ prs: [] })), "Build");
  assert.equal(nextLabel(t({})), "Resume");
  assert.equal(nextLabel(t({ prs: [{ ...input().prs[0], isDraft: false }] })), "Review");
  assert.equal(nextLabel(t({ docs: {} })), "Resume"); // a draft PR with no docs (rebased, or a fix/ branch): the PR decides, never "Start"
  assert.equal(nextLabel(t({ docs: {}, prs: [{ ...input().prs[0], isDraft: false }] })), "Review");
});

test("reason: the agent's message leads; without an agent, commits ahead and PR state", () => {
  const r = (over) => tracks(input(over)).find((x) => x.branch === "feat/ring").reason;
  const a = (status, msg) => [{ address: "t9", status, cwd: "/r/.claude/worktrees/ring", msg }];
  assert.equal(r({ agents: a("working", "running hooks test suite") }), "working · running hooks test suite");
  assert.equal(r({ agents: a("working", null) }), "working");
  assert.equal(r({ agents: a("blocked", "merge order?") }), "blocked · merge order?");
  assert.equal(r({ agents: a("blocked", null) }), "agent asked you something");
  assert.equal(r({ ahead: { "/r/.claude/worktrees/ring": 3 } }), "no agent · 3 commits ahead · draft PR #55");
  assert.equal(r({ ahead: { "/r/.claude/worktrees/ring": 1 }, prs: [] }), "no agent · 1 commit ahead · no PR");
  assert.equal(r({ agents: a("idle", "committed T2"), ahead: { "/r/.claude/worktrees/ring": 2 } }), "idle · committed T2 · 2 commits ahead · draft PR #55");
  assert.equal(r({ agents: a("done", null) }), "done · 0 commits ahead · draft PR #55");
  assert.equal(r({ prs: [{ ...input().prs[0], isDraft: false }] }), "review PR #55");
});

test("takenIssues ignores merged tracks: a merged PR's #n must not grey open backlog issues", () => {
  const now = input().now;
  const ts = tracks(input({ prs: [input().prs[0], { number: 61, title: "x", body: "Filed #81 as deferred, see #82", url: "u", isDraft: false, state: "MERGED", headRefName: "fix/fresh", mergedAt: new Date(now - 86400 * 1000).toISOString() }] }));
  assert.deepEqual([...takenIssues(ts).keys()].sort(), [38, 51]);
});

test("done: a merged PR within 7 days is a track without a worktree; older or already-tracked ones are not", () => {
  const now = input().now;
  const merged = (n, branch, daysAgo) => ({ number: n, title: `PR ${n}`, body: "Closes #70", url: `u${n}`, isDraft: false, state: "MERGED", headRefName: branch, mergedAt: new Date(now - daysAgo * 86400 * 1000).toISOString() });
  const ts = tracks(input({ prs: [input().prs[0], merged(60, "feat/old", 8), merged(61, "fix/fresh", 2), merged(62, "feat/ring", 1)] }));
  const done = ts.filter((t) => t.group === "done");
  assert.deepEqual(done.map((t) => [t.pr.number, t.path, t.slug, t.branch, t.merged]), [[61, null, "fresh", "fix/fresh", true]]);
  assert.equal(done[0].reason, "merged · PR #61");
  assert.deepEqual(done[0].issues, [70]);
  assert.equal(done[0].at, Date.parse(done[0].pr.mergedAt) / 1000);
  assert.equal(ts.filter((t) => t.branch === "feat/ring").length, 1); // the worktree's own track wins over the PR-only one
  assert.equal(DONE_WINDOW_MS, 7 * 86400 * 1000);
});

test("a worktree whose PR merged is done and dated by the merge, and shows the merged PR", () => {
  const t = tracks(input({ prs: [{ ...input().prs[0], state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" }] })).find((x) => x.branch === "feat/ring");
  assert.equal(t.group, "done"); assert.equal(t.merged, true); assert.equal(t.at, Date.parse("2026-11-01T00:00:00Z") / 1000);
  assert.equal(t.reason, "merged · PR #55"); assert.equal(t.path, "/r/.claude/worktrees/ring");
});
```

2. Run `node --test herdr/mods/forge/model.test.js` — the file fails to load (`nextLabel` is not exported yet), so every test fails; that is the expected red.

3. In `model.js`: delete the `STAGES` line and the `stage()` function. Replace the `GROUPS` line with
   (`GROUPS` is unchanged — the board's counts line lowercases titles into `3 done`, so the "· 7 days" suffix is drawn by the group headers in Task 3, not stored in the title.)
   `export const DONE_WINDOW_MS = 7 * 86400 * 1000; // merged PRs stay under Done this long after their worktree is gone — gh is the memory, nothing is stored`
   Replace `reason()` and `tracks()` with:

```js
// The card's one line: what the agent says it is doing; without one, the facts on disk.
function reason(t) {
  const a = t.agents.find((x) => x.status === "blocked") ?? t.agents.find((x) => x.status === "working") ?? t.agents[0] ?? null;
  if (a?.status === "blocked") return a.msg ? `blocked · ${a.msg}` : "agent asked you something";
  if (t.group === "needs") return `review PR #${t.pr.number}`;
  if (t.group === "flight") return a?.msg ? `working · ${a.msg}` : "working";
  if (t.group === "done") return `merged · PR #${t.pr.number}`;
  const pr = t.pr ? `${t.pr.isDraft ? "draft " : ""}PR #${t.pr.number}` : "no PR";
  const who = a ? `${a.status}${a.msg ? ` · ${a.msg}` : ""}` : "no agent"; // an idle or done agent is still on the track: say so, with its last message
  return `${who} · ${t.ahead} commit${t.ahead === 1 ? "" : "s"} ahead · ${pr}`;
}

// The action button's label: the forge verb the branch is at. The PR decides first (docs vanish from `diff base...HEAD` after a rebase onto
// merged docs, and fix/ branches never have any); then which docs exist. /forge:start routes by itself; this is for the human.
export function nextLabel(t) {
  if (t.pr) return t.pr.isDraft ? "Resume" : "Review";
  if (!t.design) return "Start";
  if (!t.plan) return "Plan";
  return "Build";
}

const under = (cwd, path) => cwd === path || cwd.startsWith(path.endsWith("/") ? path : path + "/");

export function tracks(input) {
  const now = input.now ?? Date.now();
  const ts = input.worktrees.filter((w) => !w.main).map((w) => {
    const d = input.docs?.[w.path] ?? {};
    const pr = w.branch ? (input.prs ?? []).find((p) => p.headRefName === w.branch && p.state !== "CLOSED") ?? null : null; // a shelved track's closed draft PR is history, not state
    const t = {
      path: w.path, branch: w.branch ?? "(detached)", slug: w.branch ? w.branch.replace(/^[^/]+\//, "") : w.path.split("/").filter(Boolean).pop(),
      design: d.design ?? null, plan: d.plan ?? null, pr,
      agents: (input.agents ?? []).filter((a) => a.cwd && under(a.cwd, w.path)),
      issues: linked(`${pr?.body ?? ""}\n${(d.designText ?? "").split("\n").filter((l) => /\b(issue|closes|fixes|resolves|from|parked|deferred)\b/i.test(l)).join("\n")}`), // design prose mentions many #n; only issue-talking lines count
      at: input.ages?.[w.path] ?? 0,
      ahead: input.ahead?.[w.path] ?? 0,
      merged: pr?.state === "MERGED",
    };
    if (t.merged && pr.mergedAt) t.at = Date.parse(pr.mergedAt) / 1000; // Done sorts by merge time, like the PR-only items below
    t.group = group(t); t.progress = progress(pr?.body); t.reason = reason(t);
    return t;
  });
  // Done keeps a merged PR for DONE_WINDOW_MS after its worktree is gone. path null: no detail pane, no actions but the PR link.
  const have = new Set(ts.map((t) => t.branch));
  for (const p of input.prs ?? []) {
    if (p.state !== "MERGED" || !p.mergedAt || have.has(p.headRefName) || /^(main|master)$/.test(p.headRefName)) continue; // a fork's main merged here would be a Done item named "main"
    const ms = Date.parse(p.mergedAt);
    if (!(now - ms >= 0 && now - ms < DONE_WINDOW_MS)) continue;
    const t = { path: null, branch: p.headRefName, slug: p.headRefName.replace(/^[^/]+\//, ""), design: null, plan: null, pr: p, agents: [], issues: linked(p.body), at: ms / 1000, ahead: 0, merged: true };
    t.group = "done"; t.progress = progress(p.body); t.reason = reason(t);
    ts.push(t);
  }
  return ts;
}
```

   Then in `takenIssues` change `for (const t of ts) for (const n of t.issues)` to `for (const t of ts) if (!t.merged) for (const n of t.issues)` — a merged PR's body files parked issues (`Filed #81…`) that must stay startable.

   Placement: this block replaces everything from the old `function reason(t) {` through the closing `}` of the old `export function tracks(input) {`, **including the old `const under = …` line between them** (the block above already declares `under`; a second declaration is a SyntaxError). `group()` stays where it is, above the block; `grouped()`, `takenIssues()` and everything below `tracks` stay as they are. `input()` in the tests needs no `ahead` key (it defaults to `{}`).

4. In `main.js` line 9 replace `STAGES,` with `nextLabel,` so the module still links (a missing export is a load error, and `herdr-app check` renders only the sidebar, which never reads `STAGES`). The board and detail views still reference `STAGES[...]` until Task 3; that is why the live install waits until Task 3 — the symlink keeps pointing at the main checkout until then.

5. **Verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && ! grep -q 'STAGES\|\.stage\b' herdr/mods/forge/model.js`

## Task 2
**main.js data layer: commits ahead per worktree and the agent status message from hc**

- **Exists because:** Task 1's `reason()` needs `ahead` and `msg`; without this task every hold line says "0 commits ahead" and every in-flight line says just "working".
- **Model:** sonnet.
- **Files:** `herdr/mods/forge/main.js` only (`init`, `emptyData`, `refresh`, `live`, new `pollMsgs`).
- **Interfaces consumed:** Task 1's `tracks` input shape. **Produced:** `this.data.ahead`, `this.msgs` for Task 3's renderers (they only read `t.reason`).

Steps:

1. Do **not** install this branch into the live app yet (Task 3 does; the board and detail views are broken between Tasks 1 and 3).
2. `emptyData`: add `ahead: {}` → `({ worktrees: [], docs: {}, prs: [], issues: [], ages: {}, ahead: {}, me: null, repoUrl: null })`.
3. Import: add `hc` to the `from "herdr"` list. `init`: on the line `this.filter = "all"; this.shown = 50; this.error = null; // …` insert ` this.msgs = {}; this.polling = false;` right after `this.error = null;`, before the comment. Replace the line `cx.timer.every(5000, (cx) => this.relocate(cx)); // …` with
   `cx.timer.every(5000, (cx) => { this.relocate(cx); cx.spawn((cx) => this.pollMsgs(cx)); }); // the sidebar follows the shown space; agent messages live in herdr-core, not agents()`
4. `refresh`: declare `const docs = {}, ages = {}, ahead = {};` and inside the per-worktree `Promise.all` callback, after the `ages[w.path] = …` line, add
   `ahead[w.path] = Number((await this.git(["rev-list", "--count", `${this.base}..HEAD`], w.path)).out) || 0;`
   and include `ahead` in the assignment: `this.data = { worktrees: wt, docs, prs: prs ?? this.data.prs, issues: issues ?? this.data.issues, ages, ahead, me, repoUrl };`
5. Add a new method between the end of the `watch(paths, cx) { … }` method and the comment line `// Live: agents() and panes() change on their own…` that precedes `live()`:

```js
  // agents() has no status message; herdr-core does (`hc get <t> --json` → .status.msg). Polled every 5s for agents on tracks only, by the views that
  // show reason text (sidebar, board, detail). One poll in flight per view: a hung remote `hc get` must not stack processes every tick.
  async pollMsgs(cx) {
    const v = props()?.view; if (v === "start" || v === "backlog" || this.polling) return;
    this.polling = true;
    try {
      const on = [...new Set(this.live().flatMap((t) => t.agents.map((a) => a.address)))];
      let changed = false;
      await Promise.all(on.map(async (addr) => {
        let msg = null;
        try { const r = await hc(["get", addr, "--json"]); msg = r.code === 0 ? (JSON.parse(r.stdout || "{}").status?.msg ?? null) : null; } catch { msg = null; }
        if ((this.msgs[addr] ?? null) !== msg) { this.msgs[addr] = msg; changed = true; }
      }));
      for (const k of Object.keys(this.msgs)) if (!on.includes(k)) { delete this.msgs[k]; changed = true; }
      if (changed) cx.notify();
    } finally { this.polling = false; }
  }
```

6. `live()`: the agent map becomes `({ address: a.address, status: a.status, cwd: ps.find((p) => p.pane === a.pane)?.cwd ?? null, msg: this.msgs[a.address] ?? null })`.
7. `tracks({ ...this.data, agents: ag })` is unchanged (`now` defaults to `Date.now()` inside `tracks`).

- **Verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge` (`check` only proves the module loads and renders once; async paths are not exercised). The live check is part of Task 3's verify, once this branch is installed.

## Task 3
**main.js views: agent state replaces the stage ladder; Done lists merged PRs**

- **Exists because:** the sidebar, board and detail views still render `STAGES`, `pips` and `t.stage`, which no longer exist after Task 1 — the mod would throw on load.
- **Model:** sonnet.
- **Files:** `herdr/mods/forge/main.js` (`import`, `next`, `pips` (delete), `renderSidebar`, `renderBoard`, `renderDetail` header).
- **Interfaces consumed:** Task 1's `nextLabel`, `t.merged`, `t.ahead`, `t.path === null` for PR-only Done items.

Steps:

1. Run `bash scripts/install-herdr-mod.sh` from this worktree and confirm `readlink ~/.config/herdr-app/mods/forge` prints this worktree's `herdr/mods/forge`. From here on every save hot-reloads the live panel; check `herdr-app status | jq -e '.errors == []'` after each save. (The import already says `nextLabel` from Task 1.)
2. Delete the `pips(t, stage, color)` method.
3. `next(t)`: add as the first line `if (!t.path) return { label: "Open PR", go: () => this.openGitHub(t.pr.url) };` (a PR-only Done item has nothing on disk). Replace `if (t.stage === 5) {` with `if (t.merged) {`. Replace the last return with `return { label: nextLabel(t), go: () => this.openAgent(t.path, "/forge:start") };`.
4. `renderSidebar` row: ids and the click must survive `path === null`. At the top of `row` add `const key = s.path ?? "pr" + s.pr.number;` and use it in every id in the row (today only `s-${s.path}`), so:

```js
v_flex().id(`s-${key}`)…
  .on_click(() => (s.path ? this.openDetail(s) : this.openGitHub(s.pr.url)))
```

   - second line: replace `.child(this.pips(t, s.stage, color))` with nothing (the reason text alone, still `.pl(16)`); the reason text now carries the agent message so keep `.truncate().min_w(0)` on it (already there).
5. `renderBoard` card:
   - At the top of `card` add `const key = s.path ?? "pr" + s.pr.number;` and replace **every** `${s.path}` inside an id in the card with `${key}` — there are five: `c-`, `pr-`, `i-…-${n}`, `nx-`, `sh-` (two PR-only cards would otherwise share ids like `nx-null`). Click: `.on_click(() => (s.path ? this.openDetail(s) : this.openGitHub(s.pr.url)))`.
   - Wrap the two `art(...)` chips so PR-only items do not show "design —": `.when(s.path, (e) => e.child(art("design", s.design)).child(art("plan", s.plan)))` in place of the two `.child(art(…))` calls.
   - Replace the stage chip `div().px(6).py(1).rounded(9)…child(STAGES[s.stage])` with a status chip whose text is `s.merged ? "merged" : s.agents[0]?.status ?? "no agent"` (same styling, same `color`).
   - Replace `.when(s.stage < 5, …Shelve…)` with `.when(!s.merged && s.path, …)` (same button, id `sh-${key}`).
   - The footer line already prints `s.reason`; leave it.
   - Group headers (sidebar and board both render `g.title.toUpperCase()`): change to `g.title.toUpperCase() + (g.key === "done" ? " · 7 DAYS" : "")` so the Done header reads `DONE · 7 DAYS` while the counts line still says `3 done`.
6. `renderDetail` header (the `h_flex().flex_grow(1).justify_end()…` group holding `this.pips(t, tr.stage, color)`, the `STAGES[tr.stage]` chip and the Shelve button): remove the `this.pips(…)` child and the `STAGES[tr.stage]` chip; in their place one chip with the same text rule as the board (`tr.merged ? "merged" : tr.agents[0]?.status ?? "no agent"`), and change `.when(tr.stage < 5, …Shelve → issue…)` to `.when(!tr.merged, …)`. `openDetail` is only reachable for tracks with a path, so `tr` is never a PR-only item.
7. Check nothing else references `stage`: `grep -n 'stage\|STAGES\|pips' herdr/mods/forge/main.js` prints only comments or nothing.

- **Verify** (the live part must run from a terminal inside the Herdr desktop app, where `$HC_TERMINAL_ID` is set — the build's own terminal is one; if it is unset, run only the first line and report the live check as skipped): `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && herdr-app status | jq -e '.errors == []'` and the live views open clean:
```bash
[ "$(readlink ~/.config/herdr-app/mods/forge)" = "$PWD/herdr/mods/forge" ] || { echo "mod symlink does not point at this worktree"; exit 1; }
ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)"); SP=$(herdr-app ls | jq -r --arg t "$HC_TERMINAL_ID" '.spaces[] | select(any(.tabs[].terminals[]; .terminal == $t)) | .id'); [ -n "$SP" ] || { echo "skipped: not in an app terminal"; exit 0; }
for v in board backlog; do
  T=$(herdr-app do tab.new --space "$SP" --mod forge --props "{\"view\":\"$v\",\"root\":\"$ROOT\"}" | jq -r .tab); [ -n "$T" ] && [ "$T" != null ] || exit 1
  sleep 3; herdr-app status | jq -e '.errors == []' >/dev/null; R=$?
  herdr-app do tab.close --id "$T" --confirmed true >/dev/null   # always close the tab you opened, even when the check failed
  [ "$R" = 0 ] || exit 1
done
```
  Then open the board once more the same way, `herdr-app shot /tmp/verify-t3.png` (shot needs a `.png` path; never a path inside the worktree), and confirm in the image: a `DONE · 7 DAYS` group listing PR #11 (merged 2026-11-02T18:14Z, worktree gone; if more than 7 days have passed since then, any merged PR under 7 days old will do, and if none exists the model test `done: a merged PR within 7 days…` is the proof), no stage pips anywhere, and the in-flight card's footer showing `working` for the agent in this worktree (your own terminal; a working agent carries no message, so bare `working` is the expected text). The message path is proven by the model tests plus one look at any `done` or `idle` agent elsewhere in the app, whose sidebar line should read `<status> · <its last message>` (`hc ls --json` lists candidates; their `hc get <t> --json | jq .status.msg` is what the line must show). Blocked messages can be long: the reason text keeps `.truncate().min_w(0)`. Close that tab by id.

## Task 4
**Collapse: a ‹ in the sidebar header folds the docked panel to a 44px rail, › restores it**

- **Exists because:** the panel has no show/hide; the only alternative (a button in Herdr's tab bar) means forking `tabs-plus`, rejected by the design.
- **Model:** sonnet.
- **Files:** `herdr/mods/forge/main.js` (`import`, new `myBlock`/`collapse`/`expand`/`renderRail`, `renderSidebar` header and early return).
- **Interfaces consumed:** `layout()`, `setShared`, `shared`, `run("layout.resize")` from `herdr` (facts above; pattern `mods/workspace-chrome/main.js:15-24`).

Steps:

1. Import: add `layout, setShared, shared` to the `from "herdr"` list. Add `const RAIL = 44; // the folded width; the sidebar mod uses 44 too (76 on macOS only because of the traffic lights, which this panel never sits under)` after `GH_EVERY`.
2. Add after `repoUrl()`:

```js
  // --- collapse: the docked panel resizes its own layout block (pattern: mods/workspace-chrome toggleSidebar) ---
  // layout() is the window tree (blocks, stacks, rows); tab panes (the board, detail, backlog copies of this mod) are not nodes in it — only the docked copy is, as a block with content.mod === "forge" (verified against layouts/main-plus.json).
  myBlock() { const find = (n) => (n?.type === "block" && n?.content?.mod === "forge" ? n : (n?.children ?? []).map(find).find(Boolean)); return find(layout()) ?? null; }
  collapse() {
    if (props()?.root) return; // only the docked sidebar copy folds; a sidebar opened as a tab must not resize the docked block
    const b = this.myBlock(); if (!b) return;
    const px = b.size?.px ?? Math.round(this.w);
    if (px >= 100) setShared("forge.width", px); // a second click before the re-render would otherwise remember the rail width and › could never reopen
    run("layout.resize", { id: b.id, px: RAIL });
  }
  expand() { const b = this.myBlock(); if (b) run("layout.resize", { id: b.id, px: Math.max(100, shared("forge.width") ?? 340) }); }
  renderRail(cx) {
    const t = theme(), g = grouped(this.live()), needs = g[0].items.length, flight = g[1].items.length;
    const badge = (n, color) => div().px(5).py(1).rounded(8).text_size(10.5).font_semibold().bg(alpha(color, "22")).text_color(color).child(String(n));
    return v_flex().id("root").size_full().bg(t.surface).items_center().pt(10).gap(10).cursor_pointer().hover((e) => e.bg(t.hover)).on_click(() => this.expand()).on_size_change(this.onSize)
      .child(div().text_size(14).text_color(t.muted).child("›"))
      .when(needs > 0, (e) => e.child(badge(needs, t.blocked)))
      .when(flight > 0, (e) => e.child(badge(flight, t.accent)));
  }
```

3. `renderSidebar`: first line becomes `if (this.w > 0 && this.w < 100) return this.renderRail(cx);` then the existing body. In its `this.header(t, "Forge", [...])` array append `this.button(t, "fold", "‹", () => this.collapse())` after the `+` button. The header already wraps (`flex_wrap`) so the third button fits at 340px.
4. The board, backlog, detail and start views are untouched (they are tab panes, not the docked block, and `myBlock` is only called from the sidebar's buttons).

- **Verify:** `herdr-app check herdr/mods/forge && herdr-app status | jq -e '.errors == []'`, then from the CLI (the id is the docked block's, from the on-disk layout, which is stable for an existing block):
```bash
[ "$(readlink ~/.config/herdr-app/mods/forge)" = "$PWD/herdr/mods/forge" ] || { echo "mod symlink does not point at this worktree"; exit 1; }
L=$(jq -r .layout ~/.config/herdr-app/shared.json); F=~/.config/herdr-app/layouts/"$L".json
ID=$(jq -r '[.. | objects | select(.content?.mod? == "forge")][0].id // empty' "$F"); PX=$(jq -r '[.. | objects | select(.content?.mod? == "forge")][0].size.px // 340' "$F")
if [ -z "$ID" ]; then echo "skipped: no docked forge block in layout $L"; else
  trap 'herdr-app do layout.resize --id "$ID" --px "$PX" >/dev/null' EXIT   # the panel always goes back to its width, whatever fails below
  herdr-app do layout.resize --id "$ID" --px 44; sleep 2; herdr-app status | jq -e '.errors == []'; R=$?
  herdr-app shot /tmp/verify-t4-rail.png
  [ "$R" = 0 ]
fi
```
  (Run it as a script file or a subshell so the `trap` fires. The on-disk layout file lags the live tree, so `PX` is the last written width, which is fine: it is the width the panel had before this build touched it.) Look at `/tmp/verify-t4-rail.png`: the right edge shows a thin column with `›` and count badges, no overflow or clipped text. If it printed `skipped`, say so in the task report; the check line still proves the module loads.
