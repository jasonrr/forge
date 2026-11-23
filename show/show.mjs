// forge show: turns a block list into a page pane and log panes beside a session in the Herdr desktop app.
//   open            reads one JSON view on stdin and prints one JSON line, {"result"} or {"deny"}
//   serve <stem>    the page pane's program: shows the page and keeps command blocks fresh
//   log <stem> <n>  a log pane's program
//   pick <file>     a floating window's program: asks the choice or confirm block in one snapshot file and sends the answer to the session
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, rmSync, statSync, readdirSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createInterface } from 'node:readline'
import { PAGE, specError, rowsFrom, answerText } from './blocks.mjs'
import { palette, pageBlocks, pageHtml } from './page.mjs'

const SELF = fileURLToPath(import.meta.url)
// FORGE_SHOW_DIR is for tests only: the helper mod always uses ~/.cache/forge/show.
const DIR = () => process.env.FORGE_SHOW_DIR || join(homedir(), '.cache/forge/show')
const path = (name) => join(DIR(), name)
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const first200 = (e) => String(e?.message ?? e).slice(0, 200)

const env = () => ({ ...process.env, PATH: [process.env.FORGE_SHOW_PATH_FIRST, `${homedir()}/.local/bin`, '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].filter(Boolean).join(':') })
const sh = (argv, opts) => execFileSync(argv[0], argv.slice(1), { encoding: 'utf8', env: env(), timeout: 5000, ...opts })

const runShell = (command, cwd) => sh(['sh', '-c', command], { cwd, timeout: 20000, maxBuffer: 8 << 20 })
const herdr = (...args) => JSON.parse(sh(['herdr-app', 'do', ...args]))
const enter = () => new Promise((done) => createInterface({ input: process.stdin }).once('line', done))

export const stemOf = (terminal, pane) => terminal.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + pane
export const shq = (text) => "'" + text.replace(/'/g, "'\\''") + "'"
export const pickerRows = (block) => block.options.map((o, i) => `${i}\t${o.label.replace(/[\t\r\n]/g, ' ')}`)
export const pickedFrom = (block, stdout) => block.options[Number.parseInt(stdout, 10)]
export const plain = (text) => String(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, ' ')
export const pickerHeader = (view, block) => {
  const text = block.type === 'confirm' ? block.summary + (typeof block.consequence === 'string' && block.consequence ? '\n\n' + block.consequence : '') : (block.prompt ?? view.title)
  return plain(text).slice(0, 1000)
}
export const diffCommand = (block) => 'git -C ' + shq(block.repo) + ' diff --no-color --no-ext-diff ' + shq(block.base ?? 'HEAD') + ' --'

export function plan(view) {
  const out = { page: [], logs: [], asks: [] }
  view.blocks.forEach((b, n) => {
    if (PAGE.includes(b.type)) out.page.push(n)
    else if (b.type === 'log') out.logs.push(n)
    else out.asks.push(n)
  })
  return out
}

function put(file, text) {
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

// The version is a hash of the page itself, so an unchanged page keeps its version and is not reloaded.
export function buildPage(view, themeFile, { run, data, stem }) {
  const pageOnly = []
  const extra = new Map()
  view.blocks.forEach((b, n) => {
    if (!PAGE.includes(b.type)) return
    if (b.type === 'diff' && b.repo) {
      try { extra.set(pageOnly.length, { patch: run(diffCommand(b), view.cwd) }) } catch (e) { extra.set(pageOnly.length, { error: first200(e) }) }
    } else if (b.command && data[n]) extra.set(pageOnly.length, data[n])
    pageOnly.push(b)
  })
  const blocks = pageBlocks(pageOnly, extra)
  const render = (version) => pageHtml({ stem: stem ?? stemOf(view.terminal, view.pane), title: view.title, blocks, palette: palette(themeFile), version })
  const version = createHash('sha1').update(render('')).digest('hex').slice(0, 12)
  return { version, html: render(version) }
}

export function due(view, lastRun, now) {
  const ids = []
  view.blocks.forEach((b, n) => {
    if (['table', 'chart'].includes(b.type) && b.command && (lastRun[n] === undefined || now - lastRun[n] >= (b.every ?? 60) * 1000)) ids.push(n)
  })
  return ids
}

function writePage(stem, view, data) {
  let themeFile
  try { themeFile = read(path('theme.json')) } catch { /* the page falls back to the default palette */ }
  const { version, html } = buildPage(view, themeFile, { run: runShell, data })
  const stamp = 'window.__v=' + JSON.stringify(version)
  try { if (existsSync(path(stem + '.html')) && readFileSync(path(stem + '.v.js'), 'utf8') === stamp) return } catch { /* no version file yet */ }
  put(path(stem + '.html'), html)
  put(path(stem + '.v.js'), stamp)
}

// A picture the card can load: copied beside index.html, because a chat card cannot read file:// URLs.
// Its name carries its content, so a picture rendered again under the same path changes the page and the live card reloads.
function bring(dir, ref, name, kept) {
  if (!ref.startsWith('/')) return ref
  const bytes = readFileSync(ref)
  const ext = /^\.[A-Za-z0-9]{1,5}$/.test(extname(ref)) ? extname(ref) : ''
  const file = `${name}-${createHash('sha1').update(bytes).digest('hex').slice(0, 8)}${ext}`
  // The name is the content, so a file already there is this picture: a live card mid-load never sees it rewritten.
  if (!existsSync(join(dir, file))) put(join(dir, file), bytes)
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

function themeKey() {
  let theme = null
  try {
    const cfg = join(homedir(), '.config/herdr-app')
    const layout = read(join(cfg, 'shared.json')).layout ?? 'main'
    theme = read(join(cfg, 'layouts/.state', layout + '.json')).theme ?? null
  } catch { /* no readable theme: key on null */ }
  let mode = 'Light'
  try { mode = sh(['defaults', 'read', '-g', 'AppleInterfaceStyle'], { stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* light mode has no value */ }
  // ponytail: a custom theme file edited in place is not noticed until the theme or appearance changes; add its mtime to the key if that bites.
  return JSON.stringify(theme) + '|' + mode
}

function takeLock() {
  const lock = path('lock')
  for (const end = Date.now() + 10000; ; sleep(100)) {
    try { mkdirSync(lock); return lock } catch (e) {
      if (e.code !== 'EEXIST' || Date.now() > end) throw e
      try { if (Date.now() - statSync(lock).mtimeMs > 8000) rmdirSync(lock) } catch { /* another process took it */ }
    }
  }
}

// why: mod.open is a toggle and request.json is one file, so two show calls at once would cancel each other without the lock.
// Returns whether the helper acknowledged in time; false also when the lock or the helper mod is unavailable.
function askHelper(key, theme, floats) {
  let lock
  try { lock = takeLock() } catch { return false }
  try {
    const id = process.pid + '-' + Date.now()
    put(path('request.json'), JSON.stringify({ id, key, theme, floats }))
    try { sh(['herdr-app', 'do', 'mod.open', '--name', 'forge-show'], { timeout: 3000 }) } catch { return false }
    for (const end = Date.now() + (Number(process.env.FORGE_SHOW_ACK_MS) || 3000); Date.now() < end; sleep(100)) {
      try { if (read(path('ack.json')).id === id) return true } catch { /* not written yet */ }
    }
    return false
  } finally { try { rmdirSync(lock) } catch { /* another process cleared it as stale */ } }
}

const terminalsOf = (ls) => ls.spaces.flatMap((s) => s.tabs.flatMap((t) => t.terminals))

function split(direction, pane, argv) {
  const r = herdr('pane.split', '--direction', direction, '--pane', pane, '--argv', JSON.stringify(argv))
  if (r.error || typeof r.terminal !== 'string') throw new Error(r.error ?? 'pane.split returned no terminal')
  return r
}

function open(view) {
  const bad = specError(view)
  if (bad) return { deny: bad }
  const terminal = view.terminal ?? process.env.HC_TERMINAL_ID
  if (!terminal) return { deny: 'forge show needs the Herdr desktop app (HC_TERMINAL_ID is not set).' }
  let terminals = []
  try { terminals = terminalsOf(JSON.parse(sh(['herdr-app', 'ls']))) } catch { /* handled below */ }
  const me = terminals.find((t) => t.terminal === terminal)
  if (!me) return { deny: "forge show could not find this session's pane in the Herdr app." }
  const { page, logs, asks } = plan(view)

  const stem = stemOf(terminal, view.pane)
  const cwd = view.cwd ?? process.cwd()
  const alive = (p) => p && terminals.some((t) => t.terminal === p.terminal && t.pane === p.pane)
  let panes = {}
  try { panes = read(path(stem + '.json')).panes ?? {} } catch { /* first show of this pane */ }
  mkdirSync(DIR(), { recursive: true })
  // A person who closes a question window instead of answering leaves its snapshot behind.
  for (const name of readdirSync(DIR())) {
    if (!name.startsWith(stem + '.ask-') || !name.endsWith('.json')) continue
    try { if (Date.now() - statSync(path(name)).mtimeMs > 24 * 3600 * 1000) rmSync(path(name)) } catch { /* gone already */ }
  }
  const stored = { ...view, terminal, cwd, panes, stamp: Date.now() }
  put(path(stem + '.json'), JSON.stringify(stored))

  const key = themeKey()
  let current = false
  try { current = read(path('theme.json')).key === key } catch { /* missing */ }
  const floats = []
  const snapshots = []
  let floatsOpen
  try {
    for (const n of asks) {
      const file = resolve(path(`${stem}.ask-${stored.stamp}-${n}.json`))
      put(file, JSON.stringify({ pane: view.pane, title: view.title, terminal, block: view.blocks[n] }))
      snapshots.push(file)
      const { address } = JSON.parse(sh(['hc', 'run', '--bg', '--json', '--no-notify', '--rm', 'node', SELF, 'pick', file]))
      floats.push({ terminal: address, key: 'show-' + address, width: 640, height: 320 })
    }
    const acked = current && !floats.length ? true : askHelper(key, !current, floats)
    floatsOpen = acked || !floats.length
    // A picker that died after being floated means the window never showed: hc get fails if its terminal is gone.
    for (const f of floats) sh(['hc', 'get', f.terminal], { stdio: 'ignore' })
  } catch { floatsOpen = false }
  let note = ''
  if (!floatsOpen) {
    for (const f of floats) try { sh(['hc', 'kill', f.terminal]) } catch { /* it may be gone already */ }
    for (const file of snapshots) rmSync(file, { force: true })
    if (!page.length && !logs.length) return { deny: 'forge show could not open the question window (is the forge-show helper mod installed? run scripts/install-herdr-mod.sh).' }
    note = ' The question window could not be opened (is the forge-show helper mod installed? run scripts/install-herdr-mod.sh).'
  }

  let opened = false
  try {
    if (page.length) {
      writePage(stem, stored, {})
      if (!alive(panes.page)) {
        panes.page = split(view.placement ?? 'right', me.pane, ['node', SELF, 'serve', stem])
        opened = true
      }
    } else if (alive(panes.page)) {
      herdr('pane.close', '--pane', panes.page.pane)
      delete panes.page
    }
    for (const k of Object.keys(panes).filter((k) => k.startsWith('log'))) {
      if (alive(panes[k])) herdr('pane.close', '--pane', panes[k].pane)
      delete panes[k]
    }
    for (const n of logs) {
      panes['log' + n] = split('down', me.pane, ['node', SELF, 'log', stem, String(n)])
      opened = true
    }
  } catch (e) {
    return { deny: `forge show could not open the pane: ${first200(e)}` }
  } finally {
    put(path(stem + '.json'), JSON.stringify({ ...stored, panes }))
  }
  if (!page.length && !logs.length) return { result: "Asked in a floating window; the answer arrives as the person's next message. They click the window first." }
  try { herdr('pane.focus', '--terminal', terminal) } catch { /* focus is a nicety */ }
  return { result: (opened ? `Opened the ${view.pane} pane beside this session.` : `Updated the ${view.pane} pane.`) + (asks.length && floatsOpen ? ' Also asked a question in a floating window.' : '') + note }
}

async function serve(stem) {
  const file = path(stem + '.html')
  const child = spawn('terminal-browser', ['open', file], {
    stdio: 'inherit',
    env: env(),
  })
  child.on('exit', (code) => process.exit(code ?? 0))
  child.on('error', async () => {
    console.log(`forge show: terminal-browser is not installed (brew install …); the page is at ${file}`)
    await enter()
    process.exit(1)
  })
  let stamp, data = {}, lastRun = {}
  const tick = () => {
    let view
    try { view = read(path(stem + '.json')) } catch { return }
    const changed = view.stamp !== stamp
    if (changed) { stamp = view.stamp; data = {}; lastRun = {} }
    const now = Date.now()
    const ids = due(view, lastRun, now)
    if (!ids.length && !changed) return
    // ponytail: commands run one at a time and block this loop while they run (20 s cap each); make them async if a pane with several slow commands feels stuck.
    for (const id of ids) {
      try { data[id] = rowsFrom(JSON.parse(runShell(view.blocks[id].command, view.cwd))) } catch (e) { data[id] = { error: first200(e) } }
      lastRun[id] = Date.now()
    }
    try { if (read(path(stem + '.json')).stamp !== stamp) return } catch { return }
    writePage(stem, view, data)
  }
  setInterval(tick, 1000)
}

async function log(stem, n) {
  const view = read(path(stem + '.json'))
  const block = view.blocks[n]
  try { process.chdir(view.cwd) } catch { /* run from where we are */ }
  if (!block.every) {
    const r = spawnSync('sh', ['-c', block.command], { stdio: 'inherit' })
    console.log(`[exited ${r.status ?? r.signal}] press enter to close`)
    return enter()
  }
  for (;; sleep(block.every * 1000)) {
    const r = spawnSync('sh', ['-c', block.command], { encoding: 'utf8', timeout: 20000, maxBuffer: 8 << 20 })
    const out = (r.stdout ?? '').trimEnd().split('\n').slice(-(block.lines ?? 40)).join('\n')
    process.stdout.write('\x1b[2J\x1b[H' + out + '\n' + (r.stderr ?? '') + (r.error ? r.error.message + '\n' : ''))
  }
}

async function choose(block, header, preview) {
  const args = ['--reverse', '--delimiter=\t', '--with-nth=2..', '--header', header, ...(preview ? ['--preview', preview, '--preview-window', 'right,50%'] : [])]
  const r = spawnSync('fzf', args, { input: pickerRows(block).join('\n'), stdio: ['pipe', 'pipe', 'inherit'], encoding: 'utf8', env: env() })
  if (!r.error) return r.status === 0 ? pickedFrom(block, r.stdout) : undefined
  console.log(header)
  block.options.forEach((o, i) => console.log(`${i + 1}) ${plain(o.label)}`))
  const answer = (await enter()).trim()
  return /^\d+$/.test(answer) ? block.options[Number(answer) - 1] : undefined
}

async function pick(file) {
  const view = read(file)
  try {
    const block = view.block
    const confirm = block.type === 'confirm'
    const options = confirm ? [{ label: block.confirm_label ?? 'Confirm' }, { label: 'Cancel' }] : block.options
    const preview = !confirm && options.some((o) => o.preview) && 'node ' + shq(SELF) + ' preview ' + shq(file) + ' {1}'
    const chosen = await choose({ options }, pickerHeader(view, block), preview)
    if (!chosen) return
    try { sh(['hc', 'send', view.terminal, answerText(view.pane, block, confirm ? { confirmed: chosen === options[0] } : chosen)]) } catch (e) {
      console.log(first200(e))
      await enter()
    }
  } finally { rmSync(file, { force: true }) }
}

export async function main([cmd, ...args]) {
  if (cmd === 'open' || cmd === 'page') {
    let text
    try { text = readFileSync(cmd === 'page' && args[0] ? args[0] : 0, 'utf8') } catch { return console.log(JSON.stringify({ deny: `cannot read ${cmd === 'page' && args[0] ? args[0] : 'the view on stdin'}.` })) }
    let view
    try { view = JSON.parse(text) } catch { return console.log(JSON.stringify({ deny: 'the view is not valid JSON.' })) }
    console.log(JSON.stringify(cmd === 'open' ? open(view) : pageFolder(view)))
  } else if (cmd === 'serve') await serve(args[0])
  else if (cmd === 'log') await log(args[0], Number(args[1]))
  else if (cmd === 'pick') await pick(args[0])
  else if (cmd === 'preview') {
    const options = read(args[0]).block.options
    if (/^\d+$/.test(args[1]) && options[args[1]]?.preview) console.log(options[args[1]].preview)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e?.message ?? e); process.exit(1) })
}
