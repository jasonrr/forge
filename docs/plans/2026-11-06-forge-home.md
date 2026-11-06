# Plan: Forge Home + track panes

- **Goal:** replace the docked Forge sidebar with:
  - a track pane pinned to one worktree;
  - a Home tab across every repo, including design/plan drafts not yet dispatched;
  - GitHub calls that scale with repos, not panes (a shared 60 s cache).
- **Design:** `docs/decisions/2026-11-06-forge-home.md`. Read it first. Its mockup is the target for Home.
- **Branch:** `feat/forge-home`
- **Whole-feature verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && bash hooks/session-start.test.sh`

## Context every task needs

- **Files.** Everything is in `herdr/mods/forge/`:
  - `main.js`: one `View` class `Forge`, ~594 long lines.
  - `model.js`: pure functions, no `herdr` import.
  - `model.test.js`: `node:test` + `node:assert/strict`, flat `test()` calls; run with `node --test herdr/mods/forge/model.test.js`.
  - `mod.json`.
- **The old views.** Tasks 3 and 5 delete them, but the old view code stays readable on `main`: `git show main:herdr/mods/forge/main.js`. There, `renderSidebar` is lines 232-267 (group headers and one-line rows) and `renderBoard` is lines 269-313 (status chip at ~280, progress bar at ~285-287).
- **Herdr mod API:** `~/.config/herdr-app/AGENTS.md` and `~/.config/herdr-app/herdr.d.ts`. Check every command and argument there or with `herdr-app commands`.
  - `run()` inside a mod returns `null`, so it gives you no ids.
  - In `space.new`/`tab.new`, `machine: null` means "omitted" and defaults to the focused space's machine. Pass `machine: on ?? ""` (empty string = this computer).
- **Verified live on 2026-11-06** (throwaway probe mod, since removed):
  - `mod.open {name}` opens the overlay with `props()` = `{ overlay: "<id>" }` and no other keys.
  - A `place: "none"` mod opens fine through `tab.new {mod, props}` and `pane.split {mod, props}`.
  - `localStorage` is per mod copy. A second copy did not see the first copy's value.
  - Not verified: whether `localStorage` survives an app restart.
- **Learnings to obey** (`docs/learnings.md`):
  - Never name a method after a lifecycle hook (`close`), and never run an unscoped `tab.close`/`pane.close`.
  - Grep every `this.<field>` you reuse.
  - Truncating children need `.min_w(0)`.
  - Every `spaces().find` needs a guard for a missing space, and must match `(s.machine ?? null) === (on ?? null)`.
  - A rejected exec (`r.failed`) means "could not run", never "empty / not a repo". Keep the previous data.
  - Execs against a remote machine run sequentially.
  - `gh issue view <n>` also resolves PR numbers: keep only results whose `url` contains `/issues/`.
  - Repointing the mod symlink doesn't reload a mounted copy. Reopen the pane/tab, or restart Herdr.
- **Live checks:**
  - Skip them (and say so in the PR note) when `herdr-app status` fails: there's no Herdr window.
  - Before the first one, run `bash scripts/install-herdr-mod.sh` from this worktree. It points `~/.config/herdr-app/mods/forge` here.
  - Tools: `herdr-app do <command> '<json>'` prints the ids it made; `herdr-app status` shows mod errors; `herdr-app shot <file.png>` may return a stale frame, so when it disagrees with `status`, say so.
  - Close only what you opened, by the id `herdr-app do` printed (`tab.close {"id": …}`, `space.close {"id": …, "confirmed": true}`).
- **Units:** a track's `at` is in seconds. `DONE_WINDOW_MS` is in milliseconds.
- **Naming:** in render code `t` is always the theme. Call a list item `it`, never `t`.

## Task 1
**Model: slim PRs, find a track for a folder, Home groups**

- **Exists because:** the shared cache persists to `shared.json` on every write, so it must hold slim PRs. Home needs a pure, testable grouping across repos. The track pane needs the "which worktree holds this cwd" rule tested once.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/model.js`, `herdr/mods/forge/model.test.js`
- **Produces:** `slimPr(p)`, `trackFor(worktrees, cwd)`, `HOME_GROUPS`, `homeGroups(input)`. Used by Tasks 2, 4, 5 and 8.

**Steps, test-first.** Add these tests to `model.test.js`, merging the names into its existing `./model.js` import line:

```js
test("slimPr keeps only checklist and #ref lines of the body", () => {
  const p = { number: 1, headRefName: "feat/a", body: "Intro text\n- [x] T1 one\n- [ ] T2 two\nCloses #12\nlong prose\n" };
  assert.deepEqual(slimPr(p), { number: 1, headRefName: "feat/a", body: "- [x] T1 one\n- [ ] T2 two\nCloses #12" });
  assert.equal(slimPr({ number: 2, body: null }).body, "");
});

test("trackFor returns the deepest linked worktree containing cwd, never main", () => {
  const wt = [{ path: "/r", branch: "main", main: true }, { path: "/w/feat-a", branch: "feat/a", main: false }, { path: "/w/feat-ab", branch: "feat/ab", main: false }, { path: "/w/feat-a/nested", branch: "feat/n", main: false }];
  assert.equal(trackFor(wt, "/w/feat-a"), "/w/feat-a");
  assert.equal(trackFor(wt, "/w/feat-a/src/x"), "/w/feat-a");
  assert.equal(trackFor(wt, "/w/feat-a/nested/y"), "/w/feat-a/nested");
  assert.equal(trackFor(wt, "/w/feat-ab"), "/w/feat-ab");
  assert.equal(trackFor(wt, "/r"), null);
  assert.equal(trackFor(wt, null), null);
});

test("homeGroups: needs/flight from tracks, hold folds into flight, planned minus taken, done deduped", () => {
  const now = Date.parse("2026-11-06T12:00:00Z");
  const t = (over) => ({ path: "/w/x", branch: "feat/x", slug: "x", pr: null, agents: [], issues: [], at: 100, merged: false, group: "hold", ...over });
  const repos = [{ root: "/code/forge", on: null, nwo: "o/forge", tracks: [
    t({ path: "/w/a", group: "needs", issues: [5] }),
    t({ path: "/w/b", group: "flight", at: 300 }),
    t({ path: "/w/c", group: "hold", at: 200 }),
    t({ path: "/w/d", group: "done", merged: true, pr: { url: "u/9", number: 9 }, at: now / 1000 - 3600 }),
  ] }];
  const issue = (n, nwo = "o/forge") => ({ repository: { name: nwo.split("/")[1], nameWithOwner: nwo }, number: n, title: `i${n}`, url: `i/${n}`, labels: [], createdAt: "2026-11-01T00:00:00Z" });
  const g = homeGroups({ repos, now,
    assigned: [issue(5), issue(6), issue(7, "o/elsewhere")],
    shelved: [issue(6)],
    merged: [{ repository: { name: "forge", nameWithOwner: "o/forge" }, number: 9, title: "dup", url: "u/9", closedAt: "2026-11-06T10:00:00Z" },
             { repository: { name: "forge", nameWithOwner: "o/forge" }, number: 8, title: "new", url: "u/8", closedAt: "2026-11-05T10:00:00Z" },
             { repository: { name: "forge", nameWithOwner: "o/forge" }, number: 7, title: "old", url: "u/7", closedAt: "2026-10-01T10:00:00Z" }] });
  assert.deepEqual(g.map((x) => x.key), HOME_GROUPS.map(([k]) => k));
  const by = Object.fromEntries(g.map((x) => [x.key, x.items]));
  assert.deepEqual(by.needs.map((i) => i.path), ["/w/a"]);
  assert.deepEqual(by.flight.map((i) => i.path), ["/w/b", "/w/c"]); // agent-backed first, then no-agent oldest first
  assert.deepEqual(by.planned.map((i) => [i.issue.number, i.shelved, i.root]), [[6, true, "/code/forge"], [7, false, null]]); // #5 is taken by /w/a; #6 once, as shelved
  assert.deepEqual(by.done.map((i) => i.pr.number), [9, 8]); // #9 from the track (not duplicated), #8 from search, #7 outside the window
  assert.equal(by.needs[0].repo, "forge");
});
```

