import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, progress, linked, slugify, kind, planTasks, tracks, grouped, takenIssues, isParked, branchFor, STAGES } from "./model.js";

const WT = "worktree /r\nHEAD aaa\nbranch refs/heads/main\n\nworktree /r/.claude/worktrees/ring\nHEAD bbb\nbranch refs/heads/feat/ring\n\nworktree /h/.herdr/worktrees/r/fix-login\nHEAD ccc\ndetached\n\nworktree /gone\nHEAD ddd\nbranch refs/heads/feat/gone\nprunable gitdir file points to non-existent location\n";

test("parseWorktrees: first is main, detached has no branch, prunable is dropped", () => {
  const w = parseWorktrees(WT);
  assert.deepEqual(w, [
    { path: "/r", branch: "main", main: true },
    { path: "/r/.claude/worktrees/ring", branch: "feat/ring", main: false },
    { path: "/h/.herdr/worktrees/r/fix-login", branch: null, main: false },
  ]);
});

test("progress counts PR checklist boxes", () => {
  assert.deepEqual(progress("Plan: x\n\n- [x] T1 — a\n- [ ] T2 — b\n- [x] T3 — c\n\nAfter merge:\n- [ ] run the installer\n"), { done: 2, total: 3 });
  assert.deepEqual(progress(null), { done: 0, total: 0 });
});

test("linked finds #n references once each, not inside words", () => {
  assert.deepEqual(linked("Fixes #12 and #7, see #12. abc#9 (#30)"), [12, 7, 30]);
});

test("slugify", () => {
  assert.equal(slugify("Ring: which bus carries beats?"), "ring-which-bus-carries-beats");
  assert.equal(slugify("  A  very long title that keeps going and going past forty chars "), "a-very-long-title-that-keeps-going-and-g");
});

test("kind from labels only", () => {
  assert.equal(kind({ labels: [{ name: "bug" }] }), "bug");
  assert.equal(kind({ labels: [{ name: "enhancement" }] }), "feature");
  assert.equal(kind({ labels: [{ name: "feature" }] }), "feature");
  assert.equal(kind({ labels: [{ name: "question" }] }), "question");
  assert.equal(kind({ labels: [{ name: "wontfix" }] }), null);
  assert.equal(kind({ labels: [] }), null);
});

test("planTasks joins plan headings with PR ticks", () => {
  const plan = "# Plan\n\n## Task 1\n**First**\n\n- x\n\n## Task 2\n**Second**\n";
  const body = "Plan: p\n\n- [x] T1 — First (u#task-1)\n- [ ] T2 — Second (u#task-2)\n";
  assert.deepEqual(planTasks(plan, body), [{ n: 1, title: "First", done: true }, { n: 2, title: "Second", done: false }]);
  assert.deepEqual(planTasks(plan, null), [{ n: 1, title: "First", done: false }, { n: 2, title: "Second", done: false }]);
});

function input(over = {}) {
  return {
    worktrees: parseWorktrees(WT),
    docs: { "/r/.claude/worktrees/ring": { design: "docs/decisions/2026-11-01-ring.md", plan: "docs/plans/2026-11-01-ring.md", designText: "Problem from issue #51.\nUnrelated to #12, colour #123456." } },
    prs: [{ number: 55, title: "Ring", body: "Plan: docs/plans/2026-11-01-ring.md\n\n- [x] T1 — a\n- [ ] T2 — b\n\nCloses #38", url: "u", isDraft: true, state: "OPEN", headRefName: "feat/ring", mergedAt: null }],
    agents: [],
    ages: { "/r/.claude/worktrees/ring": 1000 },
    ...over,
  };
}

test("tracks: one per non-main worktree; stage, group, issues, progress", () => {
  const ts = tracks(input());
  assert.equal(ts.length, 2);
  const t = ts.find((x) => x.branch === "feat/ring");
  assert.equal(t.branch, "feat/ring");
  assert.equal(t.slug, "ring");
  assert.equal(t.pr.number, 55);
  assert.equal(STAGES[t.stage], "Build");
  assert.equal(t.group, "hold");
  assert.deepEqual(t.issues, [38, 51]);
  assert.deepEqual(t.progress, { done: 1, total: 2 });
  assert.equal(t.at, 1000);
});

test("a detached worktree is still a track, named by its folder, with no PR", () => {
  const d = tracks(input()).find((x) => x.path === "/h/.herdr/worktrees/r/fix-login");
  assert.equal(d.slug, "fix-login"); assert.equal(d.branch, "(detached)"); assert.equal(d.pr, null);
  const blocked = tracks(input({ agents: [{ address: "t9", status: "blocked", cwd: "/h/.herdr/worktrees/r/fix-login" }] })).find((x) => x.slug === "fix-login");
  assert.equal(blocked.group, "needs");
});

