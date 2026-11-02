# Support connected machines

Issue: #21 · branch `feat/support-connected-machines`

## Problem

Herdr spaces can live on a connected machine (`hc machine ls`; `spaces()[i].machine`). The forge panel ignores that. Every `git`/`gh` call, `readTextFile` and `watchFolder` runs on this computer against the remote space's path. The result is "no git repo in this space" or, when the paths happen to match (same user on two Macs), the wrong repo's tracks.

The skills already work remotely. Checked on mbp-dev: an agent in a remote space runs on that machine with gh, claude and the forge plugin, and its `herdr-app do space.new` writes into that machine's layout, which the local window shows as `mbp-dev/sp…`.

Scope: remotes that are Macs running Herdr (like mbp-dev).

## Chosen approach

Thread the shown space's machine through the panel. Herdr already supports this: `exec(cmd, args, {cwd, on})`, `readTextFile(path, {on})`, `knownAgents({on})`, `space.new {machine}`.

- `location()` also returns `machine` (the active space's `.machine`, null = here). `relocate` keys on machine + cwd, so a remote space and a local one with the same path refresh separately.
- `this.on` sits next to `this.root`. `git()`, `gh()`, the `gh api user` / `repo view` calls, `ls-remote`, `worktree add` and every `readTextFile` pass `{on: this.on}`. The board, backlog and detail views get `on` in their props, the same way they get `root` now.
- Worktree path for Start: `~/.herdr/worktrees/…` uses *that machine's* home. Read it with `exec("sh", ["-c", 'printf %s "$HOME"'], {on})`, as Herdr's worktree mod does.
- Start / open agent: `knownAgents({on})`, `space.new {folder, machine: on, argv, task}`. The space lookup by folder must also match `machine`.
- Live agents: join agents/panes to tracks on machine + cwd, not cwd alone. Join by `agents()[i].space` → `spaces()[i].machine`; a space not yet in `spaces()` (its layout still loading) counts as no machine's. `hc get mbp-dev/t2` already works for status messages.
- Folder watch: local only (`watchFolder` has no `on`). On a remote root, skip it; the existing 30 s refresh picks up doc changes.
- Skills: when `herdr-app` is not on PATH, /forge:start continues in-session (folded into its existing "anything else" fallback), /forge:plan skips the dispatch question and builds Inline, and /forge:shelve skips its space close and says so.
- An unreachable machine keeps the last data with a "can't reach" error, rather than wiping the panel as "no git repo".

## Cut and why

- **Headless Linux/VPS dispatch** (opening a space in your window from a box with no herdr-app). It would need our own channel back to the local app, which Herdr doesn't provide. The in-session fallback covers the work.
- **Editing docs of a remote track in the detail view.** `writeTextFile` has no `on`, and the 3-way merge uses local temp files. Remote docs are read-only in the panel; agents edit them. Add this if Herdr gains a remote write.
- **Remote folder watch.** A 30 s refresh is fine for docs; a poller would duplicate the timer.
- **Machine picker in Start work.** Start follows the shown space's machine, the same rule Herdr uses for new-space keys.

## Open questions

- None. (The agent-address question was settled while planning: remote space, tab and pane ids carry a `machine/` prefix, and `AgentInfo.space` names the space.)
