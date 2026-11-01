# dev loop
routing: on
builder-model: opus

## Lenses
- correctness: every skill step runs as written in macOS bash/zsh, and every hc/herdr/herdr-app/gh flag matches its --help. p1 = a dispatch, build, review, cleanup or publish step that fails or does the wrong thing.
- invariants: hooks/routing.md is the only copy of the block; session-start.sh and routing.ts resolve config the same way (dev-loop.md, then tally-dev-loop.md; the first regular file decides; exact `routing: on`); the hook does nothing without opt-in; skills check $HC_TERMINAL_ID, then HERDR_ENV, then plain; never clean up on blocked/failed, never --force or -D; a release bumps .claude-plugin/plugin.json, .codex-plugin/plugin.json and package.json together. p1 = breaking any of these.
- simplicity: rules duplicated across skills that can drift apart, prose that restates another rule, machinery with no answer to "what breaks without this". Findings cap at p2.
