# Plan: Forge show in OpenMausBot

- **Goal:** bots in the OpenMausBot chat client can draw the same blocks as Forge show (stats, charts, tables, flow, sequence, Mermaid, pictures, diffs, markdown) as a chat card. A new `page` subcommand of `show/show.mjs` writes a page folder with no Herdr calls; a personal skill, `forge-show`, tells the bot to run it and then call OpenMausBot's own `show_html` tool on the folder.
- **Design:** `docs/decisions/2026-11-23-show-in-openmausbot.md`
- **Branch:** `feat/show-in-openmausbot`
- **Verify (whole feature):** `node --test show/*.test.mjs && bash hooks/session-start.test.sh`

## Background a fresh implementer needs

- Repo layout (see `AGENTS.md`): `show/show.mjs` is the show CLI (`open`, `serve`, `log`, `pick`, `preview`), `show/blocks.mjs` validates a view (`specError`, `PAGE`, `TYPES`), `show/page.mjs` builds the HTML (`pageBlocks`, `pageHtml`, `palette`). Tests are `node:test` files run as `node --test show/*.test.mjs` (never `node --test show/`: Node 22 reads that as a file).
- A **view** is `{ pane, title, blocks, placement?, terminal?, cwd? }`. `pane` matches `/^[a-z0-9][a-z0-9-]{0,39}$/` (checked by `specError`), so it is safe as a folder name.
- `PAGE` (in `show/blocks.mjs`) is the list of block types drawn on the HTML page: `markdown, stats, table, chart, flow, sequence, mermaid, image, compare, diff`. `log`, `choice`, `confirm` are Herdr-only.
- OpenMausBot facts, checked live with a bot on 2026-11-23 (the implementer cannot re-check them; do not change what depends on them):
  - Its `show_html` tool takes `path` (a folder **inside the bot's working folder** holding `index.html`), `title`, `live` (true reloads the card when the folder changes) and `app_id`. A folder outside the working folder is refused. A hidden folder given as the relative path `.forge-show/<name>` is accepted.
  - A page built by `pageHtml` renders in that card unchanged.
  - Bots load the person's skills from `~/.claude/skills`. Forge's Claude plugin (tool and plugin skills) does **not** load in a bot's turn.
  - The bot's shell ran `node "$HOME/.claude/skills/<folder>/<file>.mjs" .forge-show/<name>.json` exactly as written, with no refusal. Keep the skill's command in that plain form (no `$(...)`, no backticks, no heredoc: a more complex command was refused once).
- The page polls `<stem>.v.js` beside itself and reloads when the version changes (`show/page.mjs`), so `index.html` needs `index.v.js` in the same folder.
- The OpenMausBot repository URL used in the README, `https://github.com/milind-soni/OpenMausBot`, was read from the `origin` remote of the owner's checkout.
- Repo rule (`AGENTS.md`): no AI attribution in commits or PR bodies. The repo is public: no machine names and no local absolute paths in the PR body.
- **Not built, and why (do not add it):** an allow-list of picture extensions or folders for `image`/`compare` paths. A view could name any readable file, which is then copied into the page folder. The bot that writes the view already has a shell that can copy the same file, so the check would stop nothing.

## Task 1
**`show.mjs page`: write a page folder, nothing from Herdr**

- **Exists because:** `open` cannot run outside the Herdr desktop app (it needs `HC_TERMINAL_ID`, `herdr-app ls`, a pane split), so a bot has nothing to produce the page with.
- **Model:** sonnet
- **Files:** `show/show.mjs`, `show/show.test.mjs`
- **Interfaces produced for Task 2:**
  - CLI: `node show/show.mjs page [FILE]` reads a view as JSON from `FILE`, or from stdin when no file is given, and prints one JSON line: `{"result": "..."}` or `{"deny": "..."}`. Exit code 0 in both cases (same as `open`).
  - `export async function main(argv)` (today `main` is not exported).
  - `export function pageFolder(view, cwd = process.cwd())`.
  - Output on disk, always in the **process's working folder** (a view's `cwd` does not move it; `view.cwd` is only passed on to `buildPage`, as `open` does): `.forge-show/.gitignore` (content `*\n`, written only when missing), `.forge-show/<pane>/index.html`, `.forge-show/<pane>/index.v.js`, and copied pictures named `p<n>-<hash><ext>`, `p<n>-before-<hash><ext>`, `p<n>-after-<hash><ext>`, where `<n>` is the block's index in `view.blocks`, `<hash>` is the first 8 hex characters of the SHA-1 of the picture's bytes, and `<ext>` is the source file's extension when it matches `/^\.[A-Za-z0-9]{1,5}$/`, else empty.
  - Result text. First write of a folder: `Wrote the page folder .forge-show/<pane>. Now call show_html with path ".forge-show/<pane>", live true and a title.` Any later write (when `index.html` already existed): `Updated the page folder .forge-show/<pane>. A live card of it reloads by itself. Only if this conversation has no card for it, call show_html with path ".forge-show/<pane>", live true and a title.`

