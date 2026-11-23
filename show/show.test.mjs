import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stemOf, plan, diffCommand, buildPage, due, pickerRows, pickedFrom, pickerHeader, plain } from './show.mjs'

const SHOW = new URL('./show.mjs', import.meta.url).pathname
const tmp = () => mkdtempSync(join(tmpdir(), 'forge-show-'))

test('stemOf', () => assert.equal(stemOf('mbp-dev/T2', 'chart'), 'mbp-dev-t2-chart'))

test('plan', () => {
  const view = { blocks: [{ type: 'stats' }, { type: 'log' }, { type: 'choice' }, { type: 'chart' }] }
  assert.deepEqual(plan(view), { page: [0, 3], logs: [1], asks: [2] })
})

test('diffCommand quotes the repo', () => {
  assert.equal(diffCommand({ repo: "/r/it's" }), "git -C '/r/it'\\''s' diff --no-color --no-ext-diff 'HEAD' --")
})

test('buildPage fills command blocks from data', () => {
  const view = { terminal: 't1', pane: 'p', title: 't', cwd: '/', blocks: [{ type: 'log', command: 'l' }, { type: 'table', command: 'x' }] }
  const run = () => assert.fail('run must not be called')
  assert.match(buildPage(view, undefined, { run, data: { 1: { columns: ['a'], rows: [[1]] } } }).html, /"columns":\["a"\]/)
  assert.match(buildPage(view, undefined, { run, data: {} }).html, /"loading":true/)
  assert.match(buildPage(view, undefined, { run, data: { 1: { error: 'boom' } } }).html, /boom/)
})

test('buildPage version is a content hash and diff runs once', () => {
  const view = { terminal: 't1', pane: 'p', title: 't', cwd: '/', blocks: [{ type: 'table', command: 'x' }, { type: 'diff', repo: '/r' }] }
  let runs = 0
  const run = () => { runs++; return 'P' }
  const data = (v) => ({ 0: { columns: ['a'], rows: [[v]] } })
  const a = buildPage(view, undefined, { run, data: data(1) })
  assert.equal(runs, 1)
  assert.match(a.version, /^[0-9a-f]{12}$/)
  assert.ok(a.html.includes(`window.__seen="${a.version}"`))
  assert.equal(buildPage(view, undefined, { run, data: data(1) }).version, a.version)
  assert.notEqual(buildPage(view, undefined, { run, data: data(2) }).version, a.version)
})

test('buildPage survives a failing diff', () => {
  const view = { terminal: 't1', pane: 'p', title: 't', cwd: '/', blocks: [{ type: 'diff', repo: '/r' }] }
  assert.match(buildPage(view, undefined, { run: () => { throw new Error('nogit') }, data: {} }).html, /nogit/)
})

test('due ignores diff blocks', () => {
  assert.deepEqual(due({ blocks: [{ type: 'diff', repo: '/r', command: 'x' }, { type: 'chart', command: 'y' }] }, {}, 0), [1])
})

test('due', () => {
  const view = { blocks: [{ type: 'table', command: 'x', every: 5 }, { type: 'table', command: 'y' }] }
  assert.deepEqual(due(view, { 0: 1000 }, 5999), [1])
  assert.deepEqual(due(view, { 0: 1000 }, 6000), [0, 1])
})

const open = (view, env = {}, stdin = JSON.stringify(view)) =>
  spawnSync('node', [SHOW, 'open'], { input: stdin, encoding: 'utf8', env: { ...process.env, ...env } })

test('open denies a bad spec and bad JSON', () => {
  const env = { FORGE_SHOW_DIR: tmp() }
  const r = open({ pane: 'Bad Name', title: 't', blocks: [] }, env)
  assert.equal(r.status, 0)
  assert.match(JSON.parse(r.stdout).deny, /^at \/pane:/)
  const bad = open(null, env, 'nope')
  assert.equal(bad.status, 0)
  assert.ok(JSON.parse(bad.stdout).deny)
})

const stats = { pane: 'chk', title: 't', blocks: [{ type: 'stats', items: [{ label: 'A', value: 1 }] }] }

test('open needs HC_TERMINAL_ID', () => {
  const env = { ...process.env, FORGE_SHOW_DIR: tmp() }
  delete env.HC_TERMINAL_ID
  const r = spawnSync('node', [SHOW, 'open'], { input: JSON.stringify(stats), encoding: 'utf8', env })
  assert.match(JSON.parse(r.stdout).deny, /HC_TERMINAL_ID is not set/)
})

