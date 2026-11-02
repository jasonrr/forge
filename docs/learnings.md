# Learnings

## forge-owned-guidance (PR #8, 2026-11-01)

- Plan code mirrored bash `[ -f ]` with `statSync(p, { throwIfNoEntry: false })` → that only suppresses ENOENT, so EACCES/ENOTDIR throw; a TS port of a shell test needs a try/catch-false, and the parity test should include an unsearchable `.claude`.
- `codex plugin marketplace upgrade` only refreshes Git marketplace snapshots → the installed plugin stays on its versioned cache until `codex plugin add forge@forge` runs again; and upgrade on a local marketplace exits 1. Verify a CLI refresh path end-to-end in a throwaway CODEX_HOME before writing it into a plan.
- A worktree fallback written as one shell line ending in `cd "$WT"` → harnesses that run each command in a fresh process (Codex) lose the cd; say "run later commands in $WT" explicitly. Also: the rtk-wrapped `grep` in this shell miscounts patterns containing `$`; run verify greps with /usr/bin/grep.
- `.trim()` on a subprocess path is not `$(...)`: bash strips only trailing newlines, so a TS port must use `.replace(/
+$/, "")`, or parity breaks on paths that end in whitespace.

## herdr-work-panel (PR #11, 2026-11-02)

- A plan step that copies from a live user folder (~/.config/herdr-app/mods/forge) → the operator may delete it mid-build, and deleting the folder also deletes the install symlink placed there; plans should vendor the source into the repo at plan time and verify the symlink at each later task, not only in Task 1.
- A gpui-kit mod helper named `close` → Herdr calls `close(cx)` as the View's lifecycle hook when its tab goes away → a helper that runs `tab.close` then closes the *focused* tab, i.e. the agent that opened the check tab, and its space; it killed the build twice. Never name a View method after a lifecycle hook (check AGENTS.md "Cleanup"), and never write an unscoped `tab.close` in a mod or a verify line: close only a captured id.
- A plan that reuses an instance field across tasks (`this.base` = git base ref in Task 3, the editor's merge base in Task 5) → a later task silently clobbers state an earlier task's render reads; grep the plan for every `this.<field>` assignment before handing out tasks.
- `gh pr view` on a branch falls back to a CLOSED or MERGED PR when no open one exists → any "no PR yet → create" check built on it silently never fires for a reused branch; use `gh pr list --head <br> --state open`.
- `git worktree remove` without `--force` refuses untracked files but silently deletes ignored ones (`.env`, local config) → a cleanup skill must list `git status --porcelain --ignored` and stop on non-regenerable files before removing.
- A UI that offers per-stage verbs next to a skill that routes by reading → two routers that disagree (the panel said "Resume build" where the skill said review); when a design names one entry verb, every button should call it and only labels may vary.
- `git ls-remote --exit-code --heads origin <name>` matches path suffixes and returns 128 on a network failure → ask for `refs/heads/<name>` and treat only exit 2 as "absent", or a flaky network silently turns a resume into a fresh branch.
- `gh issue view <n>` happily resolves a PR number → check the URL contains `/issues/` before treating `#n` from prose as an issue.
