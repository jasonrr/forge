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