test('open splits a page pane without the helper when the theme is current', () => {
  const dir = tmp()
  const bin = tmp()
  const log = join(bin, 'log')
  const fake = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755) }
  fake('herdr-app', `echo "$*" >> '${log}'\nif [ "$1" = ls ]; then echo '{"spaces":[{"tabs":[{"terminals":[{"terminal":"t1","pane":"p1"}]}]}]}'; else echo '{"pane":"p2","terminal":"t2"}'; fi`)
  fake('defaults', 'echo Dark')
  writeFileSync(join(dir, 'theme.json'), JSON.stringify({ key: 'null|Dark', theme: {}, settings: {} }))
  const r = open(stats, { FORGE_SHOW_DIR: dir, FORGE_SHOW_PATH_FIRST: bin, HC_TERMINAL_ID: 't1', HOME: tmp() })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { result: 'Opened the chk pane beside this session.' })
  assert.ok(existsSync(join(dir, 't1-chk.html')))
  assert.match(readFileSync(join(dir, 't1-chk.v.js'), 'utf8'), /^window\.__v=/)
  const calls = readFileSync(log, 'utf8')
  assert.equal(calls.match(/do pane\.split/g).length, 1)
  assert.doesNotMatch(calls, /mod\.open/)
})

const rig = (herdrBody) => {
  const dir = tmp()
  const bin = tmp()
  const log = join(bin, 'log')
  const fake = (name, body) => { writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`); chmodSync(join(bin, name), 0o755) }
  fake('herdr-app', `echo "$*" >> '${log}'\nif [ "$1" = ls ]; then echo '{"spaces":[{"tabs":[{"terminals":[{"terminal":"t1","pane":"p1"},{"terminal":"t9","pane":"p9"}]}]}]}'; else ${herdrBody}; fi`)
  fake('defaults', 'echo Dark')
  fake('hc', `echo "hc $*" >> '${log}'\nif [ "$1" = run ]; then echo '{"address":"t9"}'; fi`)
  writeFileSync(join(bin, 'ack'), `#!/usr/bin/env node\nconst fs = require('fs'), d = process.env.FORGE_SHOW_DIR\nfs.writeFileSync(d + '/ack.json', JSON.stringify({ id: JSON.parse(fs.readFileSync(d + '/request.json')).id }))\n`)
  chmodSync(join(bin, 'ack'), 0o755)
  const env = { FORGE_SHOW_DIR: dir, FORGE_SHOW_PATH_FIRST: bin, HC_TERMINAL_ID: 't1', HOME: tmp() }
  return { dir, env, calls: () => readFileSync(log, 'utf8'), theme: () => writeFileSync(join(dir, 'theme.json'), JSON.stringify({ key: 'null|Dark', theme: {}, settings: {} })) }
}
const logOnly = { pane: 'chk', title: 't', blocks: [{ type: 'log', command: 'echo hi' }] }

test('open carries on when the helper mod is missing', () => {
  const t = rig('if [ "$2" = mod.open ]; then exit 3; fi; echo \'{"pane":"p2","terminal":"t2"}\'')
  const r = open(stats, t.env)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.stdout), { result: 'Opened the chk pane beside this session.' })
  assert.ok(existsSync(join(t.dir, 't1-chk.html')))
})

test('open denies a failed pane.split and keeps what opened', () => {
  for (const body of ['echo \'{"error":"nope"}\'', 'echo \'{"pane":"p2"}\'']) {
    const t = rig(body)
    t.theme()
    const r = open(stats, t.env)
    assert.equal(r.status, 0, r.stderr)
    assert.match(JSON.parse(r.stdout).deny, /^forge show could not open the pane: /)
    assert.deepEqual(JSON.parse(readFileSync(join(t.dir, 't1-chk.json'), 'utf8')).panes, {})
  }
  const t = rig('echo \'{"error":"nope"}\'')
  t.theme()
  assert.equal(JSON.parse(open(stats, t.env).stdout).deny, 'forge show could not open the pane: nope')
  const x = rig('exit 1')
  x.theme()
  const r = open(stats, x.env)
  assert.equal(r.status, 0)
  assert.match(JSON.parse(r.stdout).deny, /^forge show could not open the pane: /)
})

