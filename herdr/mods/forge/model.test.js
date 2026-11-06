import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktrees, progress, linked, slugify, kind, planTasks, tracks, agentsOn, grouped, takenIssues, isParked, branchFor, shelfBranch, nextLabel, chip, DONE_WINDOW_MS, slimPr, trackFor, HOME_GROUPS, homeGroups } from "./model.js";

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

test("done: with a known user only their own merged PRs are Done items; unknown user keeps all", () => {
  const now = input().now, at = new Date(now - 86400 * 1000).toISOString();
  const pr = (n, branch, login) => ({ number: n, title: `PR ${n}`, body: "", url: `u${n}`, isDraft: false, state: "MERGED", headRefName: branch, mergedAt: at, author: { login } });
  const prs = [pr(70, "fix/mine", "jr"), pr(71, "dependabot/npm/x", "dependabot[bot]")];
  const done = (me) => tracks(input({ prs, me })).filter((t) => t.group === "done").map((t) => t.branch);
  assert.deepEqual(done("jr"), ["fix/mine"]);
  assert.deepEqual(done(null).sort(), ["dependabot/npm/x", "fix/mine"]);
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

test("agentsOn: only that machine's agents; an unknown space is nobody's", () => {
  const sp = [{ id: "s1", machine: null }, { id: "mbp/s2", machine: "mbp" }];
  const ag = [{ address: "t1", space: "s1" }, { address: "mbp/t2", space: "mbp/s2" }, { address: "mbp/t3", space: "mbp/s9" }];
  assert.deepEqual(agentsOn(ag, sp, null).map((a) => a.address), ["t1"]);
  assert.deepEqual(agentsOn(ag, sp, "mbp").map((a) => a.address), ["mbp/t2"]);
  assert.deepEqual(agentsOn(ag, sp, undefined).map((a) => a.address), ["t1"]);
});

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
