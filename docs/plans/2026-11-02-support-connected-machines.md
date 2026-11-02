# Plan: support connected machines

- **Goal:** the forge panel works when the shown Herdr space lives on a connected machine (`spaces()[i].machine`, e.g. `mbp-dev`). Its git/gh calls, file reads, Start work and agent joins run against that machine. The skills fall back to working in-session when `herdr-app` is missing.
- **Design:** `docs/decisions/2026-11-02-support-connected-machines.md`
- **Branch:** `feat/support-connected-machines` (issue #21)
- **Verify (whole feature):** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && bash hooks/session-start.test.sh`, then the manual check in Task 5. Run every command from the worktree root. This plan and its design are moved into the worktree's `docs/plans/` and `docs/decisions/` at handoff, and /forge:build commits them first.

Facts every task relies on (verified live on 2026-11-02 against the installed Herdr app; types in `~/.config/herdr-app/herdr.d.ts`):
- `exec(cmd, args, {cwd, on})` and `readTextFile(path, {on})` run on machine `on` (null = this computer). `exec` **rejects** when the machine is unreachable, the same as for a missing cwd. `knownAgents({on})` exists. `writeTextFile` and `watchFolder` have **no** `on`.
- `SpaceInfo.machine` is `string | null`. Remote space, tab and pane ids are prefixed `"<machine>/"`. `AgentInfo.space` is the space id. A remote machine's spaces are missing from `spaces()` while its layout is `loading` or `unavailable` (`machines()`). `hc get mbp-dev/t2` works from this computer, so `pollMsgs` needs no change.
- `space.new {folder, machine, argv, task}` opens a space on that machine. `machine: null` means this computer.
- `$HC_TERMINAL_ID` is set in every hc terminal, remote ones included (it read `t25` in a terminal on mbp-dev). So on a connected machine the skills take their desktop-app branch.
- **Pattern to follow:** Herdr's own worktree dialog, `~/.config/herdr-app/mods/worktree/main.js`. It sets `this.on = this.space()?.machine` (l.109), reads the remote home with `exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on })` (l.136), matches spaces on `(s.machine ?? null) === (on ?? null)` (l.49) and calls `run("space.new", { folder, machine: this.on, … })` (l.192). Its remove action takes `{space}` and is already remote-aware.

Panel invariants (main.js header and comments; docs/decisions/2026-11-02-herdr-work-panel.md:13) that every task keeps:
- **No stored state.** New fields are derived caches only.
- **`exec` rejections never kill a refresh.**
- **gh at most once per `GH_EVERY` per view.**
- **Another repo's PRs, issues and url never show.** Data resets when the repo changes. After this change, "repo" means machine + path.
- New this plan: **a refresh reads `this.on` / `this.root` only before its first `await`.** After that it uses the values it captured, so a superseded refresh never acts on another machine.
- New this plan: **an unreachable machine never wipes the panel.** It keeps the last data and shows an error.

## Task 1
**`agentsOn` in model.js: one machine's agents**

- **Exists because:** agents are joined to tracks by cwd alone. Same user on two Macs means identical paths, so a remote agent would show on a local track, with an Answer button pointing at the wrong terminal. main.js has no test harness, so the join goes into model.js where `node --test` covers it.
- **Model:** haiku
- **Files:** `herdr/mods/forge/model.js`, `herdr/mods/forge/model.test.js`
- **Produces:** `agentsOn(agents, spaces, on)` for Task 2.

Steps:
1. Test first. In `model.test.js` add `agentsOn` to the import list from `./model.js` on line 3, then append:
   ```js
   test("agentsOn: only that machine's agents; an unknown space is nobody's", () => {
     const sp = [{ id: "s1", machine: null }, { id: "mbp/s2", machine: "mbp" }];
     const ag = [{ address: "t1", space: "s1" }, { address: "mbp/t2", space: "mbp/s2" }, { address: "mbp/t3", space: "mbp/s9" }];
     assert.deepEqual(agentsOn(ag, sp, null).map((a) => a.address), ["t1"]);
     assert.deepEqual(agentsOn(ag, sp, "mbp").map((a) => a.address), ["mbp/t2"]);
     assert.deepEqual(agentsOn(ag, sp, undefined).map((a) => a.address), ["t1"]);
   });
   ```
   Run it and watch it fail (`agentsOn` is not exported).
2. In `model.js`, add after `tracks()`:
   ```js
   // One machine's agents (on: a space's `machine`, null = this computer). A space missing from spaces() — its machine's layout
   // still loading or unavailable — is nobody's: never count it as local, or a same-path remote agent lands on a local track.
   export function agentsOn(agents, spaces, on) {
     const m = new Map(spaces.map((s) => [s.id, s.machine ?? null]));
     return agents.filter((a) => m.has(a.space) && m.get(a.space) === (on ?? null));
   }
   ```

- **Verify:** `node --test herdr/mods/forge/model.test.js`

## Task 2
**Thread the shown machine through the panel's data path**

- **Exists because:** without it every git/gh/read call in a remote space runs locally. The panel shows "no git repo", or another repo's tracks when the same path exists here.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `agentsOn` from Task 1. **Produces:** `this.on` (`string|null`) on every view. The props `on` on board, backlog, detail and start views, next to `root`. `git(args, cwd, on)` and `gh(args, cwd, on)` signatures. Tasks 3 and 4 use these.

Steps (line numbers are the current file's):

1. Imports (l.9): add `agentsOn` to the `./model.js` import.
2. `location()` (l.23–28): return `{ cwd: …as now…, space: space?.id, machine: space?.machine ?? null }`. The cwd comes from the focused pane, which is in the active space, so this is that pane's machine.
3. `init` (l.33–45):
   - Next to `this.root = props()?.root ?? null` add `this.on = props()?.on ?? null; this.ghAt = 0; this.ghRoot = null; this.ghOn = null; this.ghErr = null; this.refreshing = false;`.
   - Change the `GH_EVERY` timer (l.43) to `cx.timer.every(GH_EVERY, (cx) => { if (!this.refreshing) this.refresh(cx); });`. A hung remote `exec` must not stack a new refresh every tick. Refreshes started by the folder watch or by `relocate` still run, and `seq` supersedes them.
4. Replace `git()` and `gh()` (l.49–50):
   ```js
   // failed: exec REJECTED (no cwd, no program, machine unreachable) — not the same as git exiting non-zero ("not a repo").
   async git(args, cwd = this.root, on = this.on) { try { const r = await exec("git", [...GIT, ...args], { cwd, on }); return { ok: r.code === 0, out: (r.stdout ?? "").replace(/\n+$/, "") }; } catch { return { ok: false, out: "", failed: true }; } }
   async gh(args, cwd = this.root, on = this.on) { try { const r = await exec("gh", args, { cwd, on }); return r.code === 0 ? JSON.parse(r.stdout || "[]") : null; } catch { return null; } }
   ```
5. Replace `relocate` (l.53–58):
   ```js
   // Cheap: one git call, and a full refresh only when the shown repo (machine + path) changed. Only refresh() changes this.on.
   relocate(cx) {
     if (props()?.root) return;
     const { cwd, machine } = location(); if (!cwd) return;
     const loc = `${machine ?? ""}\n${cwd}`; if (loc === this.loc) return;
     this.loc = loc;
     if (machine !== this.on) { this.refresh(cx); return; } // another machine: always another repo
     cx.spawn(async (cx) => { const r = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, machine); if (r.ok && r.out.replace(/\/\.git$/, "") !== this.root) this.refresh(cx); });
   }
   ```
   The old `this.cwd` field goes away; its two readers (l.55, l.63) are replaced by `this.loc`.
6. Add above `refresh`:
   ```js
   // Every data reset also forgets the gh cache: an emptied list must never pass for a fresh fetch.
   resetData() { this.data = emptyData(); this.ghAt = 0; }
   ```
7. Replace `refresh` (l.59–99) with the following. It keeps every existing line's behaviour except where commented.
   ```js
   refresh(cx) {
     cx.spawn(async (cx) => {
       const seq = ++this.seq; // a newer refresh (or a repo change) supersedes this one: it must not write its data
       this.refreshing = true;
       try {
         if (!props()?.root) { // the sidebar follows the shown space; other views are pinned to props().root and props().on
           const { cwd, machine } = location(); if (!cwd) return; this.loc = `${machine ?? ""}\n${cwd}`;
           if (machine !== this.on) { this.on = machine; this.root = null; this.resetData(); }
           const common = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, machine);
           if (seq !== this.seq) return;
           if (common.failed) { this.error = `can't reach ${machine ?? "git"} — showing the last data`; cx.notify(); return; } // unreachable ≠ not a repo: keep what we have
           if (!common.ok) { this.root = null; this.resetData(); this.watch([], cx, machine); this.error = "no git repo in this space"; cx.notify(); return; }
           const r0 = common.out.replace(/\/\.git$/, "");
           if (r0 !== this.root) { this.root = r0; this.resetData(); } // another repo's PRs, issues and url must never show
         }
         const root = this.root, on = this.on; // captured: after the first await below, never read this.root / this.on again
         const git = (args, cwd = root) => this.git(args, cwd, on);
         this.base = (await git(["rev-parse", "--verify", "-q", "origin/main"])).ok ? "origin/main" : "main";
         const list = await git(["worktree", "list", "--porcelain"]);
         if (seq !== this.seq) return;
         if (!list.ok) { this.error = list.failed ? `can't reach ${on ?? "git"} — showing the last data` : "git worktree list failed — showing the last data"; cx.notify(); return; } // never replace tracks with an empty list
         const wt = parseWorktrees(list.out);
         this.watch([`${root}/docs`, ...wt.filter((w) => !w.main).map((w) => `${w.path}/docs`)], cx, on);
         const docs = {}, ages = {}, ahead = {};
         await Promise.all(wt.filter((w) => !w.main).map(async (w) => {
           const changed = await git(["diff", "--name-only", `${this.base}...HEAD`, "--", "docs/decisions", "docs/plans"], w.path);
           const untracked = await git(["ls-files", "--others", "--exclude-standard", "docs/decisions", "docs/plans"], w.path);
           const files = `${changed.out}\n${untracked.out}`.split("\n").filter(Boolean);
           const design = files.find((f) => f.startsWith("docs/decisions/")) ?? null, plan = files.find((f) => f.startsWith("docs/plans/")) ?? null;
           const designText = design ? (await readTextFile(`${w.path}/${design}`, { on }).catch(() => "")) ?? "" : "";
           // (a pruned worktree never gets here: parseWorktrees drops `prunable` blocks)
           docs[w.path] = { design, plan, designText };
           ages[w.path] = Number((await git(["log", "-1", "--format=%ct"], w.path)).out) || 0;
           ahead[w.path] = Number((await git(["rev-list", "--count", `${this.base}..HEAD`], w.path)).out) || 0;
         }));
         // ponytail: per-view throttle — docs/ bursts (builds, rebases) reuse the cached lists; one shared cache across views if several open panels ever matter
         const ghFresh = this.ghRoot === root && this.ghOn === on && Date.now() - this.ghAt < GH_EVERY - 1000;
         const [prs, issues] = ghFresh ? [this.data.prs, this.data.issues] : await Promise.all([
           this.gh(["pr", "list", "--state", "all", "--limit", "200", "--json", "number,title,body,url,isDraft,state,headRefName,mergedAt,updatedAt,author"], root, on),
           this.gh(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,body,url,labels,author,createdAt"], root, on),
         ]);
         const me = this.data.me || (await exec("gh", ["api", "user", "-q", ".login"], { cwd: root, on }).catch(() => ({}))).stdout?.trim() || null; // || not ??: an empty string must retry next time
         const repoUrl = this.data.repoUrl || (await exec("gh", ["repo", "view", "--json", "url", "-q", ".url"], { cwd: root, on }).catch(() => ({}))).stdout?.trim() || null;
         if (seq !== this.seq || root !== this.root || on !== this.on) return;
         this.data = { worktrees: wt, docs, prs: prs ?? this.data.prs, issues: issues ?? this.data.issues, ages, ahead, me, repoUrl };
         if (!ghFresh) { this.ghAt = Date.now(); this.ghRoot = root; this.ghOn = on; this.ghErr = prs ? null : "gh unavailable — PRs and issues may be stale"; }
         this.error = this.ghErr; // replaces a "can't reach" from an earlier tick; a cached gh failure stays shown
         this.fetched = Date.now();
         if (props()?.track) this.loadDoc(cx); // the detail pane's first load: track() is null until this data exists
         cx.notify();
       } finally { if (seq === this.seq) this.refreshing = false; } // a superseded refresh must not clear the newer one's flag
     });
   }
   ```
   Before transcribing, diff the existing body against this. The only intended changes are the captured `root` / `on` / `git`, the `common.failed` and `list.ok` early returns, `resetData()`, the `ghOn` key, the `seq` check before `watch`, `{ on }` on `readTextFile` / `exec`, `this.ghErr` (the gh error kept with the gh cache, so `this.error = this.ghErr` replaces a stale "can't reach"), and the `refreshing` try/finally. If the current file differs elsewhere, keep the current file's line.
8. Replace `watch` (l.102–106) with a version that takes the captured machine:
   ```js
   // One loop per docs/ dir (main root + each linked worktree); the set restarts only when the path list changes. A missing dir rejects: wait and retry while the set is current.
   // watchFolder is this computer only: a remote root watches nothing and the GH_EVERY refresh picks up its docs. An empty set still ends the old loops.
   watch(paths, cx, on) {
     if (on) paths = [];
     const key = paths.join("\n"); if (key === this.watched) return;
     this.watched = key; const gen = ++this.watchGen;
     for (const p of paths) cx.spawn(async (cx) => { while (gen === this.watchGen) { try { await watchFolder(p); if (gen === this.watchGen) this.refresh(cx); } catch { await cx.sleep(5000); } } });
   }
   ```
9. `live()` (l.125–129):
   ```js
   // Live: agents() and panes() change on their own and re-render this view; join them to tracks by cwd, on this view's machine only.
   live() {
     const ps = panes();
     const ag = agentsOn(agents(), spaces(), this.on).map((a) => ({ address: a.address, status: a.status, cwd: ps.find((p) => p.pane === a.pane)?.cwd ?? null, msg: this.msgs[a.address] ?? null }));
     return tracks({ ...this.data, agents: ag });
   }
   ```
10. Pinned views carry the machine: in `openBoard`, `openBacklog`, `openDetail` and `openStart` (l.163–166) add `on: this.on` to each `props` object, next to `root: this.root`.

- **Verify:** `node --test herdr/mods/forge/model.test.js && herdr-app check herdr/mods/forge && /usr/bin/grep -c 'this\.cwd' herdr/mods/forge/main.js | /usr/bin/grep -qx 0`

## Task 3
**Start work, open agent and Remove worktree on the shown machine**

- **Exists because:** Start work runs `git worktree add` locally at a local-home path and opens a local space. `openAgent`'s folder lookup can match a local space with the same path, so the agent would start on the wrong machine.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `this.on` and `props.on` from Task 2 (the Start overlay is pinned: `this.on` is fixed for its lifetime). `this.git(...)` calls already default to `this.on`.

Steps:
1. Add next to `repoName()`:
   ```js
   // That machine's home: Herdr's worktree path rule is ~/.herdr/worktrees/<repo>/<branch-with-dashes> on the space's machine. Pattern: mods/worktree/main.js:136.
   async homeOn() {
     if (!this.on) return home();
     const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); // rejects if unreachable: start()'s catch shows it
     if (r.code !== 0 || !r.stdout.trim()) throw new Error(`can't read the home folder on ${this.on}`);
     return r.stdout.trim();
   }
   ```
2. `start()` (l.456–492):
   - In `onOrigin`, the `exec` (l.467) options become `{ cwd: this.root, on: this.on }`.
   - The worktree path (l.484) becomes `const path = \`${await this.homeOn()}/.herdr/worktrees/${this.repoName()}/${branch.replace(/\//g, "-")}\`;`
   - In the `worktree add` `exec` (l.485), the options become `{ cwd: this.root, on: this.on }`.