### Steps

1. **Tests first**, appended to `show/show.test.mjs`. It already defines `SHOW`, `tmp()`, and the `stats` view (`{ pane: 'chk', title: 't', blocks: [{ type: 'stats', items: [{ label: 'A', value: 1 }] }] }`); reuse them. Its `node:fs` import already has `mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, statSync, utimesSync`: **add `mkdirSync`** to it. Add this helper and these tests:

```js
const page = (view, { cwd = tmp(), env = {}, args = [], stdin = JSON.stringify(view) } = {}) => {
  const r = spawnSync('node', [SHOW, 'page', ...args], { input: stdin, encoding: 'utf8', cwd, env: { ...process.env, ...env } })
  return { ...r, cwd, out: r.stdout.trim() ? JSON.parse(r.stdout.trim().split('\n').pop()) : undefined }
}

test('page writes a folder in the working folder and calls nothing from Herdr', () => {
  const bin = tmp()
  const log = join(bin, 'log')
  for (const name of ['herdr-app', 'hc', 'terminal-browser']) { writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n`); chmodSync(join(bin, name), 0o755) }
  const r = page({ ...stats, cwd: tmp() }, { env: { FORGE_SHOW_PATH_FIRST: bin, HC_TERMINAL_ID: '' } })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.out.result, 'Wrote the page folder .forge-show/chk. Now call show_html with path ".forge-show/chk", live true and a title.')
  const dir = join(r.cwd, '.forge-show', 'chk')
  assert.match(readFileSync(join(dir, 'index.html'), 'utf8'), /index\.v\.js/)
  assert.match(readFileSync(join(dir, 'index.v.js'), 'utf8'), /^window\.__v="[0-9a-f]{12}"$/)
  assert.equal(readFileSync(join(r.cwd, '.forge-show', '.gitignore'), 'utf8'), '*\n')
  assert.ok(!existsSync(log), 'no Herdr program may run')
})

test('page reads the view from a file argument', () => {
  const file = join(tmp(), 'view.json')
  writeFileSync(file, JSON.stringify(stats))
  const r = page(stats, { args: [file], stdin: '' })
  assert.match(r.out.result, /^Wrote the page folder/)
  assert.ok(existsSync(join(r.cwd, '.forge-show', 'chk', 'index.html')))
})

test('page denies a block a folder cannot hold and writes nothing; it denies bad specs, bad JSON and an unreadable file', () => {
  const view = (block) => ({ pane: 'a', title: 'T', blocks: [{ type: 'stats', items: [{ label: 'A', value: 1 }] }, block] })
  const denied = page(view({ type: 'log', command: 'date' }))
  assert.match(denied.out.deny, /^at blocks\[1\]: a page folder cannot hold a log block/)
  assert.ok(!existsSync(join(denied.cwd, '.forge-show')), 'a refused block type writes nothing')
  assert.match(page(view({ type: 'choice', options: [{ label: 'a' }, { label: 'b' }] })).out.deny, /cannot hold a choice block/)
  assert.match(page(view({ type: 'confirm', summary: 's' })).out.deny, /cannot hold a confirm block/)
  assert.match(page(view({ type: 'table', command: 'echo []' })).out.deny, /^at blocks\[1\]: a page folder cannot run a command/)
  assert.match(page({ pane: 'Bad Name', title: 'T', blocks: [] }).out.deny, /^at /)
  assert.equal(page(stats, { stdin: '{' }).out.deny, 'the view is not valid JSON.')
  assert.match(page(stats, { args: [join(tmp(), 'missing.json')], stdin: '' }).out.deny, /^cannot read /)
})

