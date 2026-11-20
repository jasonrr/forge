# Plan: Forge Home redesign (command center, step 1 of 3)

- **Goal:** redraw Forge Home on today's data so it reads as designed: a small UI kit, two-line rows, colour only on status, one action per row, keyboard navigation, one health indicator, a Dock badge. No new data sources. Steps 2 (Linear) and 3 (task runs) of the design get their own plans later.
- **Design:** `docs/decisions/2026-11-20-command-center.md` (step 1 of "Chosen approach"). /forge:plan moves this plan and the design into the build's worktree and /forge:build commits both first; no task below needs the design's text.
- **Branch:** `feat/command-center`
- **Verify (whole feature):** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && bash hooks/session-start.test.sh`

## Read this first (applies to every task)

- **Commits and PR:** /forge:build commits once per task and opens the draft PR whose body is the task checklist; tasks here never push or open a PR themselves.
- **Shell:** variables do not survive between commands. Any command that uses `$WT` or `$ROOT` starts with `WT=$(git rev-parse --show-toplevel); ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)");` (`WT` is this worktree, `ROOT` the main checkout).
- **API types:** `herdr.d.ts` and `gpui-kit.d.ts` are generated and git-ignored, so a fresh worktree has none. Read them at `~/.config/herdr-app/herdr.d.ts` and `~/.config/herdr-app/gpui-kit.d.ts`.
- **Prerequisite, stop condition:** PR #46 (Refresh button on Home) must already be on `origin/main` (it was merged on 2026-11-20). Run `grep -c "this.force" herdr/mods/forge/main.js`. If it prints `0`, stop and report "PR #46 is not merged"; do not re-implement it.
- Only the Home view changes (`renderHome` and what it needs). Do not restyle `renderBacklog`, `renderDetail`, `renderStart` or `renderMoved`, and do not remove `button()`, `link()`, `header()`, `empty()`, `groupColor()`: those views still use them.
- The mod has no build step. Files in `herdr/mods/forge/` are loaded by Herdr through a symlink (`~/.config/herdr-app/mods/forge` → the main checkout's `herdr/mods/forge`), so a worktree's edits are not live until Task 6 repoints it.
- gpui rules from `docs/learnings.md` and `~/.config/herdr-app/AGENTS.md` that this plan's code already follows; keep them when editing:
  - Every shrinkable text needs `.min_w(0)` on itself or its flex parent (learnings.md:21).
  - Colours are `#rgb`/`#rrggbb`/`#rrggbbaa` literals only; use the existing `NONE` constant, never `"transparent"` (main.js:19).
  - Never keep a `cx` for later; every callback gets its own (`~/.config/herdr-app/AGENTS.md:981`).
  - `close(cx)` is Herdr's lifecycle hook (`~/.config/herdr-app/AGENTS.md:990`). Task 5 defines it on purpose; no other method may be named `close`.
  - `herdr-app check` passes a mod whose render throws (learnings.md:39). After any `main.js` edit, grep every newly used name against the import lines.
- New instance fields this plan adds to the `Forge` view (and the new methods `homeView`, `homeKey`, `syncBadge`, `close`), all unused today (checked against every `this.<field>` in main.js): `cur`, `order`, `doneOpen`, `scroll`, `keys`, `reveal`, `badge`. Do not reuse `this.sel` (the Start view owns it) or `this.base`.
- Commits: no AI attribution of any kind (repo `AGENTS.md`).

## Task 1
**UI kit: copy a subset of cockpit's ui.js and twelve icons into the mod**

- **Exists because:** Home's spacing, type sizes and buttons are ad hoc; the design takes an existing MIT kit built on the same gpui API instead of writing one.
- **Model:** sonnet
- **Files:** create `herdr/mods/forge/ui.js`, `herdr/mods/forge/icons/*.svg` (12 files), `herdr/mods/forge/THIRD_PARTY_NOTICES.md`.
- **Produces for Tasks 3–4:** named exports `RADIUS`, `TEXT`, `tokens`, `Icon`, `Spinner`, `keyLabel`, `Kbd`, `Button`, `Skeleton`, `SectionHeader`, `KeyHints`, `Mono`.
- **Source:** `~/.claude/plugins/marketplaces/cockpit/app/mods/cockpit/ui.js` (identical to `~/.config/herdr-app/mods/cockpit/ui.js`). If neither path exists, stop and report.

Steps:

1. Create `herdr/mods/forge/ui.js`. First lines:
   ```js
   // A subset of cockpit's design kit (https://github.com/quaresc/cockpit — MIT, see THIRD_PARTY_NOTICES.md), copied 2026-11-20:
   // shadcn/ui proportions drawn with GPUI elements, colored from Herdr's theme(). Changed here: Icon's path, Mono's font.
   // Rhythm: a 4px grid, 13px body, 12px secondary, 11px captions; radius 6 (controls), 4 (kbd); color only for state.
   import { div, svg } from "gpui-kit";
   import { h_flex } from "gpui-base";
   import { theme, settings } from "herdr";
   ```
2. Copy these blocks from the source file verbatim, in this order, each with its doc comment (line numbers are the source's): `RADIUS` and `TEXT` (11–12); `tokens` (14–44); `Icon` (56–60); `Spinner` (62–65); `MODIFIER` (72); `keyLabel` (74–81); `Kbd` (83–108); `BUTTON` (136–144); `SIZE` (145); `Button` (147–181); `Skeleton` (the function starting at 208, with its doc comment above it); `SectionHeader` (the function starting at 354, with its doc comment); `KeyHints` (the function starting at 486, with its doc comment); `Mono` (the function starting at 1102, with its doc comment). Do not copy `alpha` (nothing in this subset calls it, and main.js has its own `alpha`). Copy whole functions: find each by its `export function <Name>` line and take through its closing brace.
3. Two edits to the copy, nothing else:
   - In `Icon`: `svg(\`mods/cockpit/icons/${name}.svg\`)` → `svg(\`mods/forge/icons/${name}.svg\`)`.
   - In `Mono`: `.font_family("JetBrains Mono")` → `.font_family(settings().font_family)` (the mod's rule: the terminal's mono font, main.js:15).
4. Copy these files from `~/.config/herdr-app/mods/cockpit/icons/` into `herdr/mods/forge/icons/` unchanged: `chevron-down.svg chevron-right.svg circle-check.svg circle-dashed.svg circle-help.svg circle.svg external.svg git-pull-request.svg loader.svg plus.svg refresh-cw.svg triangle-alert.svg`.
5. Create `herdr/mods/forge/THIRD_PARTY_NOTICES.md` with two sections, each holding text copied unchanged from `~/.claude/plugins/marketplaces/cockpit/`:
   - `## ui.js — from cockpit (https://github.com/quaresc/cockpit), MIT`: the whole of that repo's `LICENSE` file (starts "MIT License", "Copyright (c) 2026 quaresc").
   - `## icons/ — Lucide, ISC (some derived from Feather, MIT)`: from that repo's `THIRD_PARTY_NOTICES.md`, everything under the heading `## ISC License: Lucide` up to, but not including, the next line that starts with `## `. That block already contains the ISC text, the `---` separator, the list of Feather-derived icon names and the Feather MIT text ("Copyright (c) 2013-present Cole Bemis"); keep all of it, including the list. Do not copy the source's own `## ISC License: Lucide` heading line; the new heading replaces it.

- **Verify:** `cd herdr/mods/forge && test "$(ls icons/*.svg | wc -l | tr -d ' ')" = 12 && ! grep -q "mods/cockpit\|JetBrains" ui.js && for n in RADIUS TEXT tokens Icon Spinner keyLabel Kbd Button Skeleton SectionHeader KeyHints Mono; do grep -qE "^export (const|function) $n\b" ui.js || { echo "missing $n"; exit 1; }; done && grep -q "quaresc" THIRD_PARTY_NOTICES.md && grep -q "Lucide" THIRD_PARTY_NOTICES.md && grep -q "Cole Bemis" THIRD_PARTY_NOTICES.md && echo OK` prints `OK`.

## Task 2
**Model: Home rows as pure data (`age`, `humanize`, `homeRow`, `backlogRow`), new lane titles**

- **Exists because:** the row's words (title, the one-sentence meta line, status tone) are the part of the redesign that can be wrong silently; in `model.js` they run under `node --test`, in `main.js` nothing tests them.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/model.js`, `herdr/mods/forge/model.test.js`.
- **Consumes:** existing `lead`, `kind`, `isParked` in `model.js`; the item shapes `homeGroups` returns (model.js, `homeGroups`).
- **Produces for Task 3:** exports `age`, `humanize`, `homeRow`, `backlogRow`; `HOME_GROUPS` titles become `Needs you`, `In progress`, `Up next`, `Done this week`.

Steps, test first:

1. In `model.test.js`, add `age, humanize, homeRow, backlogRow` to the second `./model.js` import (line 7, the one that already lists `homeGroups`) and append:
   ```js
   test("age: m/h/d from unix seconds; unknown (0 or null) is null", () => {
     const now = 1_000_000_000_000;
     assert.equal(age(now / 1000 - 20, now), "now");
     assert.equal(age(now / 1000 - 120, now), "2m");
     assert.equal(age(now / 1000 - 7200, now), "2h");
     assert.equal(age(now / 1000 - 3 * 86400, now), "3d");
     assert.equal(age(0, now), null);
     assert.equal(age(null, now), null);
   });

   test("humanize: a slug as a title", () => {
     assert.equal(humanize("home-refresh"), "Home refresh");
     assert.equal(humanize("yaml_desc--fix"), "Yaml desc fix");
     assert.equal(humanize(""), "");
     assert.equal(humanize(null), "");
   });

   test("homeRow: one title and one meta sentence per item, tone only from state", () => {
     const now = 1_000_000_000_000, at = now / 1000 - 3600;
     const base = { repo: "forge", root: "/r/forge", on: null, path: "/wt/a", branch: "feat/home-refresh", slug: "home-refresh", issues: [], at, ahead: 4, progress: { done: 0, total: 0 }, pr: null, merged: false };
     assert.deepEqual(homeRow("needs", { ...base, agents: [{ status: "blocked" }], progress: { done: 3, total: 5 } }, now),
       { key: "t::/wt/a", lane: "needs", dense: false, tone: "blocked", icon: "circle-help", ref: null, title: "Home refresh", meta: "forge · agent is waiting on you · 3 of 5 tasks", url: null });
     const pr = { number: 27, title: "Fix YAML parsing", url: "https://x/pull/27", isDraft: false, state: "OPEN" };
     assert.deepEqual(homeRow("needs", { ...base, agents: [], pr }, now),
       { key: "t::/wt/a", lane: "needs", dense: false, tone: "blocked", icon: "git-pull-request", ref: null, title: "Fix YAML parsing", meta: "forge · PR #27 ready for review · 1h", url: "https://x/pull/27" });
     assert.deepEqual(homeRow("flight", { ...base, on: "mini", agents: [{ status: "working" }], pr: { ...pr, isDraft: true }, progress: { done: 1, total: 4 } }, now),
       { key: "t:mini:/wt/a", lane: "flight", dense: false, tone: "working", icon: "loader", ref: null, title: "Fix YAML parsing", meta: "forge @ mini · agent working · 1 of 4 tasks · draft PR #27", url: "https://x/pull/27" });
     assert.deepEqual(homeRow("flight", { ...base, agents: [] }, now),
       { key: "t::/wt/a", lane: "flight", dense: false, tone: "idle", icon: "circle", ref: null, title: "Home refresh", meta: "forge · no agent · 4 commits ahead · 1h", url: null });
     assert.equal(homeRow("flight", { ...base, agents: [{ status: "idle" }], ahead: null, at: 0 }, now).meta, "forge · agent idle"); // unknown ahead and age: the segments drop
     assert.equal(homeRow("flight", { ...base, agents: [], ahead: 1 }, now).meta, "forge · no agent · 1 commit ahead · 1h");
     assert.deepEqual(homeRow("flight", { draft: true, path: null, slug: "command-center", design: "docs/decisions/x.md", plan: null, repo: "forge", root: "/r/forge", on: null, agents: [], issues: [], at: 0 }, now),
       { key: "draft::/r/forge:command-center", lane: "flight", dense: false, tone: "idle", icon: "circle-dashed", ref: null, title: "Command center", meta: "forge · draft on main · design written", url: null });
     assert.equal(homeRow("flight", { draft: true, path: null, slug: "x", design: "d.md", plan: "p.md", repo: "forge", root: "/r/forge", on: null, agents: [], issues: [], at: 0 }, now).meta, "forge · draft on main · plan written");
     const issue = { number: 31, title: "Board follows focus", url: "https://x/issues/31", repository: { nameWithOwner: "me/forge", name: "forge" } };
     assert.deepEqual(homeRow("planned", { issue, shelved: true, repo: "forge", root: "/r/forge", on: null, at: now / 1000 - 2 * 86400 }, now),
       { key: "planned:me/forge#31", lane: "planned", dense: true, tone: "idle", icon: "circle-dashed", ref: "#31", title: "Board follows focus", meta: "forge · shelved · 2d", url: "https://x/issues/31" });
     assert.deepEqual(homeRow("done", { ...base, path: null, branch: null, agents: [], pr: { ...pr, state: "MERGED" }, merged: true, at: now / 1000 - 86400 }, now),
       { key: "t::https://x/pull/27", lane: "done", dense: true, tone: "done", icon: "circle-check", ref: "#27", title: "Fix YAML parsing", meta: "forge · merged 1d", url: "https://x/pull/27" });
   });

   test("backlogRow: an open issue as a dense row", () => {
     const now = 1_000_000_000_000;
     assert.deepEqual(backlogRow({ number: 9, title: "Login 500s", url: "https://x/issues/9", labels: [{ name: "bug" }], createdAt: new Date(now - 5 * 86400000).toISOString() }, now),
       { key: "backlog:#9", lane: "backlog", dense: true, tone: "idle", icon: "circle-dashed", ref: "#9", title: "Login 500s", meta: "bug · 5d", url: "https://x/issues/9" });
     assert.equal(backlogRow({ number: 9, title: "t", url: "u", labels: [], createdAt: "nonsense" }, now).meta, "");
   });
   ```
   Run `node --test herdr/mods/forge/model.test.js`: the whole file now fails to load (the four names are not exported yet). That is the failing state.
2. In `model.js`, change the `HOME_GROUPS` line to:
   ```js
   export const HOME_GROUPS = [["needs", "Needs you"], ["flight", "In progress"], ["planned", "Up next"], ["done", "Done this week"]];
   ```
   No existing test asserts the titles (model.test.js compares the keys only), so no existing test changes.
3. In `model.js`, directly after the `homeGroups` function, add:
   ```js
   // --- Home rows: what a row says, as data (main.js draws it and attaches the action) ---
   // Unix seconds → "now" / "12m" / "3h" / "2d". Unknown (0, null, NaN) is null: the caller drops the segment, never prints 0.
   export function age(sec, now = Date.now()) {
     if (!sec || !Number.isFinite(sec)) return null;
     const d = Math.max(0, now / 1000 - sec);
     return d < 60 ? "now" : d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`;
   }
   // "home-refresh" → "Home refresh": the only title a track without a PR has.
   export function humanize(slug) {
     const s = (slug ?? "").replace(/[-_]+/g, " ").trim();
     return s ? s[0].toUpperCase() + s.slice(1) : "";
   }
   // One homeGroups item as a row. tone: blocked | working | idle | done (the glyph's color — the only color on a row).
   // dense: a one-line row (Up next, Done); otherwise title over one meta sentence. ref: the mono identifier of a dense row.
   // key: a track's is its machine + worktree (or PR url), never its lane, so Home's selection stays on a track that changes lane.
   export function homeRow(lane, it, now = Date.now()) {
     const meta = (...parts) => [it.on ? `${it.repo} @ ${it.on}` : it.repo, ...parts].filter(Boolean).join(" · ");
     if (lane === "planned") {
       const i = it.issue;
       return { key: `planned:${i.repository?.nameWithOwner ?? it.repo}#${i.number}`, lane, dense: true, tone: "idle", icon: "circle-dashed", ref: `#${i.number}`, title: i.title, meta: meta(it.shelved ? "shelved" : null, age(it.at, now)), url: i.url ?? null };
     }
     if (it.draft) return { key: `draft:${it.on ?? ""}:${it.root}:${it.slug}`, lane, dense: false, tone: "idle", icon: "circle-dashed", ref: null, title: humanize(it.slug), meta: meta("draft on main", it.plan ? "plan written" : it.design ? "design written" : null), url: null };
     const key = `t:${it.on ?? ""}:${it.path ?? it.pr?.url}`, title = it.pr?.title ?? humanize(it.slug), url = it.pr?.url ?? null;
     if (lane === "done") return { key, lane, dense: true, tone: "done", icon: "circle-check", ref: it.pr ? `#${it.pr.number}` : null, title, meta: meta(["merged", age(it.at, now)].filter(Boolean).join(" ")), url };
     const a = lead(it), tasks = it.progress?.total ? `${it.progress.done} of ${it.progress.total} tasks` : null;
     const pr = it.pr ? `${it.pr.isDraft ? "draft " : ""}PR #${it.pr.number}` : null;
     const row = (tone, icon, ...parts) => ({ key, lane, dense: false, tone, icon, ref: null, title, meta: meta(...parts), url });
     if (a?.status === "blocked") return row("blocked", "circle-help", "agent is waiting on you", tasks);
     if (lane === "needs" && it.pr) return row("blocked", "git-pull-request", `PR #${it.pr.number} ready for review`, age(it.at, now));
     if (a?.status === "working") return row("working", "loader", "agent working", tasks, pr);
     return row("idle", "circle", a ? `agent ${a.status}` : "no agent", it.ahead ? `${it.ahead} commit${it.ahead === 1 ? "" : "s"} ahead` : null, pr, age(it.at, now));
   }
   // An open issue of the shown repo's backlog as a dense row.
   export function backlogRow(i, now = Date.now()) {
     const k = kind(i) ?? (isParked(i) ? "agent" : null);
     return { key: `backlog:#${i.number}`, lane: "backlog", dense: true, tone: "idle", icon: "circle-dashed", ref: `#${i.number}`, title: i.title, meta: [k, age(Date.parse(i.createdAt) / 1000, now)].filter(Boolean).join(" · "), url: i.url ?? null };
   }
   ```
   `lead`, `kind` and `isParked` are already defined in `model.js`; if `isParked` is declared below this point as a `const`, that is fine (it is only called at run time).

- **Verify:** `node --test herdr/mods/forge/model.test.js` — every test passes, including the four new ones.

## Task 3
**Home view: redraw `renderHome` with the kit and the row model**

- **Exists because:** this is the redesign itself; without it Tasks 1–2 are unused files.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` only.
- **Consumes:** Task 1's `ui.js` exports; Task 2's `homeRow`, `backlogRow`; existing methods `homeModel`, `hereRepo`, `next`, `draftStart`, `openStart`, `spaceAt`, `openGitHub`, `refreshHome`, `narrow`.
- **Produces for Tasks 4–5:** `this.cur` (selected row key), `this.order` (rows in screen order, each `{key, act, url, jump, ...}`), `this.scroll`, a local `at` map in `renderHome` (row key → index among the scroll area's direct children), and `homeView()` returning `{ lanes, errs, order }`.

Steps:

1. Imports. Add a new line after the `./model.js` import:
   ```js
   import { RADIUS, TEXT, tokens, Icon, Spinner, Button, Skeleton, SectionHeader, KeyHints, Mono } from "./ui.js";
   ```
   Add `homeRow, backlogRow` to the `./model.js` import list. Add `ScrollHandle` to the `gpui-base` import list. `ui.js` has no `alpha`; main.js keeps its own.
2. In `init`, inside `if (r === "home") {`, before `this.seedHome();`, add:
   ```js
   this.cur = null; this.order = []; this.doneOpen = false; this.scroll = ScrollHandle.new(); // Home's selection (a row key), the rows in screen order, the Done fold, the list's scroll
   ```
3. Add this method directly above `renderHome`:
   ```js
   // Home as lanes of rows (model.js homeRow / backlogRow), each with its one action. order: the rows top to bottom, as j/k walk them.
   homeView() {
     const groups = this.homeModel(), now = Date.now(), here = this.hereRepo(), BACKLOG_ROWS = 8;
     const act = (g, it) => {
       if (g.key === "planned") return it.root ? { label: it.shelved ? "Resume" : "Start", go: () => this.openStart(it.issue.number, it.root, it.on) } : null;
       if (it.draft) return this.draftStart(it, it.root, it.on);
       return it.path ? this.next(it, { root: it.root, on: it.on }) : null;
     };
     const jump = (it) => () => { const sp = this.spaceAt(it.path, it.on); if (sp) run("space.select", { id: sp.id }); else run("space.new", { folder: it.path, machine: it.on ?? "" }); }; // a track row jumps to its worktree's space, opening one if it has none
     const lanes = groups.filter((g) => this.loaded || g.key !== "done") // Done needs this.meBy: hidden until the first load ends
       .map((g) => ({ key: g.key, title: g.title, count: g.items.length, rows: g.items.map((it) => ({ ...homeRow(g.key, it, now), act: act(g, it), jump: it.path ? jump(it) : null })) }));
     if (here) { // the shown repo's backlog, minus what is already a track or listed under Up next
       const cached = shared(issuesKey(here.on, here.root))?.data;
       const skip = new Set(groups.flatMap((g) => g.items).filter((it) => it.root === here.root && (it.on ?? null) === here.on).flatMap((it) => (it.issue ? [it.issue.number] : it.merged ? [] : it.issues ?? [])));
       const open = (cached ?? []).filter((i) => !skip.has(i.number) && !(i.labels ?? []).some((l) => l.name === "shelved"));
       const name = here.root.split("/").pop(), lane = { key: "backlog", title: `Backlog · ${here.on ? `${name} @ ${here.on}` : name}`, here, loading: !cached, count: open.length,
         rows: open.slice(0, BACKLOG_ROWS).map((i) => ({ ...backlogRow(i, now), act: { label: "Start", go: () => this.openStart(i.number, here.root, here.on) }, jump: null })) };
       const p = lanes.findIndex((l) => l.key === "planned");
       lanes.splice(p < 0 ? lanes.length : p + 1, 0, lane);
     }
     const errs = [this.homeErr, this.hereErr, ...this.repos.filter((r) => r.error).map((r) => { const n = r.root.split("/").pop(); return `${r.on ? `${n} @ ${r.on}` : n}: ${r.error}`; })].filter(Boolean); // every source that failed, for the one header indicator
     const shown = lanes.filter((l) => l.key === "needs" || l.key === "backlog" || l.rows.length || errs.length); // an empty lane is not drawn, unless a source failed: then empty may only mean "could not load", and the lane says so
     return { lanes: shown, errs, order: shown.flatMap((l) => (l.key === "done" && !this.doneOpen ? [] : l.rows)) };
   }
   ```
4. Replace the whole `renderHome(cx) { … }` method (from its `renderHome(cx) {` line through its closing `}` just above `renderBacklog(cx) {`) with:
   ```js
   renderHome(cx) {
     const k = tokens(), { lanes, order, errs } = this.homeView();
     this.order = order;
     if (!order.some((r) => r.key === this.cur)) this.cur = order[0]?.key ?? null; // the selection follows the data: a row that left hands over to the first
     const label = (r) => { const n = r.root.split("/").pop(); return r.on ? `${n} @ ${r.on}` : n; };
     const note = (text) => div().px(8).py(4).text_size(TEXT.sm).text_color(k.dim).child(text);
     const glyph = (r) => (r.tone === "working" ? Spinner({ size: 14, color: k.working }) : Icon(r.icon, { size: 14, color: { blocked: k.blocked, done: k.success }[r.tone] ?? k.dim }));
     const rowEl = (r) => {
       const on = r.key === this.cur;
       const actions = h_flex().id(`x-${r.key}`).flex_none().gap(4).items_center().on_mouse_down("left", (_e, cx) => cx.stop_propagation()) // a press on a button is not a press on the row (the same guard as button(), main.js)
         .when(r.act, (e) => e.child(Button(`a-${r.key}`, { label: r.act.label, size: "sm", variant: on ? "default" : "ghost", onClick: (_e, cx) => { cx.stop_propagation(); r.act.go(cx); } })))
         .when(r.url, (e) => e.child(Button(`o-${r.key}`, { icon: "external", size: "icon-sm", variant: "ghost", tooltip: "Open on GitHub", onClick: (_e, cx) => { cx.stop_propagation(); this.openGitHub(r.url); } })));
       const el = h_flex().id(`r-${r.key}`).px(8).gap(10).min_w(0).flex_none().items_center().rounded(RADIUS.md).cursor_pointer()
         .bg(on ? k.selected : NONE).hover((s) => s.bg(on ? k.selected : k.accent))
         .on_click((_e, cx) => { this.cur = r.key; cx.notify(); if (r.jump) r.jump(); });
       return r.dense
         ? el.h(30)
           .child(div().w(48).flex_none().child(Mono(r.ref ?? "")))
           .child(div().flex_1().min_w(0).truncate().child(r.title))
           .when(!this.narrow(520), (e) => e.child(div().flex_none().max_w(240).truncate().text_size(TEXT.xs).text_color(k.mutedFg).child(r.meta)))
           .child(actions)
         : el.py(7)
           .child(glyph(r))
           .child(v_flex().flex_1().min_w(0).gap(1)
             .child(div().truncate().font_medium().child(r.title))
             .child(div().truncate().text_size(TEXT.xs).text_color(k.mutedFg).child(r.meta)))
           .child(actions);
     };
     const openBacklog = (r) => run("tab.new", { name: "Backlog", mod: "forge", props: { view: "backlog", root: r.root, on: r.on } });
     const kids = [], at = {}; // the scroll area's direct children, and each row's index among them (scroll_to_item counts direct children)
     for (const l of lanes) {
       const folded = l.key === "done" && !this.doneOpen;
       const title = div().min_w(0).truncate().child(l.title); // an element, so a long "Backlog · repo @ machine" truncates instead of wrapping (SectionHeader's own text cannot shrink)
       if (l.key === "done") kids.push(SectionHeader(title, { count: l.count, id: "lane-done", action: Icon(folded ? "chevron-right" : "chevron-down", { size: 14, color: k.dim }) }).mt(10).min_w(0).flex_none().cursor_pointer().on_click((_e, cx) => { this.doneOpen = !this.doneOpen; cx.notify(); }));
       else kids.push(SectionHeader(title, { count: l.key === "backlog" && l.loading ? undefined : l.count, action: l.key === "backlog" ? Button("h-bo", { label: "Open backlog", size: "sm", variant: "ghost", onClick: () => openBacklog(l.here) }) : undefined }).mt(10).min_w(0).flex_none());
       if (l.key === "needs" && !l.rows.length) kids.push(note(!this.loaded ? "Loading…" : errs.length ? `Can't tell: ${errs[0]}` : "All clear. Nothing is waiting on you.")); // a failed fetch is never "all clear"
       if (l.key !== "needs" && l.key !== "backlog" && !l.rows.length) kids.push(note("Nothing loaded. A source failed, see the warning above.")); // only drawn when errs is non-empty (homeView)
       if (l.key === "backlog" && l.loading) kids.push(this.hereErr ? note(this.hereErr) : v_flex().px(8).py(4).gap(8).child(Skeleton({ h: 14 })).child(Skeleton({ h: 14, w: 320 })));
       if (l.key === "backlog" && !l.loading && !l.rows.length) kids.push(note("No open issues."));
       if (!folded) for (const r of l.rows) { at[r.key] = kids.length; kids.push(rowEl(r)); }
       if (l.key === "backlog" && l.count > l.rows.length) kids.push(note(`${l.count - l.rows.length} more in the backlog`));
     }
     if (this.repos.length) kids.push(h_flex().mt(10).px(8).gap(4).items_center().flex_wrap().flex_none().text_size(TEXT.sm).text_color(k.mutedFg)
       .child(div().mr(4).child("Backlogs"))
       .children(this.repos.map((r) => Button(`h-bk-${r.on ?? ""}-${r.root}`, { label: label(r), size: "sm", variant: "ghost", onClick: () => openBacklog(r) }))));
     const first = !this.loaded && !this.repos.length; // no snapshot yet: the very first open
     return v_flex().id("root").size_full().bg(k.canvas).text_size(TEXT.base).text_color(k.foreground).on_size_change(this.onSize)
       .child(h_flex().px(20).py(10).gap(10).items_center().flex_none().border_b(1).border_color(k.border)
         .child(div().flex_none().font_semibold().text_size(TEXT.lg).child("Forge"))
         .child(div().flex_1().min_w(0))
         .when(errs.length, (e) => e.child(h_flex().id("health").min_w(0).flex_shrink(1).gap(6).items_center().text_size(TEXT.xs).text_color(k.warning).tooltip(errs.join(" · "))
           .child(Icon("triangle-alert", { size: 14, color: k.warning }))
           .child(div().truncate().min_w(0).child(errs.length === 1 ? errs[0] : `${errs.length} sources are stale`))))
         .child(this.force ? h_flex().w(28).h(28).flex_none().items_center().justify_center().child(Spinner({ size: 14, color: k.mutedFg }))
           : Button("refresh", { icon: "refresh-cw", size: "icon-sm", variant: "ghost", tooltip: "Refresh", onClick: (_e, cx) => { this.force = true; cx.notify(); this.refreshHome(cx); } }))
         .child(Button("start", { label: "Start work", icon: "plus", size: "sm", onClick: () => this.openStart(null, null, null) })))
       .when(first, (el) => el.child(v_flex().px(20).py(16).gap(10).child(Skeleton({ h: 14, w: 120 })).child(Skeleton({ h: 30 })).child(Skeleton({ h: 30 })).child(Skeleton({ h: 30 }))))
       .when(!first, (el) => el.child(v_flex().id("home-body").flex_1().min_h(0).overflow_y_scroll().track_scroll(this.scroll).px(12).pb(12).gap(2).children(kids)));
   }
   ```
5. In `refreshHome`, change the string `"gh search unavailable — Planned/Done may be stale"` to `"gh search unavailable — Up next/Done may be stale"` (the lanes were renamed).
6. Check every name used in the two new methods against the imports and the class: `tokens Icon Spinner Button Skeleton SectionHeader Mono RADIUS TEXT` (ui.js); `homeRow backlogRow` (model.js); `ScrollHandle` (gpui-base); `div h_flex v_flex run shared NONE issuesKey` (already in main.js). `KeyHints` is imported for Task 4 and unused until then; that is expected.
7. If `.tooltip(...)` on the health `h_flex` or `.mt(...)` on a `SectionHeader` result makes `herdr-app check` report an error, remove just that call, say so in the commit message, and continue.

- **Verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && ! grep -n "g.title.toUpperCase\|BACKLOG ·" herdr/mods/forge/main.js` (the two greps prove the old Home markup is gone). The live render is Task 6.