3. `openAgent(path, task)` (l.157–161):
   ```js
   async openAgent(path, task) {
     const argv = (await knownAgents({ on: this.on })).find((a) => a.installed)?.run ?? ["claude"];
     const space = spaces().find((s) => s.folder === path && (s.machine ?? null) === this.on); // ponytail: folder match; a space made by Start/worktree mod has exactly this folder
     if (space) run("tab.new", { space: space.id, argv, task }); else run("space.new", { folder: path, machine: this.on, argv, task });
   }
   ```
4. `next(t)`, merged branch (l.173): `const sp = spaces().find((s) => s.folder === t.path && (s.machine ?? null) === this.on);`. Leave the rest alone: the worktree dialog reads the machine from the space id, and the `git status` call already uses `this.on`.

- **Verify:** `herdr-app check herdr/mods/forge && /usr/bin/grep -c 'machine: this.on' herdr/mods/forge/main.js | /usr/bin/grep -qx 1`

## Task 4
**Detail view on a remote track: read-only, polled**

- **Exists because:** the detail pane reads docs with local `readTextFile` and waits on local `watchFolder`, which rejects forever for a remote path (an endless 5 s retry, and docs never load). Its editor saves with `writeTextFile`, which cannot write remotely, so Edit must not appear.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js`
- **Consumes:** `this.on` from Task 2 (the detail view is opened with `props.on`).

Steps:
1. `initDetail` (l.326–330): replace the `cx.spawn(...)` loop line with:
   ```js
   cx.spawn(async (cx) => { for (;;) {
     if (this.on) { // watchFolder is this computer only: poll a remote track, and stop once its worktree is gone
       await cx.sleep(GH_EVERY);
       if (this.data.worktrees.length && !this.track()) return;
       if (!this.editing) this.loadDoc(cx, true);
       continue;
     }
     try { await watchFolder(`${props().track}/docs`); } catch { if (this.data.worktrees.length && !this.track()) return; await cx.sleep(5000); continue; }
     if (!this.editing) { this.docs = {}; this.loadDoc(cx); }
   } }); // ends only when the worktree is gone (a missing docs/ retries every 5 s); while editing, save() reconciles instead
   ```
2. Replace `loadDoc` (l.332–343). `reload` reads into a fresh object and swaps it in when done, so a remote re-read never blanks the doc:
   ```js
   // Reads the shown tab's file once per change; `expected` is the text on disk when it was read. reload: re-read everything, swap in when done.
   loadDoc(cx, reload = false) {
     cx.spawn(async (cx) => {
       const tr = this.track(); if (!tr) return;
       const docs = reload ? {} : this.docs;
       for (const key of ["design", "plan"]) {
         if (!reload && docs[key] && docs[key].rel !== tr[key] && !this.editing) delete docs[key]; // a renamed file must reload
         const rel = tr[key]; if (!rel || docs[key]) continue;
         try { docs[key] = { rel, text: (await readTextFile(`${tr.path}/${rel}`, { on: this.on })) ?? "" }; } catch (e) { docs[key] = { rel, text: null, err: String(e) }; } // text null = unreadable: shown, never editable
       }
       if (reload) { if (this.editing) return; this.docs = docs; }
       this.log = (await this.git(["log", "-6", "--format=%h%x09%s%x09%cr"], tr.path)).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
       cx.notify();
     });
   }
   ```
3. `renderDetail` (l.423): `const canEdit = !this.on && (this.tab === "design" || this.tab === "plan") && this.docs[this.tab]?.text != null;`. Remote docs are read-only (design: "Cut and why"). `save()` is then unreachable remotely; leave it as it is.

- **Verify:** `herdr-app check herdr/mods/forge`

## Task 5
**Skills: no herdr-app → no dispatch, no space close; manual end-to-end check**

- **Exists because:** on a connected machine without the Herdr app, `herdr-app` exits 127. /forge:start would stop instead of working. /forge:plan would ask the dispatch question and then fail. /forge:shelve (the panel's Shelve button) would remove the worktree and then fail on its last command.
- **Model:** haiku
- **Files:** `skills/start/SKILL.md`, `skills/plan/SKILL.md`, `skills/shelve/SKILL.md`

Steps (exact old → new text; each old string occurs once):
1. `skills/start/SKILL.md`, end of the **Hand off, Herdr desktop app** bullet. Fold the new case into the existing fallback so there is one rule:
   - old: `anything else: do not dispatch; \`cd "$P"\` and continue below.`
   - new: `anything else, or when \`command -v herdr-app\` finds nothing (a connected machine without the app): do not dispatch; \`cd "$P"\` and continue below.`
