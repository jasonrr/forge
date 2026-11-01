# Learnings

## forge-owned-guidance (PR #8, 2026-11-01)

- Plan code mirrored bash `[ -f ]` with `statSync(p, { throwIfNoEntry: false })` → that only suppresses ENOENT, so EACCES/ENOTDIR throw; a TS port of a shell test needs a try/catch-false, and the parity test should include an unsearchable `.claude`.
- `codex plugin marketplace upgrade` only refreshes Git marketplace snapshots → the installed plugin stays on its versioned cache until `codex plugin add forge@forge` runs again; and upgrade on a local marketplace exits 1. Verify a CLI refresh path end-to-end in a throwaway CODEX_HOME before writing it into a plan.
