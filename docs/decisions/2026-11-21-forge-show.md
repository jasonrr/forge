# Forge show: charts beside the session without cockpit

Issue: #51. Date: 2026-11-21. Approved by the owner on 2026-11-21.

## Problem

Cockpit is going to be uninstalled. Its `show` tool (charts, stat tiles, tables, diagrams in a Herdr pane beside the session) is worth keeping, and it cannot be kept on its own:

- `show` is registered by cockpit's Claude Code hooks module (`hooks/register.tsx`, `$.tool.register`). The plugin side only validates blocks and writes a JSON spec.
- The drawing is done by cockpit's Herdr app mod (`show.js`, `plot.js`, `diagram.js`, `diff.js`, about 2,570 lines) or its Rust TUI crate (about 7,600 lines).
- Cockpit has no show-only switch. With connectors off, its inbox, CI, mail, meetings and monitor timers still run every 60 s.
- The "Drawing results" text that makes the model draw unprompted is added by a `prompt.compose` hook in the same module (`tools.ts:271-275`).
- easel (`mcp__easel__chart`) is a built-in Claude Code plugin, gated off on this account, line and bar charts in the transcript only.
- No third-party plugin takes a mixed block list. antvis `mcp-server-chart`, `claude-mermaid`, terminal chart CLIs and `json-render` each cover a slice.

Licence: cockpit is MIT (copyright quaresc), so lifting `page.ts` is allowed with the notice kept in `THIRD_PARTY_NOTICES.md`.

## Chosen approach

Forge gets its own `show`, built from native pieces. Desktop app only (`$HC_TERMINAL_ID`).

1. **One script, no dependencies**, takes a block list as JSON (same block shapes as cockpit's `show`, for the blocks kept) and picks a pane kind per block:
   - Stats, chart, table, flow, sequence, mermaid, markdown, image, compare, diff: one static HTML page (Chart.js, Mermaid, diff2html, marked from jsdelivr, versions pinned), adapted from cockpit's `page.ts` (162 lines). Opened with `herdr-app do pane.split --direction right --pane <session pane> --argv '["terminal-browser","open","<file>"]'`. The page reloads itself; the same pane name rewrites the file instead of opening a second pane.
   - `command` + `every`: a loop owned by the pane re-runs the command and rewrites the page. It ends with the pane. No daemon.
   - `log`: a plain terminal pane running the command.
   - `choice` / `confirm`: a picker (fzf, falling back to a numbered prompt) in a **floating window**, not a split. The script starts it with `hc run --bg --no-notify --rm`, then asks the forge mod to float that terminal: `openOverlay({ kind: "window", key, layout: { type: "block", content: { terminal } }, width, height })`. The answer goes to the session with `hc send <session terminal>` and arrives as the person's next message; the window closes when the picker exits. The forge mod gains one command for this and should focus the window, since a float does not take the keyboard on opening. Charts stay in a split (owner's decision).
   Two requirements on the page, from the owner:
   - **Matches the Herdr theme by default** (background, text, accent, borders, fonts; Chart.js and Mermaid themed from the same values), so it feels reasonably native. The script reads the active theme from the app's files under `~/.config/herdr-app` (`settings.json`, `themes/`); the plan confirms the exact source and what to fall back to when it cannot be read.
   - **Pan and zoom on diagrams** (flow, sequence, mermaid), with a fit control. Test wheel and drag inside `terminal-browser` early in the build; they are untested there.
2. **A Claude Code hooks module** wraps the script: registers the typed tool, appends the "Drawing results" section to every session's prompt, and asks before running a block that carries a `command`.
3. The session's pane id comes from `herdr-app ls` (terminal → pane), as cockpit's `herdr.ts` does.

Verified on 2026-11-21: a Chart.js bar chart and a Mermaid flowchart render in a `terminal-browser` pane opened by `pane.split`, and the page picks up a changed file within one reload interval. `terminal-browser open --split` does not work in the Herdr app (it scripts Ghostty), so the split must go through `herdr-app`.

Trade-off accepted: a choice or confirm opens its own pane rather than sitting under the chart; the pane is a web page, not Herdr-native drawing; it needs the CDN reachable. Estimated size is 500-700 lines against about 3,300 for porting cockpit's renderer.

New kind of file for forge: a hooks module (forge is skills + one hook + one pi extension today). Approved by the owner for this feature. `AGENTS.md` needs its first line and test list updated.

## Found while planning (2026-11-21)

