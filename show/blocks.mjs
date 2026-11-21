export const PAGE = ['markdown', 'stats', 'table', 'chart', 'flow', 'sequence', 'mermaid', 'image', 'compare', 'diff']
export const TYPES = [...PAGE, 'log', 'choice', 'confirm']

const isStr = (v) => typeof v === 'string'
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isAbs = (v) => isStr(v) && v.startsWith('/')
const isHttp = (v) => isStr(v) && /^https?:\/\//.test(v)
const isLoc = (v) => isAbs(v) || isHttp(v)
const err = (path, want) => `at ${path}: ${want}`

// each check returns undefined or an error string
const optStr = (b, key, p) => (b[key] === undefined || isStr(b[key]) ? undefined : err(`${p}/${key}`, 'a string'))
const optNum = (b, key, p, min) => (b[key] === undefined || (isNum(b[key]) && b[key] >= min) ? undefined : err(`${p}/${key}`, `a number >= ${min}`))
const first = (...checks) => checks.map((c) => c()).find((e) => e !== undefined)

function tableError(b, p) {
  if (b.command !== undefined) {
    if (!isStr(b.command) || !b.command) return err(`${p}/command`, 'a non-empty string')
    const e = optNum(b, 'every', p, 5)
    if (e) return e
    if (b.columns === undefined && b.rows === undefined) return undefined
  }
  if (!Array.isArray(b.columns) || !b.columns.length || !b.columns.every(isStr)) return err(`${p}/columns`, 'a non-empty array of strings')
  if (!Array.isArray(b.rows) || b.rows.length > 5000) return err(`${p}/rows`, 'an array of at most 5000 rows')
  for (const [i, row] of b.rows.entries()) {
    if (!Array.isArray(row) || row.length !== b.columns.length) return err(`${p}/rows/${i}`, `an array of ${b.columns.length} values`)
    const j = row.findIndex((c) => !(isStr(c) || isNum(c) || typeof c === 'boolean' || c === null))
    if (j >= 0) return err(`${p}/rows/${i}/${j}`, 'a string, number, boolean or null')
  }
}

function chartError(b, p) {
  const kind = ['line', 'area', 'bar', 'donut'].includes(b.kind) ? undefined : err(`${p}/kind`, 'line, area, bar or donut')
  if (kind) return kind
  const e = tableError(b, p)
  if (e) return e
  if (!b.columns) return undefined
  if (b.x !== undefined && !b.columns.includes(b.x)) return err(`${p}/x`, 'one of columns')
  if (b.y !== undefined && (!Array.isArray(b.y) || !b.y.length || !b.y.every((c) => b.columns.includes(c)))) return err(`${p}/y`, 'a non-empty array of columns')
}

function flowError(b, p) {
  if (!Array.isArray(b.nodes) || !b.nodes.length || b.nodes.length > 60) return err(`${p}/nodes`, 'an array of 1 to 60 nodes')
  const ids = new Set()
  for (const [i, n] of b.nodes.entries()) {
    const q = `${p}/nodes/${i}`
    if (!isObj(n)) return err(q, 'an object')
    if (!isStr(n.id) || !n.id || ids.has(n.id)) return err(`${q}/id`, 'a unique non-empty string')
    ids.add(n.id)
    if (!isStr(n.label)) return err(`${q}/label`, 'a string')
    if (n.kind !== undefined && !['box', 'round', 'decision'].includes(n.kind)) return err(`${q}/kind`, 'box, round or decision')
  }
  if (b.edges !== undefined && !Array.isArray(b.edges)) return err(`${p}/edges`, 'an array')
  for (const [i, e] of (b.edges ?? []).entries()) {
    const q = `${p}/edges/${i}`
    if (!isObj(e)) return err(q, 'an object')
    for (const end of ['from', 'to']) if (!ids.has(e[end])) return err(`${q}/${end}`, 'a node id')
    if (e.label !== undefined && !isStr(e.label)) return err(`${q}/label`, 'a string')
  }
  if (b.direction !== undefined && !['down', 'right'].includes(b.direction)) return err(`${p}/direction`, 'down or right')
}

function sequenceError(b, p) {
  if (b.actors !== undefined) {
    if (!Array.isArray(b.actors)) return err(`${p}/actors`, 'an array')
    const i = b.actors.findIndex((a) => !(isStr(a) || (isObj(a) && isStr(a.id) && (a.label === undefined || isStr(a.label)))))
    if (i >= 0) return err(`${p}/actors/${i}`, 'a string or {id, label?}')
  }
  if (!Array.isArray(b.messages) || !b.messages.length) return err(`${p}/messages`, 'a non-empty array')
  for (const [i, m] of b.messages.entries()) {
    const q = `${p}/messages/${i}`
    if (!isObj(m)) return err(q, 'an object')
    if (isStr(m.note) && isStr(m.over)) continue
    if (!isStr(m.from) || !isStr(m.to)) return err(q, '{from, to, label?} or {note, over}')
    if (m.label !== undefined && !isStr(m.label)) return err(`${q}/label`, 'a string')
  }
}

