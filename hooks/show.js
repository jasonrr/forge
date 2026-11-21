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
  }).catch(() => ({ decision: 'ask', reason: 'forge show could not check this call for commands.' }))

  // why tool.run and not tool.call: a hook that answers at tool.call skips the permission check above.
  on('tool.run', { tool: TOOL }, async ($, e) => {
    const view = { pane: e.pane, title: e.title, blocks: e.blocks, placement: e.placement, terminal: await $.env.get('HC_TERMINAL_ID'), cwd: await $.session.cwd() }
    const done = await $.process.run(['sh', '-c', `${PATHS} exec node "$1" open`, 'sh', `${$.plugin.root}/show/show.mjs`], { stdin: JSON.stringify(view), timeoutMs: 30_000 })
    const line = done.stdout.trim().split('\n').pop() ?? ''
    try {
      const out = JSON.parse(line)
      if (typeof out.deny === 'string') return { deny: out.deny }
      if (typeof out.result === 'string') return { result: out.result }
    } catch { /* fall through */ }
    return { deny: `forge show failed: ${(done.stderr || done.stdout || 'no output').trim().slice(0, 400)}` }
  }).catch((_$, err) => ({ deny: `forge show failed: ${String(err?.message ?? err).slice(0, 400)}` }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await inApp($))) return composed
    return { ...composed, sections: [...composed.sections.filter((s) => s.id !== DRAWING.id), DRAWING] }
  })
}
