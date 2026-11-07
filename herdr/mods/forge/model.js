// Pure derivation: the panel is a function of git worktrees, the docs on each branch, gh
// PRs/issues and the host's agents. No herdr import, so `node --test` runs it.
export const DONE_WINDOW_MS = 7 * 86400 * 1000; // merged PRs stay under Done this long after their worktree is gone — gh is the memory, nothing is stored

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

function group(t) {
  const st = t.agents.map((a) => a.status);
  if (st.includes("blocked")) return "needs";
  if (t.pr?.state === "OPEN" && !t.pr.isDraft) return "needs";
  if (st.includes("working")) return "flight";
  if (t.pr?.state === "MERGED") return "done";
  return "hold";
}

// The Home row's / track pane's one line: what the agent says it is doing; without one, the facts on disk.
export const lead = (t) => t.agents.find((x) => x.status === "blocked") ?? t.agents.find((x) => x.status === "working") ?? t.agents[0] ?? null;
function reason(t) {
  const a = lead(t);
  if (a?.status === "blocked") return a.msg ? `blocked · ${a.msg}` : "agent asked you something";
  if (t.group === "needs") return `review PR #${t.pr.number}`;
  if (t.group === "flight") return a?.msg ? `working · ${a.msg}` : "working";
  if (t.group === "done") return `merged · PR #${t.pr.number}`;
  const pr = t.pr ? `${t.pr.isDraft ? "draft " : ""}PR #${t.pr.number}` : "no PR";
  const who = a ? `${a.status}${a.msg ? ` · ${a.msg}` : ""}` : "no agent"; // an idle or done agent is still on the track: say so, with its last message
  return [who, t.ahead == null ? null : `${t.ahead} commit${t.ahead === 1 ? "" : "s"} ahead`, pr].filter(Boolean).join(" · "); // ahead null: the count could not be read (no base ref, remote hiccup) — say nothing rather than 0
}

export function chip(t) { const a = lead(t); return a && (a.status === "blocked" || a.status === "working") ? a.status : t.merged ? "merged" : a?.status ?? "no agent"; } // the Home row's status chip: the agent that decides the group, else merged

// The action button's label: the forge verb the branch is at. The PR decides first (docs vanish from `diff base...HEAD` after a rebase onto
// merged docs, and fix/ branches never have any); then which docs exist. /forge:start routes by itself; this is for the human.
export function nextLabel(t) {
  if (t.pr) return t.pr.isDraft ? "Resume" : "Review";
  if (!t.design) return "Start";
  if (!t.plan) return "Plan";
  return "Build";
}

const under = (cwd, path) => cwd === path || cwd.startsWith(path.endsWith("/") ? path : path + "/");

