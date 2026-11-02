// forge: the dev-loop's work, one track per worktree of the shown repo. Four views in one mod,
// chosen by props(): none = docked sidebar; {view:"board"} work board; {view:"backlog"}; {track}
// detail; {view:"start", overlay} the Start work dialog. No stored state: everything is derived
// from git worktrees, the docs on each branch, gh PRs/issues and the host's agents.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, TextareaState, Textarea, EditorState, Editor } from "gpui-base";
import { spaces, panes, agents, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, run, props, home, appHome, knownAgents, openOverlay, closeOverlay, hc, layout, setShared, shared } from "herdr";
import { writeFile, mkdir } from "fs/promises"; // allowed: writes under ~/.config/herdr-app (AGENTS.md "Other built-ins")
import { nextLabel, chip, parseWorktrees, kind, planTasks, tracks, agentsOn, grouped, takenIssues, isParked, branchFor, shelfBranch, DONE_WINDOW_MS } from "./model.js";
const DONE_SUFFIX = ` · ${DONE_WINDOW_MS / 86400000} DAYS`;

const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const GH_EVERY = 30000; // gh is called at most this often per view (GraphQL budget: 5000 pts/h per user; one refresh ≈ 1 pt per 100 PRs or issues)
const RAIL = 44; // the folded width; the sidebar mod uses 44 too (76 on macOS only because of the traffic lights, which this panel never sits under)
const MONO = (el) => el.font_family(settings().font_family); // the terminal's mono font (AGENTS.md: settings().font_family)
const ago = (sec) => { const d = Math.max(0, Date.now() / 1000 - sec); return d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`; };
const since = (iso) => ago(Date.parse(iso) / 1000);
// theme() colors are "#rrggbb" or "#rrggbbaa" (border is #ffffff18); add alpha only to the 6-digit ones.
const NONE = "#00000000"; // gpui takes only #rgb/#rrggbb/#rrggbbaa literals — never "transparent"
const alpha = (c, aa) => (/^#[0-9a-f]{6}$/i.test(c) ? c + aa : c);

// The sidebar has no cwd of its own: the space, the focused pane, or a terminal pane in the same tab.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  if (!space) return {}; // its machine's layout is loading: no cwd, so nothing runs locally on a remote path
  const all = panes(), pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const sibling = f?.tab ? all.find((p) => p.tab === f.tab && p.cwd) : null;
  return { cwd: pane?.cwd || f?.cwd || sibling?.cwd || space?.folder, space: space?.id, machine: space?.machine ?? null };
}

const emptyData = () => ({ worktrees: [], docs: {}, prs: [], issues: [], ages: {}, ahead: {}, me: null, repoUrl: null });

export default class Forge extends View {
  init(_p, cx) {
    this.root = props()?.root ?? null; this.on = props()?.on ?? null; this.ghAt = 0; this.ghRoot = null; this.ghOn = null; this.ghErr = null; this.refreshing = false; this.base = "origin/main";
    this.data = emptyData(); this.seq = 0; this.watchGen = 0; this.watched = "";
    this.w = 0; this.onSize = (size, cx) => { if (Math.abs((this.w ?? 0) - size.width) >= 1) { this.w = size.width; cx.notify(); } }; // container width: the views branch on narrow()
    this.filter = "all"; this.shown = 50; this.error = null; this.msgs = {}; this.polling = false; // each view is its own copy of the mod, so these never collide
    this.search = InputState.new({ placeholder: "Search" });
    this.search.on("change", (_e, cx) => cx.notify());
    if (props()?.view === "start") this.initStart(cx);
    if (props()?.track) this.initDetail(cx);
    this.refresh(cx);
    cx.timer.every(GH_EVERY, (cx) => { if (!this.refreshing) this.refresh(cx); }); // the folder watch covers files, agents() re-renders by itself
    cx.timer.every(5000, (cx) => { this.relocate(cx); cx.spawn((cx) => this.pollMsgs(cx)); }); // the sidebar follows the shown space; agent messages live in herdr-core, not agents()
  }

  // --- data ---
  // failed: exec REJECTED (no cwd, no program, machine unreachable) — not the same as git exiting non-zero ("not a repo").
  async git(args, cwd = this.root, on = this.on) { try { const r = await exec("git", [...GIT, ...args], { cwd, on }); return { ok: r.code === 0, out: (r.stdout ?? "").replace(/\n+$/, "") }; } catch { return { ok: false, out: "", failed: true }; } }
  async gh(args, cwd = this.root, on = this.on) { try { const r = await exec("gh", args, { cwd, on }); return r.code === 0 ? JSON.parse(r.stdout || "[]") : null; } catch { return null; } }

  // Cheap: one git call, and a full refresh only when the shown repo (machine + path) changed. Only refresh() changes this.on.
  relocate(cx) {
    if (props()?.root) return;
    const { cwd, machine } = location(); if (!cwd) return;
    const loc = `${machine ?? ""}\n${cwd}`; if (loc === this.loc) return;
    this.loc = loc;
    if (machine !== this.on) { this.refresh(cx); return; } // another machine: always another repo
    cx.spawn(async (cx) => { const r = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd, machine); if (r.ok && r.out.replace(/\/\.git$/, "") !== this.root) this.refresh(cx); });
  }
  // Every data reset also forgets the gh cache: an emptied list must never pass for a fresh fetch.
  resetData() { this.data = emptyData(); this.ghAt = 0; }
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
          if (common.failed && machine) { this.error = `can't reach ${machine} — showing the last data`; cx.notify(); return; } // unreachable ≠ not a repo: keep what we have
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
  // One loop per docs/ dir (main root + each linked worktree); the set restarts only when the path list changes. A missing dir rejects: wait and retry while the set is current.
  // watchFolder is this computer only: a remote root watches nothing and the GH_EVERY refresh picks up its docs. An empty set still ends the old loops.
  watch(paths, cx, on) {
    if (on) paths = [];
    const key = paths.join("\n"); if (key === this.watched) return;
    this.watched = key; const gen = ++this.watchGen;
    for (const p of paths) cx.spawn(async (cx) => { while (gen === this.watchGen) { try { await watchFolder(p); if (gen === this.watchGen) this.refresh(cx); } catch { await cx.sleep(5000); } } });
  }
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
  // Live: agents() and panes() change on their own and re-render this view; join them to tracks by cwd, on this view's machine only.
  live() {
    const ps = panes();
    const ag = agentsOn(agents(), spaces(), this.on).map((a) => ({ address: a.address, status: a.status, cwd: ps.find((p) => p.pane === a.pane)?.cwd ?? null, msg: this.msgs[a.address] ?? null }));
    return tracks({ ...this.data, agents: ag });
  }
  track() { return this.live().find((t) => t.path === props().track) ?? null; }
  narrow(px) { return this.w > 0 && this.w < px; } // false until the first layout reports a width
  repoName() { return (this.root ?? "").split("/").pop(); }
  // That machine's home: Herdr's worktree path rule is ~/.herdr/worktrees/<repo>/<branch-with-dashes> on the space's machine. Pattern: mods/worktree/main.js:136.
  async homeOn() {
    if (!this.on) return home();
    const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: this.on }); // rejects if unreachable: start()'s catch shows it
    if (r.code !== 0 || !r.stdout.trim()) throw new Error(`can't read the home folder on ${this.on}`);
    return r.stdout.trim();
  }
  repoUrl() { return this.data.repoUrl ?? "https://github.com"; }

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

  // --- actions: every write is an agent's or the person's, never the panel's bookkeeping ---
  // Harness-agnostic: the agent is Herdr's most-picked installed one (knownAgents is ordered that way); no model choice here.
  async openAgent(path, task, argv) {
    argv ??= (await knownAgents({ on: this.on })).find((a) => a.installed)?.run ?? ["claude"];
    const space = spaces().find((s) => s.folder === path && (s.machine ?? null) === this.on); // ponytail: folder match; a space made by Start/worktree mod has exactly this folder
    if (space) run("tab.new", { space: space.id, argv, task }); else run("space.new", { folder: path, machine: this.on, argv, task });
  }
  openGitHub(url) { exec("open", [url]); }
  openBoard() { run("tab.new", { name: "Forge", space: location().space, mod: "forge", props: { view: "board", root: this.root, on: this.on } }); }
  openBacklog() { run("tab.new", { name: "Backlog", space: location().space, mod: "forge", props: { view: "backlog", root: this.root, on: this.on } }); }
  openDetail(t) { run("pane.split", { direction: "right", mod: "forge", props: { track: t.path, root: this.root, on: this.on } }); }
  openStart(issue) { openOverlay({ mod: "forge", props: { view: "start", root: this.root, on: this.on, issue: issue?.number ?? null }, kind: "dialog", width: 720, height: 720 }); }
  // The next verb for a track, run by an agent in that worktree.
  next(t) {
    if (!t.path) return { label: "Open PR", go: () => this.openGitHub(t.pr.url) };
    if (t.agents.some((a) => a.status === "blocked")) return { label: "Answer", go: () => run("agent.focus", { terminal: t.agents.find((a) => a.status === "blocked").address }) };
    if (t.agents.some((a) => a.status === "working")) return { label: "Open tab", go: () => run("agent.focus", { terminal: t.agents.find((a) => a.status === "working").address }) };
    if (t.merged) { // Herdr's own Remove worktree dialog closes the space it is given — only when this track has one (mods/worktree/main.js:2 documents {space, folder?, action}); otherwise an agent removes it
      const sp = spaces().find((s) => s.folder === t.path && (s.machine ?? null) === this.on);
      // that dialog can --force, so offer it only for a clean worktree; a dirty one goes to the agent, which never forces
      return { label: "Remove worktree", go: async () => { const st = sp ? await this.git(["status", "--porcelain"], t.path) : null; return st?.ok && !st.out ? openOverlay({ mod: "worktree", props: { action: "remove", space: sp.id, folder: t.path }, kind: "dialog" })
        : this.openAgent(this.root, `This branch is merged. Run: git worktree remove "${t.path}" (never --force; if it refuses, say why and stop), then git branch -d ${t.branch} (never -D). Then stop.`); } };
    }
    // /forge:start is the only begin verb: it reads the branch and routes (debug / brainstorm / plan / build / review); the label is for the human.
    return { label: nextLabel(t), go: () => this.openAgent(t.path, "/forge:start") };
  }
  shelve(t) { this.openAgent(t.path, "/forge:shelve"); }

  // --- shared pieces ---
  button(t, id, label, fn, primary = false) {
    return div().id(id).px(8).py(3).rounded(6).text_size(11.5).cursor_pointer()
      .bg(primary ? t.foreground : t.raised).text_color(primary ? t.canvas : t.foreground).when(primary, (e) => e.font_semibold())
      .hover((s) => s.bg(primary ? t.muted : t.hover)).child(label)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click((_e, cx) => fn(cx)); // fn gets a fresh cx: never close over render's
  }
  link(t, id, label, url) { return this.button(t, id, `${label} ↗`, () => this.openGitHub(url)).bg(NONE).text_color(t.ansi12); }
  groupColor(t, key) { return { needs: t.blocked, flight: t.accent, hold: t.muted, done: t.ansi2 }[key]; }
  header(t, title, right) {
    return h_flex().px(12).py(8).items_center().gap(8).flex_wrap().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(14).child(title))
      .child(MONO(div()).text_size(11).text_color(t.muted).truncate().min_w(0).child(`${this.repoName()} · ${this.base.replace("origin/", "")}`))
      .child(h_flex().flex_grow(1).min_w(0).justify_end().items_center().gap(8).flex_wrap().children(right ?? [])); // grows from its content width, so a crowded header wraps this group to a second line
  }
  empty(t, text) { return div().px(8).py(4).text_size(12).text_color(t.dim).child(text); }

  // --- sidebar (default) ---
  renderSidebar(cx) {
    if (this.w > 0 && this.w < 100) return this.renderRail(cx);
    const t = theme(), groups = grouped(this.live());
    const row = (g, s) => {
      const color = this.groupColor(t, g.key), needs = g.key === "needs", key = s.path ?? "pr" + s.pr.number;
      return v_flex().id(`s-${key}`).px(6).py(5).rounded(6).gap(3).cursor_pointer().bg(needs ? alpha(t.blocked, "14") : NONE).hover((e) => e.bg(t.hover))
        .on_click(() => (s.path ? this.openDetail(s) : this.openGitHub(s.pr.url)))
        .child(h_flex().items_center().gap(8).min_w(0)
          .child(div().w(8).h(8).rounded(4).bg(s.agents.length ? color : t.idle))
          .child(div().flex_1().min_w(0).truncate().font_medium().child(s.slug))
          .child(MONO(div()).text_size(10.5).flex_none().text_color(t.muted).child(s.pr && s.progress.total ? `${s.progress.done}/${s.progress.total}` : s.group === "done" ? `#${s.pr.number}` : ago(s.at))))
        .child(h_flex().items_center().gap(8).pl(16).min_w(0)
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(needs ? t.blocked : t.muted).child(s.reason)));
    };
    return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground).on_size_change(this.onSize)
      .child(this.header(t, "Forge", [
        this.button(t, "board", "⤢", () => this.openBoard()),
        this.button(t, "start", "+", () => this.openStart()),
        this.button(t, "fold", "‹", () => this.collapse()),
      ]))
      .when(this.error, (el) => el.child(this.empty(t, this.error)))
      .child(v_flex().flex_1().overflow_y_scroll().px(6).py(8).gap(14).children(groups.map((g) =>
        v_flex().gap(2)
          .child(h_flex().px(6).pb(4).gap(6).items_center()
            .child(div().text_size(11).font_semibold().text_color(this.groupColor(t, g.key)).child(g.title.toUpperCase() + (g.key === "done" ? DONE_SUFFIX : "")))
            .child(MONO(div()).text_size(10.5).text_color(t.muted).child(String(g.items.length))))
          .children(g.items.length ? g.items.map((s) => row(g, s)) : [this.empty(t, g.key === "needs" ? "nothing waiting on you" : "none")]))))
      .child(v_flex().border_t(1).border_color(t.border)
        .child(h_flex().id("backlog").px(12).py(9).items_center().gap(8).cursor_pointer().hover((e) => e.bg(t.hover)).on_click(() => this.openBacklog())
          .child(div().text_size(12).child("View backlog"))
          .child(h_flex().flex_1())
          .child(MONO(div()).text_size(11).text_color(t.muted).child(`${this.data.issues.length} open`)))
        .child(h_flex().px(12).pb(8).gap(8).items_center().text_size(11).text_color(t.muted)
          .child(div().w(6).h(6).rounded(3).bg(this.error ? t.blocked : t.ansi2))
          .child(div().child(this.fetched ? `watching docs/ · PRs ${ago(this.fetched / 1000)} ago` : "loading…"))));
  }

  renderBoard(cx) {
    const t = theme(), all = this.live(), q = this.search.value().trim().toLowerCase();
    const groups = grouped(all.filter((s) => !q || `${s.slug} ${s.branch} ${s.reason}`.toLowerCase().includes(q))).filter((g) => this.filter === "all" || g.key === this.filter);
    const chips = [["all", "All"], ["needs", "Needs you"], ["flight", "In flight"], ["hold", "On hold"], ["done", "Done"]];
    const card = (g, s) => {
      const color = this.groupColor(t, g.key), nx = this.next(s), key = s.path ?? "pr" + s.pr.number;
      const art = (label, file) => div().px(6).py(1).rounded(4).text_size(10.5).border(1).border_color(file ? t.border : NONE).when(!file, (e) => e.border_color(t.dim).text_color(t.dim)).child(file ? label : `${label} —`);
      return v_flex().id(`c-${key}`).p(12).gap(8).rounded(8).bg(t.raised).border(1).border_color(g.key === "needs" ? alpha(t.blocked, "66") : t.border).cursor_pointer().hover((e) => e.border_color(t.input))
        .on_click(() => (s.path ? this.openDetail(s) : this.openGitHub(s.pr.url)))
        .child(h_flex().items_center().gap(8)
          .child(div().font_semibold().flex_1().min_w(0).truncate().child(s.slug))
          .child(div().px(6).py(1).rounded(9).text_size(10.5).flex_none().bg(alpha(color, "22")).text_color(color).child(chip(s)))
          .child(MONO(div()).text_size(11).text_color(t.muted).truncate().min_w(0).flex_shrink(1).child(s.branch)))
        .child(h_flex().gap(6).items_center().flex_wrap()
          .when(s.path, (e) => e.child(art("design", s.design)).child(art("plan", s.plan)))
          .when(s.pr, (e) => e.child(this.link(t, `pr-${key}`, `PR #${s.pr.number}${s.pr.isDraft ? " draft" : ""}`, s.pr.url)))
          .children(s.issues.slice(0, 3).map((n) => this.link(t, `i-${key}-${n}`, `#${n}`, `${this.repoUrl()}/issues/${n}`))))
        .when(s.progress.total > 0, (e) => e.child(h_flex().items_center().gap(8)
          .child(div().flex_1().min_w(0).h(4).rounded(2).bg(t.border).child(div().h(4).rounded(2).bg(color).w(`${Math.round(100 * s.progress.done / s.progress.total)}%`)))
          .child(MONO(div()).text_size(10.5).text_color(t.muted).child(`${s.progress.done}/${s.progress.total}`))))
        .child(h_flex().items_center().gap(8)
          .child(div().w(8).h(8).rounded(4).bg(s.agents.length ? color : t.idle))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(g.key === "needs" ? t.blocked : t.muted).child(s.agents.length ? `${s.agents.length} agent${s.agents.length > 1 ? "s" : ""} · ${s.reason}` : `${s.reason} · ${ago(s.at)}`))
          .child(h_flex().flex_none().gap(8).child(this.button(t, `nx-${key}`, nx.label, nx.go, true))
            .when(!s.merged && s.path, (e) => e.child(this.button(t, `sh-${key}`, "Shelve", () => this.shelve(s))))));
    };
    const counts = grouped(all).map((g) => `${g.items.length} ${g.title.toLowerCase()}`).join(" · ");
    return v_flex().id("root").size_full().bg(t.canvas).text_size(13).text_color(t.foreground).on_size_change(this.onSize)
      .child(this.header(t, "Forge", [
        div().w(220).min_w(140).flex_shrink(1).h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.surface).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)),
        ...chips.map(([k, l]) => this.button(t, `f-${k}`, l, (cx) => { this.filter = k; cx.notify(); }).when(this.filter === k, (e) => e.bg(t.selection))),
        this.button(t, "start", "Start work", () => this.openStart(), true),
      ]))
      .child(h_flex().px(12).py(6).gap(12).text_size(11.5).text_color(t.muted).items_center()
        .child(div().child(counts))
        .child(h_flex().flex_1())
        .child(this.button(t, "backlog", `View backlog · ${this.data.issues.length} open issues`, () => this.openBacklog()).bg(NONE).text_color(t.ansi12)))
      .when(this.error, (el) => el.child(this.empty(t, this.error)))
      .child(v_flex().flex_1().overflow_y_scroll().px(12).pb(12).gap(16).children(groups.map((g) =>
        v_flex().gap(8)
          .child(h_flex().gap(6).items_center()
            .child(div().text_size(11).font_semibold().text_color(this.groupColor(t, g.key)).child(g.title.toUpperCase() + (g.key === "done" ? DONE_SUFFIX : "")))
            .child(MONO(div()).text_size(10.5).text_color(t.muted).child(String(g.items.length))))
          .children(g.items.length ? g.items.map((s) => card(g, s)) : [this.empty(t, "none")]))));
  }
  renderBacklog(cx) {
    const t = theme(), q = this.search.value().trim().toLowerCase(), taken = takenIssues(this.live()), me = this.data.me;
    const labels = (i) => (i.labels ?? []).map((l) => l.name);
    const shelved = this.data.issues.filter((i) => labels(i).includes("shelved") && !taken.has(i.number)); // already resumed → it is a track, not a shelf
    const pass = (i) => this.filter === "all" || (this.filter === "bug" && kind(i) === "bug") || (this.filter === "feature" && kind(i) === "feature") || (this.filter === "agent" && isParked(i)) || (this.filter === "yours" && i.author?.login === me);
    const rows = this.data.issues.filter((i) => !labels(i).includes("shelved") && pass(i) && (!q || `#${i.number} ${i.title} ${i.body ?? ""}`.toLowerCase().includes(q)));
    const chips = [["all", "All"], ["bug", "Bugs"], ["feature", "Features"], ["agent", "Parked by agents"], ["yours", "Yours"]];
    const cell = (w, el) => div().w(w).flex_none().child(el);
    const wide = !this.narrow(640); // below this the KIND, PARKED FROM and BY columns go, header and rows together
    const row = (i) => {
      const tk = taken.get(i.number), k = kind(i), parked = isParked(i);
      const from = /From (PR #\d+|review of PR #\d+)|Deferred from design ([^\s]+)|Filed from the (plan|build)/.exec(i.body ?? "")?.[0] ?? "";
      return h_flex().id(`b-${i.number}`).px(8).py(6).gap(10).items_center().rounded(6).hover((e) => e.bg(t.hover)).when(tk, (e) => e.opacity(0.55))
        .child(cell(64, this.link(t, `bl-${i.number}`, `#${i.number}`, i.url)))
        .when(wide, (e) => e.child(cell(72, k ? div().px(6).rounded(9).text_size(10.5).bg(k === "bug" ? alpha(t.blocked, "22") : alpha(t.ansi5, "22")).text_color(k === "bug" ? t.blocked : t.ansi5).child(k) : div())))
        .child(v_flex().flex_1().min_w(0).child(div().truncate().font_medium().child(i.title)).child(div().truncate().text_size(11).text_color(t.muted).child((i.body ?? "").split("\n").find(Boolean) ?? "")))
        .when(wide, (e) => e.child(cell(150, div().truncate().text_size(11).text_color(t.muted).child(tk ? `in track "${tk}"` : from)))
          .child(cell(90, div().px(6).rounded(9).truncate().text_size(10.5).bg(parked ? alpha(t.accent, "22") : t.border).text_color(parked ? t.ansi12 : t.muted).child(parked ? "agent" : i.author?.login === me ? "you" : i.author?.login ?? ""))))
        .child(cell(32, MONO(div()).text_size(11).text_color(t.muted).child(since(i.createdAt))))
        .child(cell(56, tk ? div() : this.button(t, `st-${i.number}`, "Start", () => this.openStart(i))));
    };
    return v_flex().id("root").size_full().bg(t.canvas).text_size(13).text_color(t.foreground).on_size_change(this.onSize)
      .child(this.header(t, "Backlog", [
        div().w(240).min_w(140).flex_shrink(1).h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.surface).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)),
        ...chips.map(([k, l]) => this.button(t, `f-${k}`, l, (cx) => { this.filter = k; this.shown = 50; cx.notify(); }).when(this.filter === k, (e) => e.bg(t.selection))),
        this.button(t, "board", "Board", () => this.openBoard()),
      ]))
      .when(this.error, (el) => el.child(this.empty(t, this.error)))
      .when(shelved.length, (el) => el.child(v_flex().mx(12).mt(10).p(10).gap(6).rounded(8).bg(t.surface).border(1).border_color(alpha(t.ansi5, "66"))
        .child(div().text_size(10.5).font_semibold().text_color(t.ansi5).child("SHELVED WORK — a branch is waiting"))
        .children(shelved.map((i) => h_flex().id(`sh-${i.number}`).gap(10).items_center().py(3)
          .child(this.link(t, `shl-${i.number}`, `#${i.number}`, i.url))
          .child(div().flex_1().min_w(0).truncate().child(i.title))
          .child(MONO(div()).text_size(11).text_color(t.muted).child(since(i.createdAt)))
          .child(this.button(t, `rs-${i.number}`, "Resume", () => this.openStart(i), true))))))
      .child(v_flex().flex_1().overflow_y_scroll().px(12).py(10).gap(1)
        .child(h_flex().px(8).pb(4).gap(10).text_size(10.5).font_semibold().text_color(t.muted)
          .child(cell(64, div().child("ISSUE"))).when(wide, (e) => e.child(cell(72, div().child("KIND")))).child(div().flex_1().min_w(0).child("TITLE")).when(wide, (e) => e.child(cell(150, div().child("PARKED FROM"))).child(cell(90, div().child("BY")))).child(cell(32, div().child("AGE"))).child(cell(56, div())))
        .children(rows.length ? rows.slice(0, this.shown).map(row) : [this.empty(t, !this.fetched ? "loading…" : this.data.issues.length ? "nothing matches" : "no open issues")])
        .child(h_flex().px(8).py(10).gap(12).items_center().text_size(11.5).text_color(t.muted)
          .child(div().child(`showing ${Math.min(this.shown, rows.length)} of ${rows.length}`))
          .when(rows.length > this.shown, (e) => e.child(this.button(t, "more", "Load 50 more", (cx) => { this.shown += 50; cx.notify(); })))));
  }
  initDetail(cx) {
    this.tab = "design"; this.docs = {}; this.editing = false; this.editor = null; this.saveMsg = null; this.log = [];
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
    this.loadDoc(cx);
  }
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
  edit(cx) {
    const d = this.docs[this.tab]; if (!d || d.text === null) return;
    this.saveMsg = null;
    this.editBase = d.text; // NOT this.base (that is the git base ref the header and refresh use) — what the person started from: the `expected` for the save and the merge base — never the reloaded text
    this.editor = EditorState.new({ language: "markdown", value: d.text, soft_wrap: true, line_numbers: false, folding: false });
    this.editing = true; cx.notify();
  }
  // Stale save: 3-way merge with git merge-file (base = what we read, ours = the edit, theirs = disk).
  // Markers left → write them and open an agent tab in the worktree to resolve. Never a refusal.
  async save(cx) {
    if (this.saving) return;
    const tr = this.track(), d = this.docs[this.tab]; if (!tr || !d) return;
    this.saving = true; let tmp = null;
    try {
      const path = `${tr.path}/${d.rel}`, ours = this.editor.value();
      try { await writeTextFile(path, ours, this.editBase); this.saveMsg = "saved"; }
      catch {
        const raw = await readTextFile(path), theirs = raw ?? ""; // raw is null when the file is gone: expecting null recreates it
        const dir = `${appHome()}/data/forge-merge`; tmp = `${dir}/${Date.now()}`; // per save, so two panes never share files
        await mkdir(dir, { recursive: true });
        await Promise.all([writeFile(`${tmp}.base`, this.editBase), writeFile(`${tmp}.ours`, ours), writeFile(`${tmp}.theirs`, theirs)]);
        const r = await exec("git", ["merge-file", "-p", "-L", "yours", "-L", "before", "-L", "agent", `${tmp}.ours`, `${tmp}.base`, `${tmp}.theirs`]);
        // merge-file exits with the conflict count (0..127); anything else (a null code from a kill, 255) is an error with empty stdout — never write that over the file.
        if (!(r.code >= 0 && r.code <= 127)) { this.saveMsg = `merge failed: ${(r.stderr || "git merge-file error").trim()} — your text is still in the editor`; cx.notify(); return; }
        await writeTextFile(path, r.stdout, raw);
        if (r.code === 0) this.saveMsg = "merged with an agent's edit and saved";
        else { this.saveMsg = "conflict — an agent tab is resolving it"; this.openAgent(tr.path, `Resolve the conflict markers in ${d.rel} (yours = the person's edit, agent = your earlier write); keep both intents, then stop.`); }
      }
      this.docs = {}; this.editing = false; this.editor = null; this.editBase = null; this.loadDoc(cx); cx.notify();
    } catch (e) { this.saveMsg = `save failed: ${e?.message ?? e} — your text is still in the editor`; cx.notify(); }
    finally { this.saving = false; if (tmp) exec("rm", ["-f", `${tmp}.base`, `${tmp}.ours`, `${tmp}.theirs`]).catch(() => {}); }
  }
  renderDetail(cx) {
    const t = theme(), tr = this.track();
    if (!tr) return v_flex().id("root").size_full().bg(t.surface).p(12).gap(8).text_color(t.dim).child(this.data.worktrees.length ? "This track's worktree is gone (shelved or removed)." : "loading…");
    const color = this.groupColor(t, tr.group), nx = this.next(tr), gh = this.repoUrl();
    const tabs = [["design", "Design"], ["plan", "Plan"], ["pr", tr.pr ? `PR #${tr.pr.number}${tr.pr.isDraft ? " (draft)" : ""}` : "PR"], ["issues", `Issues (${tr.issues.length})`]];
    const tabEl = (k, l) => div().id(`t-${k}`).flex_none().px(10).py(7).text_size(12.5).cursor_pointer().border_b(2).border_color(this.tab === k ? t.accent : NONE).text_color(this.tab === k ? t.foreground : t.muted).child(l)
      .on_click((_e, cx) => { if (this.editing) return; this.tab = k; cx.notify(); });
    const doc = (key) => {
      const d = this.docs[key];
      if (!tr[key]) return v_flex().p(12).gap(8).child(div().text_color(t.dim).child(`no ${key} on this branch yet`)).child(this.button(t, `mk-${key}`, key === "design" ? "Brainstorm" : "Plan", () => this.openAgent(tr.path, "/forge:start"), true));
      if (!d) return this.empty(t, "loading…");
      if (d.text === null) return this.empty(t, `can't read ${d.rel}: ${d.err}`);
      if (this.editing) return Editor.new(this.editor).flex_1().min_h(0);
      const body = v_flex().flex_1().min_h(0).px(16).py(12).child(TextView.markdown(`doc-${key}`, d.text).selectable().scrollable());
      if (key !== "plan") return body;
      const tasks = planTasks(d.text, tr.pr?.body);
      const blocked = tr.agents.find((a) => a.status === "blocked");
      return v_flex().flex_1().min_h(0)
        .when(blocked, (e) => e.child(h_flex().mx(16).mt(8).p(8).gap(8).items_center().rounded(6).bg(alpha(t.blocked, "14")).border(1).border_color(alpha(t.blocked, "66"))
          .child(div().flex_1().text_size(12).text_color(t.blocked).child("The build is waiting on you in its tab."))
          .child(this.button(t, "ans", "Answer", () => run("agent.focus", { terminal: blocked.address }), true))))
        .child(v_flex().px(16).py(8).gap(3).children(tasks.map((k) => h_flex().gap(8).items_center().text_size(12.5)
          .child(MONO(div()).w(16).text_color(k.done ? t.ansi2 : t.dim).child(k.done ? "✓" : "○"))
          .child(MONO(div()).text_color(t.muted).child(`T${k.n}`))
          .child(div().flex_1().min_w(0).truncate().text_color(k.done ? t.muted : t.foreground).child(k.title)))))
        .child(body);
    };
    const prTab = () => !tr.pr ? this.empty(t, "no PR yet — the build opens a draft PR as its first step")
      : v_flex().flex_1().min_h(0).px(16).py(12).gap(8)
        .child(h_flex().gap(8).items_center().child(div().font_semibold().flex_1().min_w(0).truncate().child(tr.pr.title)).child(div().text_size(11).text_color(t.muted).child(tr.pr.state.toLowerCase())).child(this.link(t, "prgh", "Open on GitHub", tr.pr.url)))
        .child(TextView.markdown("pr-body", tr.pr.body ?? "").selectable().scrollable());
    const issuesTab = () => v_flex().p(8).gap(2).children(tr.issues.length ? tr.issues.map((n) => {
      const i = this.data.issues.find((x) => x.number === n);
      return h_flex().id(`li-${n}`).px(8).py(6).rounded(6).gap(8).items_center().hover((e) => e.bg(t.hover))
        .child(MONO(div()).text_size(11).text_color(t.muted).child(`#${n}`))
        .child(div().flex_1().min_w(0).truncate().child(i?.title ?? "(closed or not loaded)"))
        .child(this.link(t, `ligh-${n}`, "Open on GitHub", i?.url ?? `${gh}/issues/${n}`));
    }) : [this.empty(t, "no linked issues")]);
    const slim = this.narrow(720); // below this the rail goes: reason + Next move under the header
    const rail = v_flex().w(220).flex_none().p(12).gap(14).border_l(1).border_color(t.border).text_size(12)
      .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("WAITING ON")).child(div().text_color(tr.group === "needs" ? t.blocked : t.foreground).child(tr.reason)))
      .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("NEXT")).child(this.button(t, "rnx", nx.label, nx.go, true)))
      .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("AGENTS ON THIS TRACK"))
        .children(tr.agents.length ? tr.agents.map((a) => h_flex().id(`ag-${a.address}`).gap(6).items_center().cursor_pointer().hover((e) => e.text_color(t.accent)).on_click(() => run("agent.focus", { terminal: a.address }))
          .child(div().w(7).h(7).rounded(4).bg(t[a.status] ?? t.idle)).child(MONO(div()).child(a.address)).child(div().text_color(t.muted).child(a.status))) : [div().text_color(t.dim).child("none")]))
      .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("ACTIVITY"))
        .children(this.log.length ? this.log.map(([h, s, when]) => v_flex().min_w(0).child(div().truncate().child(s)).child(MONO(div()).text_size(10.5).text_color(t.dim).child(`${h} · ${when}`))) : [div().text_color(t.dim).child("no commits yet")]));
    const canEdit = !this.on && (this.tab === "design" || this.tab === "plan") && this.docs[this.tab]?.text != null;
    return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground).on_size_change(this.onSize)
      .child(h_flex().px(12).py(8).gap(8).items_center().flex_wrap().border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(14).truncate().min_w(0).child(tr.slug))
        .child(MONO(div()).text_size(11).text_color(t.muted).truncate().min_w(0).flex_shrink(1).child(tr.branch))
        .when(tr.pr, (e) => e.child(this.link(t, "hpr", `PR #${tr.pr.number}`, tr.pr.url)))
        .children(tr.issues.slice(0, 3).map((n) => this.link(t, `hi-${n}`, `#${n}`, `${gh}/issues/${n}`)))
        .child(h_flex().flex_grow(1).justify_end().items_center().gap(8)
          .child(div().px(6).py(1).rounded(9).text_size(10.5).bg(alpha(color, "22")).text_color(color).child(chip(tr)))
          .when(!tr.merged, (e) => e.child(this.button(t, "shelve", "Shelve → issue", () => this.shelve(tr))))))
      .when(slim, (el) => el.child(h_flex().px(12).py(6).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().text_size(10.5).font_semibold().text_color(t.muted).flex_none().child("WAITING ON"))
        .child(div().flex_1().min_w(0).truncate().text_color(tr.group === "needs" ? t.blocked : t.foreground).child(tr.reason))
        .child(h_flex().flex_none().child(this.button(t, "rnx", nx.label, nx.go, true)))))
      .child(h_flex().flex_1().min_h(0).items_stretch()
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().px(8).items_center().gap(8).border_b(1).border_color(t.border)
            .child(h_flex().id("tabs").flex_1().min_w(0).overflow_x_scroll().children(tabs.map(([k, l]) => tabEl(k, l))))
            .child(h_flex().flex_none().items_center().gap(8)
              .when(this.saveMsg, (e) => e.child(div().text_size(11).text_color(t.muted).child(this.saveMsg)))
              .when(canEdit && !this.editing, (e) => e.child(this.button(t, "edit", "Edit", (cx) => this.edit(cx))))
              .when(this.editing, (e) => e.child(this.button(t, "cancel", "Cancel", (cx) => { this.editing = false; this.editor = null; this.saveMsg = null; this.docs = {}; this.loadDoc(cx); cx.notify(); })).child(this.button(t, "save", "Save", (cx) => cx.spawn((cx) => this.save(cx)), true)))))
          .child(this.tab === "design" ? doc("design") : this.tab === "plan" ? doc("plan") : this.tab === "pr" ? prTab() : issuesTab()))
        .when(!slim, (el) => el.child(rail)));
  }
  initStart(cx) {
    this.mode = "issue"; this.sel = props().issue ?? null; this.alsoIssue = true; this.busy = null;
    this.title = InputState.new({ placeholder: "e.g. Shelve a track with a reason" });
    this.title.on("change", (_e, cx) => cx.notify());
    this.brief = TextareaState.new({ placeholder: "Links, constraints, what you already ruled out…", rows: 6 });
  }
  // Always a worktree (the design: a track is a worktree), at Herdr's path so the spaces sidebar nests it under the repo.
  // Then one agent tab there with /forge:start — the agent decides debug / brainstorm / plan / build by reading.
  async start(cx) {
    const issue = this.mode === "issue" ? this.data.issues.find((i) => i.number === this.sel) : null;
    const title = this.mode === "issue" ? issue?.title : this.title.value().trim();
    if (!title) { this.busy = "Pick an issue or type a title."; cx.notify(); return; }
    if (!this.root) { this.busy = "No git repo here."; cx.notify(); return; }
    try {
      let branch = branchFor(issue, title);
      this.busy = "Creating worktree…"; cx.notify();
      const argv = (await knownAgents({ on: this.on })).find((a) => a.installed)?.run ?? ["claude"]; // before worktree add: an unreachable machine fails here, not after the worktree exists
      await this.git(["fetch", "-q", "origin", "main"]);
      const has = async (b) => (await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${b}`])).ok;
      const onOrigin = async (b) => { // exit 2 = no such branch; anything else non-zero (network, auth) must not pass for "absent"
        const r = await exec("git", [...GIT, "ls-remote", "--exit-code", "--heads", "origin", `refs/heads/${b}`], { cwd: this.root, on: this.on });
        if (r.code === 2) return false;
        if (r.code !== 0) throw new Error(`can't check origin for ${b}: ${(r.stderr || "git ls-remote failed").trim()}`);
        return true;
      };
      const fromShelf = shelfBranch(issue) !== null;
      if (!fromShelf && await has(branch)) { // never silently reuse a branch that isn't this shelf's: first free -2, -3, …
        const base = branch; let n = 2;
        for (; n <= 9; n++) { branch = `${base}-${n}`; if (!(await has(branch)) && !(await onOrigin(branch))) break; }
        if (n > 9) throw new Error(`${base} and ${base}-2…-9 are all taken — pick another title.`);
      }
      let exists = await has(branch);
      if (fromShelf && !exists && await onOrigin(branch)) { // a shelf from another machine: resume its work, not a fresh branch from main
        const f = await this.git(["fetch", "-q", "origin", `${branch}:${branch}`]);
        if (!f.ok) throw new Error(`could not fetch ${branch} from origin`);
        exists = true;
      } else if (fromShelf && exists && await onOrigin(branch)) await this.git(["fetch", "-q", "origin", `${branch}:${branch}`]); // fast-forward a stale local shelf branch; a non-ff or checked-out branch is left as is
      const path = `${await this.homeOn()}/.herdr/worktrees/${this.repoName()}/${branch.replace(/\//g, "-")}`; // Herdr's worktree path rule: branch with / as -
      const r = await exec("git", [...GIT, "worktree", "add", ...(exists ? [path, branch] : ["--no-track", "-b", branch, path, this.base])], { cwd: this.root, on: this.on });
      if (r.code !== 0) { this.busy = (r.stderr || "git worktree add failed").trim(); cx.notify(); return; }
      const extra = this.mode === "issue" ? "" : this.brief.value().trim();
      const task = issue ? `/forge:start #${issue.number}` : `/forge:start ${title}${extra ? `\n\n${extra}` : ""}${this.alsoIssue ? "\n\nAlso open a GitHub issue for this so it shows in the backlog if it stalls." : ""}`;
      await this.openAgent(path, task, argv);
      this.dismiss();
    } catch (e) { this.busy = String(e?.message ?? e); cx.notify(); }
  }
  dismiss() { if (props().overlay) closeOverlay(props().overlay); } // only the overlay closes; the tab-mounted view (scriptable check) never runs tab.close. NOT named close(): close(cx) is Herdr's lifecycle hook, called when this tab or pane goes
  renderStart(cx) {
    const t = theme(), taken = takenIssues(this.live()), q = this.search.value().trim().toLowerCase();
    const issues = this.data.issues.filter((i) => !q || `#${i.number} ${i.title}`.toLowerCase().includes(q));
    const sel = this.data.issues.find((i) => i.number === this.sel) ?? null;
    const tab = (k, l) => div().id(`m-${k}`).px(12).py(8).text_size(13).cursor_pointer().border_b(2).border_color(this.mode === k ? t.accent : NONE).text_color(this.mode === k ? t.foreground : t.muted).when(this.mode === k, (e) => e.font_semibold()).child(l).on_click((_e, cx) => { this.mode = k; cx.notify(); });
    const row = (i) => {
      const tk = taken.get(i.number), on = i.number === this.sel;
      return v_flex().id(`is-${i.number}`).px(10).py(7).rounded(6).gap(2).cursor_pointer().bg(on ? t.selection : NONE).when(tk, (e) => e.opacity(0.5)).hover((e) => e.bg(on ? t.selection : t.hover))
        .on_click((_e, cx) => { if (!tk) { this.sel = i.number; cx.notify(); } })
        .child(h_flex().items_center().gap(8)
          .child(div().w(12).h(12).rounded(6).border(1.5).border_color(on ? t.accent : t.idle).bg(on ? t.accent : NONE))
          .child(MONO(div()).text_size(11).text_color(t.muted).child(`#${i.number}`))
          .child(div().flex_1().min_w(0).truncate().font_medium().child(i.title))
          .when(kind(i), (e) => e.child(div().px(6).rounded(9).text_size(10.5).bg(alpha(t.ansi5, "22")).text_color(t.ansi5).child(kind(i))))
          .child(div().px(6).rounded(9).text_size(10.5).bg(isParked(i) ? alpha(t.accent, "22") : t.border).text_color(isParked(i) ? t.ansi12 : t.muted).child(isParked(i) ? "agent" : i.author?.login ?? ""))
          .child(MONO(div()).w(28).text_size(11).text_color(t.muted).child(since(i.createdAt))))
        .when(tk, (e) => e.child(div().pl(26).text_size(11).text_color(t.muted).child(`already in track "${tk}" — open it instead`)));
    };
    const footer = this.mode === "issue"
      ? (sel ? `Worktree ${branchFor(sel)}${/Branch: `/.test(sel.body ?? "") ? " (resumes the shelved branch)" : ""} · agent tab opens there with #${sel.number}` : "Pick an issue")
      : "Worktree from your one-liner · agent tab opens there with your brief";
    return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground).rounded(10).on_size_change(this.onSize)
      .child(this.header(t, "Start work", [this.button(t, "close", "✕", () => this.dismiss())]))
      .child(h_flex().px(16).border_b(1).border_color(t.border).child(tab("issue", "From an issue")).child(tab("scratch", "From scratch")))
      .when(this.mode === "issue", (el) => el
        .child(h_flex().px(16).py(10).gap(8).items_center()
          .child(div().flex_1().h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.canvas).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)))
          .child(div().text_size(12).text_color(t.muted).child(`${this.data.issues.length} open · ${[...taken.keys()].filter((n) => this.data.issues.some((i) => i.number === n)).length} already in a track`)))
        .child(v_flex().flex_1().overflow_y_scroll().px(8).gap(2).children(issues.length ? issues.map(row) : [this.empty(t, "no open issues")]))
        .when(sel, (e) => e.child(v_flex().px(16).py(12).gap(8).border_t(1).border_color(t.border).bg(t.canvas)
          .child(h_flex().items_baseline().gap(8)
            .child(MONO(div()).text_size(11).text_color(t.muted).child(`#${sel.number}`))
            .child(div().font_semibold().flex_1().min_w(0).truncate().child(sel.title))
            .child(this.link(t, "gh", "View on GitHub", sel.url)))
          .child(div().text_size(12.5).text_color(t.muted).max_h(60).overflow_hidden().child((sel.body ?? "").split("\n").filter(Boolean).slice(0, 3).join(" ")))
          .child(div().text_size(12).text_color(t.muted).child("The agent reads the issue and picks how to begin: a bug starts with debug, a feature with brainstorm; a design or plan already on a branch is resumed. Nothing to choose here.")))))
      .when(this.mode === "scratch", (el) => el.child(v_flex().flex_1().px(16).py(16).gap(14)
        .child(div().text_size(12).text_color(t.muted).child("What is it? One line — this becomes the slug"))
        .child(div().h(32).px(10).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.canvas).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.title).h_full().w_full().text_size(13)))
        .child(div().text_size(12).text_color(t.muted).child("Anything the agent should know (optional)"))
        .child(div().flex_1().min_h(120).p(8).rounded(6).border(1).border_color(t.input).bg(t.canvas).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Textarea.new(this.brief).w_full().h_full().text_size(12.5)))
        .child(h_flex().id("also").gap(8).items_center().cursor_pointer().on_click((_e, cx) => { this.alsoIssue = !this.alsoIssue; cx.notify(); })
          .child(div().w(14).h(14).rounded(3).border(1).border_color(t.input).bg(this.alsoIssue ? t.accent : NONE))
          .child(div().text_size(12.5).child("Also open an issue so it shows in the backlog if this stalls")))))
      .child(h_flex().px(16).py(12).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(12).text_color(this.busy && !this.busy.endsWith("…") ? t.blocked : t.muted).child(this.busy ?? footer))
        .child(this.button(t, "cancel", "Cancel", () => this.dismiss()))
        .child(this.button(t, "go", this.mode === "issue" ? (sel ? `Start from #${sel.number}` : "Start") : "Start", (cx) => { if (!this.busy?.endsWith("…")) cx.spawn((cx) => this.start(cx)); }, true)));
  }

  render(cx) {
    const p = props() ?? {};
    if (p.view === "start") return this.renderStart(cx);
    if (p.track) return this.renderDetail(cx);
    if (p.view === "board") return this.renderBoard(cx);
    if (p.view === "backlog") return this.renderBacklog(cx);
    return this.renderSidebar(cx);
  }
}