- An outside script cannot read Herdr's shipped theme colours, and a `place: none` mod receives no commands. So a second tiny mod, `herdr/mods/forge-show`, is opened with `mod.open`: it writes `theme()` to a file and floats the picker terminals named in a request file. Proven with a scratch mod.
- `mod.open` is a toggle and the request is one file, so the script takes a lock and waits for the mod's ack. Without it two show calls at once cancel each other.
- The page checks a small version file and reloads only when content changed, so diagram zoom survives; only blocks whose interval is due re-run.
- `open` never runs a block's command (the pane's own process does), so a slow command cannot time the tool call out.
- Views are stored per session (`<terminal>-<pane>`), so two sessions can use the same pane name.
- Model-written markdown is rendered with raw HTML escaped: the page opens with no prompt and the model may have read untrusted text.
- A floating terminal cannot be focused from outside; the person clicks it once.
- The tool is `mcp__forge__show`. It is on for every Claude Code session in the Herdr app, without `routing: on`; the invariants lens gets an explicit carve-out for it.
- Not done: asking before a `diff` of a repo path (git runs that repo's config). The agent already runs git in the same repos.

## Cut and why

- Herdr TUI renderer: the owner works in the desktop app; nothing breaks without it.
- Blueprint pane and commenting on diff lines: owner did not ask to keep them; only cockpit's renderer does them.
- Metabase, Datadog and metrics sources: not configured in the owner's cockpit config.
- Cockpit's hooks that deny hand-written HTML pages and artifacts until `show` has run: enforcement with no stated need.
- `placement` options beyond right/down, and the `ci` block: `gh run watch` in a `log` block covers CI.
- Other cockpit tools (`cockpit_search`, `cockpit_changes`, `cockpit_read`, `cockpit_health`, `report_step`): out of scope, they go with cockpit.

## Open questions

- Resolved 2026-11-21: a picker pane (`pane.split --direction down` running fzf, then `hc send $HC_TERMINAL_ID "<answer>"`) delivered the owner's pick to the session as their next message. The script needs `/opt/homebrew/bin` and `~/.local/bin` on its `PATH`. The floating version was proven the same day with a throwaway mod (since deleted): the short layout form `{ terminal }` fails with "did not load"; the block form above works. How the script hands the terminal id to the forge mod (a `forge.<command>` argument or a file) is for the plan to settle.
- Tool name the model sees. Keeping the block shapes means only the name in the "Drawing results" text changes.
- Shell route for Codex and pi (instructions to call the script, and a way to carry the "Drawing results" text outside `routing: on` repos): deferred, issue opened.
- Cockpit is uninstalled only after forge's show has been used for real; uninstalling is the owner's step, not part of the build.

## Deviations

- T1 commit 2d5c576, c84085e — deviation: one review fix round (null view, command output shape check, empty actor label, carriage returns, numeric answer values); duplicate actor lines in a sequence left as is (Mermaid accepts them) — parked: none
- T3 commit 3d6079d, 08219e5 — deviation: the plan's mod code called `writeTextFile` with two arguments, which cannot overwrite an existing file, and acted under `herdr-app check`; fixed in a second commit (a `put` helper passing the current content, and a `checking()` guard). Two p3 review notes left as is: one malformed float entry stops later floats (the script writes them with fixed sizes), and the ack write is not retried (requests are serialised by the script's lock) — parked: none
- T2 commit b057436, ea7c669 — deviation: one review fix round (stem/version escaped in the script, markdown images render as their alt text so nothing is fetched unprompted, a bad Mermaid block no longer disables zoom, value-axis options follow an auto-flipped bar chart, font fallback stack for Chart.js and Mermaid, dark diff background). `image` and `compare` blocks still load http(s) URLs by design — parked: none
- T4 commit 51de4f6, 1156211 — deviation: one review fix round (a failed helper or pane command now returns a deny and keeps the stored view instead of exiting; `pane.split` output is checked; `terminal`/`cwd` validated; only table and chart commands are run; an old page pane is closed when a view no longer has page blocks; herdr-app calls time out after 10 s). `serve` still runs block commands one at a time, blocking its loop while each runs — parked: none
- T5 commit f8f1993, 025b385, ad02f01 — deviation: one review fix round (answers are one cleaned line capped at 200 characters; each question gets its own snapshot file so a later call cannot change an open picker; a failed question window no longer drops the charts in the same call; lock and helper timeouts tightened) and one live-check fix (a confirm's summary and consequence are the picker header, they were hidden behind fzf). The no-fzf numbered prompt has no test — parked: none
- T6 commit b93e06d — deviation: the plan served the tool from a `tool.call` hook; a hook that answers there skips `tool.check`, so a view with a command ran unasked. Served from `tool.run` instead, with a `.catch` on both hooks. Proven with the dev plugin: a command view is refused where nobody can be asked, a command-free view opens. Not yet seen: the interactive approval dialog — parked: none
- T7 commit 523d428 — deviation: none — parked: none