test('open closes a stale page pane when the view has no page blocks', () => {
  const t = rig('echo \'{"pane":"p2","terminal":"t2"}\'')
  t.theme()
  writeFileSync(join(t.dir, 't1-chk.json'), JSON.stringify({ panes: { page: { pane: 'p9', terminal: 't9' } } }))
  const r = open(logOnly, t.env)
  assert.equal(r.status, 0, r.stderr)
  assert.match(t.calls(), /do pane\.close --pane p9/)
  assert.equal(JSON.parse(readFileSync(join(t.dir, 't1-chk.json'), 'utf8')).panes.page, undefined)
})

test('plain turns control characters into spaces', () => assert.equal(plain('a\u001b[31mb\tc\nd'), 'a [31mb c\nd'))

test('open leaves an unchanged page alone and rewrites a changed one', () => {
  const t = rig('echo \'{"pane":"p2","terminal":"t2"}\'')
  t.theme()
  const html = join(t.dir, 't1-chk.html')
  const vjs = join(t.dir, 't1-chk.v.js')
  open(stats, t.env)
  const v1 = readFileSync(vjs, 'utf8')
  const body = readFileSync(html, 'utf8')
  utimesSync(html, 1000, 1000)
  utimesSync(vjs, 1000, 1000)
  open(stats, t.env)
  assert.equal(statSync(html).mtimeMs, 1000000)
  assert.equal(statSync(vjs).mtimeMs, 1000000)
  assert.equal(readFileSync(html, 'utf8'), body)
  assert.equal(readFileSync(vjs, 'utf8'), v1)
  open({ ...stats, blocks: [{ type: 'stats', items: [{ label: 'A', value: 2 }] }] }, t.env)
  assert.notEqual(readFileSync(vjs, 'utf8'), v1)
})

test('open does not close a pane whose terminal id was reused', () => {
  const t = rig('echo \'{"pane":"p2","terminal":"t2"}\'')
  t.theme()
  writeFileSync(join(t.dir, 't1-chk.json'), JSON.stringify({ panes: { page: { pane: 'pX', terminal: 't9' } } }))
  const r = open(stats, t.env)
  assert.equal(r.status, 0, r.stderr)
  assert.doesNotMatch(t.calls(), /pane\.close/)
  assert.equal(t.calls().match(/do pane\.split/g).length, 1)
})

test('open removes old question snapshots and keeps fresh ones', () => {
  const t = rig('echo \'{"pane":"p2","terminal":"t2"}\'')
  t.theme()
  const old = join(t.dir, 't1-chk.ask-1-0.json')
  const fresh = join(t.dir, 't1-chk.ask-2-0.json')
  const other = join(t.dir, 't1-other.ask-1-0.json')
  for (const f of [old, fresh, other]) writeFileSync(f, '{}')
  const day = Date.now() / 1000 - 25 * 3600
  utimesSync(old, day, day)
  utimesSync(other, day, day)
  open(stats, t.env)
  assert.equal(existsSync(old), false)
  assert.equal(existsSync(fresh), true)
  assert.equal(existsSync(other), true)
})

test('pickerRows and pickedFrom', () => {
  const block = { options: [{ label: 'A\tx' }, { label: 'B\ny' }] }
  assert.deepEqual(pickerRows(block), ['0\tA x', '1\tB y'])
  assert.equal(pickedFrom(block, '1\tB y\n'), block.options[1])
  assert.equal(pickedFrom(block, ''), undefined)
  assert.equal(pickedFrom(block, '9\tZ'), undefined)
})

const choice = { pane: 'ask', title: 't', blocks: [{ type: 'choice', options: [{ label: 'A' }, { label: 'B' }] }] }

test('open asks a choice in a floating window', () => {
  const t = rig('if [ "$2" = mod.open ]; then ack; fi')
  t.theme()
  const r = open(choice, t.env)
  assert.equal(r.status, 0, r.stderr)
  assert.match(JSON.parse(r.stdout).result, /^Asked in a floating window/)
  const req = JSON.parse(readFileSync(join(t.dir, 'request.json'), 'utf8'))
  assert.equal(req.floats[0].terminal, 't9')
  assert.equal(req.floats[0].key, 'show-t9')
  assert.match(t.calls(), /hc run --bg --json --no-notify --rm node \S+show\.mjs pick \/\S+t1-ask\.ask-\d+-0\.json\n/)
  assert.equal(t.calls().match(/mod\.open/g).length, 1)
})