## Task 4
**Keyboard: j/k/arrows to move, Enter to act, o to open, r to refresh, with a key-hint footer**

- **Exists because:** a command center visited many times a day is mouse-only today; the design's "one action per row" needs a way to run it without the pointer.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` only.
- **Consumes:** Task 3's `this.cur`, `this.order`, `this.scroll`, the `at` map and `KeyHints` import. Pattern followed: `~/.config/herdr-app/mods/cockpit/todo.js:34` (focus handle in init), `:645-658` (`track_focus` + `on_mouse_down` + `on_key_down` on the root), `:390-500` (switch on `e.keystroke`, return true when handled).
- **`go` functions:** every `act.go` (from `next()`, `draftStart()` and the inline ones in `homeView`) takes no arguments; passing `cx` is harmless and ignored.
- **Done rows:** a Done row that still has a worktree has the action "Remove worktree". It stays a button, but Enter never runs it (step 2's `r.lane !== "done"`): removal is a deliberate click.
- **Known limit, accepted:** after the Start work dialog closes, Herdr does not hand focus back to a non-focusable mod, so keys need one click on Home again. It goes on the by-hand checklist, not into code.
- **Cut here on purpose:** no `"focusable": true` in `mod.json` and no `nextCommand()` loop. That would make every Forge view (track pane, backlog) a `pane.go` stop without handling keys. Home is a whole tab; it focuses itself on open and on click. The design's `a` key is not added: in step 1 it would do the same as Enter.

Steps:

1. In `init`, on the line Task 3 added inside `if (r === "home") {`, append: `this.keys = cx.focus_handle(); this.reveal = false;` and directly after that line add `cx.spawn(async (cx) => { await cx.sleep(100); try { this.keys.focus(); } catch {} }); // Home takes the keyboard once its first render has attached the handle (track_focus); if that fails, the first click does (root on_mouse_down)`. Focusing a handle outside an event handler has no precedent in the shipped mods and is not documented; Task 6's checklist has the human confirm it, and a "no" is recorded in the PR, not fixed here.
2. Add this method directly above `homeView`:
   ```js
   // Home's keys (e.keystroke: gpui's chord spelling). true: handled, the caller stops propagation.
   homeKey(e, cx) {
     const order = this.order ?? [], i = Math.max(0, order.findIndex((r) => r.key === this.cur)), r = order[i];
     const move = (n) => { const to = order[Math.max(0, Math.min(order.length - 1, n))]; if (to) { this.cur = to.key; this.reveal = true; } };
     switch (e.keystroke) {
       case "j": case "down": move(i + 1); break;
       case "k": case "up": move(i - 1); break;
       case "home": move(0); break;
       case "end": move(order.length - 1); break;
       case "enter": if (r?.act && r.lane !== "done") r.act.go(cx); break; // never "Remove worktree" from the keyboard
       case "o": if (r?.url) this.openGitHub(r.url); break;
       case "r": if (!this.force) { this.force = true; this.refreshHome(cx); } break;
       default: return false;
     }
     cx.notify(); return true;
   }
   ```
3. In `renderHome`:
   - Directly after the `for (const l of lanes) { … }` loop, add: `if (this.reveal) { this.reveal = false; if (at[this.cur] != null) this.scroll.scroll_to_item(at[this.cur]); } // only after a key moved the selection: a wheel scroll is never undone`
   - In the returned root chain, after `.on_size_change(this.onSize)`, add: `.track_focus(this.keys).on_mouse_down("left", () => this.keys.focus()).on_key_down((e, cx) => { if (this.homeKey(e, cx)) cx.stop_propagation(); })`
   - In the row's `.on_click`, the selection already updates; no change.
   - In `rowEl`, give the selected row's action button its key: change the action `Button(...)` options to include `kbd: on && r.lane !== "done" ? "⏎" : undefined`.
   - As the last child of the root chain (after the `.when(!first, …)` line), add: `.when(!first && !this.narrow(560), (el) => el.child(KeyHints([["j", "down"], ["k", "up"], ["⏎", "run the row's action"], ["o", "open on GitHub"], ["r", "refresh"]])))`
4. Check `KeyHints` is in the `./ui.js` import (Task 3 added it).

- **Verify:** `herdr-app check herdr/mods/forge && grep -c "homeKey" herdr/mods/forge/main.js` prints a count of at least 2, and `! grep -q focusable herdr/mods/forge/mod.json`. Key presses cannot be driven from a CLI (learnings.md:41); they are on the human checklist in Task 6.

## Task 5
**Dock badge: the Needs-you count on the app icon while Home is open**

- **Exists because:** the design's cheapest attention signal; without it you must look at Home to learn something is waiting. Uses Herdr's native `setBadge` (`~/.config/herdr-app/AGENTS.md:1132`: "The last call wins; `null` or `""` clears it"), nothing of our own.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` only.
- **Consumes:** Task 3's `homeView()` (`lanes`, `errs`).
- **Invariants this task must hold:** unknown is not zero (a failed source leaves the last badge alone); the badge is global and Home can exist twice (⌘⇧H runs `tab.new` directly), so a copy that closes clears it and a surviving copy must put it back.

Steps:

1. Add `setBadge` to the `herdr` import list on main.js line 6.
2. Add this method directly above `homeView`:
   ```js
   // Dock badge = the Needs-you count. render calls it with the count it already has, and only a change reaches Herdr. refreshHome calls it
   // forced every GH_TTL: the badge is global, so another Home copy that closed (close() clears it) is repaired within a minute.
   // A failed source means the count is unknown, not zero: keep the last badge.
   syncBadge(n = null, force = false) {
     if (!this.loaded) return;
     if (n === null) { const v = this.homeView(); if (v.errs.length) return; n = v.lanes.find((l) => l.key === "needs")?.rows.length ?? 0; }
     if (!force && n === this.badge) return;
     this.badge = n; setBadge(n ? String(n) : null);
   }
   ```
3. In `renderHome`, directly after the line `this.order = order;`, add:
   ```js
   if (!errs.length) this.syncBadge(lanes.find((l) => l.key === "needs")?.rows.length ?? 0); // live: a newly blocked agent re-renders Home by itself
   ```
4. In `refreshHome`, in its `finally { … }` block, add `this.syncBadge(null, true);` directly before the `cx.notify();` that ends the block.
5. Add this method directly above `route()`:
   ```js
   // Herdr's lifecycle hook (AGENTS.md "Cleanup"): this Home tab is going, so it no longer keeps the badge true. Another open Home copy sets it again on its next refresh (syncBadge).
   async close() { if (this.route() === "home") setBadge(null); }
   ```
   Confirm no other method in the class is named `close` (`grep -cE "^\s*(async )?close\(" herdr/mods/forge/main.js` prints `1`).

- **Verify:** `herdr-app check herdr/mods/forge && test "$(grep -c "syncBadge" herdr/mods/forge/main.js)" -ge 3 && test "$(grep -c "setBadge" herdr/mods/forge/main.js)" -ge 3 && test "$(grep -cE "^\s*(async )?close\(" herdr/mods/forge/main.js)" = 1 && echo OK` prints `OK`.

## Task 6
**Live check in Herdr, screenshots, and the human checklist**

- **Exists because:** `herdr-app check` passes a mod whose render throws (learnings.md:39), and gpui layouts break at narrow widths in ways only a picture shows (learnings.md:21). Nothing above proves Home draws.
- **Model:** sonnet
- **Files:** `AGENTS.md` (repo root, one line); the PR body. No code unless a check below fails.

Steps:

1. Every command below starts with the `WT=…; ROOT=…;` prefix from "Read this first". Screenshots go outside the repo: `SHOTS="${TMPDIR:-/tmp}/forge-home-shots"; mkdir -p "$SHOTS"` (repeat the assignment in each command that uses it).
2. Point Herdr at this worktree's mod: `bash "$WT/scripts/install-herdr-mod.sh"` (it replaces the symlink `~/.config/herdr-app/mods/forge`; it copies nothing). Confirm `readlink ~/.config/herdr-app/mods/forge` prints `$WT/herdr/mods/forge`.
3. Open a fresh, focused Home copy (a fresh tab loads the new code; an already-open Forge tab does not, learnings.md:25,40): `herdr-app do tab.new '{"name":"Forge check","mod":"forge","props":{"view":"home"},"focus":true}'`. Keep the tab id it prints. If it prints none, find the tab named `Forge check` with `herdr-app ls`. Never run `tab.close` without that id.
4. Wait 5 seconds, then `herdr-app status` (report any error it shows for forge) and `herdr-app shot "$SHOTS/home-wide.png"`. Read the image. It must show: the "Forge" header with a refresh icon and "Start work"; lane headers in sentence case with counts; two-line rows under "Needs you"/"In progress" when there are any (else "All clear…"); dense rows under "Up next"/"Backlog"; "Done this week" folded to one line; a key-hint footer; no error card. If the frame shows an error card or a blank pane, read the error, fix the cause in the task that introduced it, and repeat from step 3 with a new tab (close the old one by id first). Two failed fixes for the same error: close the check tab by id (step 6), restore the symlink (step 7), then stop and report. Steps 6 and 7 run on every exit path of this task, including a stop.
5. Narrower check. Confirm with `herdr-app ls` that `Forge check` is the selected tab (if not, `herdr-app do tab.select '{"id":"<that id>"}'`, and check again). If it still is not the selected tab, skip this step and say so in the report: an unscoped split would land in another tab. Then `herdr-app do pane.split '{"direction":"right"}'`: it splits the focused pane, opening a terminal beside Home in the check tab, so Home is half as wide. Wait 3 seconds, `herdr-app shot "$SHOTS/home-narrow.png"`, read it. No row may push its action button off the pane and titles must truncate with an ellipsis. Fix with `.min_w(0)` / `.flex_none()` on the offending child if not. A half-window pane is still wider than the 520/560 px breakpoints, so those are on the by-hand checklist.
6. Close the check tab by its id: `herdr-app do tab.close '{"id":"<that id>","confirmed":true}'` (this also ends the terminal step 5 opened in it, which is intended).
7. Point Herdr back at the main checkout so removing this worktree later cannot leave a dangling link: `bash "$ROOT/scripts/install-herdr-mod.sh"`, and confirm `readlink ~/.config/herdr-app/mods/forge` prints `$ROOT/herdr/mods/forge`.
8. In the repo-root `AGENTS.md`, in the bullet that starts `- Test:`, append: `` Mod model: `node --test herdr/mods/forge/model.test.js`. `` Add one new bullet after it: `` - `herdr/mods/forge/ui.js` and `icons/` are a subset of cockpit's design kit (MIT; Lucide icons, ISC), see `herdr/mods/forge/THIRD_PARTY_NOTICES.md`. Build Home's UI from it; add a missing piece there, not inline. ``
9. Append this section to the body of the draft PR /forge:build opened for this branch, below the task checklist and without changing the checklist (`gh pr view --json body -q .body > "$SHOTS/body.md"`, append, `gh pr edit --body-file "$SHOTS/body.md"`). The repo is public: write it exactly as below, with no local paths (learnings.md, "The forge repo is public"):
   ```
   ## Check by hand before merging
   Preview: run `scripts/install-herdr-mod.sh` from this branch's worktree, then close and reopen Home (⌘⇧H). Afterwards run the same script from the main checkout.
   - [ ] ⌘⇧H opens Home and j / k move the selection without clicking first (if a click is needed first, say so here)
   - [ ] Enter runs the selected row's action; o opens it on GitHub; r refreshes
   - [ ] j past the bottom of the pane scrolls the selected row into view
   - [ ] Clicking a track row jumps to its space; clicking a row's button runs only the button
   - [ ] Enter on a Done row does nothing; its Remove worktree button still works
   - [ ] Drag Home's pane narrower than about 500 px: the meta column and key hints hide, nothing overflows
   - [ ] After closing the Start work dialog, keys work again after one click on Home (known limit)
   - [ ] The Dock icon shows the Needs-you count, and clears when the Home tab closes
   - [ ] Light theme and dark theme both read well
   ```

- **Verify:** `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)"); node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && bash hooks/session-start.test.sh && test "$(readlink ~/.config/herdr-app/mods/forge)" = "$ROOT/herdr/mods/forge" && grep -q "THIRD_PARTY_NOTICES" AGENTS.md && echo OK` prints `OK`; both screenshots were read and described in the task report.