test('page denies, with exit 0, when .forge-show cannot be a folder', () => {
  const cwd = tmp()
  writeFileSync(join(cwd, '.forge-show'), 'a file in the way')
  const r = page(stats, { cwd })
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.out.deny, /^cannot write \.forge-show\/chk: /)
})

const PICTURE = /^p\d+(-before|-after)?-[0-9a-f]{8}(\.[A-Za-z0-9]{1,5})?$/

test('page copies local pictures beside the page and never writes a file URL', () => {
  const pics = join(tmp(), 'my pics')
  mkdirSync(pics)
  for (const name of ['one #1.png', 'before.jpg', 'after']) writeFileSync(join(pics, name), name)
  const view = { pane: 'pics', title: 'T', blocks: [
    { type: 'image', path: join(pics, 'one #1.png'), caption: 'c' },
    { type: 'compare', before: join(pics, 'before.jpg'), after: join(pics, 'after') },
    { type: 'image', url: 'https://example.com/x.png' },
  ] }
  const r = page(view)
  assert.match(r.out.result, /^Wrote the page folder/)
  const dir = join(r.cwd, '.forge-show', 'pics')
  const copied = readdirSync(dir).filter((n) => PICTURE.test(n)).sort()
  assert.equal(copied.length, 3)
  const [one, after, before] = [copied.find((n) => /^p0-[0-9a-f]{8}\.png$/.test(n)), copied.find((n) => /^p1-after-[0-9a-f]{8}$/.test(n)), copied.find((n) => /^p1-before-[0-9a-f]{8}\.jpg$/.test(n))]
  assert.equal(readFileSync(join(dir, one), 'utf8'), 'one #1.png')
  assert.equal(readFileSync(join(dir, before), 'utf8'), 'before.jpg')
  assert.equal(readFileSync(join(dir, after), 'utf8'), 'after')
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  assert.doesNotMatch(html, /file:\/\//)
  assert.ok(html.includes(`"url":"${one}"`))
  assert.ok(html.includes(`"before":"${before}"`))
  assert.ok(html.includes(`"after":"${after}"`))
  assert.match(html, /https:\/\/example\.com\/x\.png/)
})

test('page shows a re-rendered picture: new name, new version, the old copy removed', () => {
  const cwd = tmp()
  const plot = join(tmp(), 'plot.png')
  const view = { pane: 'plot', title: 'T', blocks: [{ type: 'image', path: plot }] }
  const dir = join(cwd, '.forge-show', 'plot')
  writeFileSync(plot, 'first')
  page(view, { cwd })
  const first = readdirSync(dir).filter((n) => PICTURE.test(n))
  const version = readFileSync(join(dir, 'index.v.js'), 'utf8')
  writeFileSync(plot, 'second')
  page(view, { cwd })
  const second = readdirSync(dir).filter((n) => PICTURE.test(n))
  assert.equal(second.length, 1)
  assert.notEqual(second[0], first[0])
  assert.equal(readFileSync(join(dir, second[0]), 'utf8'), 'second')
  assert.notEqual(readFileSync(join(dir, 'index.v.js'), 'utf8'), version)
})

test('page denies a picture it cannot read', () => {
  const r = page({ pane: 'gone', title: 'T', blocks: [{ type: 'image', path: join(tmp(), 'nope.png') }] })
  assert.match(r.out.deny, /^at blocks\[0\]: could not copy the picture/)
})

test('page leaves an unchanged page alone, rewrites a changed one, and says a later write is an update', () => {
  const cwd = tmp()
  page(stats, { cwd })
  const html = join(cwd, '.forge-show', 'chk', 'index.html')
  const vjs = join(cwd, '.forge-show', 'chk', 'index.v.js')
  const old = new Date(Date.now() - 60_000)
  utimesSync(html, old, old)
  utimesSync(vjs, old, old)
  // Read the times back: utimes does not store a whole-millisecond Date exactly on APFS.
  const stamped = { html: statSync(html).mtimeMs, vjs: statSync(vjs).mtimeMs }
  const again = page(stats, { cwd })
  assert.equal(again.out.result, 'Updated the page folder .forge-show/chk. A live card of it reloads by itself. Only if this conversation has no card for it, call show_html with path ".forge-show/chk", live true and a title.')
  assert.equal(statSync(html).mtimeMs, stamped.html, 'an unchanged page is not rewritten')
  assert.equal(statSync(vjs).mtimeMs, stamped.vjs)
  const before = readFileSync(vjs, 'utf8')
  page({ ...stats, title: 'changed' }, { cwd })
  assert.notEqual(readFileSync(vjs, 'utf8'), before)
  assert.notEqual(statSync(html).mtimeMs, stamped.html)
})
```

   Notes on these tests:
   - The first test passes a `cwd` in the view on purpose: the folder must still land in the process's working folder (`r.cwd`), not in `view.cwd`.
   - `pageHtml` embeds the blocks as JSON in the page (`const data = js({ title, blocks, palette })` in `show/page.mjs`, where `js` is `JSON.stringify` plus a `<` escape), which is why `"url":"<name>"` appears literally.

   Run `node --test show/*.test.mjs`: every new test must fail because `page` is an unknown subcommand (it prints nothing, so `r.out` is undefined and the first `r.out.` access throws). If one fails for another reason (for example a missing import), fix the test first.

2. **Implementation** in `show/show.mjs`:

   a. Imports: add `extname` to the `node:path` import. (`createHash`, `readFileSync`, `writeFileSync`, `mkdirSync`, `rmSync`, `readdirSync`, `existsSync`, `resolve`, `join` are already imported; `first200`, `put`, `runShell`, `PAGE`, `specError` are already in scope.)

   b. `buildPage` (around line 59) takes an optional stem so a page can be built without a terminal. Change its signature and the one line that names the stem; nothing else:

```js
export function buildPage(view, themeFile, { run, data, stem }) {
  // ...unchanged...
  const render = (version) => pageHtml({ stem: stem ?? stemOf(view.terminal, view.pane), title: view.title, blocks, palette: palette(themeFile), version })
```

   c. Add after `writePage`. The function is named `pageFolder`, not `page`: `open` already has a local `const { page, logs, asks } = plan(view)`.

```js
// A picture the card can load: copied beside index.html, because a chat card cannot read file:// URLs.
// Its name carries its content, so a picture rendered again under the same path changes the page and the live card reloads.
function bring(dir, ref, name, kept) {
  if (!ref.startsWith('/')) return ref
  const bytes = readFileSync(ref)
  const ext = /^\.[A-Za-z0-9]{1,5}$/.test(extname(ref)) ? extname(ref) : ''
  const file = `${name}-${createHash('sha1').update(bytes).digest('hex').slice(0, 8)}${ext}`
  writeFileSync(join(dir, file), bytes)
  kept.add(file)
  return file
}

// The OpenMausBot route: the same page as a folder for its show_html card. Nothing here calls Herdr or reads its theme.
// The folder is always in the process's working folder: show_html refuses a folder outside the bot's own.
export function pageFolder(view, cwd = process.cwd()) {
  const bad = specError(view)
  if (bad) return { deny: bad }
  const off = view.blocks.findIndex((b) => !PAGE.includes(b.type) || b.command)
  if (off >= 0) {
    const b = view.blocks[off]
    return { deny: `at blocks[${off}]: ` + (PAGE.includes(b.type) ? 'a page folder cannot run a command: run it yourself and pass columns and rows.' : `a page folder cannot hold a ${b.type} block (log, choice and confirm are Herdr only).`) }
  }
  const root = join(resolve(cwd), '.forge-show')
  const dir = join(root, view.pane)
  const rel = '.forge-show/' + view.pane
  const existed = existsSync(join(dir, 'index.html'))
  try {
    mkdirSync(dir, { recursive: true })
    if (!existsSync(join(root, '.gitignore'))) put(join(root, '.gitignore'), '*\n')
  } catch (e) { return { deny: `cannot write ${rel}: ${first200(e)}` } }
  const kept = new Set()
  const blocks = []
  for (const [n, b] of view.blocks.entries()) {
    try {
      if (b.type === 'image' && typeof b.path === 'string') {
        const { path: from, ...rest } = b
        blocks.push({ ...rest, url: bring(dir, from, 'p' + n, kept) })
      } else if (b.type === 'compare') blocks.push({ ...b, before: bring(dir, b.before, `p${n}-before`, kept), after: bring(dir, b.after, `p${n}-after`, kept) })
      else blocks.push(b)
    } catch (e) { return { deny: `at blocks[${n}]: could not copy the picture: ${first200(e)}` } }
  }
  try {
    const { version, html } = buildPage({ ...view, blocks, cwd: view.cwd ?? resolve(cwd) }, undefined, { run: runShell, data: {}, stem: 'index' })
    const stamp = 'window.__v=' + JSON.stringify(version)
    let same = false
    try { same = existed && readFileSync(join(dir, 'index.v.js'), 'utf8') === stamp } catch { /* no version file yet */ }
    if (!same) {
      put(join(dir, 'index.html'), html)
      put(join(dir, 'index.v.js'), stamp)
    }
    // Pictures an earlier version of this drawing used.
    for (const name of readdirSync(dir)) {
      if (/^p\d+(-before|-after)?-[0-9a-f]{8}(\.[A-Za-z0-9]{1,5})?$/.test(name) && !kept.has(name)) rmSync(join(dir, name), { force: true })
    }
  } catch (e) { return { deny: `cannot write ${rel}: ${first200(e)}` } }
  const show = `call show_html with path "${rel}", live true and a title.`
  return { result: existed ? `Updated the page folder ${rel}. A live card of it reloads by itself. Only if this conversation has no card for it, ${show}` : `Wrote the page folder ${rel}. Now ${show}` }
}
```

   What holds, and what does not: a spec error or a refused block type returns before anything is written. A picture that cannot be read returns after the folder (and any earlier pictures) was created; that half-written folder is harmless and is completed by the next good write.

   d. `main`: export it, and add the `page` branch. Replace the `open` branch's parsing so both share it:

```js
export async function main([cmd, ...args]) {
  if (cmd === 'open' || cmd === 'page') {
    let text
    try { text = readFileSync(cmd === 'page' && args[0] ? args[0] : 0, 'utf8') } catch { return console.log(JSON.stringify({ deny: `cannot read ${cmd === 'page' && args[0] ? args[0] : 'the view on stdin'}.` })) }
    let view
    try { view = JSON.parse(text) } catch { return console.log(JSON.stringify({ deny: 'the view is not valid JSON.' })) }
    console.log(JSON.stringify(cmd === 'open' ? open(view) : pageFolder(view)))
  } else if (cmd === 'serve') await serve(args[0])
  // ...the remaining branches unchanged...
```

   `open` keeps reading stdin only. The one change for `open`: an unreadable stdin now prints a deny line where it used to throw. The existing `open` tests must pass unchanged.

3. Run `node --test show/*.test.mjs`. All tests pass, old and new.

- **Verify:** `node --test show/*.test.mjs`

## Task 2
**The `forge-show` skill, its launcher, the install script, and the docs**

- **Exists because:** Forge's plugin does not load in an OpenMausBot bot's turn, so without a personal skill the bot never learns that `show.mjs page` exists or that `show_html` shows its output.
- **Model:** sonnet
- **Files (new):** `openmausbot/forge-show/SKILL.md`, `openmausbot/forge-show/page.mjs`, `scripts/install-openmausbot-skill.sh`, `show/skill.test.mjs`. **Files (edited):** `hooks/show.js` (one comment), `AGENTS.md`, `README.md`.
- **Interfaces consumed from Task 1:** `export async function main(argv)` in `show/show.mjs`; the `page` subcommand's result text and folder layout.
- **Why the skill sits in `openmausbot/` and not `skills/`:** every packaging (Claude plugin default, `.codex-plugin/plugin.json` `"skills": "./skills/"`, `package.json` `pi.skills`) loads only `skills/`. Inside the Herdr app the typed tool `mcp__forge__show` already exists; a plugin skill beside it would duplicate it. Do not name the folder `.claude/skills` or `.agents/skills` either (both are auto-loaded).
- **Why a launcher file:** the bot runs one fixed, plain command, `node "$HOME/.claude/skills/forge-show/page.mjs" FILE`. `~/.claude/skills/forge-show` is a symlink into the checkout; Node resolves the entry file's real path, so the launcher's relative import reaches the checkout's `show/show.mjs` (checked with a real symlink and a home folder with a space in its name). A path like `.../forge-show/../../show/show.mjs` does not work: Node normalises `..` before following the link. The entry guard at the bottom of `show.mjs` does not fire on import (`process.argv[1]` is the launcher), so `main` runs once, from the launcher.
- **Accepted duplication:** the skill repeats the "when to draw" rule and the block shapes from `SPEC` and `DRAWING` in `hooks/show.js`. A bot cannot read that file's tool description, so the text has to exist twice. Step 5 adds a comment at the source; the test in step 1 fails if a page block type is missing from the skill.

### Steps

1. **Test first:** create `show/skill.test.mjs` (it lives in `show/` because `scripts/publish.sh` runs only `node --test show/*.test.mjs`):

```js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readlinkSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGE } from './blocks.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
const INSTALL = join(ROOT, 'scripts/install-openmausbot-skill.sh')
const SKILL = readFileSync(join(ROOT, 'openmausbot/forge-show/SKILL.md'), 'utf8')
const COMMAND = 'node "$HOME/.claude/skills/forge-show/page.mjs"'
// A home with a space in it: the commands a skill ships must survive one.
const home = () => { const h = join(mkdtempSync(join(tmpdir(), 'forge-skill-')), 'my home'); mkdirSync(h); return h }
const install = (HOME) => spawnSync('bash', [INSTALL], { encoding: 'utf8', env: { ...process.env, HOME } })

test('the skill names the command, show_html and every page block type', () => {
  assert.ok(SKILL.includes(COMMAND), 'SKILL.md must carry the exact command the test runs')
  assert.match(SKILL, /^---\nname: forge-show\ndescription: .+\n---\n/)
  assert.match(SKILL, /show_html/)
  for (const type of PAGE) assert.ok(SKILL.includes(`type:"${type}"`), `SKILL.md does not describe ${type}`)
  for (const type of ['log', 'choice', 'confirm']) assert.ok(!SKILL.includes(`type:"${type}"`), `${type} is Herdr only`)
})

test('install links the skill, is idempotent, and moves a real folder aside', () => {
  const HOME = home()
  const dst = join(HOME, '.claude/skills/forge-show')
  const first = install(HOME)
  assert.equal(first.status, 0, first.stderr)
  assert.equal(readlinkSync(dst), join(ROOT, 'openmausbot/forge-show'))
  const second = install(HOME)
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /already linked/)

  const HOME2 = home()
  mkdirSync(join(HOME2, '.claude/skills/forge-show'), { recursive: true })
  writeFileSync(join(HOME2, '.claude/skills/forge-show/keep.txt'), 'mine')
  assert.equal(install(HOME2).status, 0)
  assert.equal(readlinkSync(join(HOME2, '.claude/skills/forge-show')), join(ROOT, 'openmausbot/forge-show'))
  const backups = readdirSync(join(HOME2, '.claude')).filter((n) => n.startsWith('forge-show-skill.bak-'))
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(HOME2, '.claude', backups[0], 'keep.txt'), 'utf8'), 'mine')
  assert.deepEqual(readdirSync(join(HOME2, '.claude/skills')), ['forge-show'], 'the backup must not sit in skills/, where it would load as a second skill')
})

test("the skill's command, run through the link, writes the page folder", () => {
  const HOME = home()
  assert.equal(install(HOME).status, 0)
  const work = join(mkdtempSync(join(tmpdir(), 'forge-skill-')), 'work folder')
  mkdirSync(join(work, '.forge-show'), { recursive: true })
  writeFileSync(join(work, '.forge-show/sales.json'), JSON.stringify({ pane: 'sales', title: 'Sales', blocks: [{ type: 'stats', items: [{ label: 'A', value: 1 }] }] }))
  const r = spawnSync('sh', ['-c', COMMAND + ' .forge-show/sales.json'], { cwd: work, encoding: 'utf8', env: { ...process.env, HOME } })
  assert.equal(r.status, 0, r.stderr)
  assert.match(JSON.parse(r.stdout.trim()).result, /call show_html with path "\.forge-show\/sales"/)
  assert.ok(existsSync(join(work, '.forge-show/sales/index.html')))
})
```

   Run `node --test show/*.test.mjs`: the new file fails (no `SKILL.md` yet, so the top-level read throws).

2. **`openmausbot/forge-show/page.mjs`** (exactly this):

```js
// Run by path through the ~/.claude/skills/forge-show link. Node resolves this file's real place first,
// so the import below reaches the checkout's show tool whatever folder the bot is working in.
import { main } from '../../show/show.mjs'
await main(['page', ...process.argv.slice(2)])
```

3. **`scripts/install-openmausbot-skill.sh`** (mode 755; follows `scripts/install-herdr-mod.sh`: link, idempotent, a real folder is moved aside and never deleted):

```bash
#!/usr/bin/env bash
# Link the forge-show skill where OpenMausBot's bots (and any Claude Code session) load personal skills:
# ~/.claude/skills/forge-show -> openmausbot/forge-show in this checkout. Idempotent.
# Run it from the main checkout: a link into a worktree breaks when the worktree is removed.
# A real folder already there is moved out of skills/ (or it would load as a second skill), never deleted.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)/openmausbot/forge-show"
dst="$HOME/.claude/skills/forge-show"
[ -f "$src/SKILL.md" ] || { echo "install-openmausbot-skill: $src/SKILL.md missing" >&2; exit 1; }
mkdir -p "$(dirname "$dst")"
if [ -L "$dst" ]; then
  if [ "$(readlink "$dst")" = "$src" ]; then echo "install-openmausbot-skill: already linked"; exit 0; fi
  rm "$dst"
elif [ -e "$dst" ]; then
  mv "$dst" "$HOME/.claude/forge-show-skill.bak-$(date +%Y%m%d%H%M%S)"
fi
ln -s "$src" "$dst"
echo "install-openmausbot-skill: $dst -> $src"
```

4. **`openmausbot/forge-show/SKILL.md`** (exactly this; the frontmatter `description` is one line):

````markdown
---
name: forge-show
description: Draw charts, stat tiles, tables, flow and sequence diagrams, Mermaid, pictures, diffs or markdown as a card in an OpenMausBot chat. Use when you have a show_html tool and an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a process, an architecture or an exchange between parts. Not for a session that has the mcp__forge__show tool - use that tool there.
---

# Forge show, in an OpenMausBot chat

Whenever an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a process, an architecture or an exchange between parts, draw it as a card in the chat, without being asked: figures as a stats block, numbers as charts, structure as flow, Mermaid or sequence blocks. Keep the written answer to what the picture means. Do not hand-write an HTML page for what these blocks can draw.

If this session has a tool named `mcp__forge__show`, stop here and use that tool. This skill is for a session with a `show_html` tool.

## Draw

1. **Write the view** as JSON to `.forge-show/<name>.json` in your working folder, with your file tool. `<name>` is a short name for the drawing: lowercase letters, digits and dashes, at most 40 characters, starting with a letter or digit. Use the same `<name>` as the view's `pane`.

   ```json
   { "pane": "<name>", "title": "<the card's heading>", "blocks": [ ... ] }
   ```

2. **Build the page.** Run this from your working folder, exactly as written (no other quoting, no substitution):

   ```sh
   node "$HOME/.claude/skills/forge-show/page.mjs" .forge-show/<name>.json
   ```

   It prints one JSON line. `{"result": ...}` means the page is in `.forge-show/<name>/` and says what to do next. `{"deny": ...}` names what is wrong (`at blocks[2]: ...`): fix the view and run it again.

3. **Show it**, when the result says to: call `show_html` with `path` set to `.forge-show/<name>`, `live` set to true, and a `title` (one line, at most 80 characters).

To change a drawing, write the view again under the same `<name>` and run step 2 again. The live card reloads by itself, so do not call `show_html` again for it, unless this conversation has no card for that folder (a new conversation, or the person says the card is gone): then call it once, as in step 3. A different `<name>` makes a new card.

## Blocks

Any block takes an optional `title`.

- `{type:"stats", items:[{label, value, note?, delta?, good?, spark?:[numbers]}]}`: headline figures as tiles. `good` says whether the delta is good news.
- `{type:"chart", kind:"line"|"area"|"bar"|"donut", columns, rows, x?, y?:[columns], stacked?, percent?, horizontal?, unit?}`: rows are arrays. Line or area over time, bar for categories, `horizontal:true` for rankings and long names, `stacked:true` or `percent:true` for parts of a whole per category, donut for one whole split in a few parts.
- `{type:"table", columns, rows}`: at most 5000 rows.
- `{type:"flow", nodes:[{id, label, kind?:"box"|"round"|"decision"}], edges:[{from, to, label?}], direction?:"down"|"right"}`
- `{type:"sequence", actors?:[...], messages:[{from, to, label, reply?} | {note, over}]}`
- `{type:"mermaid", text}`
- `{type:"image", path|url, caption?}`: `path` is an absolute file path (the picture is copied into the page folder); `url` is http or https.
- `{type:"compare", before, after}`: two pictures side by side, each an absolute path or an http(s) URL.
- `{type:"diff", repo:<absolute path>, base?}` or `{type:"diff", patch}`
- `{type:"markdown", text}`

## Not here

- A table or chart cannot take a `command`: run the command yourself and pass `columns` and `rows`. To keep a drawing fresh, write its view again (for example from a schedule).
- There are no log, choice or confirm blocks: show command output as markdown or a table, and ask questions with the chat's own question tools.
- The page loads Chart.js and Mermaid from jsdelivr, so it needs a network connection.
````

5. **Source comment and docs.**
   - `hooks/show.js`: directly above the line `const SPEC = {` (or whatever line begins the `SPEC` definition), add this comment and nothing else. The file must still import nothing:

     `// The block shapes and the Drawing results rule below are repeated, for bots that cannot load this module, in openmausbot/forge-show/SKILL.md: change both.`
   - `AGENTS.md`, the bullet that starts `` `show/` is the show tool ``: change `(CLI: \`open\`, \`serve\`, \`log\`, \`pick\`, \`preview\`)` to `(CLI: \`open\`, \`page\`, \`serve\`, \`log\`, \`pick\`, \`preview\`)`, and append to the end of that same bullet, as one more sentence: `` `page` writes the same page as a folder (`.forge-show/<pane>/` in the working folder) and calls nothing from Herdr; `openmausbot/forge-show/` is the personal skill that tells an OpenMausBot bot to run it and show the folder with that client's `show_html` tool (`scripts/install-openmausbot-skill.sh` links it into `~/.claude/skills`; it is outside `skills/` on purpose, so no plugin lists it). ``
   - `README.md`, in the `## Show` section: insert a new paragraph **after** the paragraph that reads "It is on for every Claude Code session inside the Herdr app. No `routing: on` is needed, and it does nothing outside the app." and **before** the line `MIT.`, with a blank line on each side:

     `In [OpenMausBot](https://github.com/milind-soni/OpenMausBot), a bot can draw the same charts, tiles, tables, diagrams, pictures and diffs as a card in the chat. On the machine that runs OpenMausBot, run \`bash scripts/install-openmausbot-skill.sh\` from the main checkout (not a worktree): it links the \`forge-show\` skill into \`~/.claude/skills\`. The bot writes the drawing to \`.forge-show/\` in its working folder (ignored by git) and shows it with OpenMausBot's own \`show_html\` tool. Logs and choice or confirm questions stay Herdr only.`

6. Run `node --test show/*.test.mjs` and `bash hooks/session-start.test.sh`: all pass. Run `bash -n scripts/install-openmausbot-skill.sh`.

7. **PR body:** below the task checklist, add a section headed `By hand, after merge` with these unticked items (no machine names, no local paths):
   - `[ ] On the machine that runs OpenMausBot: pull the main checkout, run scripts/install-openmausbot-skill.sh from it`
   - `[ ] Ask a bot for a small comparison; it draws a card without being told how`
   - `[ ] Ask it to change the drawing; the same card updates and no second card appears`
   - `[ ] A Claude Code session in the Herdr app on that machine still draws with mcp__forge__show, not the skill`

- **Verify:** `node --test show/*.test.mjs && bash hooks/session-start.test.sh && bash -n scripts/install-openmausbot-skill.sh`
