# Forge show in OpenMausBot: the same blocks as a chat card

Date: 2026-11-23. Owner chose the native route (option A) on 2026-11-23; approved ("plan it") the same day.

## Problem

Forge show draws stats, charts, tables and diagrams beside a session, but only in the Herdr desktop app. The owner's OpenMausBot bots on mbp-dev (Bean, Val, Mazer) cannot use it.

Checked live with Bean on 2026-11-23:

- OpenMausBot has a native page tool, `show_html`: HTML text, or a folder holding `index.html`, shown as a card in the chat; `live: true` reloads the card when the folder changes; `app_id` updates an existing card.
- A page built by `show/page.mjs` (stats, bar chart, flow, table) renders in that card unchanged. Chart.js and Mermaid load from jsdelivr there.
- Forge's Claude plugin does not load in a bot's turn (Claude Agent SDK, no user plugins): no `mcp__forge__show`, no `forge:` skills.
- `OMB_BOT_ID`, `OMB_THREAD_ID` and `HC_TERMINAL_ID` are unset in the bot's shell, so the hooks module could not detect the client even if it loaded.
- OpenMausBot does load the person's `~/.claude/skills` into bot turns.
- The bot's built-in browser opens only http(s), about:blank and data: addresses, so a local file would need a web server. Rejected: a new background process where a native card exists.

## Chosen approach

A personal skill plus one new script subcommand. No hooks module, no server, no change to the Herdr path.

1. **`show.mjs page [FILE]`**: reads the same view JSON as `open` (from a file, or stdin), validates it with `specError`, and writes `.forge-show/<pane>/index.html` (and its version file) in the working folder with `pageHtml`. It prints `{"result": "..."}` naming the folder. It calls nothing from Herdr and reads no theme file (default palette). `.forge-show/.gitignore` holds `*`, so the folder never shows in git.
   - `image` and `compare` blocks: each local picture is copied into the folder and referenced by relative name, since the card cannot read `file://`.
   - `diff` with `repo`: git runs once at write time, as today.
   - `log`, `choice`, `confirm` and any `command` are refused at this boundary, with a message saying what to do instead.
2. **A `forge-show` skill** kept in the repo at `openmausbot/forge-show/`, outside `skills/` (so no plugin lists it next to the typed tool), and linked into `~/.claude/skills/forge-show` by `scripts/install-openmausbot-skill.sh`, the way `install-herdr-mod.sh` links the mods. It carries: when to draw (the "Drawing results" rule), the block shapes, and three steps: write the view to `.forge-show/<name>.json`, run `node "$HOME/.claude/skills/forge-show/page.mjs" .forge-show/<name>.json` (a two-line launcher beside the skill, so the bot's command is plain and fixed), then call `show_html` with `path` and `live: true`. To change a drawing, write and build it again; the live card reloads.
3. **Folder**: pages must sit inside the bot's working folder. Checked with Bean on 2026-11-23: `show_html` refused `~/.cache/...` ("Only files in your working folder can be published") and accepted `.forge-show/<name>`.

Trade-off accepted: the bot draws because a skill description says so, not because a typed tool sits in its tool list, so unprompted drawing will be less reliable than in Herdr, and each drawing costs two calls.

## Cut and why

- `log`, `choice`, `confirm` blocks: they are Herdr panes and floating windows. OpenMausBot has its own question cards; the skill says to use those.
- `command` + `every` on tables and charts: nothing owns a refresh loop without a pane. The bot runs the command and passes rows; a schedule can rewrite the folder.
- Herdr theme matching: there is no Herdr theme there. Default palette.
- Loading Forge's plugin into bots (per-bot `.claude/settings.json`): brings the routing hook and loop skills into chat bots, and detection still has no signal.
- A localhost server for the built-in browser: see Problem.

## Open questions

- Does the card follow light and dark, and should the page? `show_html` exposes `--color-text-primary`, `--color-background-primary`, `--color-border-primary` and `--font-sans`; not used in this build.
- Should the skill also be offered to Codex and pi sessions outside Herdr (issue from the forge-show design)? Not part of this build.

## Deviations

- T1 commit c34adb9 (+ 72b6dcb) — deviation: review fix, a copied picture is written atomically and only when its content-named file is new; a half-written folder after an unreadable picture and the html/version write order were kept as the plan accepts — parked: none
- T2 commit 214c547 (+ a6826f3) — deviation: review fixes, SKILL.md states the stats/flow/cell limits, the real deny wording and that a path starts with /; the install script warns (not refuses, so the test still runs in a worktree) when linking into a worktree, and its backup name carries the pid; the SKILL.md/hooks/show.js duplication was kept as the plan accepts — parked: none
