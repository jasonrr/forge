# CLAUDE.md

Forge is skills + one hook + one pi extension. No binary, no build step, no store.

- `skills/*/SKILL.md` — the six skills. They branch on `$HC_TERMINAL_ID` (Herdr desktop app), then `HERDR_ENV=1` (old herdr), else plain Claude Code. Verify any `hc`/`herdr`/`herdr-app` flag against `--help` or `--skill` before changing those steps.
- `hooks/routing.md` is the single copy of the routing block. `hooks/session-start.sh` (Claude) and `pi/extensions/routing.ts` (pi) both read it. Config: `.claude/dev-loop.md`, falling back to `.claude/tally-dev-loop.md`; exact-line match on `routing: on`.
- Test: `bash hooks/session-start.test.sh`; `node --experimental-strip-types --input-type=module -e 'await import(new URL("pi/extensions/routing.ts", "file://" + process.cwd() + "/"))'`.
- Release: bump `version` in `.claude-plugin/plugin.json` and `package.json`, tag `vX.Y.Z`, push with `--follow-tags`. `claude plugin update forge@forge` keys off plugin.json.
