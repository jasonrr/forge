# Plan: Herdr work panel

- **Goal:** one Herdr desktop-app mod, shipped in this repo, that shows forge work as tracks (one per worktree) in four views — docked sidebar, work board, track detail with editing, backlog — with no stored state, every GitHub thing one click away, and two new skills `/forge:start` and `/forge:shelve` as the only begin/park verbs.
- **Design:** `docs/decisions/2026-11-02-herdr-work-panel.md` (visual spec: https://claude.ai/artifact/4vN2FyMJkp81W5LjNzgLB4)
- **Branch:** `feat/herdr-work-panel`
- **Verify (whole feature):** `node --test herdr/mods/forge/model.test.js && bash scripts/install-herdr-mod.sh && herdr-app check ~/.config/herdr-app/mods/forge && bash hooks/session-start.test.sh && [ -f skills/start/SKILL.md ] && [ -f skills/shelve/SKILL.md ] && grep -q 'herdr-app check' scripts/publish.sh`
- **Out of scope:** remote machines (the worktree/agent join is local; `exec … on` is not used), "attach an issue to a track", any stored state, a Claude-specific affordance. See the design's Cut list.

Facts the implementer must not re-derive (all verified live on 2026-11-02 against Herdr `gpui-shell 0.7.1`, `~/.config/herdr-app/AGENTS.md` and `herdr.d.ts`):

- Mod API: `exec(cmd, args, {cwd})` resolves `{code, stdout, stderr}` and does **not** reject on a nonzero exit, but it does reject when the program cannot start or `cwd` does not exist (`herdr.d.ts:4-13`) — every call sits behind a try/catch; `home()` is synchronous (`herdr.d.ts:19`); `readTextFile(path)` resolves `string | null` (`herdr.d.ts:25`; coalesce to `""`); `writeTextFile(path, text, expected: string | null)` rejects when the file on disk differs from `expected` (`herdr.d.ts:28`); `knownAgents()` resolves `[{run: string[], installed: boolean, …}]` (`herdr.d.ts:33`); `agents()` entries are `{address, pane, space, tab, status, app, focused}` and `panes()` entries `{pane, terminal, tab, cwd, branch, status, app, focused}` — an agent's folder is `panes().find(p => p.pane === a.pane)?.cwd` (`herdr.d.ts:155-202`). `spaces()` entries have `{id, name, folder, machine, branch, active, status}`; `folder` is where the space was made (AGENTS.md "The model"), which equals the worktree path for spaces opened by Start work / `space.new --folder`, and is the only join the panel uses (a space whose terminals wandered elsewhere just gets a second space from `space.new` — acceptable). `render(cx)` re-runs on its own whenever spaces/agents/panes/theme change, so live data is read in `render`, never polled (AGENTS.md "Rules").
- Controls (`gpui-base`): `InputState.new({placeholder, value})` / `Input.new(state)`, `TextareaState.new({placeholder, value, rows})` / `Textarea.new(state)`, `EditorState.new({language, value, soft_wrap, line_numbers, readonly})` / `Editor.new(state)`; states are created in `init` or an event/spawn callback, never in `render`; `state.value()` reads, `state.on("change", (e, cx) => …)` listens. Wrap an input in an element with `.on_mouse_down("left", (_e, cx) => cx.stop_propagation())` so the pane does not steal the click (pattern: `~/.config/herdr-app/mods/changes/main.js:203`). `TextView.markdown(id, text).selectable().scrollable()` renders markdown (current mod).
- Commands (AGENTS.md "Commands"): `tab.new {name?, space?, folder?, argv?, task?}` or `tab.new {name?, space?, mod, props?}`; `space.new {name?, folder?, argv?, task?}`; `pane.split {direction, mod, props}`; `agent.focus {terminal}`; `openOverlay({mod, props, kind: "dialog", width, height})` returns an id, the overlay copy sees `props().overlay` and closes with `closeOverlay(props().overlay)`. Worktree checkouts in Herdr go to `~/.herdr/worktrees/<repo>/<branch with / as ->` (shipped `mods/worktree/main.js:15-22`, and the user's global AGENTS.md worktree rule); the `spaces` sidebar nests a space whose folder is such a checkout under its repo.
- Theme tokens (`theme()`), each a `#rrggbb` or `#rrggbbaa` string: `canvas, surface, raised, border, input, foreground, muted, dim, accent, accent_foreground, selection, hover, popover, blocked, working, done, idle, ansi2, ansi5, ansi12`. Mapping fixed by the design (canvas note n7): Needs you = `blocked`; In flight = `accent`; On hold = `muted`; Done = `ansi2`; Design stage/shelved = `ansi5`; links = `ansi12`; stage pips done = `selection`, todo = `border`.
- `herdr-app check <folder>` loads a mod with no props and renders once (`gpui-shell check`); it takes no props flag, and with no data the sidebar renders no rows — so a render error in any row, card or other view passes `check`. That is why Tasks 4–6 verify by opening the view as a tab (`herdr-app do tab.new … | jq -r .tab`), waiting for data, checking `herdr-app status` `errors`, then `tab.close --id <tab> --confirmed true`. Views other than the sidebar are checked by opening them: `herdr-app do tab.new --mod forge --props '{"view":"board","root":"<abs repo path>"}'`, then `herdr-app status | jq -e '.errors == []'` must pass (`status` is JSON; `errors` is an array of file/mod errors, empty when healthy), and `herdr-app shot /tmp/x.png` shows it.
- Repo labels (`gh label list`): `bug enhancement question …` — no `feature`, no `shelved`. The backlog shows kind from `bug` / `feature` or `enhancement` / `question`; `/forge:shelve` creates `shelved` with `gh label create shelved --force` before using it.
- Forge's own build worktrees live at `$ROOT/.claude/worktrees/<slug>` (gitignored; `skills/plan/SKILL.md:46`). The panel lists **every** worktree of the repo from `git worktree list --porcelain`, so both those and `~/.herdr/worktrees/…` checkouts are tracks. Start work creates the Herdr-style path.
- The existing throwaway mod at `~/.config/herdr-app/mods/forge/` (list + reader, 125 lines) is replaced wholesale; its `location()` fallback (space → focused pane → sibling terminal pane cwd) is kept because mod panes have no cwd of their own.
- Skills: frontmatter is `name` + `description` only, then `# Title`; environment branches read `$HC_TERMINAL_ID` (desktop app) first, then `HERDR_ENV=1`, else plain (`skills/plan/SKILL.md:45-46`); issues are filed with `gh issue create --title '[p<sev>] …' --body-file -` and a quoted heredoc (`skills/brainstorm/SKILL.md:22`); no manifest lists skills — `skills/<name>/SKILL.md` is picked up by directory (`.codex-plugin/plugin.json` `"skills": "./skills/"`, `package.json` `pi.skills: ["skills"]`, Claude by convention). `AGENTS.md:5` says "the six skills" and must change.

Invariants this plan must keep (`.claude/dev-loop.md` Lenses): `hooks/routing.md` stays the only copy of the routing block (Task 7 edits it, nothing copies it); skills check `$HC_TERMINAL_ID`, then `HERDR_ENV`, then plain; never clean up on blocked/failed, never `--force` on `worktree remove`, never `-D`; a release bumps the three manifests together (this plan does not bump versions — publish does).

## Task 1
**Move the mod into the repo, add the install symlink script and the publish check**

- **Exists because:** the design says the mod ships as part of forge, versioned with the skills; without the symlink script Herdr never sees it, and without the `.gitignore` lines the app's own `jsconfig.json` / `gpui-kit.d.ts` (written into the mod folder, which becomes the repo folder through the symlink) land in the diff.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/mod.json` (new), `herdr/mods/forge/main.js` (new: the current `~/.config/herdr-app/mods/forge/main.js`, copied verbatim as the starting point; Task 3 rewrites it), `scripts/install-herdr-mod.sh` (new), `scripts/publish.sh`, `.gitignore`, `AGENTS.md`.
- **Interfaces produced:** the path `herdr/mods/forge/` for Tasks 2–6; `~/.config/herdr-app/mods/forge` is a symlink to it after the script runs.
- **Steps:**
  1. `mkdir -p herdr/mods/forge && cp ~/.config/herdr-app/mods/forge/main.js herdr/mods/forge/main.js` and write `herdr/mods/forge/mod.json`:
     ```json
     { "place": "right", "size": 340 }
     ```
  2. Write `scripts/install-herdr-mod.sh` (mode 755). Run from this build's worktree it links Herdr at the worktree's copy, which is what the build wants (saves hot-reload); after merge the user runs it once from `main` (put that line, `bash scripts/install-herdr-mod.sh` from the main checkout, in the PR body under "After merge (yours)" — until then the link dangles once the worktree is removed):
     ```bash
     #!/usr/bin/env bash
     # Point Herdr at the forge mod in this checkout: ~/.config/herdr-app/mods/forge -> herdr/mods/forge.
     # Idempotent. A real folder already there (the old hand-made mod) is moved aside, never deleted.
     set -euo pipefail
     src="$(cd "$(dirname "$0")/.." && pwd)/herdr/mods/forge"
     dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/forge"
     [ -f "$src/main.js" ] || { echo "install-herdr-mod: $src/main.js missing" >&2; exit 1; }
     mkdir -p "$(dirname "$dst")"
     if [ -L "$dst" ]; then
       [ "$(readlink "$dst")" = "$src" ] && { echo "install-herdr-mod: already linked"; exit 0; }
       rm "$dst"
     elif [ -e "$dst" ]; then
       mv "$dst" "$(dirname "$(dirname "$dst")")/forge-mod.bak-$(date +%Y%m%d%H%M%S)" # out of mods/, or Herdr loads the backup as a second mod
     fi
     ln -s "$src" "$dst"
     echo "install-herdr-mod: $dst -> $src"
     ```
  3. In `scripts/publish.sh`, directly after the `node --experimental-strip-types …routing.ts…` test line (line 27), add:
     ```bash
     if command -v herdr-app >/dev/null; then herdr-app check herdr/mods/forge; else echo "publish: no herdr-app here; skipping the mod check"; fi
     ```
  4. Append to `.gitignore`:
     ```
     herdr/mods/forge/jsconfig.json
     herdr/mods/forge/gpui-kit.d.ts
     herdr/mods/forge/herdr.d.ts
     ```
  5. `AGENTS.md`: change line 3 `Forge is skills + one hook + one pi extension, packaged for …` to `Forge is skills + one hook + one pi extension + one Herdr desktop-app mod, packaged for …`. Change line 5 `the six skills` to `the eight skills`. After the `hooks/routing.md …` bullet (line 6) insert a bullet:
     ```
     - `herdr/mods/forge/` — the Herdr work panel (gpui-kit JS; API in `~/.config/herdr-app/AGENTS.md`). `scripts/install-herdr-mod.sh` symlinks it to `~/.config/herdr-app/mods/forge`; `herdr-app check herdr/mods/forge` is its test and publish runs it when Herdr is installed. `model.js` is pure JS so `node --test herdr/mods/forge/model.test.js` covers the derivation.
     ```
- **Verify:** `bash scripts/install-herdr-mod.sh && [ -L ~/.config/herdr-app/mods/forge ] && herdr-app check ~/.config/herdr-app/mods/forge && grep -q 'herdr-app check herdr/mods/forge' scripts/publish.sh && grep -q 'herdr/mods/forge/jsconfig.json' .gitignore && grep -q 'the eight skills' AGENTS.md`

## Task 2
**`model.js`: the pure derivation from worktrees + docs + PRs + issues + agents to tracks**

- **Exists because:** every view renders the same tracks, stages and groups; if the rules live inline in render code they drift between views and cannot be tested without the app. This file has no `herdr` import so plain `node --test` covers it.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/model.js` (new), `herdr/mods/forge/model.test.js` (new).
- **Interfaces produced:** `STAGES`, `GROUPS`, `parseWorktrees(porcelain)`, `progress(body)`, `linked(text)`, `slugify(title)`, `kind(issue)`, `planTasks(planText, prBody)`, `branchFor(issue, title)`, `tracks(input)`, `grouped(tracks)`, `takenIssues(tracks)`, `isParked(issue)`. Input shape for `tracks`:
  `{ worktrees: [{path, branch, main}], docs: { [path]: {design, plan, designText} }, prs: [{number, title, body, url, isDraft, state, headRefName, mergedAt}], agents: [{address, status, cwd}], ages: { [path]: epochSeconds } }`.
- **Steps, test-first.** Code blocks in this plan are indented to sit inside the list; dedent them so the file starts at column 0. Both files are ESM (`import`/`export`); Node 22 (installed: v22.23.0) runs them without a `"type"` field — do not add one to `package.json`. Write `model.test.js` first, run `node --test herdr/mods/forge/model.test.js` — it must fail (module missing). Then write `model.js`; the test must pass. Transcribe both exactly.

  `herdr/mods/forge/model.test.js`:
  ```js
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

  test("tracks: one per non-main worktree with a branch; stage, group, issues, progress", () => {
    const ts = tracks(input());
    assert.equal(ts.length, 1);
    const t = ts[0];
    assert.equal(t.branch, "feat/ring");
    assert.equal(t.slug, "ring");
    assert.equal(t.pr.number, 55);
    assert.equal(STAGES[t.stage], "Build");
    assert.equal(t.group, "hold");
    assert.deepEqual(t.issues, [38, 51]);
    assert.deepEqual(t.progress, { done: 1, total: 2 });
    assert.equal(t.at, 1000);
  });

  test("a CLOSED PR (shelved) does not count", () => {
    const t = tracks(input({ prs: [{ ...input().prs[0], state: "CLOSED" }] }))[0];
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
    assert.equal(branchFor(null, "  Shelve a track  "), "feat/shelve-a-track");
    assert.equal(branchFor({ number: 7, title: "日本語", labels: [], body: "" }), "feat/issue-7");
  });

  test("takenIssues and isParked", () => {
    assert.deepEqual(takenIssues(tracks(input())), new Map([[38, "ring"], [51, "ring"]]));
    assert.equal(isParked({ title: "[p2] Dispatch log grows", body: "" }), true);
    assert.equal(isParked({ title: "Thing", body: "Filed from the plan as out of scope.\nFrom PR #8" }), true);
    assert.equal(isParked({ title: "Thing", body: "No design yet." }), false);
  });
  ```

  `herdr/mods/forge/model.js`:
  ```js
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
    const boxes = (body ?? "").match(/^- \[[ x]\] T\d+\b/gm) ?? []; // only the ledger's task lines, not any checkbox in the body
    return { done: boxes.filter((b) => b.includes("x")).length, total: boxes.length };
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
    const ticked = new Set([...(prBody ?? "").matchAll(/^- \[x\] T(\d+)\b/gm)].map((m) => Number(m[1])));
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
    if (t.plan && t.pr) return 3;
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
    return input.worktrees.filter((w) => !w.main && w.branch).map((w) => {
      const d = input.docs?.[w.path] ?? {};
      const pr = input.prs.find((p) => p.headRefName === w.branch && p.state !== "CLOSED") ?? null; // a shelved track's closed draft PR is history, not state
      const t = {
        path: w.path, branch: w.branch, slug: w.branch.replace(/^[^/]+\//, ""),
        design: d.design ?? null, plan: d.plan ?? null, pr,
        agents: input.agents.filter((a) => a.cwd && under(a.cwd, w.path)),
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

  // The branch a track for this issue lives on: a shelved issue names it (`Branch: \`x\``, written by
  // /forge:shelve); otherwise fix/<slug> for a labelled bug, else feat/<slug>. The skill mirrors this.
  export function branchFor(issue, title) {
    const m = /Branch: `([^`\s]+)`/.exec(issue?.body ?? "");
    if (m) return m[1];
    const slug = slugify(issue?.title ?? title) || (issue?.number ? `issue-${issue.number}` : "work"); // a non-Latin title slugifies to ""
    return `${kind(issue ?? {}) === "bug" ? "fix" : "feat"}/${slug}`;
  }

  // Forge's agents file issues as `[p<sev>] …` with "From PR #n" / "From review of …" / "Filed from the plan".
  export function isParked(issue) {
    return /^\[p\d\]/.test(issue.title ?? "") || /\b(From (PR|review)|Filed from|Parked|Deferred from)\b/.test(issue.body ?? "");
  }
  ```
- **Verify:** `node --test herdr/mods/forge/model.test.js`

## Task 3
**`main.js`: data layer, view dispatch, and the docked sidebar**

- **Exists because:** this replaces the artifact list with tracks; every later view reads `this.data` and the `tracks()` call written here. Without one shared refresh path each view would re-implement git/gh fetching.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` (rewrite).
- **Interfaces produced:** `this.root`, `this.base`, `this.data = {worktrees, docs, prs, issues, ages, me}`, `this.live()` → tracks with live agents, `this.openAgent(path, task)`, `this.openGitHub(url)`, `this.openBoard()`, `this.openBacklog()`, `this.openDetail(track)`, `this.openStart()`, `this.button(t, id, label, fn(cx), primary?)`, `this.link(t, id, label, url)`, `this.pips(t, stage, color)`, `this.groupColor(t, key)`, `this.header(t, title, rightElements)`, `this.empty(t, text)`, `this.next(track)` → `{label, go}`, `this.shelve(track)`, `this.track()` (the `props().track` track or null), `this.repoName()`, `this.repoUrl()`, and the `render` dispatch calling `renderSidebar / renderBoard / renderDetail / renderBacklog / renderStart`. Tasks 4–6 add the other `render*` methods; this task leaves them as one-line stubs that render the view's name (they are replaced, not kept).
- **Steps:**
  1. Replace `herdr/mods/forge/main.js` with the following (dedented to column 0). Keep the four `render*` stubs and `initStart`/`initDetail` each on one line — later tasks' verify greps rely on the real methods starting `renderBoard(cx) {` at end of line:
     ```js
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
     ```
  2. Run `herdr-app check herdr/mods/forge`. If `check` reports an unknown builder method (for example `font_medium`, `cursor_pointer`, `border_b`, `border_t`, `border_l`, `pl`, `pb`, `opacity`, `max_h`, `items_baseline`), look it up in `~/.config/herdr-app/mods/forge/gpui-kit.d.ts` and use the name that exists there (`font_weight`, `cursor("pointer")`, `border_b_1`, …) — do not drop the styling.
  3. In the running app the sidebar (already docked in the user's layout as `"mod": "forge"`) reloads on save. Take `herdr-app shot /tmp/forge-sidebar.png`, read the PNG with your image-reading tool (Claude Code: `Read`), and confirm: four group headings, the forge repo's worktrees as rows (at least this build's own worktree `herdr-work-panel` with stage Plan or Build), and the footer. `herdr-app status | jq -e '.errors == []'` must pass.
- **Verify:** `herdr-app check herdr/mods/forge && node --test herdr/mods/forge/model.test.js && herdr-app status | jq -e '.errors == []' >/dev/null`

## Task 4
**Work board view and the Start work dialog**

- **Exists because:** the board is the full-pane view the design centres on (cards with stage, artifacts, progress, agent, next action, Shelve); Start work is the only way the panel begins a track, and it must create the worktree and hand an agent `/forge:start` — without it nothing in the panel can begin work.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` (replace `renderBoard`, `renderStart`, `initStart`).
- **Interfaces consumed:** Task 3's `live()`, `next()`, `shelve()`, `openDetail()`, `openStart()`, `button()`, `pips()`, `link()`, `header()`; Task 2's `grouped`, `takenIssues`, `kind`, `slugify`.
- **Steps:**
  1. Replace the `renderBoard` stub with:
     ```js
     renderBoard(cx) {
       const t = theme(), all = this.live(), q = this.search.value().trim().toLowerCase();
       const groups = grouped(all.filter((s) => !q || `${s.slug} ${s.branch} ${s.reason}`.toLowerCase().includes(q))).filter((g) => this.filter === "all" || g.key === this.filter);
       const chips = [["all", "All"], ["needs", "Needs you"], ["flight", "In flight"], ["hold", "On hold"], ["done", "Done"]];
       const card = (g, s) => {
         const color = this.groupColor(t, g.key), nx = this.next(s);
         const art = (label, file) => div().px(6).py(1).rounded(4).text_size(10.5).border(1).border_color(file ? t.border : NONE).when(!file, (e) => e.border_color(t.dim).text_color(t.dim)).child(file ? label : `${label} —`);
         return v_flex().id(`c-${s.path}`).p(12).gap(8).rounded(8).bg(t.raised).border(1).border_color(g.key === "needs" ? alpha(t.blocked, "66") : t.border).cursor_pointer().hover((e) => e.border_color(t.input))
           .on_click(() => this.openDetail(s))
           .child(h_flex().items_center().gap(8)
             .child(div().font_semibold().flex_1().truncate().child(s.slug))
             .child(div().px(6).py(1).rounded(9).text_size(10.5).bg(alpha(color, "22")).text_color(color).child(STAGES[s.stage]))
             .child(MONO(div()).text_size(11).text_color(t.muted).child(s.branch)))
           .child(h_flex().gap(6).items_center()
             .child(art("design", s.design)).child(art("plan", s.plan))
             .when(s.pr, (e) => e.child(this.link(t, `pr-${s.path}`, `PR #${s.pr.number}${s.pr.isDraft ? " draft" : ""}`, s.pr.url)))
             .children(s.issues.slice(0, 3).map((n) => this.link(t, `i-${s.path}-${n}`, `#${n}`, `${this.repoUrl()}/issues/${n}`))))
           .when(s.progress.total > 0, (e) => e.child(h_flex().items_center().gap(8)
             .child(div().flex_1().h(4).rounded(2).bg(t.border).child(div().h(4).rounded(2).bg(color).w(`${Math.round(100 * s.progress.done / s.progress.total)}%`)))
             .child(MONO(div()).text_size(10.5).text_color(t.muted).child(`${s.progress.done}/${s.progress.total}`))))
           .child(h_flex().items_center().gap(8)
             .child(div().w(8).h(8).rounded(4).bg(s.agents.length ? color : t.idle))
             .child(div().flex_1().truncate().text_size(11.5).text_color(g.key === "needs" ? t.blocked : t.muted).child(s.agents.length ? `${s.agents.length} agent${s.agents.length > 1 ? "s" : ""} · ${s.reason}` : `${s.reason} · ${ago(s.at)}`))
             .child(this.button(t, `nx-${s.path}`, nx.label, nx.go, true))
             .when(s.stage < 5, (e) => e.child(this.button(t, `sh-${s.path}`, "Shelve", () => this.shelve(s)))));
       };
       const counts = grouped(all).map((g) => `${g.items.length} ${g.title.toLowerCase()}`).join(" · ");
       return v_flex().id("root").size_full().bg(t.canvas).text_size(13).text_color(t.foreground)
         .child(this.header(t, "Forge", [
           div().w(220).h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.surface).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)),
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
               .child(div().text_size(11).font_semibold().text_color(this.groupColor(t, g.key)).child(g.title.toUpperCase()))
               .child(MONO(div()).text_size(10.5).text_color(t.muted).child(String(g.items.length))))
             .children(g.items.length ? g.items.map((s) => card(g, s)) : [this.empty(t, "none")]))));
     }
     ```
     Note `.w("50%")`: if the percent string is refused by `check`, use `.w(Math.round(220 * s.progress.done / s.progress.total))` on a fixed 220-px bar instead.
  2. Replace `initStart` and `renderStart`:
     ```js
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
       const branch = branchFor(issue, title), path = `${home()}/.herdr/worktrees/${this.repoName()}/${branch.replace(/\//g, "-")}`; // Herdr's worktree path rule: branch with / as -
       this.busy = "Creating worktree…"; cx.notify();
       await this.git(["fetch", "-q", "origin", "main"]);
       const exists = (await this.git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])).ok;
       const r = await exec("git", [...GIT, "worktree", "add", ...(exists ? [path, branch] : ["--no-track", "-b", branch, path, this.base])], { cwd: this.root });
       if (r.code !== 0) { this.busy = (r.stderr || "git worktree add failed").trim(); cx.notify(); return; }
       const extra = this.mode === "issue" ? "" : this.brief.value().trim();
       const task = issue ? `/forge:start #${issue.number}` : `/forge:start ${title}${extra ? `\n\n${extra}` : ""}${this.alsoIssue ? "\n\nAlso open a GitHub issue for this so it shows in the backlog if it stalls." : ""}`;
       await this.openAgent(path, task);
       this.close();
     }
     close() { if (props().overlay) closeOverlay(props().overlay); else run("tab.close", { confirmed: true }); } // the dialog also works as a tab (scriptable check)
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
             .child(div().flex_1().truncate().font_medium().child(i.title))
             .when(kind(i), (e) => e.child(div().px(6).rounded(9).text_size(10.5).bg(alpha(t.ansi5, "22")).text_color(t.ansi5).child(kind(i))))
             .child(div().px(6).rounded(9).text_size(10.5).bg(isParked(i) ? alpha(t.accent, "22") : t.border).text_color(isParked(i) ? t.ansi12 : t.muted).child(isParked(i) ? "agent" : i.author?.login ?? ""))
             .child(MONO(div()).w(28).text_size(11).text_color(t.muted).child(since(i.createdAt))))
           .when(tk, (e) => e.child(div().pl(26).text_size(11).text_color(t.muted).child(`already in track "${tk}" — open it instead`)));
       };
       const footer = this.mode === "issue"
         ? (sel ? `Worktree ${branchFor(sel)}${/Branch: `/.test(sel.body ?? "") ? " (resumes the shelved branch)" : ""} · agent tab opens there with #${sel.number}` : "Pick an issue")
         : "Worktree from your one-liner · agent tab opens there with your brief";
       return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground).rounded(10)
         .child(this.header(t, "Start work", [this.button(t, "close", "✕", () => this.close())]))
         .child(h_flex().px(16).border_b(1).border_color(t.border).child(tab("issue", "From an issue")).child(tab("scratch", "From scratch")))
         .when(this.mode === "issue", (el) => el
           .child(h_flex().px(16).py(10).gap(8).items_center()
             .child(div().flex_1().h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.canvas).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)))
             .child(div().text_size(12).text_color(t.muted).child(`${this.data.issues.length} open · ${[...taken.keys()].filter((n) => this.data.issues.some((i) => i.number === n)).length} already in a track`)))
           .child(v_flex().flex_1().overflow_y_scroll().px(8).gap(2).children(issues.length ? issues.map(row) : [this.empty(t, "no open issues")]))
           .when(sel, (e) => e.child(v_flex().px(16).py(12).gap(8).border_t(1).border_color(t.border).bg(t.canvas)
             .child(h_flex().items_baseline().gap(8)
               .child(MONO(div()).text_size(11).text_color(t.muted).child(`#${sel.number}`))
               .child(div().font_semibold().flex_1().truncate().child(sel.title))
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
           .child(this.button(t, "cancel", "Cancel", () => this.close()))
           .child(this.button(t, "go", this.mode === "issue" ? (sel ? `Start from #${sel.number}` : "Start") : "Start", (cx) => { if (!this.busy?.endsWith("…")) cx.spawn((cx) => this.start(cx)); }, true)));
     }
     ```
     Every handler that needs a `cx` takes it as `button()`'s argument (`(cx) => …`); none closes over `render`'s `cx`.
  3. Open the views and look. `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")` (the main checkout, not this worktree). `herdr-app do tab.new --mod forge --props "{\"view\":\"board\",\"root\":\"$ROOT\"}"`, `herdr-app shot /tmp/forge-board.png`, and read the PNG with your image-reading tool (Claude Code: `Read`). Then `herdr-app do tab.new --mod forge --props "{\"view\":\"start\",\"root\":\"$ROOT\"}"` (the Start view renders as a tab too; `+` opens it as a dialog) and `herdr-app shot /tmp/forge-start.png`. Close both tabs with `herdr-app do tab.close --confirmed true` while they are focused, or leave them for the user. Do not press Start against this repo during the build unless you then remove the worktree it made with `git worktree remove` (never `--force`) and `git branch -d` — a test track left behind is a deviation to record.
- **Verify** (renders the two new views with real data, since `check` only renders the empty sidebar): `herdr-app check herdr/mods/forge && node --test herdr/mods/forge/model.test.js && ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)") && for v in board start; do T=$(herdr-app do tab.new --mod forge --props "{\"view\":\"$v\",\"root\":\"$ROOT\"}" | jq -r .tab) && sleep 3 && herdr-app status | jq -e '.errors == []' >/dev/null && herdr-app do tab.close --id "$T" --confirmed true >/dev/null || exit 1; done && grep -q 'async start(cx)' herdr/mods/forge/main.js`

## Task 5
**Track detail view: Design | Plan | PR | Issues tabs, markdown read + edit with merge-on-stale, right rail**

- **Exists because:** this is where the person reads and edits the design and plan, answers a paused build, and reviews the ledger — the reader from the old mod, grown up. Without the `expected`-based save and `git merge-file` fallback an edit silently overwrites an agent's concurrent write.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` (replace `initDetail`, `renderDetail`; add `loadDoc`, `save`).
- **Interfaces consumed:** Task 3's `track()`, `next()`, `shelve()`, `openAgent()`, `link()`, `pips()`; Task 2's `planTasks`, `STAGES`.
- **Steps:**
  1. Replace `initDetail` and the `renderDetail` stub with:
     ```js
     initDetail(cx) {
       this.tab = "design"; this.docs = {}; this.editing = false; this.editor = null; this.saveMsg = null; this.log = [];
       cx.spawn(async (cx) => { for (;;) { try { await watchFolder(`${props().track}/docs`); } catch { return; } if (!this.editing) { this.docs = {}; this.loadDoc(cx); } } }); // ends when the worktree goes; while editing, save() reconciles instead
       this.loadDoc(cx);
     }
     // Reads the shown tab's file once per change; `expected` is the text on disk when it was read.
     loadDoc(cx) {
       cx.spawn(async (cx) => {
         const tr = this.track(); if (!tr) return;
         for (const key of ["design", "plan"]) {
           const rel = tr[key]; if (!rel || this.docs[key]) continue;
           const text = (await readTextFile(`${tr.path}/${rel}`).catch((e) => `_${e}_`)) ?? "";
           this.docs[key] = { rel, text };
         }
         this.log = (await this.git(["log", "-6", "--format=%h%x09%s%x09%cr"], tr.path)).out.split("\n").filter(Boolean).map((l) => l.split("\t"));
         cx.notify();
       });
     }
     edit(cx) {
       const d = this.docs[this.tab]; if (!d) return;
       this.base = d.text; // what the person started from: the `expected` for the save and the merge base — never the reloaded text
       this.editor = EditorState.new({ language: "markdown", value: d.text, soft_wrap: true, line_numbers: false, folding: false });
       this.editing = true; cx.notify();
     }
     // Stale save: 3-way merge with git merge-file (base = what we read, ours = the edit, theirs = disk).
     // Markers left → write them and open an agent tab in the worktree to resolve. Never a refusal.
     async save(cx) {
       const tr = this.track(), d = this.docs[this.tab]; if (!tr || !d) return;
       const path = `${tr.path}/${d.rel}`, ours = this.editor.value();
       try { await writeTextFile(path, ours, this.base); this.saveMsg = "saved"; }
       catch {
         const theirs = (await readTextFile(path)) ?? "";
         const dir = `${appHome()}/data/forge-merge`, tmp = `${dir}/${Date.now()}`; // per save, so two panes never share files
         await mkdir(dir, { recursive: true });
         await Promise.all([writeFile(`${tmp}.base`, this.base), writeFile(`${tmp}.ours`, ours), writeFile(`${tmp}.theirs`, theirs)]);
         const r = await exec("git", ["merge-file", "-p", "-L", "yours", "-L", "before", "-L", "agent", `${tmp}.ours`, `${tmp}.base`, `${tmp}.theirs`]);
         exec("rm", ["-f", `${tmp}.base`, `${tmp}.ours`, `${tmp}.theirs`]);
         // merge-file exits with the conflict count (0..127); anything else is an error with empty stdout — never write that over the file.
         if (r.code < 0 || r.code > 127) { this.saveMsg = `merge failed: ${(r.stderr || "git merge-file error").trim()} — your text is still in the editor`; cx.notify(); return; }
         await writeTextFile(path, r.stdout, theirs);
         if (r.code === 0) this.saveMsg = "merged with an agent's edit and saved";
         else { this.saveMsg = "conflict — an agent tab is resolving it"; this.openAgent(tr.path, `Resolve the conflict markers in ${d.rel} (yours = the person's edit, agent = your earlier write); keep both intents, then stop.`); }
       }
       this.docs = {}; this.editing = false; this.editor = null; this.base = null; this.loadDoc(cx); cx.notify();
     }
     renderDetail(cx) {
       const t = theme(), tr = this.track();
       if (!tr) return v_flex().id("root").size_full().bg(t.surface).p(12).gap(8).text_color(t.dim).child(this.data.worktrees.length ? "This track's worktree is gone (shelved or removed)." : "loading…").when(this.data.worktrees.length, (e) => e.child(this.button(t, "closepane", "Close pane", () => run("pane.close", {}))));
       const color = this.groupColor(t, tr.group), nx = this.next(tr), gh = this.repoUrl();
       const tabs = [["design", "Design"], ["plan", "Plan"], ["pr", tr.pr ? `PR #${tr.pr.number}${tr.pr.isDraft ? " (draft)" : ""}` : "PR"], ["issues", `Issues (${tr.issues.length})`]];
       const tabEl = (k, l) => div().id(`t-${k}`).px(10).py(7).text_size(12.5).cursor_pointer().border_b(2).border_color(this.tab === k ? t.accent : NONE).text_color(this.tab === k ? t.foreground : t.muted).child(l)
         .on_click((_e, cx) => { if (this.editing) return; this.tab = k; cx.notify(); });
       const doc = (key) => {
         const d = this.docs[key];
         if (!tr[key]) return v_flex().p(12).gap(8).child(div().text_color(t.dim).child(`no ${key} on this branch yet`)).child(this.button(t, `mk-${key}`, key === "design" ? "Brainstorm" : "Plan", () => this.openAgent(tr.path, key === "design" ? "/forge:brainstorm" : "/forge:plan"), true));
         if (!d) return this.empty(t, "loading…");
         if (this.editing) return Editor.new(this.editor).flex_1().min_h(0);
         const body = v_flex().flex_1().min_h(0).child(TextView.markdown(`doc-${key}`, d.text).selectable().scrollable());
         if (key !== "plan") return body;
         const tasks = planTasks(d.text, tr.pr?.body);
         const blocked = tr.agents.find((a) => a.status === "blocked");
         return v_flex().flex_1().min_h(0)
           .when(blocked, (e) => e.child(h_flex().mx(12).mt(8).p(8).gap(8).items_center().rounded(6).bg(alpha(t.blocked, "14")).border(1).border_color(alpha(t.blocked, "66"))
             .child(div().flex_1().text_size(12).text_color(t.blocked).child("The build is waiting on you in its tab."))
             .child(this.button(t, "ans", "Answer", () => run("agent.focus", { terminal: blocked.address }), true))))
           .child(v_flex().px(12).py(8).gap(3).children(tasks.map((k) => h_flex().gap(8).items_center().text_size(12.5)
             .child(MONO(div()).w(16).text_color(k.done ? t.ansi2 : t.dim).child(k.done ? "✓" : "○"))
             .child(MONO(div()).text_color(t.muted).child(`T${k.n}`))
             .child(div().flex_1().truncate().text_color(k.done ? t.muted : t.foreground).child(k.title)))))
           .child(body);
       };
       const prTab = () => !tr.pr ? this.empty(t, "no PR yet — the build opens a draft PR as its first step")
         : v_flex().flex_1().min_h(0).p(12).gap(8)
           .child(h_flex().gap(8).items_center().child(div().font_semibold().flex_1().truncate().child(tr.pr.title)).child(div().text_size(11).text_color(t.muted).child(tr.pr.state.toLowerCase())).child(this.link(t, "prgh", "Open on GitHub", tr.pr.url)))
           .child(TextView.markdown("pr-body", tr.pr.body ?? "").selectable().scrollable());
       const issuesTab = () => v_flex().p(8).gap(2).children(tr.issues.length ? tr.issues.map((n) => {
         const i = this.data.issues.find((x) => x.number === n);
         return h_flex().id(`li-${n}`).px(8).py(6).rounded(6).gap(8).items_center().hover((e) => e.bg(t.hover))
           .child(MONO(div()).text_size(11).text_color(t.muted).child(`#${n}`))
           .child(div().flex_1().truncate().child(i?.title ?? "(closed or not loaded)"))
           .child(this.link(t, `ligh-${n}`, "Open on GitHub", i?.url ?? `${gh}/issues/${n}`));
       }) : [this.empty(t, "no linked issues")]);
       const rail = v_flex().w(220).p(12).gap(14).border_l(1).border_color(t.border).text_size(12)
         .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("WAITING ON")).child(div().text_color(tr.group === "needs" ? t.blocked : t.foreground).child(tr.reason)))
         .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("NEXT")).child(this.button(t, "rnx", nx.label, nx.go, true)))
         .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("AGENTS ON THIS TRACK"))
           .children(tr.agents.length ? tr.agents.map((a) => h_flex().id(`ag-${a.address}`).gap(6).items_center().cursor_pointer().hover((e) => e.text_color(t.accent)).on_click(() => run("agent.focus", { terminal: a.address }))
             .child(div().w(7).h(7).rounded(4).bg(t[a.status] ?? t.idle)).child(MONO(div()).child(a.address)).child(div().text_color(t.muted).child(a.status))) : [div().text_color(t.dim).child("none")]))
         .child(v_flex().gap(4).child(div().text_size(10.5).font_semibold().text_color(t.muted).child("ACTIVITY"))
           .children(this.log.length ? this.log.map(([h, s, when]) => v_flex().child(div().truncate().child(s)).child(MONO(div()).text_size(10.5).text_color(t.dim).child(`${h} · ${when}`))) : [div().text_color(t.dim).child("no commits yet")]));
       const canEdit = (this.tab === "design" || this.tab === "plan") && this.docs[this.tab];
       return v_flex().id("root").size_full().bg(t.surface).text_size(13).text_color(t.foreground)
         .child(h_flex().px(12).py(8).gap(8).items_center().border_b(1).border_color(t.border)
           .child(div().font_semibold().text_size(14).child(tr.slug))
           .child(MONO(div()).text_size(11).text_color(t.muted).child(tr.branch))
           .when(tr.pr, (e) => e.child(this.link(t, "hpr", `PR #${tr.pr.number}`, tr.pr.url)))
           .children(tr.issues.slice(0, 3).map((n) => this.link(t, `hi-${n}`, `#${n}`, `${gh}/issues/${n}`)))
           .child(h_flex().flex_1())
           .child(this.pips(t, tr.stage, color))
           .child(div().px(6).py(1).rounded(9).text_size(10.5).bg(alpha(color, "22")).text_color(color).child(STAGES[tr.stage]))
           .when(tr.stage < 5, (e) => e.child(this.button(t, "shelve", "Shelve → issue", () => this.shelve(tr)))))
         .child(h_flex().flex_1().min_h(0)
           .child(v_flex().flex_1().min_w(0)
             .child(h_flex().px(8).items_center().border_b(1).border_color(t.border).children(tabs.map(([k, l]) => tabEl(k, l))).child(h_flex().flex_1())
               .when(this.saveMsg, (e) => e.child(div().px(8).text_size(11).text_color(t.muted).child(this.saveMsg)))
               .when(canEdit && !this.editing, (e) => e.child(this.button(t, "edit", "Edit", (cx) => this.edit(cx))))
               .when(this.editing, (e) => e.child(this.button(t, "cancel", "Cancel", (cx) => { this.editing = false; this.editor = null; cx.notify(); })).child(this.button(t, "save", "Save", (cx) => cx.spawn((cx) => this.save(cx)), true))))
             .child(this.tab === "design" ? doc("design") : this.tab === "plan" ? doc("plan") : this.tab === "pr" ? prTab() : issuesTab()))
           .child(rail));
     }
     ```
  2. Open a detail pane: `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`; `herdr-app do tab.new --mod forge --props "{\"track\":\"$(git rev-parse --show-toplevel)\",\"root\":\"$ROOT\"}"` (this build's own worktree is a track with a design and a plan), `herdr-app shot /tmp/forge-detail.png`, read the PNG: header, four tabs, the design renders, the plan tab lists this plan's tasks with ticks matching the PR. Edit/Save and the stale-merge path need clicks you cannot make: leave them for the user's review and say so in the task report; verify the merge command's semantics yourself instead — the Verify line's `git merge-file` probe must exit 0 with both lines present for a clean merge, and exit 1 with `<<<<<<<` markers for an overlapping one (the code treats `code === 0` as clean).
- **Verify:** `herdr-app check herdr/mods/forge && ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)") && T=$(herdr-app do tab.new --mod forge --props "{\"track\":\"$(git rev-parse --show-toplevel)\",\"root\":\"$ROOT\"}" | jq -r .tab) && sleep 3 && herdr-app status | jq -e '.errors == []' >/dev/null && herdr-app do tab.close --id "$T" --confirmed true >/dev/null && grep -q 'merge-file' herdr/mods/forge/main.js && grep -q 'async save(cx)' herdr/mods/forge/main.js && D=$(mktemp -d) && printf 'a\nb\n' >$D/base && printf 'a\nb\nmine\n' >$D/ours && printf 'agent\na\nb\n' >$D/theirs && git merge-file -p $D/ours $D/base $D/theirs | grep -q mine && git merge-file -p $D/ours $D/base $D/theirs | grep -q agent && printf 'a\nX\n' >$D/ours && printf 'a\nY\n' >$D/theirs && ! git merge-file -p $D/ours $D/base $D/theirs >$D/out; grep -q '<<<<<<<' $D/out`

## Task 6
**Backlog view**

- **Exists because:** issues are the intake and run to hundreds; the design makes them a separate paged view behind "View backlog", with the shelved strip on top and Start on every row. Without it Start work is the only window onto issues and shelved tracks cannot be found.
- **Model:** sonnet
- **Files:** `herdr/mods/forge/main.js` (replace `renderBacklog`).
- **Interfaces consumed:** Task 3's `openStart(issue)`, `button()`, `link()`, `header()`; Task 2's `kind`, `isParked`, `takenIssues`.
- **Steps:**
  1. Replace the `renderBacklog` stub with:
     ```js
     renderBacklog(cx) {
       const t = theme(), q = this.search.value().trim().toLowerCase(), taken = takenIssues(this.live()), me = this.data.me;
       const labels = (i) => (i.labels ?? []).map((l) => l.name);
       const shelved = this.data.issues.filter((i) => labels(i).includes("shelved") && !taken.has(i.number)); // already resumed → it is a track, not a shelf
       const pass = (i) => this.filter === "all" || (this.filter === "bug" && kind(i) === "bug") || (this.filter === "feature" && kind(i) === "feature") || (this.filter === "agent" && isParked(i)) || (this.filter === "yours" && i.author?.login === me);
       const rows = this.data.issues.filter((i) => !labels(i).includes("shelved") && pass(i) && (!q || `#${i.number} ${i.title} ${i.body ?? ""}`.toLowerCase().includes(q)));
       const chips = [["all", "All"], ["bug", "Bugs"], ["feature", "Features"], ["agent", "Parked by agents"], ["yours", "Yours"]];
       const cell = (w, el) => div().w(w).flex_none().child(el);
       const row = (i) => {
         const tk = taken.get(i.number), k = kind(i), parked = isParked(i);
         const from = /From (PR #\d+|review of PR #\d+)|Deferred from design ([^\s]+)|Filed from the (plan|build)/.exec(i.body ?? "")?.[0] ?? "";
         return h_flex().id(`b-${i.number}`).px(8).py(6).gap(10).items_center().rounded(6).hover((e) => e.bg(t.hover)).when(tk, (e) => e.opacity(0.55))
           .child(cell(64, this.link(t, `bl-${i.number}`, `#${i.number}`, i.url)))
           .child(cell(72, k ? div().px(6).rounded(9).text_size(10.5).bg(k === "bug" ? alpha(t.blocked, "22") : alpha(t.ansi5, "22")).text_color(k === "bug" ? t.blocked : t.ansi5).child(k) : div()))
           .child(v_flex().flex_1().min_w(0).child(div().truncate().font_medium().child(i.title)).child(div().truncate().text_size(11).text_color(t.muted).child((i.body ?? "").split("\n").find(Boolean) ?? "")))
           .child(cell(150, div().truncate().text_size(11).text_color(t.muted).child(tk ? `in track "${tk}"` : from)))
           .child(cell(60, div().px(6).rounded(9).text_size(10.5).bg(parked ? alpha(t.accent, "22") : t.border).text_color(parked ? t.ansi12 : t.muted).child(parked ? "agent" : i.author?.login === me ? "you" : i.author?.login ?? "")))
           .child(cell(32, MONO(div()).text_size(11).text_color(t.muted).child(since(i.createdAt))))
           .child(cell(56, tk ? div() : this.button(t, `st-${i.number}`, "Start", () => this.openStart(i))));
       };
       return v_flex().id("root").size_full().bg(t.canvas).text_size(13).text_color(t.foreground)
         .child(this.header(t, "Backlog", [
           div().w(240).h(28).px(8).flex().items_center().rounded(6).border(1).border_color(t.input).bg(t.surface).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).child(Input.new(this.search).h_full().w_full().text_size(12)),
           ...chips.map(([k, l]) => this.button(t, `f-${k}`, l, (cx) => { this.filter = k; this.shown = 50; cx.notify(); }).when(this.filter === k, (e) => e.bg(t.selection))),
           this.button(t, "board", "Board", () => this.openBoard()),
         ]))
         .when(shelved.length, (el) => el.child(v_flex().mx(12).mt(10).p(10).gap(6).rounded(8).bg(t.surface).border(1).border_color(alpha(t.ansi5, "66"))
           .child(div().text_size(10.5).font_semibold().text_color(t.ansi5).child("SHELVED WORK — a branch is waiting"))
           .children(shelved.map((i) => h_flex().id(`sh-${i.number}`).gap(10).items_center().py(3)
             .child(this.link(t, `shl-${i.number}`, `#${i.number}`, i.url))
             .child(div().flex_1().truncate().child(i.title))
             .child(MONO(div()).text_size(11).text_color(t.muted).child(since(i.createdAt)))
             .child(this.button(t, `rs-${i.number}`, "Resume", () => this.openStart(i), true))))))
         .child(v_flex().flex_1().overflow_y_scroll().px(12).py(10).gap(1)
           .child(h_flex().px(8).pb(4).gap(10).text_size(10.5).font_semibold().text_color(t.muted)
             .child(cell(64, div().child("ISSUE"))).child(cell(72, div().child("KIND"))).child(div().flex_1().child("TITLE")).child(cell(150, div().child("PARKED FROM"))).child(cell(60, div().child("BY"))).child(cell(32, div().child("AGE"))).child(cell(56, div())))
           .children(rows.length ? rows.slice(0, this.shown).map(row) : [this.empty(t, this.data.issues.length ? "nothing matches" : "no open issues")])
           .child(h_flex().px(8).py(10).gap(12).items_center().text_size(11.5).text_color(t.muted)
             .child(div().child(`showing ${Math.min(this.shown, rows.length)} of ${rows.length}`))
             .when(rows.length > this.shown, (e) => e.child(this.button(t, "more", "Load 50 more", (cx) => { this.shown += 50; cx.notify(); })))));
     }
     ```
  2. Open it: `herdr-app do tab.new --mod forge --props "{\"view\":\"backlog\",\"root\":\"$PWD\"}"`, `herdr-app shot /tmp/forge-backlog.png`; chips filter, Start opens the dialog with that issue preselected (the dialog's `props().issue` → `this.sel`).
- **Verify:** `herdr-app check herdr/mods/forge && ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)") && T=$(herdr-app do tab.new --mod forge --props "{\"view\":\"backlog\",\"root\":\"$ROOT\"}" | jq -r .tab) && sleep 3 && herdr-app status | jq -e '.errors == []' >/dev/null && herdr-app do tab.close --id "$T" --confirmed true >/dev/null && grep -q 'SHELVED WORK' herdr/mods/forge/main.js && grep -q 'Load 50 more' herdr/mods/forge/main.js`

## Task 7
**`/forge:start` — the single entry point that routes by reading**

- **Exists because:** the panel hands every new track to one verb; without this skill the agent tab opens with a slash command that does not exist. The routing (bug → debug, feature → brainstorm, design on the branch → plan, plan → build, shelved issue → resume) lives here and nowhere in the UI, per the design.
- **Model:** sonnet
- **Files:** `skills/start/SKILL.md` (new), `hooks/routing.md`, `README.md`.
- **Steps:**
  1. Write `skills/start/SKILL.md` — follows the frontmatter and environment-branch pattern of `skills/debug/SKILL.md` and `skills/plan/SKILL.md:45-46`:
     ````
     ---
     name: start
     description: The one way to begin work — on an issue (`/forge:start #42`) or a one-line brief. Reads what it is given and routes to /forge:debug, /forge:brainstorm, /forge:plan or /forge:build; resumes a shelved branch. Used by the Herdr work panel's Start work; also fine from a shell.
     ---

     # Start

     You are the router. The person (or the Herdr forge panel) gave you an issue number, an issue URL, or a brief. Decide how to begin by **reading**, then hand off to exactly one loop skill. Nothing here maintains state: the branch and the repo say where the work is.

     ## Where you are

     `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`; `HERE=$(git rev-parse --show-toplevel)`.

     - **`HERE` ≠ `ROOT`** — you are in a worktree (the panel put you here, or it is a build worktree under `.claude/worktrees/`). Work in place, whatever the branch is called. Never make another.
     - **`HERE` = `ROOT`** (you were run in the main checkout): make the track's worktree first, then go on **inside it**. The branch, exactly as the panel computes it (`herdr/mods/forge/model.js` `branchFor`): a shelved issue's body names it (`Branch: \`…\``) — use that; else `fix/<slug>` when the issue carries the `bug` label, else `feat/<slug>`, where slug = title (or brief) lower-cased, every run of characters outside `a-z0-9` → `-`, leading/trailing `-` removed, cut to 40 characters, trailing `-` removed again. Path: `P="$HOME/.herdr/worktrees/$(basename "$ROOT")/<branch with / replaced by ->"`. `git -C "$ROOT" fetch -q origin main`. If `git -C "$ROOT" show-ref --verify --quiet refs/heads/<branch>`: `git -C "$ROOT" worktree add "$P" <branch>`; else `git -C "$ROOT" worktree add --no-track -b <branch> "$P" origin/main`. If `$P` exists already, stop and say so. Then, in the Herdr desktop app (`$HC_TERMINAL_ID` set): `herdr-app do space.new --folder "$P" --argv '<argv>' --task "/forge:start <what you were given, verbatim>"` and stop — the new space's agent takes it from here. `<argv>` is your own CLI, no model flag: your kind from `hc ls --json | jq -r --arg t "$HC_TERMINAL_ID" '.terminals[] | select(.address==$t) | .agent'` → **claude-code** `["claude"]`, **pi** `["pi","--provider","$PI_PROVIDER","--model","$PI_MODEL"]` (both non-empty), **codex** `["codex","--no-daemon"]`, anything else: do not dispatch; `cd "$P"` and continue below. In herdr (`HERDR_ENV=1`, no `$HC_TERMINAL_ID`): `herdr worktree create --cwd "$ROOT" --branch <branch>` in place of the git commands, then start your own kind in its root pane and prompt it with the same `/forge:start` line exactly as /forge:plan's **Dispatch** bullet does (`herdr agent get`, `herdr agent start build-<slug> --kind <kind> --pane <pane-id>` with the per-kind tail, `herdr agent prompt`), and stop. Plain Claude Code: `cd "$P"` (every later command runs there) and continue below.

     ## Read, then route

     1. If given a number or URL: `gh issue view <n> --json number,title,body,labels,url,comments`. Read it whole, including comments. Labels are a hint only; the text decides.
     2. Look at the branch: `git diff --name-only origin/main...HEAD -- docs/decisions docs/plans; git ls-files --others --exclude-standard docs/decisions docs/plans`.
     3. Route — the first that applies:
        - A plan file is on the branch and its open PR (`gh pr list --head "$(git branch --show-current)" --state open --json number,body,isDraft`) is not a draft, or is a draft with every `- [ ] T` box ticked → `/forge:review-branch`.
        - A plan file is on the branch (no PR, or a draft PR with an unticked box) → `/forge:build docs/plans/<file>`.
        - A design file is on the branch, no plan → `/forge:plan` (name the design file).
        - The issue is a shelved track (title starts `Shelved:` or it carries the `shelved` label): its body says the stage and what stopped it. Tell the person in two lines what you found and which skill you are resuming with, then do the route above for the artifacts on the branch; if the branch has none, treat the body as the brief.
        - The text describes something that is broken — an error, a wrong result, a failing test, "used to work" — → `/forge:debug` with the issue as the report.
        - Otherwise → `/forge:brainstorm` with the issue or brief as the request.
     Before any route: if the brief said to also open an issue, do that first — `gh issue create --title '<brief, one line, no quote characters>' --body-file -` with a quoted `<<'EOF'` heredoc holding the brief and `Started from the Herdr forge panel on branch <branch>.` And when resuming a shelved issue, `gh issue edit <n> --remove-label shelved` so the backlog's shelved strip stops offering it.
     4. Say the route in one line ("#42 reads as a bug → /forge:debug") and run that skill. Do not ask which; if the text is genuinely both, debug first — a fix that turns out to need a design exits into /forge:plan on its own.

     ## Never

     - Pick by label alone. Open a second worktree for the same slug. Write any state file. Decide in the UI's place — this skill is the decision.
     ````
  2. `hooks/routing.md`: append one bullet after the `- Branch complete…` line (keep the existing text byte-for-byte; the hook test checks the block contains `/forge:plan`, `/forge:build`, `/forge:review-branch` and `/forge:brainstorm`, which still holds):
     ```
     - An issue number, issue URL, or "start work on …" with no design yet → run /forge:start; it routes to debug, brainstorm, plan or build by reading.
     ```
  3. `README.md`: the skills are listed as numbered lines 5–8 followed by an "Also …" line (line 10); extend that "Also …" line to mention `/forge:start` (the entry point: an issue or a brief in, the right loop skill out) and `/forge:shelve` (park a track as an issue). Add a section `## Herdr work panel` as the last section of the file (after everything that is there now): one paragraph — what it shows (tracks = worktrees, four views), `bash scripts/install-herdr-mod.sh` to install, and that Start/Shelve run `/forge:start` / `/forge:shelve` in an agent tab.
