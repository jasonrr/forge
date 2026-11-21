import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stemOf, plan, diffCommand, buildPage, due } from './show.mjs'

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
