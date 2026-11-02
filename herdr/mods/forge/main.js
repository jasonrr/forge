// forge: the dev-loop's work, one track per worktree of the shown repo. Four views in one mod,
// chosen by props(): none = docked sidebar; {view:"board"} work board; {view:"backlog"}; {track}
// detail; {view:"start", overlay} the Start work dialog. No stored state: everything is derived
// from git worktrees, the docs on each branch, gh PRs/issues and the host's agents.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, InputState, Input, TextareaState, Textarea, EditorState, Editor } from "gpui-base";
import { spaces, panes, agents, focused, exec, readTextFile, writeTextFile, watchFolder, theme, settings, run, props, home, appHome, knownAgents, openOverlay, closeOverlay } from "herdr";
import { writeFile, mkdir } from "fs/promises"; // allowed: writes under ~/.config/herdr-app (AGENTS.md "Other built-ins")
import { STAGES, parseWorktrees, kind, planTasks, tracks, grouped, takenIssues, isParked, slugify, branchFor } from "./model.js";

const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const MONO = (el) => el.font_family(settings().font_family); // the terminal's mono font (AGENTS.md: settings().font_family)
const ago = (sec) => { const d = Math.max(0, Date.now() / 1000 - sec); return d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`; };
const since = (iso) => ago(Date.parse(iso) / 1000);
// theme() colors are "#rrggbb" or "#rrggbbaa" (border is #ffffff18); add alpha only to the 6-digit ones.
const NONE = "#00000000"; // gpui takes only #rgb/#rrggbb/#rrggbbaa literals — never "transparent"
const alpha = (c, aa) => (/^#[0-9a-f]{6}$/i.test(c) ? c + aa : c);

// The sidebar has no cwd of its own: the space, the focused pane, or a terminal pane in the same tab.
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const all = panes(), pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const sibling = f?.tab ? all.find((p) => p.tab === f.tab && p.cwd) : null;
  return { cwd: pane?.cwd || f?.cwd || sibling?.cwd || space?.folder, space: space?.id };
}

export default class Forge extends View {
  init(_p, cx) {
    this.root = props()?.root ?? null; this.base = "origin/main";
    this.data = { worktrees: [], docs: {}, prs: [], issues: [], ages: {}, me: null, repoUrl: null };
    this.filter = "all"; this.shown = 50; this.error = null; // each view is its own copy of the mod, so these never collide
    this.search = InputState.new({ placeholder: "Search" });
    this.search.on("change", (_e, cx) => cx.notify());
    if (props()?.view === "start") this.initStart(cx);
    if (props()?.track) this.initDetail(cx);
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx)); // ponytail: gh polled once a minute; the folder watch covers files, agents() re-renders by itself
    cx.timer.every(5000, (cx) => this.relocate(cx)); // the sidebar follows the shown space
  }

  // --- data ---
  // exec resolves {code, stdout, stderr} on any exit, but REJECTS when the program or cwd does not exist (a pruned worktree, no gh); never let that kill refresh.
  async git(args, cwd = this.root) { try { const r = await exec("git", [...GIT, ...args], { cwd }); return { ok: r.code === 0, out: (r.stdout ?? "").replace(/\n+$/, "") }; } catch { return { ok: false, out: "" }; } }
  async gh(args) { try { const r = await exec("gh", args, { cwd: this.root }); return r.code === 0 ? JSON.parse(r.stdout || "[]") : null; } catch { return null; } }

  // Cheap: one git call, and a full refresh only when the shown repo changed.
  relocate(cx) {
    if (props()?.root) return;
    const { cwd } = location(); if (!cwd || cwd === this.cwd) return;
    this.cwd = cwd;
    cx.spawn(async (cx) => { const r = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd); if (r.ok && r.out.replace(/\/\.git$/, "") !== this.root) this.refresh(cx); });
  }
  refresh(cx) {
    cx.spawn(async (cx) => {
      if (!props()?.root) { // the sidebar follows the shown space; other views are pinned to props().root
        const { cwd } = location(); if (!cwd) return; this.cwd = cwd;
        const common = await this.git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
        if (!common.ok) { this.root = null; this.error = "no git repo in this space"; cx.notify(); return; }
        const root = common.out.replace(/\/\.git$/, "");
        if (root !== this.root) { this.root = root; this.watch(root, cx); }
      }
      this.base = (await this.git(["rev-parse", "--verify", "-q", "origin/main"])).ok ? "origin/main" : "main";
      const wt = parseWorktrees((await this.git(["worktree", "list", "--porcelain"])).out);
      const docs = {}, ages = {};
      await Promise.all(wt.filter((w) => !w.main).map(async (w) => {
        const changed = await this.git(["diff", "--name-only", `${this.base}...HEAD`, "--", "docs/decisions", "docs/plans"], w.path);
        const untracked = await this.git(["ls-files", "--others", "--exclude-standard", "docs/decisions", "docs/plans"], w.path);
        const files = `${changed.out}\n${untracked.out}`.split("\n").filter(Boolean);
        const design = files.find((f) => f.startsWith("docs/decisions/")) ?? null, plan = files.find((f) => f.startsWith("docs/plans/")) ?? null;
        const designText = design ? (await readTextFile(`${w.path}/${design}`).catch(() => "")) ?? "" : "";
        // (a pruned worktree never gets here: parseWorktrees drops `prunable` blocks)
        docs[w.path] = { design, plan, designText };
        ages[w.path] = Number((await this.git(["log", "-1", "--format=%ct"], w.path)).out) || 0;
      }));
      const [prs, issues] = await Promise.all([
        this.gh(["pr", "list", "--state", "all", "--limit", "200", "--json", "number,title,body,url,isDraft,state,headRefName,mergedAt,updatedAt"]),
        this.gh(["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,body,url,labels,author,createdAt"]),
      ]);
      const me = this.data.me || (await exec("gh", ["api", "user", "-q", ".login"], { cwd: this.root }).catch(() => ({}))).stdout?.trim() || null; // || not ??: an empty string must retry next time
      const repoUrl = this.data.repoUrl || (await exec("gh", ["repo", "view", "--json", "url", "-q", ".url"], { cwd: this.root }).catch(() => ({}))).stdout?.trim() || null;
      this.data = { worktrees: wt, docs, prs: prs ?? this.data.prs, issues: issues ?? this.data.issues, ages, me, repoUrl };
      this.error = prs ? null : "gh unavailable — PRs and issues may be stale";
      this.fetched = Date.now();
      if (props()?.track) this.loadDoc(cx); // the detail pane's first load: track() is null until this data exists
      cx.notify();
    });
  }
  watch(root, cx) {
    cx.spawn(async (cx) => { try { while (this.root === root) { await watchFolder(`${root}/docs`); if (this.root === root) this.refresh(cx); } } catch {} });
  }
  // Live: agents() and panes() change on their own and re-render this view; join them to tracks by cwd.
  live() {
    const ps = panes();
    const ag = agents().map((a) => ({ address: a.address, status: a.status, cwd: ps.find((p) => p.pane === a.pane)?.cwd ?? null }));
    return tracks({ ...this.data, agents: ag });
  }
  track() { return this.live().find((t) => t.path === props().track) ?? null; }
  repoName() { return (this.root ?? "").split("/").pop(); }
  repoUrl() { return this.data.repoUrl ?? "https://github.com"; }

  // --- actions: every write is an agent's or the person's, never the panel's bookkeeping ---
  // Harness-agnostic: the agent is Herdr's most-picked installed one (knownAgents is ordered that way); no model choice here.
  async openAgent(path, task) {
    const argv = (await knownAgents()).find((a) => a.installed)?.run ?? ["claude"];
    const space = spaces().find((s) => s.folder === path); // ponytail: folder match; a space made by Start/worktree mod has exactly this folder
    if (space) run("tab.new", { space: space.id, argv, task }); else run("space.new", { folder: path, argv, task });
  }
  openGitHub(url) { exec("open", [url]); }
  openBoard() { run("tab.new", { name: "Forge", space: location().space, mod: "forge", props: { view: "board", root: this.root } }); }
  openBacklog() { run("tab.new", { name: "Backlog", space: location().space, mod: "forge", props: { view: "backlog", root: this.root } }); }
  openDetail(t) { run("pane.split", { direction: "right", mod: "forge", props: { track: t.path, root: this.root } }); }
  openStart(issue) { openOverlay({ mod: "forge", props: { view: "start", root: this.root, issue: issue?.number ?? null }, kind: "dialog", width: 720, height: 720 }); }
  // The next verb for a track, run by an agent in that worktree.
  next(t) {
    if (t.agents.some((a) => a.status === "blocked")) return { label: "Answer", go: () => run("agent.focus", { terminal: t.agents.find((a) => a.status === "blocked").address }) };
    if (t.agents.some((a) => a.status === "working")) return { label: "Open tab", go: () => run("agent.focus", { terminal: t.agents.find((a) => a.status === "working").address }) };
    if (t.stage === 5) { // Herdr's own Remove worktree dialog closes the space it is given — only when this track has one (mods/worktree/main.js:2 documents {space, folder?, action}); otherwise an agent removes it
      const sp = spaces().find((s) => s.folder === t.path);
      return { label: "Remove worktree", go: () => sp ? openOverlay({ mod: "worktree", props: { action: "remove", space: sp.id, folder: t.path }, kind: "dialog" })
        : this.openAgent(this.root, `This branch is merged. Run: git worktree remove "${t.path}" (never --force; if it refuses, say why and stop), then git branch -d ${t.branch} (never -D). Then stop.`) };
    }
    if (t.stage === 4) return { label: "Review", go: () => this.openAgent(t.path, "/forge:review-branch") };
    if (t.stage >= 2) return { label: t.stage === 3 ? "Resume build" : "Build", go: () => this.openAgent(t.path, `/forge:build ${t.plan}`) };
    if (t.stage === 1) return { label: "Plan", go: () => this.openAgent(t.path, "/forge:plan") };
    return { label: "Start", go: () => this.openAgent(t.path, "/forge:start") };
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
  pips(t, stage, color) {
    return h_flex().gap(3).children(STAGES.map((_, i) => div().w(10).h(4).rounded(2).bg(i < stage ? t.selection : i === stage ? color : t.border)));
  }
  groupColor(t, key) { return { needs: t.blocked, flight: t.accent, hold: t.muted, done: t.ansi2 }[key]; }
  header(t, title, right) {
    return h_flex().px(12).py(8).items_center().gap(8).border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(14).child(title))
      .child(MONO(div()).text_size(11).text_color(t.muted).child(`${this.repoName()} · ${this.base.replace("origin/", "")}`))
      .child(h_flex().flex_1()).children(right ?? []);
  }
  empty(t, text) { return div().px(8).py(4).text_size(12).text_color(t.dim).child(text); }

  // --- sidebar (default) ---
  renderSidebar(cx) {
    const t = theme(), groups = grouped(this.live());
    const row = (g, s) => {
      const color = this.groupColor(t, g.key), needs = g.key === "needs";
      return v_flex().id(`s-${s.path}`).px(6).py(5).rounded(6).gap(3).cursor_pointer().bg(needs ? alpha(t.blocked, "14") : NONE).hover((e) => e.bg(t.hover))
        .on_click(() => this.openDetail(s))
        .child(h_flex().items_center().gap(8)
          .child(div().w(8).h(8).rounded(4).bg(s.agents.length ? color : t.idle))
          .child(div().flex_1().truncate().font_medium().child(s.slug))
          .child(MONO(div()).text_size(10.5).text_color(t.muted).child(s.pr && s.progress.total ? `${s.progress.done}/${s.progress.total}` : s.group === "done" ? `#${s.pr.number}` : ago(s.at))))
        .child(h_flex().items_center().gap(8).pl(16)
          .child(this.pips(t, s.stage, color))
          .child(div().flex_1().truncate().text_size(11).text_color(needs ? t.blocked : t.muted).child(s.reason)));
    };
    return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground)
      .child(this.header(t, "Forge", [
        this.button(t, "board", "⤢", () => this.openBoard()),
        this.button(t, "start", "+", () => this.openStart()),
      ]))
      .when(this.error, (el) => el.child(this.empty(t, this.error)))
      .child(v_flex().flex_1().overflow_y_scroll().px(6).py(8).gap(14).children(groups.map((g) =>
        v_flex().gap(2)
          .child(h_flex().px(6).pb(4).gap(6).items_center()
            .child(div().text_size(11).font_semibold().text_color(this.groupColor(t, g.key)).child(g.title.toUpperCase()))
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

  renderBoard(cx) { return div().id("root").size_full().bg(theme().surface).p(12).child("board"); }
  renderBacklog(cx) { return div().id("root").size_full().bg(theme().surface).p(12).child("backlog"); }
  renderDetail(cx) { return div().id("root").size_full().bg(theme().surface).p(12).child("detail"); }
  renderStart(cx) { return div().id("root").size_full().bg(theme().surface).p(12).child("start"); }
  initStart(cx) {}
  initDetail(cx) {}

  render(cx) {
    const p = props() ?? {};
    if (p.view === "start") return this.renderStart(cx);
    if (p.track) return this.renderDetail(cx);
    if (p.view === "board") return this.renderBoard(cx);
    if (p.view === "backlog") return this.renderBacklog(cx);
    return this.renderSidebar(cx);
  }
}