- **Verify:** `bash hooks/session-start.test.sh && /usr/bin/grep -q '^name: start$' skills/start/SKILL.md && /usr/bin/grep -q 'forge:start' hooks/routing.md && /usr/bin/grep -q 'forge:start' README.md && /usr/bin/grep -q 'install-herdr-mod' README.md`

## Task 8
**`/forge:shelve` — the inverse of start**

- **Exists because:** the panel's Shelve button runs this; without it a parked track lingers on the board forever or gets removed by hand with its state lost. It writes the state to an issue so the backlog's shelved strip and `/forge:start` can resume it.
- **Model:** sonnet
- **Files:** `skills/shelve/SKILL.md` (new).
- **Steps:**
  1. Write `skills/shelve/SKILL.md`:
     ````
     ---
     name: shelve
     description: Park the current track — write where it stopped to its issue (or a new one labelled `shelved`), close the draft PR unmerged, remove the worktree, keep the branch. Run inside the track's worktree; the Herdr work panel's Shelve button runs it. Undo is /forge:start on that issue.
     ---

     # Shelve

     Run inside the track's worktree. `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`, `WT=$(git rev-parse --show-toplevel)`, `BR=$(git branch --show-current)`. If `WT` = `ROOT`, stop: this is the main checkout, nothing to shelve.

     1. **Nothing is lost first.** `git status --porcelain` not empty → `git add -A -- . ':(exclude).worktree-bootstrapped' ':(exclude).worktree-bootstrap.log' ':(exclude).forge-brief.md' && git commit -qm "wip: shelved"` (worktree remove refuses untracked files, so they are committed, except the bootstrap/brief scratch). `git push -q -u origin "$BR"` (so the branch survives the worktree). If push fails, stop and say so — do not remove anything.
     2. **Where it stopped**, from the artifacts: design = `git diff --name-only origin/main...HEAD -- docs/decisions`, plan likewise for `docs/plans`; PR = `gh pr list --head "$BR" --state open --json number,url,body`; tasks done = count of `- [x]` vs `- [ ]` in the PR body; the open question = the last thing an agent asked or the Deviations line that stopped it, in one sentence (read the design file's Deviations and the tab you are in). If none of that says why, ask the person once for a one-line reason; if no answer comes (the panel may have launched you with nobody at the keyboard), write `no reason recorded`.
     3. **The issue.** Linked issue = the first `#n` in the PR body or design file that is an open issue (`gh issue view n --json state`). First, in every case: `gh label create shelved --force --color 7057ff --description 'A branch holds this work' >/dev/null 2>&1`. If a linked issue exists: `gh issue comment <n> --body-file -` then `gh issue edit <n> --add-label shelved`; else `url=$(gh issue create --title 'Shelved: <track slug>' --label shelved --body-file - <<'EOF' … EOF)` — `gh issue create` prints the issue URL — and `n=${url##*/}`. Body (quoted `<<'EOF'` heredoc; `<Stage>` = Review if the PR is open and not draft, Build if a plan and a PR exist, Plan if a plan exists, Design if only a design, else Idea; date from `date +%F`):
        ```
        Shelved from track `<slug>` at <Stage> (<done>/<total> tasks) on <YYYY-MM-DD>.
        Branch: `<BR>` (pushed). Design: `<path or none>`. Plan: `<path or none>`. PR: <url or none> (closed, not merged).
        Stopped because: <one sentence>.
        Resume with `/forge:start #<n>`.
        ```
     4. **Close the PR unmerged**, if open: `gh pr close <number> --comment "Shelved; see #<issue>."`
     5. **Remove the worktree, keep the branch.** In the Herdr desktop app (`$HC_TERMINAL_ID` set): the space you are in is this worktree's; `cd "$ROOT"` first, then `git -C "$ROOT" worktree remove "$WT"` (never `--force`; if it refuses, say why and stop — step 1 should have made it clean), then `herdr-app do space.close --id "$(herdr-app ls | jq -r --arg t "$HC_TERMINAL_ID" --arg wt "$WT" '.spaces[] | select(.folder == $wt and any(.tabs[].terminals[]; .terminal == $t)) | .id')" --confirmed true` as your **last** command (it ends this terminal); if it prints nothing (you are in a space that is not this worktree's), skip the close and say so. Verified 2026-11-02: `hc ls --json` terminals carry no space field; `herdr-app ls` is JSON whose `spaces[].tabs[].terminals[].terminal` is the address, and that jq prints exactly one id. In herdr (`HERDR_ENV=1`): `cd "$ROOT" && git worktree remove "$WT"`, then tell the person to close this workspace (`herdr workspace close <id>`; the id is not reliably readable from inside the pane — not verified here). Plain: `cd "$ROOT" && git worktree remove "$WT"`.
     6. Say, in one line before step 5's final command: issue URL, "branch kept", "worktree removed". Never `git branch -d`, never `-D`: the branch is the shelf.
     ````
     Before finishing, run the `herdr-app ls | jq …` line once from your own terminal (you are in the desktop app; `$HC_TERMINAL_ID` is set) and confirm it prints exactly one space id (yours).
- **Verify:** `/usr/bin/grep -q '^name: shelve$' skills/shelve/SKILL.md && /usr/bin/grep -q 'worktree remove "\$WT"' skills/shelve/SKILL.md && /usr/bin/grep -q 'never `--force`' skills/shelve/SKILL.md && /usr/bin/grep -q 'gh pr close' skills/shelve/SKILL.md`