Then implement in `model.js`. `under` is already a top-level `const` arrow (model.js:88, argument order `(cwd, path)`); use it as is.

```js
// The shared gh cache persists to shared.json on every write: keep only the body lines the panel reads —
// checklist boxes (progress, planTasks ticks) and lines with #refs (linked issues). The PR tab fetches the full body on demand (Task 4).
export function slimPr(p) {
  const body = (p.body ?? "").split("\n").filter((l) => /^\s*- \[[ xX]\]|#\d+/.test(l)).join("\n");
  return { ...p, body };
}

// The deepest linked (non-main) worktree whose folder holds cwd, or null.
export function trackFor(worktrees, cwd) {
  if (!cwd) return null;
  const hits = worktrees.filter((w) => !w.main && under(cwd, w.path)).sort((a, b) => b.path.length - a.path.length);
  return hits[0]?.path ?? null;
}

export const HOME_GROUPS = [["needs", "Waiting on you"], ["flight", "In flight"], ["planned", "Planned"], ["done", "Done"]];
// Home across repos. repos: [{root, on, nwo, tracks, drafts?}] with tracks from tracks(). assigned/shelved: `gh search issues` rows
// ({repository:{name,nameWithOwner}, number, title, url, labels, createdAt}). merged: `gh search prs --merged-at` rows
// ({repository, number, title, url, closedAt}; search has no mergedAt, and closedAt is the merge time for a merged PR).
export function homeGroups({ repos = [], assigned = [], shelved = [], merged = [], now = Date.now() }) {
  const items = { needs: [], flight: [], planned: [], done: [] };
  const taken = new Set(), seenPr = new Set(), byNwo = new Map(repos.filter((r) => r.nwo).map((r) => [r.nwo, r]));
  for (const r of repos) {
    const repo = r.root.split("/").pop();
    for (const t of r.tracks) {
      items[t.group === "hold" ? "flight" : t.group].push({ ...t, repo, root: r.root, on: r.on ?? null });
      if (t.pr?.url) seenPr.add(t.pr.url);
      if (!t.merged && r.nwo) for (const n of t.issues) taken.add(`${r.nwo}#${n}`);
    }
  }
  const seen = new Set();
  for (const [i, shelf] of [...shelved.map((i) => [i, true]), ...assigned.map((i) => [i, false])]) {
    const nwo = i.repository?.nameWithOwner, key = `${nwo}#${i.number}`;
    if (seen.has(key) || taken.has(key)) continue;
    seen.add(key);
    const r = byNwo.get(nwo);
    items.planned.push({ issue: i, shelved: shelf, repo: i.repository?.name ?? nwo, root: r?.root ?? null, on: r?.on ?? null, at: Date.parse(i.createdAt) / 1000 || 0 });
  }
  for (const p of merged) {
    const ms = Date.parse(p.closedAt);
    if (seenPr.has(p.url) || !(now - ms <= DONE_WINDOW_MS)) continue;
    items.done.push({ path: null, branch: null, pr: { ...p, state: "MERGED", mergedAt: p.closedAt }, repo: p.repository?.name ?? "", root: byNwo.get(p.repository?.nameWithOwner)?.root ?? null, on: null, agents: [], issues: [], at: ms / 1000, merged: true, group: "done" });
  }
  const rank = (it) => (it.group === "flight" ? 0 : 2); // agent-backed before no-agent (Task 8 adds drafts at rank 1)
  items.flight.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.at - a.at : rank(a) === 2 ? a.at - b.at : 0));
  items.needs.sort((a, b) => b.at - a.at);
  items.planned.sort((a, b) => (b.shelved - a.shelved) || b.at - a.at); // shelved first, then newest
  items.done.sort((a, b) => b.at - a.at);
  return HOME_GROUPS.map(([key, title]) => ({ key, title, items: items[key] }));
}
```

- **Verify:** `node --test herdr/mods/forge/model.test.js`. Every test passes, including the 25 existing ones.

## Task 2
**Data layer: a shared gh cache and `loadRepo(root, on)`**

- **Exists because:** each view polls `gh pr list --limit 200` and `gh issue list --limit 500` on its own every 30 s (main.js:106-112). With a pane per track that blows GitHub's 5,000 points an hour. Home also needs the per-repo load as a function it can loop over; today it is fused into `refresh()` and writes `this.data`.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `slimPr` (Task 1).
- **Produces:**
  - `GH_TTL`
  - `this.cachedGh(key, args, cwd, on, ttl = GH_TTL, map = (x) => x)` → data or null
  - `this.loadRepo(root, on, prev)` → `{ ok: true, base, worktrees, docs, ages, ahead, prs, repoUrl, nwo }` or `{ ok: false, error }`
  - `emptyData()` gains `nwo: null`
- **Deviation from the design, deliberate.** The design's per-track `gh pr list --head <branch>` is replaced by one cached PR list per repo. That list serves Home and every track pane in the repo, and `gh search prs` can't serve the join because it has no `headRefName`.

**Steps:**

1. Replace `const GH_EVERY = 30000;` (main.js:13) with `const GH_TTL = 60000; // gh results are cached across all forge views for this long (shared()); GraphQL budget: 5000 pts/h per user`. Rename every `GH_EVERY` use to `GH_TTL`. Add `const DAY = 86400000;`.

