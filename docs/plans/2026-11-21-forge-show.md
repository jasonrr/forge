# Plan: forge show

- **Goal:** forge draws charts, tiles, tables, diagrams, diffs, logs and questions beside a Claude Code session in the Herdr desktop app, so cockpit can be uninstalled.
- **Design:** `docs/decisions/2026-11-21-forge-show.md`
- **Branch:** `feat/keep-the-show-pane-charts-beside-the-ses` (exists; this worktree. Do not create another.)
- **Verify (whole feature):** `node --test show/*.test.mjs && bash hooks/session-start.test.sh && herdr-app check herdr/mods/forge-show && herdr-app check herdr/mods/forge && claude plugin validate .`

An untracked `package-lock.json` at the repo root predates this work. Do not commit it and do not delete it.

## Facts every task relies on

Verified on this machine on 2026-11-21 (hc 0.1.21, herdr-app 0.1.16, node v22.23.0, fzf 0.75.0, Claude Code 2.1.330):

- `node --test show/` FAILS on Node 22 (it treats the argument as a file). Always write `node --test show/*.test.mjs`.
- `herdr-app ls` prints `{"spaces":[{"tabs":[{"terminals":[{"terminal":"t54","pane":"p2ead…","status":…}]}]}]}`. A session's pane id is the `pane` of the entry whose `terminal` equals `$HC_TERMINAL_ID`. A terminal on another machine is written `mbp-dev/t2`.
- `herdr-app do pane.split --direction right --pane <paneId> --argv '["prog","arg"]'` prints `{"pane":"p…","terminal":"t…"}`. `herdr-app do pane.close --pane <paneId>` prints `{"ok":true}`. `herdr-app do pane.focus --terminal <t>` returns the keyboard to a pane's terminal.
- `herdr-app status` prints JSON with keys `agent, errors, floats, focused_pane, font_size, layout, overlays, space, tab, ui_font_size, zoom`; `errors` and `overlays` are arrays.
- `terminal-browser open <file.html>` renders the page in the current pane (Chart.js and Mermaid from jsdelivr render). `terminal-browser open --split` does NOT work in the Herdr app (it scripts Ghostty). Never use it.
- A page that appends `<script src="x.v.js?t=<now>">` every 1.5 s sees a changed `window.__v` and can `location.reload()`. This works on `file://` in terminal-browser.
- `hc run --bg --json --no-notify --rm <argv…>` prints `{"address":"t58",…}`. `hc get <terminal>` exits non-zero for a terminal that no longer exists. `hc send <terminal> "<text>"` delivers text to a session as the person's next message.
- A mod opened with `herdr-app do mod.open --name <mod>` runs its `init`, may call `openOverlay({ kind: "window", key, layout: { type: "block", content: { terminal } }, width, height })` (floating window; closes when the terminal ends), may `writeTextFile` to any path under the home folder, and may close itself with `closeOverlay(props().overlay)`. The short layout form `{ terminal }` fails with "did not load". `mod.open` is a toggle: calling it while the mod is still open closes it instead of running `init`.
- `herdr-app do pane.focus --terminal <t>` on a floating terminal fails ("no such pane"). The person clicks the float. Do not try to focus it.
- `<mod>.<command>` reaches shown copies only, and a `"place": "none"` mod has none. Do not use mod commands; use `mod.open` plus a request file.
- Inside a mod, `theme()` returns colours by name (`background`, `canvas`, `border`, `foreground`, `muted`, `dim`, `accent`, `ansi0`..`ansi15`; values `#rrggbb` or `#rrggbbaa`) and `settings()` returns `{ dark, theme, ui_font_family, ui_font_size, font_family, … }`. Outside a mod the shipped themes (`ink`, `paper`) cannot be read. `~/.config/herdr-app/layouts/.state/main.json` has `.theme` = `{"light":"paper","dark":"ink"}`; `~/.config/herdr-app/shared.json` has `.layout`.
- Claude Code hooks module (pattern: `~/.claude/plugins/cache/cockpit/cockpit/0.40.3/hooks/register.tsx`): `hooks/hooks.json` may hold `"modules": ["./file.js"]` beside `"hooks"` (`claude plugin validate` passes with both; loading is proven only by Task 6's live check). The module is an ES module, no `import()`, no Node or DOM; it exports `register(on)`. `$.tool.register({name, description, inputSchema, isDeferred})` inside `on('session.start', …)`; the model sees `mcp__forge__<name>`. `on('tool.call', {tool}, ($, e) => …)` gets the tool arguments directly on `e` (`e.blocks`) and returns `{ result: string }` or `{ deny: string }`. `on('tool.check', {tool}, …)` returns `{ decision: 'allow'|'ask', reason? }`; cockpit reads the arguments there as `e.input`. `on('prompt.compose', ($, e, next) => …)` returns `{ ...composed, sections }`, a section being `{ id, scope: 'session', text }`. `$.process.run(argv, { stdin, timeoutMs, cwd })` resolves `{ exitCode, stdout, stderr }`; `$.env.get(name)` and `$.session.cwd()` return promises; `$.plugin.root` is the plugin folder.
- `~/.config/herdr-app/mods/forge` is a symlink to the MAIN checkout (`~/Code/forge/herdr/mods/forge`), not this worktree. A new mod in this worktree is not live until it is linked (Task 3).
- `docs/learnings.md:39-40`: `herdr-app check` passes even when render throws. Only a live run proves a mod change. `docs/learnings.md:7`: the wrapped `grep` miscounts patterns with `$`; use `/usr/bin/grep`.
- Cockpit's page generator to adapt: `~/.claude/plugins/cache/cockpit/cockpit/0.40.3/hooks/page.ts` (162 lines; the same file is at `~/.claude/plugins/marketplaces/cockpit/plugin/hooks/page.ts`). If neither exists, stop and report.

**State.** `DIR` = `$FORGE_SHOW_DIR`, else `~/.cache/forge/show`. A view is stored under a **stem** = `<session terminal with every character outside a-z 0-9 replaced by ->` + `-` + `<pane name>` (for example `t54-quota-chart`), so two sessions using the same pane name do not collide. Files: `<stem>.json` (the stored view), `<stem>.html`, `<stem>.v.js`, and shared `theme.json`, `request.json`, `ack.json`, `lock/`.

Tests follow `herdr/mods/forge/model.test.js`: `import { test } from "node:test"; import assert from "node:assert/strict"`.

## Task 1
**Block validation and diagram text (`show/blocks.mjs`)**

- **Exists because:** a malformed block must come back to the model as a readable error instead of a blank or crashed pane.
- **Model:** sonnet
- **Files:** create `show/blocks.mjs`, `show/blocks.test.mjs`.
- **Produces for later tasks:**
  - `export const PAGE = ['markdown','stats','table','chart','flow','sequence','mermaid','image','compare','diff']`
  - `export const TYPES = [...PAGE, 'log', 'choice', 'confirm']`
  - `export function specError(view)` → `undefined` when valid, else one string `at <json path>: <what is expected>`. `view` is `{ pane, title, blocks, placement? }`.
  - `export function flowText(block)`, `export function sequenceText(block)` → Mermaid text
  - `export function rowsFrom(json)` → `{ columns, rows }` from a command's parsed output
  - `export function answerText(pane, block, picked)` → the message sent to the session
- **Steps, test-first:**
  1. Write `show/blocks.test.mjs`. Error tests assert only the `at <path>:` prefix (the wording after it is the implementer's). Checks run in this order: `pane`, `title`, `placement`, `blocks`, then each block in order, and the first failure is returned.
     - `specError({pane:'a', title:'T', blocks:[{type:'markdown', text:'hi'}]})` is `undefined`.
     - `pane` must match `/^[a-z0-9][a-z0-9-]{0,39}$/`; `'Bad Name'` → `at /pane:`. `{pane:'Bad Name', title:'t', blocks:[]}` also gives `at /pane:` (order).
     - `title` must be a string → `at /title:`; `placement` when present is `'right'` or `'down'` → `at /placement:`; `blocks` a non-empty array of objects → `at /blocks:`.
     - Unknown `type` (including `'blueprint'` and `'ci'`) → `at /blocks/N/type:`. A `title` on a block must be a string when present.
     - `markdown`, `mermaid`: `text` is a string.
     - `stats`: `items` has 1 to 8 entries, each `label` a string and `value` a string or number; `spark` when present is an array of numbers.
     - `table`: either `columns` (non-empty array of strings) and `rows` (array, at most 5000, each an array of `columns.length` values that are string, number, boolean or null), or `command` (non-empty string) with optional `every` (number ≥ 5). With `command`, `columns` and `rows` are optional.
     - `chart`: table rules, plus `kind` in `line|area|bar|donut`; when `columns` is given, `x` when present is one of `columns` and `y` when present is a non-empty array whose every entry is one of `columns`.
     - `flow`: `nodes` 1 to 60, each `{id, label}` strings with unique non-empty `id`, `kind` when present in `box|round|decision`; each edge's `from` and `to` is a node id and its `label` when present is a string; `direction` when present is `down` or `right`.
     - `sequence`: `actors` when present is an array whose entries are strings or `{id: string, label?: string}`; `messages` non-empty; each is `{from, to}` strings (`label` when present a string) or `{note, over}` strings.
     - `image`: exactly one of `path` (starts with `/`) or `url` (starts with `http://` or `https://`).
     - `compare`: `before` and `after` each an absolute path or http(s) URL.
     - `diff`: exactly one of `patch` (string, at most 500000 chars) or `repo` (absolute path); `base` when present matches `/^[\w.~^@{}/][\w./~^@{}-]*$/`.
     - `log`: `command` non-empty string; `every` and `lines` when present are numbers ≥ 1.
     - `choice`: `options` has at least 2 entries, each with a string `label`; `preview` when present a string; `prompt` when present a string.
     - `confirm`: `summary` is a string; `consequence` and `confirm_label` when present are strings.
     - `flowText({nodes:[{id:'a',label:'A "x"'},{id:'b',label:'B',kind:'decision'}],edges:[{from:'a',to:'b',label:'go'}],direction:'right'})` equals `'flowchart LR\n  n0["A #quot;x#quot;"]\n  n1{"B"}\n  n0 -->|"go"| n1'`.
     - `sequenceText({messages:[{from:'M',to:'S',label:'hi'},{note:'n',over:'S'},{from:'S',to:'M',label:'ok',reply:true}]})` equals `'sequenceDiagram\n  participant a0 as M\n  participant a1 as S\n  a0->>a1: hi\n  Note over a1: n\n  a1-->>a0: ok'`.
     - `rowsFrom({columns:['a'],rows:[[1]]})` returns it unchanged. `rowsFrom([{a:1,b:'x'},{b:'y',c:2}])` returns `{columns:['a','b','c'],rows:[[1,'x',null],[null,'y',2]]}` (columns are the union of keys in first-seen order; a missing key is `null`). `rowsFrom('nope')`, `rowsFrom({columns:'a',rows:[]})` and `rowsFrom([1,2])` each throw an Error whose message starts `command output:`.
     - `answerText('p', {type:'choice', prompt:'Which?'}, {label:'Blue', value:'b'})` equals `'In the p pane I chose "Blue" (value: b) for: Which?'`; without `value` (or `value === label`) the ` (value: …)` part is absent; without `prompt` the ` for: …` part is absent.
     - `answerText('p', {type:'confirm', summary:'Delete it?\nmore'}, {confirmed:true})` equals `'In the p pane I confirmed: Delete it?'`; `{confirmed:false}` gives `'In the p pane I declined: Delete it?'`.
  2. Implement. `flowText` and `sequenceText` are ported from cockpit's `hooks/page.ts:17-43` (MIT), types removed:
     ```js
     const quoted = (text) => `"${text.replace(/"/g, '#quot;').replace(/\n/g, ' ')}"`
     export function flowText(block) {
       const shape = (kind, label) => (kind === 'round' ? `(${quoted(label)})` : kind === 'decision' ? `{${quoted(label)}}` : `[${quoted(label)}]`)
       const nodes = block.nodes.map((n, i) => `  n${i}${shape(n.kind, n.label)}`)
       const ids = new Map(block.nodes.map((n, i) => [n.id, `n${i}`]))
       const edges = (block.edges ?? []).map((e) => `  ${ids.get(e.from)} -->${e.label ? `|${quoted(e.label)}|` : ''} ${ids.get(e.to)}`)
       return [`flowchart ${block.direction === 'right' ? 'LR' : 'TD'}`, ...nodes, ...edges].join('\n')
     }
     export function sequenceText(block) {
       const names = new Map()
       const id = (name) => { if (!names.has(name)) names.set(name, `a${names.size}`); return names.get(name) }
       const actors = (block.actors ?? []).map((a) => (typeof a === 'string' ? { id: a, label: a } : { id: a.id, label: a.label ?? a.id }))
       const lines = actors.map((a) => `  participant ${id(a.id)} as ${a.label.replace(/[:;\n]/g, ' ')}`)
       for (const m of block.messages) {
         const text = String(m.label ?? m.note ?? '').replace(/[;\n]/g, ' ')
         if (m.note !== undefined) lines.push(`  Note over ${id(m.over)}: ${text}`)
         else lines.push(`  ${id(m.from)}${m.reply ? '-->>' : '->>'}${id(m.to)}: ${text || ' '}`)
       }
       const late = [...names].filter(([name]) => !actors.some((a) => a.id === name)).map(([name, alias]) => `  participant ${alias} as ${name.replace(/[:;\n]/g, ' ')}`)
       return ['sequenceDiagram', ...late, ...lines].join('\n')
     }
     ```
     `late` participants are emitted in first-seen order, before the message lines.
- **Verify:** `node --test show/blocks.test.mjs`

## Task 2
**The themed page (`show/page.mjs`)**

- **Exists because:** this is the drawing itself; without it there is nothing in the pane.
- **Model:** sonnet
- **Files:** create `show/page.mjs`, `show/page.test.mjs`, `show/THIRD_PARTY_NOTICES.md`.
- **Consumes:** `flowText`, `sequenceText` from `./blocks.mjs`.
- **Produces:**
  - `export function palette(themeFile)` → `{ dark, bg, panel, line, text, dim, accent, good, bad, series: string[6], font, mono, size }`
  - `export function pageBlocks(blocks, extra)` → blocks ready for the page. `extra` is a `Map` keyed by the index within the array passed in; its value (an object) is merged over the block.
  - `export function pageHtml({ stem, title, blocks, palette, version })` → the HTML string. `blocks` is what `pageBlocks` returned.
- **Steps, test-first:**
  1. `show/page.test.mjs`:
     - `palette(undefined)` returns the defaults below, with `dark: true`.
     - `palette({theme:{background:'#ffffff',foreground:'#111111',accent:'#0055ff80',ansi2:'nope'},settings:{dark:false,ui_font_family:'Geist"; x',font_family:'Mono}; y',ui_font_size:99}})` → `bg` `'#ffffff'`, `text` `'#111111'`, `series[0]` `'#0055ff'` (cut to 7 chars), `good` the default (invalid value ignored), `dark` `false`, `font` `'Geist x'`, `mono` `'Mono y'` (both: only letters, digits, space, `.`, `-`, `_` kept), `size` `20`. `ui_font_size: 'big'` gives `13`.
     - `pageBlocks([{type:'flow',title:'F',nodes:[{id:'a',label:'A'}]}], new Map())[0]` deep-equals `{type:'mermaid', title:'F', text:'flowchart TD\n  n0["A"]'}`.
     - `pageBlocks([{type:'image',path:'/tmp/a b#1.png'}], new Map())[0].url` is `'file:///tmp/a%20b%231.png'`; a `compare` gets the same treatment on absolute `before`/`after` and leaves http(s) URLs alone; `pageBlocks([{type:'diff',repo:'/r'}], new Map([[0,{patch:'P'}]]))[0].patch` is `'P'`; with `{error:'E'}` the block's `error` is `'E'`; `pageBlocks([{type:'table',command:'x'}], new Map())[0].loading` is `true` (a command block with no `rows` and nothing in `extra`).
     - `pageHtml({stem:'t1-p', title:'A <b>', blocks:[{type:'markdown',text:'</script><script>alert(1)'}], palette: palette(), version:'v7'})`: contains `<title>A &lt;b></title>`; does not contain the substring `</script><script>alert(1)`; contains `window.__seen="v7"`; contains `t1-p.v.js`; contains `--bg: #111720`.
  2. `palette` defaults (Herdr's `ink`, read from `theme()` on 2026-11-21): `bg '#111720'`, `panel '#0e131b'`, `line '#ffffff18'`, `text '#eeeeef'`, `dim '#96989c'`, `accent '#91b6ee'`, `good '#89c5aa'`, `bad '#e58c9a'`, `series ['#91b6ee','#89c5aa','#e5c07b','#c678dd','#e58c9a','#56b6c2']`, `font 'Geist'`, `mono 'MesloLGL Nerd Font Mono'`, `size 13`. Mapping from the theme file `{ theme, settings }`: `bg ← theme.background`, `panel ← theme.canvas`, `line ← theme.border`, `text ← theme.foreground`, `dim ← theme.muted`, `accent ← theme.accent`, `good ← theme.ansi2`, `bad ← theme.ansi1`, `series ← [accent, ansi2, ansi3, ansi5, ansi1, ansi6]` each cut to 7 chars (a missing one keeps that slot's default), `dark ← settings.dark` (must be a boolean, else `true`), `font ← settings.ui_font_family`, `mono ← settings.font_family`, `size ← settings.ui_font_size` (a finite number clamped to 11..20, else 13). A colour is accepted only if it matches `/^#[0-9a-f]{6}([0-9a-f]{2})?$/i`. Font names keep only `[A-Za-z0-9 ._-]`; an empty result keeps the default.
  3. `pageBlocks`: `flow` → `{type:'mermaid', title, text: flowText(b)}`; `sequence` likewise with `sequenceText`; `image` with a string `path` → add `url: 'file://' + encodeURI(path).replace(/#/g, '%23').replace(/\?/g, '%3F')`; `compare` → the same conversion on values starting with `/`; then merge `extra.get(n)` over the block when present; then a block that has a `command`, no `rows` and no `error` gets `loading: true`.
  4. `pageHtml`: adapt cockpit's `pageHtml` (`page.ts:57-161`, MIT; keep the CDN versions: marked 12.0.2, mermaid 10.9.1, chart.js 4.4.3, diff2html 3.4.48, all from `https://cdn.jsdelivr.net/npm/`). Keep its `el`, `later`, table, compare and image renderers as they are. Changes, all required:
     - Escape: `data = JSON.stringify({title, blocks, palette}).replace(/</g, '\\u003c')`; page title with `<` → `&lt;` and `&` → `&amp;`.
     - CSS variables come from the palette: `:root { --bg: ${p.bg}; --panel: ${p.panel}; --line: ${p.line}; --text: ${p.text}; --dim: ${p.dim}; --accent: ${p.accent}; --green: ${p.good}; --red: ${p.bad}; }`. Body font `${p.size + 2}px/1.55 "${p.font}", -apple-system, BlinkMacSystemFont, sans-serif`; `code, pre` font-family `"${p.mono}", ui-monospace, monospace`. Nothing else model- or theme-supplied is interpolated into the HTML or CSS: everything else reaches the page through the JSON data.
     - No model-supplied markup runs. Markdown: before first use, `marked.use({ renderer: { html: (t) => String(typeof t === 'string' ? t : t.text ?? t.raw ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;') } })`, so raw HTML in markdown shows as text. After parsing, remove every `href` that does not start with `http://`, `https://`, `#` or `mailto:` (`for (const a of box.querySelectorAll('a')) …`). Mermaid text is set with `textContent`, never a template string, and Mermaid keeps its default `securityLevel` (`'strict'`). All other text uses `textContent` (cockpit's `el` already does). `// why: blocks are written by a model that may have read untrusted text; the page opens with no prompt.`
     - In the page script read `const P = spec.palette`, then `const SERIES = P.series`; `Chart.defaults.color = P.dim; Chart.defaults.borderColor = P.line; Chart.defaults.font.family = P.font`; donut `borderColor: P.bg`; use `SERIES[i % SERIES.length]` everywhere cockpit wrote `% 5`.
     - Chart value axis: when `b.unit` is a string and `b.percent` is not set, add `ticks: { callback: v => v + ' ' + b.unit }` to the value scale (`y`, or `x` when `b.horizontal`).
     - Stat sparkline: when `t.spark` has 2 or more numbers, append after the value an inline SVG `viewBox="0 0 100 24" preserveAspectRatio="none" width="100%" height="24"` holding one `polyline` (`fill="none"`, `stroke` = `P.accent`, `stroke-width="1.5"`, `vector-effect="non-scaling-stroke"`) whose points are `x = i * 100 / (n - 1)`, `y = 22 - (v - min) * 20 / ((max - min) || 1)`. Build it with `document.createElementNS('http://www.w3.org/2000/svg', …)` and `setAttribute`, not `innerHTML`.
     - Mermaid: `mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { darkMode: P.dark, background: P.panel, primaryColor: P.panel, primaryTextColor: P.text, primaryBorderColor: P.accent, lineColor: P.dim, textColor: P.text, fontFamily: P.font } })`.
     - diff2html: `colorScheme: P.dark ? 'dark' : 'light'`.
     - A block with `loading` renders `<p class="note">loading…</p>`; a block with `error` renders `<p class="error">` with the text (via `textContent`) and, for tables, charts and diffs, nothing else. The block's `title` heading is shown in every case. Add `.note { color: var(--dim); }`.
     - Pan and zoom on every Mermaid block. Each is built with `el(…)` as `div.zoom > [div.zbar > button×3 ("−", "+", "Fit"), pre.mermaid]`. CSS: `.zoom { position: relative; overflow: hidden; background: var(--panel); border-radius: 8px; } .zoom .mermaid { margin: 0; cursor: grab; } .zbar { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; gap: 4px; } .zbar button { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 2px 9px; font: inherit; cursor: pointer; }`. After `await mermaid.run({ querySelector: '.mermaid' })` (wrap the tail of the script in an async function) wire each `.zoom`:
       ```js
       for (const box of document.querySelectorAll('.zoom')) {
         const svg = box.querySelector('svg'); if (!svg) continue
         let k = 1, x = 0, y = 0, drag = null
         svg.style.transformOrigin = '0 0'
         const apply = () => { svg.style.transform = `translate(${x}px,${y}px) scale(${k})` }
         const by = (f) => { k = Math.min(8, Math.max(0.2, k * f)); apply() }
         const [minus, plus, fit] = box.querySelectorAll('.zbar button')
         minus.onclick = () => by(1 / 1.25); plus.onclick = () => by(1.25); fit.onclick = () => { k = 1; x = 0; y = 0; apply() }
         box.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); by(e.deltaY < 0 ? 1.1 : 1 / 1.1) }, { passive: false })
         box.addEventListener('pointerdown', (e) => { if (e.target.closest('.zbar')) return; drag = { px: e.clientX - x, py: e.clientY - y }; box.setPointerCapture(e.pointerId) })
         box.addEventListener('pointermove', (e) => { if (!drag) return; x = e.clientX - drag.px; y = e.clientY - drag.py; apply() })
         box.addEventListener('pointerup', () => { drag = null })
       }
       ```
       Plain wheel still scrolls the page; ctrl or cmd + wheel (and trackpad pinch) zooms. `k = 1` is Mermaid's own fit-to-width.
     - Update check, last in the page script (`stem` and `version` are JSON-encoded into the template):
       ```js
       window.__seen=${JSON.stringify(version)}
       setInterval(() => {
         const s = document.createElement('script')
         s.src = ${JSON.stringify(stem + '.v.js')} + '?t=' + Date.now()
         s.onload = () => { s.remove(); if (window.__v !== undefined && window.__v !== window.__seen) location.reload() }
         s.onerror = () => s.remove()
         document.head.appendChild(s)
       }, 1500)
       ```
       The test asserts the literal `window.__seen="v7"`: no spaces around `=`.
  5. `show/THIRD_PARTY_NOTICES.md`: state that `show/page.mjs` and the `flowText`/`sequenceText` functions in `show/blocks.mjs` are adapted from cockpit (`https://github.com/quaresc/cockpit`, `plugin/hooks/page.ts`), MIT, `Copyright (c) 2026 quaresc`, followed by the full MIT text copied from `~/.claude/plugins/marketplaces/cockpit/LICENSE`. Follow the layout of `herdr/mods/forge/THIRD_PARTY_NOTICES.md`.
- **Verify:** `node --test show/page.test.mjs`

## Task 3
**Helper mod (`herdr/mods/forge-show`) and its install**

- **Exists because:** only a mod can read Herdr's theme colours and open a floating window; both are stated requirements (theme match; choice/confirm in a float).
- **Model:** sonnet
- **Files:** create `herdr/mods/forge-show/main.js`, `herdr/mods/forge-show/mod.json`; edit `scripts/install-herdr-mod.sh`, `.gitignore`.
- **Produces:** `herdr-app do mod.open --name forge-show` reads `~/.cache/forge/show/request.json` and acts on it. Request: `{ "id": "<unique string>", "key": "<theme key>", "theme": true|false, "floats": [{ "terminal": "t58", "key": "show-t58", "width": 640, "height": 320 }] }`. When `theme` is true it writes `theme.json` = `{ "key": <request key>, "theme": theme(), "settings": settings() }`. It always finishes by writing `ack.json` = `{ "id": <request id> }`; the script (Task 4) waits for that ack and holds a lock meanwhile, so requests never overlap.
- **Steps:**
  1. `herdr/mods/forge-show/mod.json` (same keys as `herdr/mods/forge/mod.json`): `{ "place": "none", "overlay": { "kind": "popup", "width": 10, "height": 10 } }`
  2. `herdr/mods/forge-show/main.js` (complete):
     ```js
     // forge-show: the helper forge's show script calls with `herdr-app do mod.open --name forge-show`. It reads
     // ~/.cache/forge/show/request.json, writes Herdr's theme colours where the script can read them, opens each asked
     // terminal as a floating window, writes ack.json, then closes itself. It draws nothing.
     import { View, div } from "gpui-kit";
     import { props, openOverlay, closeOverlay, readTextFile, writeTextFile, home, theme, settings } from "herdr";
     const DIR = `${home()}/.cache/forge/show`;
     export default class ForgeShow extends View {
       init(_p, cx) {
         cx.spawn(async () => {
           let id = "";
           try {
             const req = JSON.parse((await readTextFile(`${DIR}/request.json`)) ?? "{}");
             id = String(req.id ?? "");
             if (req.theme) await writeTextFile(`${DIR}/theme.json`, JSON.stringify({ key: req.key ?? "", theme: theme(), settings: settings() }));
             for (const f of Array.isArray(req.floats) ? req.floats : []) {
               if (typeof f?.terminal !== "string") continue;
               openOverlay({ kind: "window", key: String(f.key ?? f.terminal), layout: { type: "block", content: { terminal: f.terminal } }, width: f.width ?? 640, height: f.height ?? 320 });
             }
           } catch (e) { /* a bad request draws nothing; the script falls back to its default palette */ }
           try { await writeTextFile(`${DIR}/ack.json`, JSON.stringify({ id })); } catch (e) { }
           if (props()?.overlay) closeOverlay(props().overlay); // only this overlay, by its captured id (docs/learnings.md:14)
         });
       }
       render() { return div(); }
     }
     ```
     Check `home` is exported by `herdr` (`/usr/bin/grep -n "export function home" ~/.config/herdr-app/herdr.d.ts`; `herdr/mods/forge/main.js:6` imports it). The mod always uses the default folder; `$FORGE_SHOW_DIR` is for the script's tests only.
  3. `scripts/install-herdr-mod.sh`: link both mods. Wrap lines 5-16 (from `src=` through the `ln -s` line) in `for mod in forge forge-show; do … done`, with `src="$(cd "$(dirname "$0")/.." && pwd)/herdr/mods/$mod"` and `dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/$mod"`, the backup name `"$mod-mod.bak-$(date +%Y%m%d%H%M%S)"`, `linked=` reset inside the loop, and messages naming `$mod`. Update the file's header comment to name both mods. Leave the keys and hide-hint part unchanged.
  4. `.gitignore`: add `herdr/mods/forge-show/jsconfig.json`, `herdr/mods/forge-show/gpui-kit.d.ts`, `herdr/mods/forge-show/herdr.d.ts` (Herdr writes these into a mod folder; the forge mod's are already ignored).
  5. Live check, in this worktree, inside the Herdr app (`$HC_TERMINAL_ID` set). The link is temporary and points at this worktree; Task 8 removes it. If `~/.config/herdr-app/mods/forge-show` already exists, stop and report; do not replace it.
     ```bash
     ln -s "$PWD/herdr/mods/forge-show" ~/.config/herdr-app/mods/forge-show
     herdr-app check herdr/mods/forge-show
     mkdir -p ~/.cache/forge/show && rm -f ~/.cache/forge/show/theme.json ~/.cache/forge/show/ack.json
     printf '%s' '{"id":"i1","key":"k1","theme":true,"floats":[]}' > ~/.cache/forge/show/request.json
     herdr-app do mod.open --name forge-show && sleep 2
     jq -e '.key=="k1" and (.theme.background|test("^#")) and (.settings.dark|type=="boolean")' ~/.cache/forge/show/theme.json
     jq -e '.id=="i1"' ~/.cache/forge/show/ack.json
     herdr-app status | jq -e '(.errors|length)==0 and (.overlays|length)==0'
     ```
- **Verify:** the block in step 5 exits 0, and `H="$(mktemp -d)"; HERDR_APP_HOME="$H" bash scripts/install-herdr-mod.sh; [ -L "$H/mods/forge" ] && [ -L "$H/mods/forge-show" ]`.

## Task 4
**The script: page and log panes (`show/show.mjs`)**

- **Exists because:** something must turn a block list into panes; this is the one entry both the tool and a later shell route call.
- **Model:** sonnet
- **Files:** create `show/show.mjs`, `show/show.test.mjs`.
- **Consumes:** `specError`, `PAGE`, `rowsFrom` (Task 1); `palette`, `pageBlocks`, `pageHtml` (Task 2); the request/ack/theme contract (Task 3).
- **Produces (CLI):**
  - `node show/show.mjs open` reads one JSON object on stdin: `{ pane, title, blocks, placement?, cwd?, terminal? }`. `terminal` defaults to `$HC_TERMINAL_ID`, `cwd` to `process.cwd()`. It prints exactly one line of JSON on stdout, `{"result":"…"}` or `{"deny":"…"}`, and exits 0. Unexpected failures exit 1 with the message on stderr. `open` never runs a block's `command`: it must return quickly.
  - `node show/show.mjs serve <stem>` is the page pane's program.
  - `node show/show.mjs log <stem> <viewIndex>` is a log pane's program.
  - Exports for tests: `stemOf(terminal, pane)`, `plan(view)`, `shq(text)`, `diffCommand(block)`, `buildPage(view, themeFile, version, { run, data })`, `due(view, lastRun, now)`. The CLI runs only when this file is the entry (`import.meta.url === pathToFileURL(process.argv[1]).href`).
- **Behaviour:**
  1. One helper for every external command: `sh(argv, opts)` = `execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', env: { ...process.env, PATH: [process.env.FORGE_SHOW_PATH_FIRST, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':') }, ...opts })`. `FORGE_SHOW_PATH_FIRST` exists for tests (fake `hc`/`herdr-app`). Arguments are always separate argv entries, never one shell string, except where a `sh -c` is named below.
  2. `stemOf(terminal, pane)` = `terminal.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + pane`.
  3. `plan(view)` → `{ page: number[], logs: number[], asks: number[] }`: view indexes of blocks whose type is in `PAGE`, is `log`, or is `choice`/`confirm`.
  4. Atomic writes: `put(path, text)` writes `path + '.' + process.pid + '.tmp'` then renames it over `path`.
  5. `shq(text)` = `"'" + text.replace(/'/g, "'\\''") + "'"`. `diffCommand(block)` = `'git -C ' + shq(block.repo) + ' diff --no-color --no-ext-diff ' + shq(block.base ?? 'HEAD') + ' --'`.
  6. `buildPage(view, themeFile, version, { run, data })` returns the HTML string and never throws. `run(command, cwd)` returns stdout. `data` is an object keyed by **view index** holding `{ columns, rows }` or `{ error }` for command blocks. For the page-only blocks (in view order): a `diff` with `repo` → `extra` gets `{ patch: run(diffCommand(b), view.cwd) }`, or `{ error: <first 200 chars of the message> }` on throw; a block with `command` → `extra` gets `data[viewIndex]` when present. `extra` is keyed by the index within the page-only array. Return `pageHtml({ stem: stemOf(view.terminal, view.pane), title: view.title, blocks: pageBlocks(pageOnly, extra), palette: palette(themeFile), version })`.
  7. `due(view, lastRun, now)` → the view indexes of page blocks with a `command` for which `lastRun[i]` is undefined or `now - lastRun[i] >= (block.every ?? 60) * 1000`.
  8. `open`:
     - Parse stdin; `specError` → `{"deny": error}`.
     - No `terminal` → `{"deny":"forge show needs the Herdr desktop app (HC_TERMINAL_ID is not set)."}`. `herdr-app ls` failing, or the terminal not found in it → `{"deny":"forge show could not find this session's pane in the Herdr app."}`.
     - `stem = stemOf(terminal, pane)`. Read the previous `DIR/<stem>.json` if any for its `panes` (default `{}`). `panes` maps `page` and `log<viewIndex>` to `{ pane, terminal }`; a pane counts as alive when its `terminal` appears in `herdr-app ls`.
     - `put(DIR/<stem>.json, { ...view, terminal, cwd, panes, stamp: Date.now() })` (create `DIR` with `mkdirSync(…, { recursive: true })`). `serve` notices `stamp` changing.
     - Theme key: `key = JSON.stringify(<.theme of ~/.config/herdr-app/layouts/.state/<layout>.json, or null>) + '|' + <trimmed stdout of `defaults read -g AppleInterfaceStyle`, or 'Light' when it exits non-zero>`, with `<layout>` = `.layout` of `~/.config/herdr-app/shared.json` (default `main`); any read error gives `null`. A theme refresh is needed when `DIR/theme.json` is missing or its `key` differs. `// ponytail: a custom theme file edited in place is not noticed until the theme or appearance changes; add its mtime to the key if that bites.`
     - Asks: Task 5 fills this in. In this task, a view with `asks` returns `{"deny":"choice and confirm are not built yet"}` before anything is written.
     - Helper request (only when a theme refresh is needed, or Task 5 has floats): take the lock by `mkdirSync(DIR/lock)`; on `EEXIST` retry every 100 ms for up to 5 s, and remove a lock whose mtime is older than 10 s. With the lock held: `id = process.pid + '-' + Date.now()`; `put(DIR/request.json, { id, key, theme: <needed>, floats })`; run `herdr-app do mod.open --name forge-show` ONCE; poll `DIR/ack.json` every 100 ms for up to 3 s until its `id` matches; `rmdirSync(DIR/lock)` in a `finally`. On ack timeout carry on (the page falls back to the stored or default palette), and remember the timeout for Task 5. `// why: mod.open is a toggle and request.json is one file, so two show calls at once would cancel each other without the lock.`
     - Page blocks present: `put(DIR/<stem>.html, buildPage(view, <theme.json or undefined>, version, { run, data: {} }))` then `put(DIR/<stem>.v.js, 'window.__v=' + JSON.stringify(version))`, with `version = String(Date.now())` and `run` = `(command, cwd) => sh(['sh', '-c', command], { cwd, timeout: 20000, maxBuffer: 8 << 20 })` (here `run` only ever receives `diffCommand` output). If `panes.page` is alive that is all: the open page reloads and its `serve` fills command blocks in. Otherwise `pane.split` with `--direction` = `placement ?? 'right'`, `--pane` = the session's pane id, `--argv` = `JSON.stringify(['node', <absolute path of show.mjs>, 'serve', stem])`; store the returned `{ pane, terminal }` as `panes.page`.
     - Logs: for every `panes` key starting with `log` that is alive, `pane.close --pane` it and delete the key (commands may have changed, or the block is gone). Then for each `log` block at view index `n`: `pane.split --direction down --pane <session pane>` with argv `['node', <show.mjs>, 'log', stem, String(n)]`; store as `panes['log' + n]`.
     - `put` the `.json` again with the updated `panes` (same `stamp`). Run `herdr-app do pane.focus --terminal <session terminal>` and ignore its failure.
     - Result: `Opened the <pane> pane beside this session.` when a page or log pane was newly split; `Updated the <pane> pane.` when only an existing page was rewritten.
  9. `serve <stem>`: spawn `terminal-browser open DIR/<stem>.html` with `stdio: 'inherit'` (through the same PATH as `sh`); when it exits, exit with its code; if it cannot be started, print `forge show: terminal-browser is not installed (brew install …); the page is at <path>` and wait for enter. Meanwhile, once a second and never overlapping (skip a tick while one is running): read `DIR/<stem>.json` (skip the tick if it does not parse). If its `stamp` differs from the last one seen, forget `data` and `lastRun`. `ids = due(view, lastRun, now)`. If `ids` is empty and the stamp did not change, do nothing. Otherwise for each id: set `lastRun[id] = now` first (so a failing command waits its full interval too), then `data[id] = rowsFrom(JSON.parse(run(block.command, view.cwd)))`, or `{ error: <first 200 chars> }` on any throw. Then re-read `<stem>.json`; if its `stamp` changed meanwhile, drop this rebuild; else read `DIR/theme.json` and `put` the page and a new version as `open` does. Only due blocks re-run; a rebuild re-runs each repo `diff` (cheap, and it follows the working tree). The loop is this process, which is the pane's program: it ends with the pane. No daemon.
  10. `log <stem> <n>`: read the view and block `n`; `process.chdir(view.cwd)` (ignore failure). Without `every`: run `sh -c <command>` with `stdio: 'inherit'`, then print `[exited <code>] press enter to close` and wait for a line on stdin. With `every`: loop forever: run `spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 << 20 })`, clear the screen (`\x1b[2J\x1b[H`), print the last `lines ?? 40` lines of stdout followed by stderr, then sleep `every` seconds.
- **Steps, test-first (`show/show.test.mjs`):**
  - `stemOf('mbp-dev/T2', 'chart')` is `'mbp-dev-t2-chart'`.
  - `plan({blocks:[{type:'stats'},{type:'log'},{type:'choice'},{type:'chart'}]})` deep-equals `{page:[0,3], logs:[1], asks:[2]}`.
  - `diffCommand({repo:"/r/it's"})` equals `git -C '/r/it'\''s' diff --no-color --no-ext-diff 'HEAD' --`.
  - `buildPage` for a view `[{type:'log',command:'l'},{type:'table',command:'x'}]` with `data = {1:{columns:['a'],rows:[[1]]}}` yields HTML whose embedded spec contains `"columns":["a"]`; with `data = {}` it contains `"loading":true`; with `data = {1:{error:'boom'}}` it contains `boom`. In none of these is `run` called.
  - `buildPage` with a `diff` block and `run = () => { throw new Error('nogit') }` yields HTML containing `nogit` and does not throw.
  - `due({blocks:[{type:'table',command:'x',every:5},{type:'table',command:'y'}]}, {0: 1000}, 5999)` deep-equals `[1]`; at `now = 6000` it deep-equals `[0, 1]`.
  - CLI: `echo '{"pane":"Bad Name","title":"t","blocks":[]}' | FORGE_SHOW_DIR=$(mktemp -d) node show/show.mjs open` prints a line that parses as JSON with a `deny` starting `at /pane:` and exits 0.
  - CLI with `HC_TERMINAL_ID` unset (`env -u HC_TERMINAL_ID`) and a valid view prints the `HC_TERMINAL_ID is not set` deny.
  - CLI with fake `herdr-app` and `defaults` on `FORGE_SHOW_PATH_FIRST` (shell scripts in a temp dir: `herdr-app` appends `"$*"` to a log file, prints `{"spaces":[{"tabs":[{"terminals":[{"terminal":"t1","pane":"p1"}]}]}]}` for `ls` and `{"pane":"p2","terminal":"t2"}` otherwise; `defaults` prints `Dark`), `HC_TERMINAL_ID=t1`, a temp `FORGE_SHOW_DIR` pre-seeded with a `theme.json` whose `key` equals the computed key, and a one-`stats`-block view: prints `{"result":"Opened the <pane> pane beside this session."}`, writes `t1-<pane>.html` and `.v.js`, and the log shows one `do pane.split` and no `mod.open`. For the pre-seeded key the test computes it the same way with `HOME` pointed at an empty temp dir (so the layout part is `null`): `'null|Dark'`.
- **Live check (Herdr app; needs Task 3's link):**
  ```bash
  printf '%s' '{"pane":"t4-check","title":"Task 4 check","blocks":[{"type":"stats","items":[{"label":"A","value":4,"spark":[1,3,2,4]}]},{"type":"flow","nodes":[{"id":"a","label":"spec"},{"id":"b","label":"page"}],"edges":[{"from":"a","to":"b"}]},{"type":"table","title":"Clock","command":"printf \"[{\\\"now\\\":\\\"%s\\\"}]\" \"$(date +%T)\"","every":5},{"type":"markdown","text":"<img src=x onerror=\"document.title=1\"> **bold**"},{"type":"log","command":"for i in 1 2 3; do echo line $i; sleep 1; done"}]}' | node show/show.mjs open
  sleep 8 && herdr-app shot /tmp/forge-show-t4.png
  ```
  Read the screenshot: a page pane right of the session in Herdr's colours with a tile and sparkline, a flowchart with − + Fit buttons, a Clock table with a time, the markdown shown as literal `<img …>` text followed by bold "bold"; a log pane below showing `line 1..3` then `[exited 0]`. Take a second shot 6 s later: the Clock value has changed. Run the same command again: the output is `{"result":"Opened the t4-check pane beside this session."}` (the log pane is re-split) and there is still exactly one page pane. Close the panes named in `~/.cache/forge/show/<stem>.json` with `herdr-app do pane.close --pane <id>`.
- **Verify:** `node --test show/show.test.mjs` passes and the live check matches.

## Task 5
**Choice and confirm in a floating window**

- **Exists because:** the owner requires choice/confirm prompts whose answer reaches the session.
- **Model:** sonnet
- **Files:** edit `show/show.mjs`, `show/show.test.mjs`.
- **Consumes:** `answerText` (Task 1); the `floats` request contract (Task 3); the lock-and-ack helper request (Task 4).
- **Behaviour:**
  1. In `open`, replace Task 4's "not built yet" deny. For each view index `n` in `asks`: start the picker with `sh(['hc', 'run', '--bg', '--json', '--no-notify', '--rm', 'node', <show.mjs>, 'pick', stem, String(n)])` (no `--name`: names must be unique among live terminals and an earlier picker may still be open) and read `address` from its JSON output. Collect `{ terminal: address, key: 'show-' + address, width: 640, height: 320 }`.
  2. Floats go into the SAME single helper request as the theme refresh (Task 4, one `mod.open` per `open`).
  3. After the request: if the ack timed out, or `hc get <address>` exits non-zero for a picker, return `{"deny":"forge show could not open the question window (is the forge-show helper mod installed? run scripts/install-herdr-mod.sh)."}` after killing any picker still alive with `hc kill <address>` (ignore failures).
  4. A view with only asks returns `{"result":"Asked in a floating window; the answer arrives as the person's next message. They click the window first."}`. With page or log panes too, append ` Also asked a question in a floating window.` to the pane result.
  5. `pick <stem> <n>` (the float's program): read the view and block `n`.
     - `choice`: `pickerRows(block)` → `['0\t<label0>', '1\t<label1>', …]` (tabs and newlines in a label become spaces). With fzf on PATH: `spawnSync('fzf', ['--reverse', '--delimiter=\t', '--with-nth=2..', '--header', block.prompt ?? view.title, '--preview', 'node ' + shq(<show.mjs>) + ' preview ' + shq(stem) + ' ' + n + ' {1}', '--preview-window', hasPreview ? 'right,50%' : 'hidden'], { input: rows.join('\n'), stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8' })`. `pickedFrom(block, stdout)` → `block.options[<integer before the first tab>]`, or `undefined` for empty or unparsable output. Esc (non-zero status) → send nothing, exit 0.
     - `confirm`: print `block.summary`, then `block.consequence` when present, then pick between `block.confirm_label ?? 'Confirm'` and `Cancel` the same way (no preview). Esc sends nothing; `Cancel` sends the declined text.
     - No fzf: print the numbered labels, read one line from stdin, accept `1..N`; anything else sends nothing.
     - Send: `sh(['hc', 'send', view.terminal, answerText(view.pane, block, picked)])` where `picked` is `{label, value}` of the option, or `{confirmed: true|false}`. If it throws, print the error and wait for enter, so the float stays open and the person sees why.
  6. `preview <stem> <n> <i>`: print `options[i].preview ?? ''`.
- **Steps, test-first:** test `pickerRows` and `pickedFrom` (`'1\tB\n'` → `options[1]`; `''` → `undefined`; `'9\tZ'` → `undefined`). CLI test with fake `hc` and `herdr-app` on `FORGE_SHOW_PATH_FIRST` (as in Task 4; `hc run` prints `{"address":"t9"}`, `hc get` exits 0; the fake `herdr-app`, on `do mod.open`, also copies the `id` from `$FORGE_SHOW_DIR/request.json` into `$FORGE_SHOW_DIR/ack.json` using `node -e`): a one-`choice`-block view prints the asks-only result, `request.json` has `floats[0].terminal === 't9'` and `floats[0].key === 'show-t9'`, and the log shows `mod.open` exactly once. Second case: the fake `herdr-app` writes no ack → the output is the `could not open the question window` deny and the log shows `hc kill t9`. (For that case set `FORGE_SHOW_ACK_MS=300`: `open` reads the ack timeout from that variable, default 3000, so the test does not wait 3 s.)
- **Live check:** `printf '%s' '{"pane":"t5-check","title":"Pick one","blocks":[{"type":"choice","prompt":"Which colour?","options":[{"label":"Red","value":"r","preview":"warm"},{"label":"Blue","value":"b","preview":"cool"}]}]}' | node show/show.mjs open`. A float opens with a preview column; the human clicks it and picks Blue. The session receives `In the t5-check pane I chose "Blue" (value: b) for: Which colour?`. This step needs the human: say so and wait.
- **Verify:** `node --test show/show.test.mjs`, and the live message arrives.

## Task 6
**The Claude Code tool (`hooks/show.js`)**

- **Exists because:** without a registered tool and the "Drawing results" prompt section the model does not draw unprompted, which is the behaviour being kept.
- **Model:** sonnet
- **Files:** create `hooks/show.js`; edit `hooks/hooks.json`.
- **Consumes:** the `open` CLI contract (Task 4). It imports nothing: a hooks module cannot use Node, and a sibling-folder import is unproven, so the three-line `commandsOf` lives here.
- **Steps:**
  1. `hooks/hooks.json`: add a top-level `"modules": ["./show.js"]` beside the existing `"hooks"` key. Change nothing else.
  2. `hooks/show.js` (complete):
     ```js
     // forge's show tool for Claude Code: registers mcp__forge__show, hands each call to show/show.mjs, and tells the
     // model to draw without being asked. Only inside the Herdr desktop app (HC_TERMINAL_ID): elsewhere it does nothing.
     const TOOL = 'mcp__forge__show'
     const PATHS = 'PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"'
     const SPEC = {
       name: 'show',
       description: [
         'Draws charts, figures, tables, diagrams, pictures, diffs, logs or a question beside this session in the Herdr app. ',
         'Reach for it on your own, unasked, whenever an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a funnel, a process, an architecture or an exchange: draw it here instead of a markdown table or ASCII art, and keep the text answer to what it means. ',
         'Blocks: {type:"stats", items:[{label, value, note?, delta?, good?, spark?:[numbers]}]} for headline figures as tiles (good: whether the delta is good news); ',
         '{type:"chart", kind:"line"|"area"|"bar"|"donut", columns, rows, x?, y?:[columns], stacked?, percent?, horizontal?, unit?} (rows as arrays; line or area over time, bar for categories, horizontal:true for rankings and long names, stacked:true or percent:true for parts of a whole per category, donut for one whole split in a few parts); ',
         '{type:"table", columns, rows}; a chart or table can instead take command:<shell printing JSON, either {columns, rows} or a list of row objects> with every:<seconds, at least 5, default 60> to refresh itself; ',
         '{type:"flow", nodes:[{id, label, kind?:"box"|"round"|"decision"}], edges:[{from, to, label?}], direction?:"down"|"right"}; ',
         '{type:"sequence", actors?:[...], messages:[{from, to, label, reply?} | {note, over}]}; {type:"mermaid", text}; diagrams can be zoomed and dragged in the pane; ',
         '{type:"image", path|url, caption?}; {type:"compare", before, after} for two screenshots; {type:"diff", repo:<absolute path>, base?} or {type:"diff", patch}; {type:"markdown", text}; ',
         '{type:"log", command, every?, lines?} runs a command in its own terminal pane below the session (with every: re-runs it and shows the last lines); ',
         '{type:"choice", prompt?, options:[{label, value?, preview?}]} or {type:"confirm", summary, consequence?, confirm_label?} asks in a floating window, and the answer reaches you as the person\'s next message. ',
         'Any block takes a title. The same pane name updates the same pane.',
       ].join(''),
       inputSchema: {
         type: 'object',
         properties: {
           pane: { type: 'string', description: 'A short name such as quota-chart (lowercase letters, digits, dashes); the same name updates the same pane' },
           title: { type: 'string' },
           placement: { type: 'string', enum: ['right', 'down'], description: 'Where a new pane opens: right of this session (default) or below it' },
           blocks: { type: 'array', items: { type: 'object', properties: { type: { type: 'string', enum: ['markdown', 'stats', 'table', 'chart', 'flow', 'sequence', 'mermaid', 'image', 'compare', 'diff', 'log', 'choice', 'confirm'] } }, required: ['type'] } },
         },
         required: ['pane', 'title', 'blocks'],
       },
       isDeferred: false,
     }
     const DRAWING = {
       id: 'forge:drawing',
       scope: 'session',
       text: [
         '# Drawing results',
         `Whenever an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a process, an architecture or an exchange between parts, draw it with ${TOOL} in the pane beside the session, without being asked: figures as a stats block, numbers as charts, structure as flow, Mermaid or sequence blocks. Keep the written answer to what the picture means.`,
         `Do not write an HTML page to open in a browser, nor publish a page or an artifact, to show results: those are the fallback for what ${TOOL} cannot draw (call it first with what it can), or for when the person asks for a page or a link to share.`,
       ].join('\n'),
     }

     const inApp = async ($) => Boolean(await $.env.get('HC_TERMINAL_ID').catch(() => undefined))
     // The same rule as show/blocks: a block with a command runs it. Kept here because a hooks module imports nothing.
     const commandsOf = (blocks) => blocks.map((b) => b?.command).filter((c) => typeof c === 'string' && c.trim() !== '')

     export function register(on) {
       on('session.start', async ($, e, next) => {
         if (await inApp($)) await $.tool.register(SPEC).catch(() => undefined)
         return next(e)
       })

       // A view that runs commands asks first; the rest only writes forge's cache and splits a pane.
       // If the blocks cannot be found on the event, ask: never allow what could not be inspected.
       on('tool.check', { tool: TOOL }, async (_$, e) => {
         const blocks = Array.isArray(e?.input?.blocks) ? e.input.blocks : Array.isArray(e?.blocks) ? e.blocks : undefined
         if (!blocks) return { decision: 'ask', reason: 'forge show could not read this call’s blocks to check for commands.' }
         const commands = commandsOf(blocks)
         return commands.length > 0 ? { decision: 'ask', reason: `The pane will run: ${commands.join(' ; ')}` } : { decision: 'allow' }
       })

       on('tool.call', { tool: TOOL }, async ($, e) => {
         const view = { pane: e.pane, title: e.title, blocks: e.blocks, placement: e.placement, terminal: await $.env.get('HC_TERMINAL_ID'), cwd: await $.session.cwd() }
         const done = await $.process.run(['sh', '-c', `${PATHS} exec node "$1" open`, 'sh', `${$.plugin.root}/show/show.mjs`], { stdin: JSON.stringify(view), timeoutMs: 30_000 })
         const line = done.stdout.trim().split('\n').pop() ?? ''
         try {
           const out = JSON.parse(line)
           if (typeof out.deny === 'string') return { deny: out.deny }
           if (typeof out.result === 'string') return { result: out.result }
         } catch { /* fall through */ }
         return { deny: `forge show failed: ${(done.stderr || done.stdout || 'no output').trim().slice(0, 400)}` }
       })

       on('prompt.compose', async ($, e, next) => {
         const composed = await next(e)
         if (!(await inApp($))) return composed
         return { ...composed, sections: [...composed.sections.filter((s) => s.id !== DRAWING.id), DRAWING] }
       })
     }
     ```
     Before relying on it, confirm these against the engine's types (`F=$(ls /private/tmp/claude-501/bundled-skills/*/*/plugin-authoring/types/claude-code.d.ts | head -1)`; if nothing matches, load the `plugin-authoring` skill, which writes it): `$.plugin.root` (`/usr/bin/grep -n "root: string" "$F"`), `$.env.get` returning a promise (`/usr/bin/grep -n "get: (name: string) => Promise" "$F"`), `stdin`/`timeoutMs` in `ProcessRunInit`, and where `tool.check`'s input carries the tool arguments (`/usr/bin/grep -n "export type ToolCheckInput" -A12 "$F"`). If a name differs, use the name the types give and note it in the PR.
  3. `claude plugin validate .` must pass (the icon warning is expected and not a failure).
  4. Live check (a fresh Claude Code process that loads this worktree as the plugin; run it in the Herdr app so `HC_TERMINAL_ID` is inherited):
     ```bash
     claude --plugin-dir "$PWD" -p 'Call the tool mcp__forge__show once with pane "t6-check", title "Task 6", and one stats block with two items. Then reply with exactly the tool result text.' --allowedTools 'mcp__forge__show'
     ```
     Expected output contains `Opened the t6-check pane beside this session.` and a page pane appears. Then prove the command gate is not fail-open: run the same with a prompt asking for one `log` block with command `echo hi` and WITHOUT `--allowedTools`; in `-p` mode a tool that needs asking is refused, so the output must NOT contain `Opened the`, and no log pane appears. If `claude` rejects a flag, run `claude --help`, use the equivalent flags, and record the working commands in the PR. If the installed forge plugin (0.4.x, without the module) shadows the dev copy so that the tool is missing, or the module fails to load, stop and report: do not edit the user's installed plugins.
- **Verify:** `claude plugin validate .` passes; both live runs behave as described.

## Task 7
**Docs, lens, release checks**

- **Exists because:** `AGENTS.md` says forge is "skills + one hook + one pi extension", which would now be false, and `scripts/publish.sh` would ship the script untested.
- **Model:** sonnet
- **Files:** edit `AGENTS.md`, `README.md`, `.claude/dev-loop.md`, `scripts/publish.sh`.
- **Steps:**
  1. `AGENTS.md`: change the first paragraph to say forge is skills, one hook, one pi extension, a Herdr mod and a show tool. Add one bullet: "`show/` is the show tool: `show.mjs` (CLI: `open`, `serve`, `log`, `pick`, `preview`), `blocks.mjs` (validation), `page.mjs` (the themed page, adapted from cockpit, see `show/THIRD_PARTY_NOTICES.md`). `hooks/show.js` is the Claude Code hooks module that registers `mcp__forge__show` and adds the Drawing results prompt section; it imports nothing and does nothing outside the Herdr desktop app. `herdr/mods/forge-show` exports the theme and opens floating windows for it. Test: `node --test show/*.test.mjs` (not `show/`: Node 22 reads that as a file)." Add the same command to the existing Test bullet.
  2. `README.md`: after the "Herdr work panel" section add a short "Show" section: what it draws, that it needs the Herdr desktop app, `terminal-browser` and (for choice/confirm) `fzf`, that `bash scripts/install-herdr-mod.sh` links the `forge-show` helper mod, that page libraries load from jsdelivr, and that it is on for every Claude Code session inside the Herdr app (no `routing: on` needed).
  3. `.claude/dev-loop.md`, invariants lens: after "the hook does nothing without opt-in" add "(the routing hook; the show module is separate, owner-approved on 2026-11-21, and acts only when `HC_TERMINAL_ID` is set)"; append to the list "`hooks/show.js` imports nothing and asks before any view with a `command`; `herdr-app mod.open forge-show` is called at most once per show call, under the lock".
  4. `scripts/publish.sh`: after the `bash hooks/session-start.test.sh` line add `node --test show/*.test.mjs`; extend the mod check to `herdr-app check herdr/mods/forge && herdr-app check herdr/mods/forge-show` inside the existing `command -v herdr-app` guard.
- **Verify:** `node --test show/*.test.mjs && bash hooks/session-start.test.sh && [ "$(/usr/bin/grep -c 'node --test show/\*.test.mjs' scripts/publish.sh)" = 1 ] && bash -n scripts/publish.sh`

## Task 8
**End-to-end check and cleanup**

- **Exists because:** `herdr-app check` and unit tests pass on a mod or page that does not draw (`docs/learnings.md:39-40`); only a live run proves it, and Tasks 3-6 left test panes, cache files and a temporary symlink behind.
- **Model:** sonnet
- **Files:** none in the repo.
- **Steps:**
  1. Run the whole-feature verify command from the header.
  2. Ask the human to pick another theme in Herdr's settings, call `open` with a new pane name, and confirm from `herdr-app shot` that the page's background follows the new theme. Ask them to switch back.
  3. In a page with a flow block of 20 or more nodes, confirm with the human that + / − / Fit, drag, and ctrl+wheel work inside the terminal-browser pane. If wheel or drag does not reach the page, the buttons must still work: report exactly which inputs fail in the PR rather than removing the handlers.
  4. Two calls at once: run two `open` commands in the background in one shell line (`… | node show/show.mjs open & … | node show/show.mjs open & wait`), one with a `choice` block and one with a `stats` block, after `rm ~/.cache/forge/show/theme.json`. Both print a `result`, the float appears, and `~/.cache/forge/show/lock` does not exist afterwards.
  5. Close every pane recorded in the `panes` of each `~/.cache/forge/show/*-t4-check.json`, `*-t5-check.json`, `*-t6-check.json` and any from steps 2-4 (`herdr-app do pane.close --pane <id>`; ignore "no such pane"). Remove those files and their `.html`/`.v.js`.
  6. Remove the temporary link: `[ "$(readlink ~/.config/herdr-app/mods/forge-show)" = "$PWD/herdr/mods/forge-show" ] && rm ~/.config/herdr-app/mods/forge-show`. Only remove it when it points at this worktree.
  7. Put in the PR description, under "After merge": (a) run `bash scripts/install-herdr-mod.sh` from the main checkout (links `forge-show` there); (b) publish, restart Claude Code; (c) Codex shares `hooks/hooks.json`, which now has a `modules` key Codex has not been tested against: start Codex once in a `routing: on` repo and confirm the dev-loop routing text still appears, and if it does not, report it before using the release; (d) use forge's show for real, and only then uninstall cockpit (the owner's step).
- **Verify:** the header's verify command exits 0; `herdr-app status | jq -e '(.errors|length)==0'`; `[ ! -e ~/.config/herdr-app/mods/forge-show ]`; `[ ! -e ~/.cache/forge/show/lock ]`.
