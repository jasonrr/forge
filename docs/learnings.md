# Learnings

## forge-owned-guidance (PR #8, 2026-11-01)

- Plan code mirrored bash `[ -f ]` with `statSync(p, { throwIfNoEntry: false })` → that only suppresses ENOENT, so EACCES/ENOTDIR throw; a TS port of a shell test needs a try/catch-false, and the parity test should include an unsearchable `.claude`.