2. `skills/plan/SKILL.md`, the bullet starting `- **In herdr (\`HERDR_ENV=1\`) or the Herdr desktop app (\`$HC_TERMINAL_ID\` set):**`. Insert right after that bold label, before `one prompt carrying two questions`:
   `If \`$HC_TERMINAL_ID\` is set, \`HERDR_ENV\` is not, and \`command -v herdr-app\` finds nothing (a connected machine without the app), there is no space to dispatch into: skip this prompt and take **Inline**. Otherwise, `
   (After the insert, the sentence reads "…Otherwise, one prompt carrying two questions…". The plan's "Cleanup in the Herdr desktop app" needs no change: it only follows a dispatch, which this skips.)
3. `skills/shelve/SKILL.md`, step 6:
   - old: `if it prints nothing (you are in a space that is not this worktree's), skip the close and say so.`
   - new: `if it prints nothing (you are in a space that is not this worktree's), skip the close and say so. If \`command -v herdr-app\` finds nothing (a connected machine without the app), skip the close too and tell the person to close this space from their Herdr window.`
4. Manual check. It needs a connected machine (`hc machine ls` lists them) and a terminal inside the Herdr desktop app. If either is missing, write "manual check skipped: <why>" in the PR body. Otherwise record the result of each step in the PR body:
   0. Point the installed mod at this worktree: run `bash scripts/install-herdr-mod.sh` from the worktree, then check `[ "$(readlink ~/.config/herdr-app/mods/forge)" = "$PWD/herdr/mods/forge" ]`. **Ask the human to reopen the forge panel (or restart the app) and wait for their yes.** A docked copy keeps the old build, and CLI remounts don't reload it (docs/learnings.md:25). When done, put the link back with `bash "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/scripts/install-herdr-mod.sh"` (the main checkout's copy).
   1. Run `herdr-app do space.new --machine <m> --folder <path of a forge checkout on m>`, and focus that space.
   2. The forge sidebar lists the same tracks as `hc exec --on <m> --cwd <path> git worktree list`. It does not show this computer's checkout at the same path.
   3. Focus a local space with a git repo: the sidebar switches to the local repo within 5 s.
   4. Open a remote track's detail: the Design tab shows text and there is no Edit button.
   5. Pinned board on the remote:
      - `SP=$(herdr-app ls | jq -r '.spaces[] | select(.active) | .id')`
      - `T=$(herdr-app do tab.new --space "$SP" --mod forge --props '{"view":"board","root":"<path on m>","on":"<m>"}' | jq -r .tab)`, then check `[ -n "$T" ] && [ "$T" != null ]`.
      - `herdr-app status | jq -e --arg p "$PWD" '[.errors[] | tostring | select(contains($p))] == []'`. Only this worktree's errors count: unrelated stale-mod errors may already be listed.
      - The board lists the remote tracks.
      - `herdr-app do tab.close --id "$T" --confirmed true`. Close only that captured id (docs/learnings.md:14).

- **Verify:** `bash hooks/session-start.test.sh && for f in start plan shelve; do /usr/bin/grep -q 'command -v herdr-app' skills/$f/SKILL.md || exit 1; done` (`/usr/bin/grep`: the rtk-wrapped grep miscounts, per docs/decisions/2026-11-01-forge-owned-guidance.md)