2. Add `slimPr` to the model import (main.js:9). Add `nwo: null` to `emptyData()` (main.js:31). Add the module constant `const PR_FIELDS = "number,title,body,url,isDraft,state,headRefName,mergedAt,updatedAt,author";` next to `GIT`.

3. Add `cachedGh` after `gh()` (main.js:51):
   ```js
   // One cache for every forge view (shared(): persisted in shared.json; setShared re-renders every mod copy). Fresh → no call.
   // The 1 s slack keeps a timer that fires every ttl from always landing just inside the window (it would double the real interval).
   // Stores map(data) so big payloads are slimmed first. A failed call returns the last good data (stale beats empty), else null.
   // ponytail: two views expiring together both fetch once; harmless at this rate.
   async cachedGh(key, args, cwd, on, ttl = GH_TTL, map = (x) => x) {
     const k = `forge.gh.${key}`, hit = shared(k);
     if (hit && Date.now() - hit.at < ttl - 1000) return hit.data;
     const data = await this.gh(args, cwd, on);
     if (data === null) return hit?.data ?? null;
     const v = map(data);
     setShared(k, { at: Date.now(), data: v });
     return v;
   }
   ```

4. **Extract `async loadRepo(root, on, prev = emptyData())`.**
   - It starts with `const git = (args, cwd = root) => this.git(args, cwd, on);`. Always pass `on` explicitly: `this.git`'s defaults are `this.root`/`this.on`, which are wrong for Home.
   - Move into it, from `refresh()`: the base pick (main.js:84), the `worktree list` call and its failure handling (:85-87), `parseWorktrees` (:88), and the per-worktree `one(w)` loop with its sequential/parallel switch (:90-104). Changes:
     - (a) `one` reads keep-what-we-had values from `prev`, not `this.data`;
     - (b) delete the `if (seq !== this.seq) return;` lines (`loadRepo` has no seq; its caller checks after it returns);
     - (c) where refresh set `this.error` and returned on a failed `worktree list`, return `{ ok: false, error: <the same message> }`;
     - (d) `loadRepo` never calls `this.watch` and never assigns `this.*`.
   - Then:
     ```js
     const key = `${on ?? ""}:${root}`, list = (state, limit) => ["pr", "list", "--state", state, "--limit", String(limit), "--json", PR_FIELDS];
     const open = await this.cachedGh(`pr-open:${key}`, list("open", 100), root, on, GH_TTL, (ps) => ps.map(slimPr));
     const done = await this.cachedGh(`pr-merged:${key}`, list("merged", 30), root, on, GH_TTL, (ps) => ps.map(slimPr)); // sequential: remote exec rule
     const id = await this.cachedGh(`repo:${key}`, ["repo", "view", "--json", "url,nameWithOwner"], root, on, DAY);
     const prs = open && done ? [...open, ...done] : null; // tracks() ignores CLOSED; an OPEN PR on a reused branch still wins (model.js)
     return { ok: true, base, worktrees: wt, docs, ages, ahead, prs, repoUrl: id?.url ?? null, nwo: id?.nameWithOwner ?? null };
     ```

5. **Rewrite the rest of `refresh()`** after its root-resolution branch (main.js:69-81, unchanged in this task):
   ```js
   const root = this.root, on = this.on;
   const r = await this.loadRepo(root, on, this.data);
   if (seq !== this.seq || root !== this.root || on !== this.on) return;
   if (!r.ok) { this.error = r.error; cx.notify(); return; } // never replace tracks with an empty list
   this.watch([`${root}/docs`, ...r.worktrees.filter((w) => !w.main).map((w) => `${w.path}/docs`)], cx, on);
   let issues = this.data.issues;
   if (this.needIssues() && Date.now() - this.issuesAt >= GH_TTL - 1000) { // the 500-issue list stays per view and only where it is shown: too big for shared.json
     const got = await this.gh(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,body,url,labels,author,createdAt"], root, on);
     if (seq !== this.seq) return;
     if (got) { issues = got; this.issuesAt = Date.now(); }
   }
   const me = await this.cachedGh(`me:${on ?? ""}`, ["api", "user"], root, on, DAY, (u) => u.login);
   if (seq !== this.seq) return;
   this.base = r.base;
   this.data = { worktrees: r.worktrees, docs: r.docs, prs: r.prs ?? this.data.prs, issues, ages: r.ages, ahead: r.ahead, me, repoUrl: r.repoUrl, nwo: r.nwo };
   this.error = r.prs ? null : "gh unavailable — PRs may be stale";
   this.fetched = Date.now();
   ```
   - Add the method `needIssues() { const v = props()?.view; return v === "backlog" || v === "start"; }`. Task 3 rewrites it on top of `route()`.
   - Keep the existing `if (props()?.track) this.loadDoc(...)`, `cx.notify()` and the `finally` exactly as they are.
   - Delete the fields `ghAt`, `ghRoot`, `ghOn` and `ghErr` everywhere, including `init` and `resetData()`. `resetData()` becomes `{ this.data = emptyData(); this.issuesAt = 0; this.fetched = 0; }`. Add `this.issuesAt = 0;` to `init`.

- **Verify:**
  - `node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge && node --test herdr/mods/forge/model.test.js`
  - `grep -nE 'GH_EVERY|ghAt|ghRoot|ghOn|ghErr' herdr/mods/forge/main.js` prints nothing.
  - Live: open the existing Backlog view for this repo with `herdr-app do tab.new '{"name":"Backlog","mod":"forge","props":{"view":"backlog","root":"<this worktree>","on":null}}'`. Wait 5 s. Check that `herdr-app status` shows no errors and that `~/.config/herdr-app/shared.json` holds `forge.gh.pr-open:…`, `forge.gh.pr-merged:…`, `forge.gh.repo:…` and `forge.gh.me:` keys. Close that tab by its id.

## Task 3
**Remove the dock; one `route()`; Forge no longer docks itself**