export function tracks(input) {
  const now = input.now ?? Date.now();
  const ts = input.worktrees.filter((w) => !w.main).map((w) => {
    const d = input.docs?.[w.path] ?? {};
    const mine = (input.prs ?? []).filter((p) => p.headRefName === w.branch);
    const at = input.ages?.[w.path] ?? 0; // HEAD's commit time
    const stale = (p) => at > 0 && p.mergedAt && at > Date.parse(p.mergedAt) / 1000; // a merged PR older than this worktree's HEAD: an earlier track that reused the branch name. Equal: HEAD is the merge commit itself (pulled after a merge-commit merge) — still this PR. ponytail: commit time, not ancestry; a worktree that pulls main after its own merge reads as fresh
    const pr = w.branch ? mine.find((p) => p.state === "OPEN") ?? mine.find((p) => p.state === "MERGED" && !stale(p)) ?? null : null; // a shelved track's closed draft PR is history, not state
    const t = {
      path: w.path, branch: w.branch ?? "(detached)", slug: w.branch ? w.branch.replace(/^[^/]+\//, "") : w.path.split("/").filter(Boolean).pop(),
      design: d.design ?? null, plan: d.plan ?? null, pr,
      agents: (input.agents ?? []).filter((a) => a.cwd && under(a.cwd, w.path)),
      issues: linked(`${pr?.body ?? ""}\n${(d.designText ?? "").split("\n").filter((l) => /\b(issue|closes|fixes|resolves|from|parked|deferred)\b/i.test(l)).join("\n")}`), // design prose mentions many #n; only issue-talking lines count
      at,
      ahead: input.ahead?.[w.path] ?? null, // null: unknown (see reason)
      merged: pr?.state === "MERGED",
    };
    if (t.merged && pr.mergedAt) t.at = Date.parse(pr.mergedAt) / 1000; // Done sorts by merge time, like the PR-only items below
    t.group = group(t); t.progress = progress(pr?.body); t.reason = reason(t);
    return t;
  });
  // Done keeps a merged PR for DONE_WINDOW_MS after its worktree is gone. path null: no detail pane, no actions but the PR link.
  const have = new Set(ts.map((t) => t.pr?.url).filter(Boolean)); // PRs a worktree attached; a merged PR a reused-name worktree disowned still shows here
  for (const p of input.prs ?? []) {
    if (p.state !== "MERGED" || !p.mergedAt || have.has(p.url) || /^(main|master)$/.test(p.headRefName)) continue; // a fork's main merged here would be a Done item named "main"
    const ms = Date.parse(p.mergedAt);
    if (!(now - ms >= 0 && now - ms < DONE_WINDOW_MS)) continue;
    if (input.me && p.author?.login !== input.me) continue; // teammates' and bots' merged PRs are not this user's Done; unknown me keeps all
    const t = { path: null, branch: p.headRefName, slug: p.headRefName.replace(/^[^/]+\//, ""), design: null, plan: null, pr: p, agents: [], issues: linked(p.body), at: ms / 1000, ahead: 0, merged: true };
    t.group = "done"; t.progress = progress(p.body); t.reason = reason(t);
    ts.push(t);
  }
  return ts;
}

// One machine's agents (on: a space's `machine`, null = this computer). A space missing from spaces() — its machine's layout
// still loading or unavailable — is nobody's: never count it as local, or a same-path remote agent lands on a local track.
export function agentsOn(agents, spaces, on) {
  const m = new Map(spaces.map((s) => [s.id, s.machine ?? null]));
  return agents.filter((a) => m.has(a.space) && m.get(a.space) === (on ?? null));
}

// issue number -> slug of the track that references it (greyed in Start work).
export function takenIssues(ts) {
  const m = new Map();
  for (const t of ts) if (!t.merged) for (const n of t.issues) if (!m.has(n)) m.set(n, t.slug); // a merged PR's body files parked issues that must stay startable
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
  return /^\[p\d\]/.test(issue.title ?? "") || parkedFrom(issue) !== "";
}
// The "parked from" phrase the backlog shows, or "": one regex for the badge and the cell, so an agent badge always has a source.
// Writers today: review-branch "From review of PR #n", build "From PR #n", brainstorm "Deferred from design <file>"; the bare words are what a person types.
export function parkedFrom(issue) {
  return /\b(From (PR #\d+|review of PR #\d+|review|PR)|Filed from( the \w+)?|Parked|Deferred from( design \S+)?)\b/.exec(issue.body ?? "")?.[0] ?? "";
}

// The shared gh cache persists to shared.json on every write: keep only the body lines the panel reads —
// checklist boxes (progress, planTasks ticks) and lines with #refs (linked issues). The PR tab fetches the full body on demand.
export function slimPr(p) {
  const body = (p.body ?? "").split("\n").map((l) => /^\s*- \[[ xX]\]/.test(l) ? l : linked(l).map((n) => `#${n}`).join(" ")).filter(Boolean).join("\n"); // checklist lines whole; prose shrinks to its #refs (all linked() reads)
  return { ...p, body };
}

// The deepest linked (non-main) worktree whose folder holds cwd, or null.
export function trackFor(worktrees, cwd) {
  if (!cwd) return null;
  const hits = worktrees.filter((w) => !w.main && under(cwd, w.path)).sort((a, b) => b.path.length - a.path.length);
  return hits[0]?.path ?? null;
}

export const HOME_GROUPS = [["needs", "Waiting on you"], ["flight", "In flight"], ["planned", "Planned"], ["done", "Done"]];
// New, uncommitted design/plan files in a checkout (`git status --porcelain --untracked-files=all -- docs/decisions docs/plans`):
// the work brainstorm/plan are writing before a worktree exists. Only new files (?? or A); an edit to a committed doc is not a draft.
export function drafts(porcelain) {
  const by = new Map();
  for (const line of (porcelain ?? "").split("\n")) {
    const m = /^(\?\?|A[ MD]) (docs\/(decisions|plans)\/\d{4}-\d{2}-\d{2}-([^/]+)\.md)$/.exec(line.trimEnd());
    if (!m) continue;
    const [, , file, dir, slug] = m, d = by.get(slug) ?? { slug, design: null, plan: null };
    d[dir === "decisions" ? "design" : "plan"] = file; by.set(slug, d);
  }
  return [...by.values()];
}

// Home across repos. repos: [{root, on, nwo, tracks, drafts?}] with tracks from tracks(). assigned/shelved: `gh search issues` rows
// ({repository:{name,nameWithOwner}, number, title, url, labels, createdAt}). merged: `gh search prs --merged-at` rows
// ({repository, number, title, url, closedAt}; search has no mergedAt, and closedAt is the merge time for a merged PR).
export function homeGroups({ repos = [], assigned = [], shelved = [], merged = [], now = Date.now() }) {
  const items = { needs: [], flight: [], planned: [], done: [] };
  const taken = new Set(), seenPr = new Set(), byNwo = new Map(repos.filter((r) => r.nwo).sort((a, b) => (a.on == null) - (b.on == null)).map((r) => [r.nwo, r])); // a repo on this computer wins over a same-nwo remote one: Map keeps the last, so sort it last
  const withPath = new Set(repos.flatMap((r) => r.tracks.filter((t) => t.path && t.pr?.url).map((t) => t.pr.url))); // a PR that has a worktree anywhere: that row wins over PR-only copies
  for (const r of [...repos].sort((a, b) => (a.on == null ? 0 : 1) - (b.on == null ? 0 : 1))) { // this computer's copy first, so it wins a duplicate
    const repo = r.root.split("/").pop();
    for (const t of r.tracks) {
      if (!t.path && t.pr?.url && (seenPr.has(t.pr.url) || withPath.has(t.pr.url))) continue; // the same PR-only Done item from another machine's copy of the repo
      items[t.group === "hold" ? "flight" : t.group].push({ ...t, repo, root: r.root, on: r.on ?? null });
      if (t.pr?.url) seenPr.add(t.pr.url);
      if (!t.merged && r.nwo) for (const n of t.issues) taken.add(`${r.nwo}#${n}`);
    }
    for (const d of r.drafts ?? []) items.flight.push({ draft: true, path: null, slug: d.slug, design: d.design, plan: d.plan, repo, root: r.root, on: r.on ?? null, agents: [], issues: [], at: 0 }); // agents/issues: the row code reads them like any flight item
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
  const rank = (it) => (it.group === "flight" ? 0 : it.draft ? 1 : 2); // agent-backed, then drafts, then no-agent
  items.flight.sort((a, b) => rank(a) - rank(b) || (rank(a) === 0 ? b.at - a.at : rank(a) === 2 ? a.at - b.at : 0));
  items.needs.sort((a, b) => b.at - a.at);
  items.planned.sort((a, b) => (b.shelved - a.shelved) || b.at - a.at); // shelved first, then newest
  items.done.sort((a, b) => b.at - a.at);
  return HOME_GROUPS.map(([key, title]) => ({ key, title, items: items[key] }));
}

// How long a gh cache entry counts as fresh: its base ttl, stretched to 1/20 of how long its data has gone unchanged, up to QUIET_CAP.
// Quiet 1 h → 3 min; 10 h or more → 30 min. A base ttl above the cap (identity: a day) is never shortened.
export const QUIET_CAP = 30 * 60000;
export function cacheLife(ttl, since, now) { return since != null ? Math.max(ttl, Math.min(QUIET_CAP, (now - since) / 20)) : ttl; }
// The newest timestamp in a gh list (PRs: updatedAt/mergedAt; search hits: closedAt/createdAt), or null: seeds a new entry's quiet time.
export function newest(list) {
  if (!Array.isArray(list)) return null;
  const ts = list.map((x) => Date.parse(x?.updatedAt ?? x?.mergedAt ?? x?.closedAt ?? x?.createdAt)).filter((n) => n > 0);
  return ts.length ? Math.max(...ts) : null;
}
