// Pure derivation: the panel is a function of git worktrees, the docs on each branch, gh
// PRs/issues and the host's agents. No herdr import, so `node --test` runs it.
export const STAGES = ["Idea", "Design", "Plan", "Build", "Review", "Merged"];
export const GROUPS = [["needs", "Needs you"], ["flight", "In flight"], ["hold", "On hold"], ["done", "Done"]];

// `git worktree list --porcelain`: blocks of "worktree <path>\nHEAD <sha>\n(branch refs/heads/x|detached)"; the first block is the main checkout.
export function parseWorktrees(porcelain) {
  const out = [];
  for (const block of (porcelain ?? "").trim().split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((l) => l.startsWith("prunable"))) continue; // gone from disk: not a track
    const branch = lines.find((l) => l.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0 });
  }
  return out;
}

export function progress(body) {
  const boxes = (body ?? "").match(/^- \[[ xX]\] T\d+\b/gm) ?? []; // only the ledger's task lines, not any checkbox in the body
  return { done: boxes.filter((b) => /x/i.test(b)).length, total: boxes.length };
}

// #n references, once each, in order of first appearance; not inside words (abc#9).
export function linked(text) {
  return [...new Set([...(text ?? "").matchAll(/(?:^|[^A-Za-z0-9_])#(\d+)\b/g)].map((m) => Number(m[1])))];
}

export function slugify(title) {
  return (title ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
}

// Shown only; never used to decide anything (the agent reads the issue).
export function kind(issue) {
  const names = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l.name));
  if (names.includes("bug")) return "bug";
  if (names.includes("feature") || names.includes("enhancement")) return "feature";
  if (names.includes("question")) return "question";
  return null;
}

// `## Task N` + next-line **title** from the plan, ticked from the PR body's `- [x] TN`.
export function planTasks(planText, prBody) {
  const ticked = new Set([...(prBody ?? "").matchAll(/^- \[[xX]\] T(\d+)\b/gm)].map((m) => Number(m[1])));
  const lines = (planText ?? "").split("\n"), out = [];
  lines.forEach((l, i) => {
    const m = /^## Task (\d+)\s*$/.exec(l);
    if (!m) return;
    const title = (lines[i + 1] ?? "").replace(/^\*\*/, "").replace(/\*\*\s*$/, "").trim();
    out.push({ n: Number(m[1]), title, done: ticked.has(Number(m[1])) });
  });
  return out;
}

function stage(t) {
  if (t.pr?.state === "MERGED") return 5;
  if (t.pr?.state === "OPEN" && !t.pr.isDraft) return 4;
  if (t.pr) return 3;
  if (t.plan) return 2;
  if (t.design) return 1;
  return 0;
}

function group(t) {
  const st = t.agents.map((a) => a.status);
  if (st.includes("blocked")) return "needs";
  if (t.pr?.state === "OPEN" && !t.pr.isDraft) return "needs";
  if (st.includes("working")) return "flight";
  if (t.pr?.state === "MERGED") return "done";
  return "hold";
}

function reason(t) {
  if (t.agents.some((a) => a.status === "blocked")) return "agent asked you something";
  if (t.group === "needs") return `review PR #${t.pr.number}`;
  if (t.group === "flight") return `${STAGES[t.stage].toLowerCase()} · agent working`;
  if (t.group === "done") return `merged · PR #${t.pr.number}`;
  if (t.stage === 0) return "no design yet";
  if (t.stage === 1) return "designed, not planned";
  if (t.stage === 2) return "planned, not built";
  if (t.stage === 3) return `build ${t.progress.done}/${t.progress.total} · no agent`;
  return "no agent";
}

const under = (cwd, path) => cwd === path || cwd.startsWith(path.endsWith("/") ? path : path + "/");

export function tracks(input) {
  return input.worktrees.filter((w) => !w.main).map((w) => {
    const d = input.docs?.[w.path] ?? {};
    const pr = w.branch ? (input.prs ?? []).find((p) => p.headRefName === w.branch && p.state !== "CLOSED") ?? null : null; // a shelved track's closed draft PR is history, not state
    const t = {
      path: w.path, branch: w.branch ?? "(detached)", slug: w.branch ? w.branch.replace(/^[^/]+\//, "") : w.path.split("/").filter(Boolean).pop(),
      design: d.design ?? null, plan: d.plan ?? null, pr,
      agents: (input.agents ?? []).filter((a) => a.cwd && under(a.cwd, w.path)),
      issues: linked(`${pr?.body ?? ""}\n${(d.designText ?? "").split("\n").filter((l) => /\b(issue|closes|fixes|resolves|from|parked|deferred)\b/i.test(l)).join("\n")}`), // design prose mentions many #n; only issue-talking lines count
      at: input.ages?.[w.path] ?? 0,
    };
    t.stage = stage(t); t.group = group(t); t.progress = progress(pr?.body); t.reason = reason(t);
    return t;
  });
}

export function grouped(ts) {
  return GROUPS.map(([key, title]) => {
    const items = ts.filter((t) => t.group === key).sort((a, b) => (key === "hold" ? a.at - b.at : b.at - a.at));
    return { key, title, items };
  });
}

// issue number -> slug of the track that references it (greyed in Start work).
export function takenIssues(ts) {
  const m = new Map();
  for (const t of ts) for (const n of t.issues) if (!m.has(n)) m.set(n, t.slug);
  return m;
}

// The branch a track for this issue lives on: a shelf issue (label or `Shelved:` title) names it (`Branch: \`x\``, written by
// /forge:shelve); otherwise fix/<slug> for a labelled bug, else feat/<slug>. The skill mirrors this.
export function shelfBranch(issue) {
  const shelf = (issue?.labels ?? []).some((l) => l.name === "shelved") || /^Shelved:/.test(issue?.title ?? "");
  const m = shelf ? /Branch: `([^`\s]+)`/.exec(issue?.body ?? "") : null;
  return m && /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(m[1]) ? m[1] : null;
}
export function branchFor(issue, title) {
  const sb = shelfBranch(issue);
  if (sb) return sb;
  const slug = slugify(issue?.title ?? title) || (issue?.number ? `issue-${issue.number}` : "work"); // a non-Latin title slugifies to ""
  return `${kind(issue ?? {}) === "bug" ? "fix" : "feat"}/${slug}`;
}

// Forge's agents file issues as `[p<sev>] …` with "From PR #n" / "From review of …" / "Filed from the plan".
export function isParked(issue) {
  return /^\[p\d\]/.test(issue.title ?? "") || /\b(From (PR|review)|Filed from|Parked|Deferred from)\b/.test(issue.body ?? "");
}
