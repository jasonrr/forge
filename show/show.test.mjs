import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stemOf, plan, diffCommand, buildPage, due, pickerRows, pickedFrom, pickerHeader } from './show.mjs'

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
  assert.match(buildPage(view, undefined, 'v', { run, data: { 1: { columns: ['a'], rows: [[1]] } } }), /"columns":\["a"\]/)
  assert.match(buildPage(view, undefined, 'v', { run, data: {} }), /"loading":true/)
  assert.match(buildPage(view, undefined, 'v', { run, data: { 1: { error: 'boom' } } }), /boom/)
})

test('buildPage survives a failing diff', () => {
  const view = { terminal: 't1', pane: 'p', title: 't', cwd: '/', blocks: [{ type: 'diff', repo: '/r' }] }
  assert.match(buildPage(view, undefined, 'v', { run: () => { throw new Error('nogit') }, data: {} }), /nogit/)
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