- **Exists because:** the dock duplicates Herdr's agent list and depends on the Automations mod's `main-plus` layout. Its 5 s `hc get` poll and its follow-focus logic go with it. A single `route()` keeps `render`, `init` and the issue fetch agreeing on which view this copy is.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`, `herdr/mods/forge/mod.json`
- **Produces:** `route()`, `this.here`, `renderMoved`.

**Steps:**

1. **Set `mod.json`** to exactly `{ "place": "none", "overlay": { "width": 720, "height": 720 } }`. With `"none"` the mod appears only where a layout or another mod puts it (AGENTS.md:787). The existing `main-plus` layout still holds a forge block until the person hides it (Task 7), so that copy renders a notice (step 6).

2. **Add `route()`:**
   ```js
   // Which view this copy is. mod.open:forge (the ⌘⇧N key) opens the overlay with props {overlay} only — verified live 2026-11-06.
   // A docked layout block from before this change gets no props at all: "moved".
   route() {
     const p = props() ?? {};
     if (p.view === "start" || (p.overlay && !p.view)) return "start";
     if (p.view === "track" || p.track) return "track";
     if (p.view === "home") return "home";
     if (p.view === "backlog") return "backlog";
     return "moved";
   }
   ```
   - Rewrite `needIssues()` as `{ const r = this.route(); return r === "backlog" || r === "start"; }`.
   - `render()` becomes a switch on `this.route()`: start → `renderStart`, track → `renderDetail`, backlog → `renderBacklog`, home and moved → `renderMoved`. Task 5 points home at `renderHome`.
   - In `init`: `const r = this.route();`. Call `this.initStart(cx)` when `r === "start"` and `this.initDetail(cx)` when `r === "track"`. Return before `this.refresh(cx)` and before the timer when `r === "moved"`, so the old dock copy starts no git or gh work.

3. **Delete:**
   - `RAIL`, `relocate`, `pollMsgs`, `myBlock`, `collapse`, `expand`, `renderRail`, `renderSidebar`, `renderBoard`, `openBoard`;
   - the Board button in the Backlog header (main.js:339);
   - the 5 s timer in `init` (main.js:45);
   - `this.msgs`, `this.polling` and `this.loc` (all assignments);
   - the `msg:` field in `live()`;
   - the imports `layout` and `hc`.

   Keep `focused`, which `location()` uses. Then:
   - Fix the header comment of the file (main.js:1-4) to list the views: Home `{view:"home"}`, track pane `{view:"track"}` or `{track}`, backlog `{view:"backlog"}`, Start (`{view:"start"}` or the `mod.open` overlay), and the "moved" notice.
   - Delete comments that mention the sidebar following focus.
   - model.js's `reason()` still reads `a.msg` and tolerates its absence. Leave it.
   - Grep every removed name afterwards.

4. **Resolve the location once.**
   - In `init`, before `this.refresh(cx)`: `if (!props()?.root) this.here = location();`.
   - In `refresh()`'s branch for views without a root (main.js:69-81), guard it with `if (!props()?.root && this.here)`.
   - Replace `const { cwd, machine } = location(); if (!cwd) return;` with:
     ```js
     const { cwd, machine } = this.here;
     if (!cwd) { this.error = "no space or folder to work from"; cx.notify(); return; }
     ```
   - This branch now serves only the views that open without a `root`: the key-opened Start overlay and the key-opened track pane. Both resolve the repo from where the person was when they opened them, then stay put.
   - Update the comments on `location()` and this branch to say so.

5. Keep `openStart`, `openDetail` and `openBacklog` as they are.
   - `openBacklog` still uses `location().space`. That's fine: it's a click.

6. **Add `renderMoved`.** Root `.id("root").size_full().bg(t.surface).p(12).gap(6)` with three `div` lines (muted text after the first):
   - "Forge moved out of the dock."
   - "⌘⇧H Home · ⌘⇧N Start work · ⌘⇧J this worktree's track"
   - "Hide this block: run scripts/install-herdr-mod.sh — it prints the command."

- **Verify:**
  - `node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge`
  - `grep -nE 'renderSidebar|renderBoard|renderRail|collapse\(|relocate|pollMsgs|RAIL|openBoard|this\.msgs|this\.loc\b|this\.polling' herdr/mods/forge/main.js` prints nothing.

## Task 4
**Track pane: pinned to one worktree**

- **Exists because:** it replaces the dock as "the Forge for this worktree", living in an ordinary pane. A pane opened by a key has no `track` prop, so it needs a rule for which worktree it belongs to.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `trackFor` (Task 1), `cachedGh` (Task 2), `route()` and `this.here` (Task 3).

**Steps:**

1. **Add `trackPath()` and rewrite `track()`:**
   ```js
   // Start passes props.track. A key-opened pane (props {view:"track"}) resolves once from where the person was (this.here)
   // and remembers it in this copy's localStorage (per copy — verified live), so a restart with focus elsewhere keeps it.
   // ponytail: a cached one-time resolution, not tracked state; if it names a removed worktree the pane says so.
   trackPath() {
     if (props()?.track) return props().track;
     if (this.pinned) return this.pinned;
     const saved = localStorage.getItem("forge.track");
     if (saved) return (this.pinned = saved);
     const p = trackFor(this.data.worktrees, this.here?.cwd);
     if (p) { this.pinned = p; localStorage.setItem("forge.track", p); }
     return p;
   }
   track() { const p = this.trackPath(); return p ? this.live().find((t) => t.path === p) ?? null : null; } // tracks() also holds PR-only Done items with path null: never match those
   ```
   - The only other `props().track` reads are `initDetail` (main.js:361) and `refresh` (main.js:118, `if (props()?.track) this.loadDoc(...)`). Change both to `this.trackPath()` (refresh: `if (this.route() === "track") this.loadDoc(...)`).
   - `loadDoc` and `save` already go through `this.track()`.

2. **`initDetail`'s watch loop:**
   - Before watching, wait for a path: `while (!this.trackPath()) await cx.sleep(1000);`.
   - Watch `${this.trackPath()}/docs`.
   - Its `catch` currently returns when data is loaded and `!this.track()` (the worktree is gone). Keep that: it only runs once a path exists.
   - Add `this.issueInfo = {}; this.prBody = null;` to `initDetail`'s fields.

3. **What `renderDetail` shows when there is no track:**
   - `this.error` with no data (`!this.data.worktrees.length && this.error`): show `this.error`.
   - Data still loading (`!this.data.worktrees.length`): "loading…".
   - `this.trackPath() == null` (data loaded, pane not in a linked worktree) — "Not in a track":
     - a heading `this.repoName() || "No repo"`;
     - the line "Not in a track.";
     - a primary button **+ Start work** → `this.openStart(null)`;
     - a button **Home** → `run("tab.new", { name: "Forge", mod: "forge", props: { view: "home" } })`. Omit `space`: Herdr uses the selected space. Task 5 swaps this call for `this.openHome()`.
   - A path but no track: the existing "This track's worktree is gone (shelved or removed)." text.

4. **Issues tab** (main.js:447-452). It stops reading `this.data.issues`, which is now fetched only by Backlog and Start.
   - Add a method:
     ```js
     async fetchIssues(cx) {
       const tr = this.track(); if (!tr) return;
       for (const n of tr.issues) { // sequential: remote exec rule
         const i = await this.cachedGh(`issue:${this.on ?? ""}:${this.root}:${n}`, ["issue", "view", String(n), "--json", "number,title,url,state"], this.root, this.on);
         this.issueInfo[n] = i === null ? { failed: true } : i.url?.includes("/issues/") ? i : { pr: true }; // gh issue view resolves PR numbers too
       }
       cx.notify();
     }
     ```
   - Call it from the Issues tab's `on_click` (`cx.spawn((cx) => this.fetchIssues(cx))`), and at the end of each successful `refresh()` when `this.route() === "track" && this.tab === "issues"`. Never call it from `render`.
   - Render each linked number:
     - `{pr: true}` → skip the row;
     - undefined → "loading…";
     - `{failed: true}` → "couldn't load";
     - otherwise the title, with dim text when `i.state === "CLOSED"`.
   - The tab label counts only entries that are not `{pr: true}`.

5. **PR tab** (main.js:444-446). It shows `tr.pr.body`, which is now slimmed (Task 1).
   - Fetch the full body when the tab opens: in the PR tab's `on_click`, spawn
     ```js
     this.cachedGh(`prbody:${this.on ?? ""}:${this.root}:${tr.pr.number}`, ["pr", "view", String(tr.pr.number), "--json", "body"], this.root, this.on)
     ```
     and store the result's `.body` in `this.prBody`, keyed by number (`this.prBody = { n, body }`).
   - Render `this.prBody?.n === tr.pr.number ? this.prBody.body : tr.pr.body`.

6. **Rail:** in "AGENTS ON THIS TRACK" (around main.js:461), remove any `a.msg` use and keep the status.

7. **Width:** pane widths are mostly under 720 px, so the existing `slim` layout applies. Take one shot at ~420 px to check truncation.

8. **Live check: two key-opened panes.**
   - Focus a terminal in worktree A, run `herdr-app do pane.split '{"direction":"right","mod":"forge","props":{"view":"track"}}'`, then do the same for worktree B.
   - Each pane must show its own track.
   - Close only the two panes you made: `pane.close {"pane": <id printed>}` is scoped by id.
   - If `localStorage` is shared across copies after all (both panes show the same track): delete the two `localStorage` lines, keep `this.pinned`, change the ponytail comment to "a key-opened pane re-resolves from focus after a restart; Start-opened panes carry props.track", and note the deviation in the PR.

- **Verify:**
  - `node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge && node --test herdr/mods/forge/model.test.js`
  - Step 8, with `herdr-app status` showing no errors.

## Task 5
**Home: one tab across every repo**

- **Exists because:** this is the dashboard the person asked for: everything waiting on them, in flight, planned and done, across projects, without reading agent panes.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:**
  - from the model: `homeGroups`, `tracks`, `agentsOn`, `chip`, `DONE_WINDOW_MS`;
  - from Task 2: `loadRepo`, `cachedGh`, `DAY`;
  - from Task 3: `route()`;
  - existing: `next()` (main.js:199), and `button`/`link`/`groupColor`/`header`/`empty` (main.js:215-229).
- **Produces:** `renderHome`, `openHome()`, `discoverRepos()`, and `openStart(issue, root, on)`.

**Steps:**

1. **Imports and fields.**
   - Import `readdir` from `fs/promises`; reading under home is allowed (AGENTS.md "Other built-ins"). Add `homeGroups` to the model import.
   - In `init`: `this.repos = []; this.found = { assigned: [], shelved: [], merged: [] }; this.homeErr = null; this.me = null;`.

2. **Repo discovery:**
   ```js
   // Repos = git roots behind open spaces (any machine) ∪ ~/.herdr/worktrees/* on this computer, deduped by machine + git common dir.
   // A rejected exec (unreachable machine, missing folder) is "unknown", not "not a repo": refreshHome keeps that machine's previous repos.
   async discoverRepos() {
     const seen = new Map(), unreachable = new Set(), tried = new Set();
     const add = async (cwd, on) => {
       const k = `${on ?? ""}\n${cwd}`; if (tried.has(k)) return false; tried.add(k);
       const r = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, on);
       if (r.failed && on) unreachable.add(on);
       if (!r.ok) return false;
       const root = r.out.replace(/\/\.git$/, ""); seen.set(`${on ?? ""}\n${root}`, { root, on: on ?? null }); return true;
     };
     for (const s of spaces()) if (s.folder) await add(s.folder, s.machine ?? null); // sequential: remote machines cap concurrent execs
     const base = `${home()}/.herdr/worktrees`;
     for (const e of await readdir(base, { withFileTypes: true }).catch(() => [])) {
       const p = `${base}/${e.name}`;
       if (await add(p, null)) continue; // a symlink to a repo, or a repo itself
       for (const k of await readdir(p, { withFileTypes: true }).catch(() => [])) if (k.isDirectory() && await add(`${p}/${k.name}`, null)) break; // a folder of worktrees: any one names the repo
     }
     return { repos: [...seen.values()], unreachable };
   }
   ```

3. **Home data.**
   - In `init`, when `this.route() === "home"`, call `this.refreshHome(cx)` instead of `this.refresh(cx)`.
   - The `GH_TTL` timer calls `this.route() === "home" ? this.refreshHome(cx) : this.refresh(cx)`.
   ```js
   refreshHome(cx) {
     cx.spawn(async (cx) => {
       if (this.refreshing) return; this.refreshing = true;
       try {
         const { repos, unreachable } = await this.discoverRepos(), out = [];
         for (const r of this.repos) if (r.on && unreachable.has(r.on) && !repos.some((x) => x.root === r.root && x.on === r.on)) repos.push({ root: r.root, on: r.on, stale: true });
         for (const { root, on, stale } of repos) { // sequential; PR lists come from the shared cache
           const prev = this.repos.find((r) => r.root === root && r.on === on)?.data ?? emptyData();
           if (stale) { out.push({ root, on, data: prev, error: `can't reach ${on} — showing the last data` }); continue; }
           const r = await this.loadRepo(root, on, prev);
           out.push({ root, on, data: r.ok ? r : prev, error: r.ok ? null : r.error });
         }
         const since = new Date(Date.now() - DONE_WINDOW_MS).toISOString().slice(0, 10);
         const search = (key, args) => this.cachedGh(key, ["search", ...args], home(), null);
         const issueFields = "repository,number,title,url,labels,createdAt"; // no body: Home never reads it and the cache persists
         const assigned = await search("s:assigned", ["issues", "--assignee", "@me", "--state", "open", "--limit", "100", "--json", issueFields]);
         const shelved = await search("s:shelved", ["issues", "--author", "@me", "--label", "shelved", "--state", "open", "--limit", "100", "--json", issueFields]);
         const merged = await search("s:merged", ["prs", "--author", "@me", "--merged-at", `>=${since}`, "--limit", "100", "--json", "repository,number,title,url,closedAt"]);
         this.repos = out;
         this.found = { assigned: assigned ?? this.found.assigned, shelved: shelved ?? this.found.shelved, merged: merged ?? this.found.merged };
         this.homeErr = [assigned, shelved, merged].includes(null) ? "gh search unavailable — Planned/Done may be stale" : null;
         this.me = await this.cachedGh("me:", ["api", "user"], home(), null, DAY, (u) => u.login);
         cx.notify();
       } finally { this.refreshing = false; }
     });
   }
   homeModel() { // live: agents() changes re-render this view by themselves
     const ps = panes();
     const repos = this.repos.map(({ root, on, data }) => {
       const ag = agentsOn(agents(), spaces(), on).map((a) => ({ address: a.address, status: a.status, cwd: ps.find((p) => p.pane === a.pane)?.cwd ?? null }));
       return { root, on, nwo: data.nwo, tracks: tracks({ worktrees: data.worktrees, docs: data.docs, prs: data.prs ?? [], agents: ag, ages: data.ages, ahead: data.ahead, me: this.me }) }; // this.me: this computer's gh user filters Done
     });
     return homeGroups({ repos, ...this.found });
   }
   ```

4. **`next()` and `openAgent()` take a repo context.**
   - `openAgent(path, task, argv, on = this.on)`. Inside it, use `on` for `knownAgents({ on })`, for the `spaces().find` machine match, and for `space.new { folder: path, machine: on ?? "", argv, task }` (the empty string means this computer).
   - `next(t, ctx = { root: this.root, on: this.on })`. Inside `next`, use `ctx.on` in:
     - the merged branch's `spaces().find` machine match;
     - `this.git(["status", "--porcelain"], t.path, ctx.on)`;
     - every `openAgent(…)` call, passing `ctx.on`.

     The merged fallback's `openAgent(this.root, …)` becomes `openAgent(ctx.root, …, undefined, ctx.on)`.
   - Existing callers pass nothing, so their behaviour is unchanged.

5. **Header and colours.**
   - Give `header(t, title, right, sub = \`${this.repoName()} · ${this.base.replace("origin/", "")}\`)` a fourth parameter `sub`, and print `sub` where it now builds that string.
   - Add `planned: t.ansi12` to `groupColor`'s map.

6. **`renderHome`.** Follow the old sidebar's rows and the old board's chip and progress bar (see "The old views" in Context), and the design's mockup.
   - **Header:** `this.header(t, "Home", [this.button(t, "start", "+ Start work", () => this.openStart(null, null, null), true)], "all repos")`.
   - **Errors:** under the header, `this.homeErr` and each repo's `error` as `this.empty(t, …)` lines.
   - **Body:** `v_flex().id("home-body").flex_1().min_h(0).overflow_y_scroll()`.
   - **Group headers:** for each group of `this.homeModel()`, a line `TITLE · n` in uppercase, coloured `this.groupColor(t, key)`. Done's line reads `DONE · n${DONE_SUFFIX}`.
   - **Rows:** one `h_flex` line each; every truncating child gets `.min_w(0)`. Call the item `it`.
     - **needs / flight track** (`it.path` set):
       - `it.repo` in muted mono, `w(120)`, truncated;
       - `it.branch`, truncated;
       - the status: if `it.agents.length`, the chip (a rounded pill, colour from the group, text `chip(it)`); otherwise the muted text `○ no agent · ${it.ahead} ahead · ${ago(it.at)}`;
       - when `it.progress?.total`, the text `${it.progress.done}/${it.progress.total}`;
       - when `it.pr`, `this.link(t, …, \`PR #${it.pr.number}\`, it.pr.url)`;
       - the primary button from `const nx = this.next(it, { root: it.root, on: it.on })`. For a blocked agent its label is "Answer", which focuses that agent's terminal: this is the "Go to pane" jump.
       - **Row click** (not the button): `const sp = spaces().find((s) => s.folder === it.path && (s.machine ?? null) === (it.on ?? null))`. If `sp`, run `run("space.select", { id: sp.id })`; otherwise run `run("space.new", { folder: it.path, machine: it.on ?? "" })`.
     - **planned:**
       - `it.repo`, `#${it.issue.number}`, the title (truncated), then muted `shelved` or `assigned`, then `ago(it.at)`;
       - when `it.root`, a **Start** button (labelled **Resume** when `it.shelved`) → `this.openStart(it.issue.number, it.root, it.on)`;
       - always `this.link(t, …, "", it.issue.url)`, which renders `↗`;
       - no row click.
     - **done:**
       - `it.repo`, `#${it.pr.number}` and title, `merged ${ago(it.at)}`, and a `↗` link to `it.pr.url`;
       - when `it.path` (the worktree still exists), the `next()` button too ("Remove worktree");
       - row click: none when `it.path` is null.
   - **Empty group:** `this.empty(t, "nothing")`.
   - **Under Planned:** a line `Backlogs:` followed by one `this.button` per entry of `this.repos`, labelled with the folder name. Each runs `run("tab.new", { name: "Backlog", mod: "forge", props: { view: "backlog", root: r.root, on: r.on } })`.

7. **Wire it up.**
   - In `render()`'s switch, point `home` at `renderHome`.
   - Add `openHome() { run("tab.new", { name: "Forge", mod: "forge", props: { view: "home" } }); }`. Omit `space`: Herdr uses the selected space.
   - Put a **Home** button (`() => this.openHome()`) in the Backlog header where Board was. Change Task 4's Home button to `this.openHome()`.

8. **`openStart(issue, root = this.root, on = this.on)`**, where `issue` is a number or null. Its overlay props become `{ view: "start", root, on, issue }`. Update the two Backlog call sites, main.js:333 (`this.openStart(i)` → `this.openStart(i.number)`) and :348 (same).

- **Verify:**
  - `node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge && node --test herdr/mods/forge/model.test.js`
  - Live: `herdr-app do tab.new '{"name":"Forge","mod":"forge","props":{"view":"home"}}'`. Then `herdr-app status` shows no errors, and a shot shows the four groups. If this machine has only one repo with worktrees, say so in the PR note rather than creating repos.
  - Close only that tab, by its id.

## Task 6
**Start: works from a key, picks a repo when none is focused, opens the track pane**

- **Exists because:**
  - `⌘⇧N` runs `mod.open:forge`, whose overlay arrives as `{overlay}` only.
  - Home's header Start has no repo.
  - A new worktree should open with its track pane beside the agent, so nobody has to press `⌘⇧J` there.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `discoverRepos` (Task 5), `route()` and `this.here` (Task 3), `openStart(issue, root, on)` (Task 5).

**Steps:**

1. **Repo picker.**
   - Add `this.pickRepos = null;` to `initStart`.
   - In `refresh()`'s branch without a root:
     - when the resolved folder is not a git repo (the `!common.ok` path, which sets "no git repo in this space");
     - and also when `this.here.cwd` is missing;
     - and `this.route() === "start"`:

     spawn `const { repos } = await this.discoverRepos(); this.pickRepos = repos; cx.notify();`.
   - Home's Start passes `root: null`, so `this.here` is resolved from location. If the focused space is a repo, Start uses it. That's fine.
   - In `renderStart`, when `!this.root && this.pickRepos?.length`, render a "Start work in…" list in place of the issue list:
     - one row per repo, labelled `r.root.split("/").pop()`, with `r.on` in muted text when set;
     - clicking a row runs `this.root = r.root; this.on = r.on; this.here = null; this.error = null; this.resetData(); this.refresh(cx);`.
   - While `!this.root` and `pickRepos` is still null, show "finding repos…".
   - In the dialog header, print `sub` as `this.root ? (default) : "pick a repo"` (via `header`'s fourth parameter).

2. **Dismiss** (main.js:535) needs no change: `props().overlay` is set for `mod.open` (verified).

3. **The track pane beside the agent.** In `start()`, after `await this.openAgent(path, task, argv);` and before `this.dismiss();`, add:
   ```js
   run("pane.split", { direction: "right", mod: "forge", props: { view: "track", track: path, root: this.root, on: this.on } }); // run() returns no ids: this splits the focused pane, which openAgent's space.new/tab.new just made
   ```

4. **Live check of step 3**, in a throwaway repo:
   ```bash
   S=/tmp/forge-start-check; rm -rf "$S" "$S.git"; git init -q -b main "$S" && git -C "$S" commit -q --allow-empty -m init && git clone -q --bare "$S" "$S.git" && git -C "$S" remote add origin "$S.git" && git -C "$S" fetch -q origin
   herdr-app do space.new "{\"folder\":\"$S\"}"   # note the space id it prints
   ```
   - With that space focused, run `herdr-app do mod.open '{"name":"forge"}'`, choose **From scratch**, type `check split`, and Start.
   - It creates a worktree under `~/.herdr/worktrees/forge-start-check/` and a new space for it. Confirm the track pane lands in that new space, beside the agent.
   - **If it lands elsewhere:** remove the step-3 line, add `// ponytail: run() returns no ids, so the new space can't be targeted; press ⌘⇧J there`, and note the deviation.
   - **Cleanup**, only what you made:
     - `herdr-app do space.close '{"id":"<new worktree space id>","confirmed":true}'` and the same for the `$S` space;
     - then `git -C "$S" worktree remove ~/.herdr/worktrees/forge-start-check/feat-check-split`, never `--force`. If it refuses (the agent left files), leave it and report the path.
     - Otherwise `rm -rf "$S" "$S.git" ~/.herdr/worktrees/forge-start-check`.

5. **The key path.**
   - `herdr-app do mod.open '{"name":"forge"}'` with a repo space focused opens Start for that repo, and the issue list loads.
   - Calling it again closes the dialog.
   - With a non-repo space focused, it shows the repo picker.

- **Verify:**
  - `node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge`
  - Steps 4-5, with `herdr-app status` showing no errors.

## Task 7
**Install: keys, the hide hint, README**

- **Exists because:** without the keys there is no way to open Home, Start or a track pane from the keyboard. Without hiding the old block, a dead "Forge moved" notice keeps 340 px of the window. The README still describes the dock.
- **Model:** sonnet
- **Files:** `scripts/install-herdr-mod.sh`, `README.md`

**Steps:**

1. **Restructure the symlink step** so the steps after it always run. Today the `already linked` path `exit 0`s.
   ```bash
   linked=
   if [ -L "$dst" ]; then
     if [ "$(readlink "$dst")" = "$src" ]; then linked=1; echo "install-herdr-mod: already linked"; else rm "$dst"; fi
   elif [ -e "$dst" ]; then
     mv "$dst" "$(dirname "$(dirname "$dst")")/forge-mod.bak-$(date +%Y%m%d%H%M%S)" # out of mods/, or Herdr loads the backup as a second mod
   fi
   [ -n "$linked" ] || { ln -s "$src" "$dst"; echo "install-herdr-mod: $dst -> $src"; }
   ```

2. **Keys, then the hide hint.** Append:
   ```bash
   app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
   node - "$app" <<'EOF'
   const fs = require("fs"), path = require("path"), app = process.argv[2], f = path.join(app, "keys.json");
   const want = {
     "cmd-shift-h": { command: "tab.new", args: { name: "Forge", mod: "forge", props: { view: "home" } } },
     "cmd-shift-n": "mod.open:forge",
     "cmd-shift-j": { command: "pane.split", args: { direction: "right", mod: "forge", props: { view: "track" } } },
   };
   let k = null;
   try { k = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(e.code === "ENOENT" ? `install-herdr-mod: no ${f} yet (Herdr writes it on first run); keys not added — open Herdr once, then rerun.` : `install-herdr-mod: ${f} is not valid JSON; keys not added.`); }
   if (k) {
     const g = (k.global ??= {}); let changed = false;
     for (const [key, act] of Object.entries(want)) {
       if (JSON.stringify(g[key]) === JSON.stringify(act)) continue;
       if (key in g) { console.log(`install-herdr-mod: ${key} is already bound to ${JSON.stringify(g[key])}; left it. Bind Forge yourself if you want it.`); continue; } // AGENTS.md: ask before replacing a key they use
       g[key] = act; changed = true;
     }
     if (changed) { fs.writeFileSync(f, JSON.stringify(k, null, 2) + "\n"); console.log("install-herdr-mod: added Forge keys (⌘⇧H Home, ⌘⇧N Start, ⌘⇧J track pane). keys.json is now yours: new Herdr default shortcuts won't arrive automatically."); }
   }
   // The old docked block: print how to hide it; never hide it ourselves (the person decides; layout.show undoes it).
   const dir = path.join(app, "layouts");
   for (const name of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith(".json"))) {
     let tree; try { tree = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
     const found = [], walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "block" && n.content?.mod === "forge" && n.id) found.push(n.id); for (const v of Object.values(n)) walk(v); };
     walk(tree);
     for (const id of found) console.log(`install-herdr-mod: layout ${name} still has the old docked Forge block. Hide it: herdr-app do layout.hide '{"id":"${id}"}'   (undo: layout.show)`);
   }
   EOF
   ```

3. **README.** Rewrite the `## Herdr work panel` section (README.md:36-38) to say:
   - A bundled Herdr mod shows your forge work: a **Home** tab across every repo (waiting on you, in flight including drafts on main, planned, done), a **track pane** per worktree (design / plan / PR / issues, Shelve), a per-repo **backlog**, and a **Start work** dialog.
   - Install with `bash scripts/install-herdr-mod.sh`. It symlinks the mod, adds ⌘⇧H / ⌘⇧N / ⌘⇧J to `keys.json`, and prints the command to hide the old docked block.
   - To go back to the docked sidebar, run the script from a checkout of the older version, and run `herdr-app do layout.show '{"id":"<id>"}'`.

- **Verify:**
  ```bash
  bash -n scripts/install-herdr-mod.sh
  H=$(mktemp -d); echo '{"global":{}}' > "$H/keys.json"
  HERDR_APP_HOME=$H bash scripts/install-herdr-mod.sh   # adds three keys
  HERDR_APP_HOME=$H bash scripts/install-herdr-mod.sh   # "already linked", adds nothing
  node -e 'const k=require(process.argv[1]).global; if(Object.keys(k).length!==3) process.exit(1)' "$H/keys.json"
  H2=$(mktemp -d); echo '{"global":{"cmd-shift-h":"app.help"}}' > "$H2/keys.json"
  HERDR_APP_HOME=$H2 bash scripts/install-herdr-mod.sh | grep -q 'already bound'
  rm -rf "$H" "$H2"
  ```

## Task 8
**Drafts on main: designs and plans not yet dispatched show up**

- **Exists because:** brainstorm and plan write their files uncommitted in the main checkout, and the worktree only appears at dispatch. Until then that work is invisible: Home doesn't list it, and a track pane on main says only "Not in a track". The uncommitted files are already how `/forge:plan` finds a design, so this is derivable state.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/model.js`, `herdr/mods/forge/model.test.js`, `herdr/mods/forge/main.js`
- **Consumes:** `homeGroups` (Task 1), `loadRepo` (Task 2), the "Not in a track" state (Task 4), `renderHome` and `openAgent(…, on)` (Task 5).
- **Produces:** `drafts(porcelain)`, plus a `drafts` field on `loadRepo`'s result and on `this.data`.

**Steps, test-first:**

1. Add tests to `model.test.js`, merging `drafts` into the import:
   ```js
   test("drafts pairs new design/plan files by slug; ignores modified committed docs", () => {
     const out = [
       "?? docs/decisions/2026-11-06-forge-home.md",
       "?? docs/plans/2026-11-06-forge-home.md",
       "A  docs/decisions/2026-11-05-other.md",
       " M docs/decisions/2026-11-01-old.md",
       "?? docs/plans/notes.txt",
     ].join("\n");
     assert.deepEqual(drafts(out), [
       { slug: "forge-home", design: "docs/decisions/2026-11-06-forge-home.md", plan: "docs/plans/2026-11-06-forge-home.md" },
       { slug: "other", design: "docs/decisions/2026-11-05-other.md", plan: null },
     ]);
     assert.deepEqual(drafts(""), []);
   });

   test("homeGroups puts drafts in flight between agent-backed and no-agent tracks", () => {
     const t = (over) => ({ path: "/w/x", branch: "feat/x", slug: "x", pr: null, agents: [], issues: [], at: 100, merged: false, group: "hold", ...over });
     const g = homeGroups({ repos: [{ root: "/code/forge", on: null, nwo: "o/forge", tracks: [t({ path: "/w/h", group: "hold" }), t({ path: "/w/f", group: "flight" })],
       drafts: [{ slug: "forge-home", design: "docs/decisions/2026-11-06-forge-home.md", plan: null }] }] });
     const flight = g.find((x) => x.key === "flight").items;
     assert.deepEqual(flight.map((i) => i.path ?? `draft:${i.slug}`), ["/w/f", "draft:forge-home", "/w/h"]);
     assert.equal(flight[1].draft, true);
     assert.equal(flight[1].root, "/code/forge");
   });
   ```

2. Implement `drafts` in `model.js`:
   ```js
   // New, uncommitted design/plan files in a checkout (`git status --porcelain --untracked-files=all -- docs/decisions docs/plans`):
   // the work brainstorm/plan are writing before a worktree exists. Only new files (?? or A); an edit to a committed doc is not a draft.
   export function drafts(porcelain) {
     const by = new Map();
     for (const line of (porcelain ?? "").split("\n")) {
       const m = /^(\?\?|A[ MD]) (docs\/(decisions|plans)\/\d{4}-\d{2}-\d{2}-(.+)\.md)$/.exec(line.trimEnd());
       if (!m) continue;
       const [, , file, dir, slug] = m, d = by.get(slug) ?? { slug, design: null, plan: null };
       d[dir === "decisions" ? "design" : "plan"] = file; by.set(slug, d);
     }
     return [...by.values()];
   }
   ```

3. **In `homeGroups`:**
   - After the tracks loop for each repo, add:
     ```js
     for (const d of r.drafts ?? []) items.flight.push({ draft: true, path: null, slug: d.slug, design: d.design, plan: d.plan, repo, root: r.root, on: r.on ?? null, agents: [], issues: [], at: 0, group: "draft" });
     ```
   - Change `rank` to `(it) => (it.group === "flight" ? 0 : it.draft ? 1 : 2)`. The existing sort expression already keeps rank 1 in insertion order.
   - Task 1's test must still pass unchanged.

4. **In `loadRepo`**, after `parseWorktrees`:
   ```js
   const st = await git(["status", "--porcelain", "--untracked-files=all", "--", "docs/decisions", "docs/plans"], root);
   const dr = st.ok ? drafts(st.out) : (prev.drafts ?? []); // could not run ≠ no drafts
   ```
   - Return `drafts: dr`, and add `drafts: []` to `emptyData()`.
   - `refresh()` copies `drafts: r.drafts` into `this.data`.
   - `homeModel()` passes `drafts: data.drafts` in each repo object.

5. **Home row for a draft** (`it.draft`, in the flight group):
   - `it.repo` (muted mono, 120 px), `it.slug`, muted `design ✓`/`design –` and `plan ✓`/`plan –`, and `on main`.
   - One primary button, labelled **Dispatch** when `it.plan` and **Plan** otherwise, both running `this.openAgent(it.root, \`/forge:start ${it.plan ?? it.design}\`, undefined, it.on)`. `/forge:start` routes by what it is given: a design goes to plan, a plan goes to build.
   - No row click.

6. **Track pane on main:** in Task 4's "Not in a track" state, when `this.data.drafts?.length`, add a section headed "Drafts here (not dispatched yet)":
   - one row per draft: `slug · design ✓/– · plan ✓/–`;
   - a **Read** button per existing file: `exec("open", [\`${this.root}/${file}\`])`;
   - the same Plan/Dispatch button as step 5, using `this.root` and `this.on`.

   Keep **+ Start work** and **Home** below it.

- **Verify:**
  - `node --test herdr/mods/forge/model.test.js && node --check herdr/mods/forge/main.js && herdr-app check herdr/mods/forge`
  - Live: with an uncommitted `docs/decisions/<date>-x.md` in a repo's main checkout (create it, then delete it afterwards), Home's In flight shows it as `on main`.
