// forge: the dev-loop's artifacts for the shown space's repo — designs
// (docs/decisions), plans (docs/plans, with the draft PR checklist as progress),
// learnings and the dispatch log. Click a row to read it in a pane; buttons
// start the next skill in a new claude tab. With props {file} this same mod is
// the reader pane.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, run, props } from "herdr";

const GIT = ["--no-optional-locks", "-c", "core.fsmonitor=false"];
const base = (p) => p.split("/").pop().replace(/\.md$/, "");

function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const all = panes(), pane = f?.pane ? all.find((p) => p.pane === f.pane) : null;
  const sibling = f?.tab ? all.find((p) => p.tab === f.tab && p.cwd) : null;
  return { cwd: pane?.cwd || f?.cwd || sibling?.cwd || space?.folder, on: space?.machine ?? null, space: space?.id };
}

export default class Forge extends View {
  init(_p, cx) {
    this.items = { decisions: [], plans: [], other: [] }; this.prs = []; this.root = null; this.text = "";
    if (props()?.file) { this.read(cx); return; }
    this.refresh(cx);
    cx.timer.every(60000, (cx) => this.refresh(cx)); // ponytail: gh polled once a minute; the folder watch covers the files
  }

  // --- reader pane ---
  read(cx) {
    const file = props().file;
    cx.spawn(async (cx) => {
      try { this.text = await readTextFile(file, { on: props().on ?? null }); } catch (e) { this.text = `_${e}_`; }
      cx.notify();
    });
    this.watchFile(file, cx);
  }
  watchFile(file, cx) {
    const dir = file.replace(/\/[^/]*$/, "");
    cx.spawn(async (cx) => { for (;;) { await watchFolder(dir); this.read(cx); return; } });
  }

  // --- list pane ---
  refresh(cx) {
    const { cwd, on } = location();
    if (!cwd) return;
    cx.spawn(async (cx) => {
      const top = await exec("git", [...GIT, "rev-parse", "--show-toplevel"], { cwd, on }).catch(() => null);
      const root = top?.stdout.trim();
      if (!root) { this.root = null; cx.notify(); return; }
      if (root !== this.root) { this.root = root; this.watch(root, cx); }
      const ls = (dir) => exec("ls", ["-1", `${root}/${dir}`], { on }).then((r) => r.stdout.split("\n").filter((f) => f.endsWith(".md")).sort().reverse().map((f) => `${dir}/${f}`)).catch(() => []);
      const exists = async (f) => (await exec("test", ["-f", `${root}/${f}`], { on }).then(() => true).catch(() => false)) ? [f] : [];
      const [decisions, plans, learn, log] = await Promise.all([ls("docs/decisions"), ls("docs/plans"), exists("docs/learnings.md"), exists(".claude/dispatch-log.md")]);
      this.items = { decisions, plans, other: [...learn, ...log] };
      const pr = await exec("gh", ["pr", "list", "--state", "all", "--limit", "50", "--json", "number,body,url,isDraft,state,headRefName"], { cwd: root, on }).catch(() => null);
      this.prs = pr ? JSON.parse(pr.stdout || "[]") : [];
      cx.notify();
    });
  }
  watch(root, cx) {
    cx.spawn(async (cx) => {
      try { while (this.root === root) { await watchFolder(`${root}/docs`); if (this.root === root) this.refresh(cx); } } catch {}
    });
  }
  pr(plan) {
    const p = this.prs.find((p) => p.body?.startsWith(`Plan: ${plan}`));
    if (!p) return null;
    const boxes = p.body.match(/^- \[[ x]\]/gm) ?? [];
    return { ...p, done: boxes.filter((b) => b.includes("x")).length, total: boxes.length };
  }
  planFor(decision) { return this.items.plans.find((p) => base(p) === base(decision)); }

  open(file) {
    const { on } = location();
    run("pane.split", { direction: "right", mod: "forge", props: { file: `${this.root}/${file}`, on } });
  }
  start(task) { run("tab.new", { name: task.split(" ")[0].replace("/forge:", ""), space: location().space, argv: ["claude"], task }); }

  button(t, id, label, fn) {
    return div().id(id).px(6).py(1).rounded(4).text_size(11).bg(t.raised).text_color(t.foreground).hover((s) => s.bg(t.hover))
      .child(label).on_click((_e, _cx) => fn());
  }
  row(t, file, note, action) {
    return h_flex().id(`r-${file}`).items_center().gap(6).px(8).py(4).rounded(4).hover((s) => s.bg(t.hover)).on_click(() => this.open(file))
      .child(div().flex_1().truncate().child(base(file)))
      .when(note, (el) => el.child(div().text_color(t.dim).text_size(11).child(note)))
      .when(action, (el) => el.child(action));
  }
  section(t, title, rows) {
    return v_flex().gap(1).child(div().px(8).pt(8).pb(2).text_size(11).font_semibold().text_color(t.muted).child(title))
      .children(rows.length ? rows : [div().px(8).text_size(12).text_color(t.dim).child("none")]);
  }

  render(cx) {
    const t = theme();
    if (props()?.file) {
      return div().id("root").size_full().bg(t.surface).p(12).text_size(13)
        .child(TextView.markdown("doc", this.text || "_loading_").selectable().scrollable());
    }
    if (!this.root) return div().size_full().bg(t.surface).p(12).text_size(12).text_color(t.dim).child("forge: no git repo in this space");
    const decisions = this.items.decisions.map((d) => {
      const plan = this.planFor(d);
      return this.row(t, d, plan ? "planned" : null, plan ? null : this.button(t, `plan-${d}`, "Plan", () => this.start(`/forge:plan ${d}`)));
    });
    const plans = this.items.plans.map((p) => {
      const pr = this.pr(p);
      const note = pr ? `${pr.done}/${pr.total}${pr.state === "MERGED" ? " merged" : pr.isDraft ? "" : " ready"}` : "no PR";
      const finished = pr && pr.total && pr.done === pr.total;
      const action = pr?.state === "MERGED" ? null
        : finished ? this.button(t, `rev-${p}`, "Review", () => this.start(`/forge:review-branch`))
        : this.button(t, `build-${p}`, "Build", () => this.start(`/forge:build ${p}`));
      return this.row(t, p, note, h_flex().gap(4)
        .when(pr, (el) => el.child(this.button(t, `pr-${p}`, `#${pr.number}`, () => exec("open", [pr.url]))))
        .when(action, (el) => el.child(action)));
    });
    const other = this.items.other.map((f) => this.row(t, f, null, null));
    return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground).overflow_y_scroll()
      .child(h_flex().px(8).pt(8).justify_between().items_center()
        .child(div().font_semibold().child("Forge"))
        .child(this.button(t, "brainstorm", "+ Brainstorm", () => this.start("/forge:brainstorm"))))
      .child(this.section(t, "Designs", decisions))
      .child(this.section(t, "Plans", plans))
      .child(this.section(t, "Notes", other));
  }
}