test("tracks tolerates missing prs and agents", () => {
  assert.equal(tracks({ worktrees: parseWorktrees(WT), docs: {} }).length, 2);
});

test("uppercase [X] counts as ticked", () => {
  assert.deepEqual(progress("- [X] T1 — a\n- [ ] T2 — b\n"), { done: 1, total: 2 });
  assert.equal(planTasks("## Task 1\n**A**\n", "- [X] T1 — A\n")[0].done, true);
});

test("a draft PR with no docs is still Build", () => {
  assert.equal(STAGES[tracks(input({ docs: {} })).find((x) => x.branch === "feat/ring").stage], "Build");
});

test("a CLOSED PR (shelved) does not count", () => {
  const t = tracks(input({ prs: [{ ...input().prs[0], state: "CLOSED" }] })).find((x) => x.branch === "feat/ring");
  assert.equal(t.pr, null); assert.equal(STAGES[t.stage], "Plan");
});

test("stage ladder", () => {
  const st = (over) => STAGES[tracks(input(over))[0].stage];
  assert.equal(st({ docs: {}, prs: [] }), "Idea");
  assert.equal(st({ docs: { "/r/.claude/worktrees/ring": { design: "d" } }, prs: [] }), "Design");
  assert.equal(st({ docs: { "/r/.claude/worktrees/ring": { design: "d", plan: "p" } }, prs: [] }), "Plan");
  assert.equal(st({}), "Build");
  assert.equal(st({ prs: [{ ...input().prs[0], isDraft: false }] }), "Review");
  assert.equal(st({ prs: [{ ...input().prs[0], state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" }] }), "Merged");
});

test("group: blocked agent wins, then ready PR, then working, then merged, else hold", () => {
  const g = (over) => tracks(input(over))[0].group;
  const a = (status) => [{ address: "t9", status, cwd: "/r/.claude/worktrees/ring/sub" }];
  assert.equal(g({ agents: a("blocked") }), "needs");
  assert.equal(g({ prs: [{ ...input().prs[0], isDraft: false }] }), "needs");
  assert.equal(g({ agents: a("working") }), "flight");
  assert.equal(g({ agents: a("working"), prs: [{ ...input().prs[0], isDraft: false }] }), "needs");
  assert.equal(g({ prs: [{ ...input().prs[0], state: "MERGED" }] }), "done");
  assert.equal(g({ agents: a("idle") }), "hold");
  assert.equal(g({ agents: [{ address: "t9", status: "working", cwd: "/r/.claude/worktrees/ring2" }] }), "hold");
});

test("grouped: four groups in order; hold oldest first, others newest first", () => {
  const base = tracks(input())[0];
  const mk = (over) => ({ ...base, ...over });
  const g = grouped([mk({ group: "hold", at: 5, path: "a" }), mk({ group: "hold", at: 1, path: "b" }), mk({ group: "flight", at: 1, path: "c" }), mk({ group: "flight", at: 9, path: "d" })]);
  assert.deepEqual(g.map((x) => x.key), ["needs", "flight", "hold", "done"]);
  assert.deepEqual(g[2].items.map((x) => x.path), ["b", "a"]);
  assert.deepEqual(g[1].items.map((x) => x.path), ["d", "c"]);
  assert.equal(g[0].items.length, 0);
});

test("branchFor: a shelved issue resumes its recorded branch; a bug gets fix/, else feat/", () => {
  assert.equal(branchFor({ title: "Shelved: ring", labels: [{ name: "shelved" }], body: "Shelved from track `ring` at Plan.\nBranch: `feat/ring` (pushed)." }), "feat/ring");
  assert.equal(branchFor({ title: "Login 500s", labels: [{ name: "bug" }], body: "" }), "fix/login-500s");
  assert.equal(branchFor({ title: "Ring: which bus?", labels: [], body: "" }), "feat/ring-which-bus");
  assert.equal(branchFor({ title: "Odd", labels: [], body: "Branch: `--detach`" }), "feat/odd");
  assert.equal(branchFor(null, "  Shelve a track  "), "feat/shelve-a-track");
  assert.equal(branchFor({ number: 7, title: "日本語", labels: [], body: "" }), "feat/issue-7");
});

test("takenIssues and isParked", () => {
  assert.deepEqual(takenIssues(tracks(input())), new Map([[38, "ring"], [51, "ring"]]));
  assert.equal(isParked({ title: "[p2] Dispatch log grows", body: "" }), true);
  assert.equal(isParked({ title: "Thing", body: "Filed from the plan as out of scope.\nFrom PR #8" }), true);
  assert.equal(isParked({ title: "Thing", body: "No design yet." }), false);
});