function imageError(b, p) {
  if ((b.path === undefined) === (b.url === undefined)) return err(p, 'exactly one of path or url')
  if (b.path !== undefined && !isAbs(b.path)) return err(`${p}/path`, 'an absolute path')
  if (b.url !== undefined && !isHttp(b.url)) return err(`${p}/url`, 'an http(s) URL')
}

function diffError(b, p) {
  if ((b.patch === undefined) === (b.repo === undefined)) return err(p, 'exactly one of patch or repo')
  if (b.patch !== undefined && (!isStr(b.patch) || b.patch.length > 500000)) return err(`${p}/patch`, 'a string of at most 500000 chars')
  if (b.repo !== undefined && !isAbs(b.repo)) return err(`${p}/repo`, 'an absolute path')
  if (b.base !== undefined && !(isStr(b.base) && /^[\w.~^@{}/][\w./~^@{}-]*$/.test(b.base))) return err(`${p}/base`, 'a git ref')
}

function choiceError(b, p) {
  if (!Array.isArray(b.options) || b.options.length < 2) return err(`${p}/options`, 'an array of at least 2 options')
  for (const [i, o] of b.options.entries()) {
    const q = `${p}/options/${i}`
    if (!isObj(o) || !isStr(o.label)) return err(`${q}/label`, 'a string')
    const e = optStr(o, 'preview', q)
    if (e) return e
  }
  return optStr(b, 'prompt', p)
}

const CHECKS = {
  markdown: (b, p) => (isStr(b.text) ? undefined : err(`${p}/text`, 'a string')),
  mermaid: (b, p) => (isStr(b.text) ? undefined : err(`${p}/text`, 'a string')),
  stats(b, p) {
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 8) return err(`${p}/items`, 'an array of 1 to 8 items')
    for (const [i, it] of b.items.entries()) {
      const q = `${p}/items/${i}`
      if (!isObj(it)) return err(q, 'an object')
      if (!isStr(it.label)) return err(`${q}/label`, 'a string')
      if (!isStr(it.value) && !isNum(it.value)) return err(`${q}/value`, 'a string or number')
      if (it.spark !== undefined && !(Array.isArray(it.spark) && it.spark.every(isNum))) return err(`${q}/spark`, 'an array of numbers')
    }
  },
  table: tableError,
  chart: chartError,
  flow: flowError,
  sequence: sequenceError,
  image: imageError,
  compare: (b, p) => first(() => (isLoc(b.before) ? undefined : err(`${p}/before`, 'an absolute path or http(s) URL')), () => (isLoc(b.after) ? undefined : err(`${p}/after`, 'an absolute path or http(s) URL'))),
  diff: diffError,
  log: (b, p) => first(() => (isStr(b.command) && b.command ? undefined : err(`${p}/command`, 'a non-empty string')), () => optNum(b, 'every', p, 1), () => optNum(b, 'lines', p, 1)),
  choice: choiceError,
  confirm: (b, p) => first(() => (isStr(b.summary) ? undefined : err(`${p}/summary`, 'a string')), () => optStr(b, 'consequence', p), () => optStr(b, 'confirm_label', p)),
}

export function specError(view) {
  if (!isStr(view.pane) || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(view.pane)) return err('/pane', 'lowercase letters, digits and dashes, 1 to 40 characters')
  if (!isStr(view.title)) return err('/title', 'a string')
  if (view.placement !== undefined && !['right', 'down'].includes(view.placement)) return err('/placement', 'right or down')
  if (!Array.isArray(view.blocks) || !view.blocks.length || !view.blocks.every(isObj)) return err('/blocks', 'a non-empty array of objects')
  for (const [i, b] of view.blocks.entries()) {
    const p = `/blocks/${i}`
    if (!TYPES.includes(b.type)) return err(`${p}/type`, `one of ${TYPES.join(', ')}`)
    const e = optStr(b, 'title', p) ?? CHECKS[b.type](b, p)
    if (e) return e
  }
}

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

export function rowsFrom(json) {
  if (isObj(json) && Array.isArray(json.columns) && Array.isArray(json.rows)) return json
  if (Array.isArray(json) && json.every(isObj)) {
    const columns = [...new Set(json.flatMap(Object.keys))]
    return { columns, rows: json.map((r) => columns.map((c) => r[c] ?? null)) }
  }
  throw new Error('command output: expected {columns, rows} or an array of objects')
}

export function answerText(pane, block, picked) {
  const head = `In the ${pane} pane I`
  if (block.type === 'confirm') return `${head} ${picked.confirmed ? 'confirmed' : 'declined'}: ${block.summary.split('\n')[0]}`
  const value = picked.value !== undefined && picked.value !== picked.label ? ` (value: ${picked.value})` : ''
  return `${head} chose "${picked.label}"${value}${block.prompt ? ` for: ${block.prompt}` : ''}`
}
