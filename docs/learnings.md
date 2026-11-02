# Learnings

## forge-owned-guidance (PR #8, 2026-11-01)

- Plan code mirrored bash `[ -f ]` with `statSync(p, { throwIfNoEntry: false })` → that only suppresses ENOENT, so EACCES/ENOTDIR throw; a TS port of a shell test needs a try/catch-false, and the parity test should include an unsearchable `.claude`.
- `codex plugin marketplace upgrade` only refreshes Git marketplace snapshots → the installed plugin stays on its versioned cache until `codex plugin add forge@forge` runs again; and upgrade on a local marketplace exits 1. Verify a CLI refresh path end-to-end in a throwaway CODEX_HOME before writing it into a plan.
- A worktree fallback written as one shell line ending in `cd "$WT"` → harnesses that run each command in a fresh process (Codex) lose the cd; say "run later commands in $WT" explicitly. Also: the rtk-wrapped `grep` in this shell miscounts patterns containing `$`; run verify greps with /usr/bin/grep.
- `.trim()` on a subprocess path is not `$(...)`: bash strips only trailing newlines, so a TS port must use `.replace(/
+$/, "")`, or parity breaks on paths that end in whitespace.

## herdr-work-panel (PR #11, 2026-11-02)

- A plan step that copies from a live user folder (~/.config/herdr-app/mods/forge) → the operator may delete it mid-build, and deleting the folder also deletes the install symlink placed there; plans should vendor the source into the repo at plan time and verify the symlink at each later task, not only in Task 1.
