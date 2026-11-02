import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, progress, linked, slugify, kind, planTasks, tracks, grouped, takenIssues, isParked, branchFor, shelfBranch, nextLabel, chip, DONE_WINDOW_MS } from "./model.js";

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
    now: Date.parse("2026-11-02T12:00:00Z"),
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
  assert.equal(nextLabel(t), "Resume"); assert.equal(t.merged, false); assert.equal(t.ahead, 0);
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

test("a CLOSED PR (shelved) does not count", () => {
  const t = tracks(input({ prs: [{ ...input().prs[0], state: "CLOSED" }] })).find((x) => x.branch === "feat/ring");
  assert.equal(t.pr, null); assert.equal(nextLabel(t), "Build");
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

test("branchFor: a Branch: line counts only on a shelf issue", () => {
  assert.equal(branchFor({ title: "Plain", labels: [], body: "Branch: `feat/other`" }), "feat/plain");
  assert.equal(shelfBranch({ title: "Plain", labels: [], body: "Branch: `feat/other`" }), null);
  assert.equal(shelfBranch({ title: "Shelved: x", labels: [], body: "Branch: `feat/x`" }), "feat/x");
  assert.equal(shelfBranch({ title: "x", labels: [{ name: "shelved" }], body: "Branch: `feat/x`" }), "feat/x");
  assert.equal(shelfBranch({ title: "Shelved: x", labels: [], body: "Branch: `--detach`" }), null);
  assert.equal(shelfBranch(null), null);
});

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

test("a reused branch: an open PR wins over an old merged one listed first", () => {
  const t = tracks(input({ prs: [{ ...input().prs[0], number: 40, state: "MERGED", mergedAt: "2026-10-01T00:00:00Z" }, input().prs[0]] })).find((x) => x.branch === "feat/ring");
  assert.equal(t.pr.number, 55); assert.equal(t.merged, false);
});

test("chip: a blocked or working agent wins, then merged, then the first agent, then no agent", () => {
  const t = (over) => tracks(input(over)).find((x) => x.branch === "feat/ring");
  const a = (...st) => st.map((status, i) => ({ address: `t${i}`, status, cwd: "/r/.claude/worktrees/ring" }));
  const merged = { prs: [{ ...input().prs[0], state: "MERGED", mergedAt: "2026-11-01T00:00:00Z" }] };
  assert.equal(chip(t({ agents: a("idle", "blocked") })), "blocked");
  assert.equal(chip(t({ agents: a("idle", "working") })), "working");
  assert.equal(chip(t({ ...merged, agents: a("working") })), "working");
  assert.equal(chip(t({ ...merged, agents: a("idle") })), "merged");
  assert.equal(chip(t({ agents: a("done") })), "done");
  assert.equal(chip(t({})), "no agent");
});