test('open writes a snapshot per question', () => {
  const t = rig('if [ "$2" = mod.open ]; then ack; fi')
  t.theme()
  const view = { ...choice, terminal: 't9', blocks: [{ type: 'log', command: 'x' }, choice.blocks[0]] }
  open(view, t.env)
  const stored = JSON.parse(readFileSync(join(t.dir, 't9-ask.json'), 'utf8'))
  const file = readdirSync(t.dir).find((f) => f.startsWith('t9-ask.ask-'))
  assert.equal(file, `t9-ask.ask-${stored.stamp}-1.json`)
  assert.deepEqual(JSON.parse(readFileSync(join(t.dir, file), 'utf8')), { pane: 'ask', title: 't', terminal: 't9', block: view.blocks[1] })
})

test('pick reads only its snapshot and deletes it; preview ignores bad indexes', () => {
  const dir = tmp()
  const bin = tmp()
  writeFileSync(join(bin, 'fzf'), '#!/bin/sh\nexit 1\n')
  chmodSync(join(bin, 'fzf'), 0o755)
  const file = join(dir, 'x.ask-1-0.json')
  const snap = { pane: 'p', title: 't', terminal: 't1', block: { type: 'choice', options: [{ label: 'A', preview: 'pa' }, { label: 'B' }] } }
  const run = (...args) => spawnSync('node', [SHOW, ...args], { encoding: 'utf8', env: { ...process.env, FORGE_SHOW_DIR: tmp(), FORGE_SHOW_PATH_FIRST: bin } })
  writeFileSync(file, JSON.stringify(snap))
  assert.equal(run('preview', file, '0').stdout, 'pa\n')
  for (const i of ['1', '9', 'x', '-1', 'length']) assert.equal(run('preview', file, i).stdout, '')
  assert.equal(run('pick', file).status, 0)
  assert.equal(existsSync(file), false)
})

test('open denies and kills the picker when the float does not open', () => {
  const t = rig('true')
  t.theme()
  const r = open(choice, { ...t.env, FORGE_SHOW_ACK_MS: '300' })
  assert.match(JSON.parse(r.stdout).deny, /^forge show could not open the question window/)
  assert.match(t.calls(), /hc kill t9/)
})

test('open keeps the log panes when the question window fails', () => {
  const t = rig('if [ "$2" = mod.open ]; then true; else echo \'{"pane":"p2","terminal":"t2"}\'; fi')
  t.theme()
  const view = { pane: 'ask', title: 't', blocks: [choice.blocks[0], logOnly.blocks[0]] }
  const r = open(view, { ...t.env, FORGE_SHOW_ACK_MS: '300' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(r.stdout).result, 'Opened the ask pane beside this session. The question window could not be opened (is the forge-show helper mod installed? run scripts/install-herdr-mod.sh).')
  assert.match(t.calls(), /hc kill t9/)
  assert.match(t.calls(), /do pane\.split/)
  assert.deepEqual(readdirSync(t.dir).filter((f) => f.includes('.ask-')), [])
})

test('pickerHeader: choice uses the prompt, else the view title', () => {
  assert.equal(pickerHeader({ title: 'T' }, { type: 'choice', prompt: 'Which?' }), 'Which?')
  assert.equal(pickerHeader({ title: 'T' }, { type: 'choice' }), 'T')
})

test('pickerHeader: confirm shows the summary and the consequence', () => {
  const view = { title: 'T' }
  assert.equal(pickerHeader(view, { type: 'confirm', summary: 'Delete it?\nReally', consequence: 'Cannot be undone.' }), 'Delete it?\nReally\n\nCannot be undone.')
  assert.equal(pickerHeader(view, { type: 'confirm', summary: 'Delete it?' }), 'Delete it?')
  assert.equal(pickerHeader(view, { type: 'confirm', summary: 'Delete it?', consequence: '' }), 'Delete it?')
})

test('pickerHeader: control characters become spaces and the text is capped', () => {
  assert.equal(pickerHeader({ title: 'T' }, { type: 'confirm', summary: 'a\u001b[31mb' }), 'a [31mb')
  assert.equal(pickerHeader({ title: 'T' }, { type: 'confirm', summary: 'x'.repeat(2000) }).length, 1000)
})

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
