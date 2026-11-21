// Adapted from cockpit's plugin/hooks/page.ts (MIT, see THIRD_PARTY_NOTICES.md).
import { flowText, sequenceText } from "./blocks.mjs"

const LIBS = {
  marked: "https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js",
  mermaid: "https://cdn.jsdelivr.net/npm/mermaid@10.9.1/dist/mermaid.min.js",
  chart: "https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js",
  diff: "https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/js/diff2html-ui.min.js",
  diffCss: "https://cdn.jsdelivr.net/npm/diff2html@3.4.48/bundles/css/diff2html.min.css",
}

const DEFAULTS = {
  dark: true, bg: "#111720", panel: "#0e131b", line: "#ffffff18", text: "#eeeeef", dim: "#96989c",
  accent: "#91b6ee", good: "#89c5aa", bad: "#e58c9a",
  series: ["#91b6ee", "#89c5aa", "#e5c07b", "#c678dd", "#e58c9a", "#56b6c2"],
  font: "Geist", mono: "MesloLGL Nerd Font Mono", size: 13,
}

const isColor = (v) => typeof v === "string" && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)
const color = (v, fallback) => (isColor(v) ? v : fallback)
const slot = (v, fallback) => (isColor(v) ? v.slice(0, 7) : fallback)
const fontName = (v, fallback) => {
  const name = typeof v === "string" ? v.replace(/[^A-Za-z0-9 ._-]/g, "") : ""
  return name || fallback
}

// Colours and fonts from a theme file `{ theme, settings }`; anything missing or invalid keeps its default.
export function palette(themeFile) {
  const t = themeFile?.theme ?? {}
  const s = themeFile?.settings ?? {}
  const D = DEFAULTS
  const size = typeof s.ui_font_size === "number" && Number.isFinite(s.ui_font_size) ? Math.min(20, Math.max(11, s.ui_font_size)) : D.size
  return {
    dark: typeof s.dark === "boolean" ? s.dark : D.dark,
    bg: color(t.background, D.bg),
    panel: color(t.canvas, D.panel),
    line: color(t.border, D.line),
    text: color(t.foreground, D.text),
    dim: color(t.muted, D.dim),
    accent: color(t.accent, D.accent),
    good: color(t.ansi2, D.good),
    bad: color(t.ansi1, D.bad),
    series: [t.accent, t.ansi2, t.ansi3, t.ansi5, t.ansi1, t.ansi6].map((v, i) => slot(v, D.series[i])),
    font: fontName(s.ui_font_family, D.font),
    mono: fontName(s.font_family, D.mono),
    size,
  }
}

const fileUrl = (path) => "file://" + encodeURI(path).replace(/#/g, "%23").replace(/\?/g, "%3F")
const picture = (ref) => (ref.startsWith("/") ? fileUrl(ref) : ref)

// Blocks with diagrams turned into Mermaid text, local pictures into file URLs, and `extra` (by index) merged in.
export function pageBlocks(blocks, extra) {
  return blocks.map((b, n) => {
    let out = b
    if (b.type === "flow") out = { type: "mermaid", title: b.title, text: flowText(b) }
    else if (b.type === "sequence") out = { type: "mermaid", title: b.title, text: sequenceText(b) }
    else if (b.type === "image" && typeof b.path === "string") out = { ...b, url: fileUrl(b.path) }
    else if (b.type === "compare") out = { ...b, before: picture(b.before), after: picture(b.after) }
    if (extra.has(n)) out = { ...out, ...extra.get(n) }
    return out.command && out.rows === undefined && !out.error ? { ...out, loading: true } : out
  })
}

export function pageHtml({ stem, title, blocks, palette: p, version }) {
  const data = JSON.stringify({ title, blocks, palette: p }).replace(/</g, "\\u003c")
  const heading = title.replace(/[<&]/g, (c) => (c === "<" ? "&lt;" : "&amp;"))
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${heading}</title>
<link rel="stylesheet" href="${LIBS.diffCss}">
<style>
:root { --bg: ${p.bg}; --panel: ${p.panel}; --line: ${p.line}; --text: ${p.text}; --dim: ${p.dim}; --accent: ${p.accent}; --green: ${p.good}; --red: ${p.bad}; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px 28px 48px; background: var(--bg); color: var(--text); font: ${p.size + 2}px/1.55 "${p.font}", -apple-system, BlinkMacSystemFont, sans-serif; }
h1 { font-size: 22px; margin: 0 0 20px; color: var(--accent); }
h2.block { font-size: 15px; margin: 32px 0 10px; color: var(--dim); text-transform: uppercase; letter-spacing: .06em; }
a { color: var(--accent); }
code, pre { font-family: "${p.mono}", ui-monospace, monospace; font-size: 13px; }
pre { background: var(--panel); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; }
.scroll { overflow-x: auto; }
th, td { padding: 6px 12px; border-bottom: 1px solid var(--line); text-align: left; white-space: nowrap; }
th { color: var(--dim); font-weight: 600; position: sticky; top: 0; background: var(--bg); }
td.num { text-align: right; }
figure { margin: 0; } figcaption { color: var(--dim); font-size: 13px; margin-top: 6px; }
img { max-width: 100%; border-radius: 6px; }
.chart { position: relative; height: 360px; }
.chart.donut { height: 280px; max-width: 520px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
.stat { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
.stat .label { color: var(--dim); font-size: 13px; } .stat .value { font-size: 26px; font-weight: 600; margin-top: 2px; }
.stat .note { color: var(--dim); font-size: 12px; } .good { color: var(--green); } .bad { color: var(--red); }
.compare { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.compare figcaption { text-transform: uppercase; letter-spacing: .06em; margin: 0 0 6px; }
@media (max-width: 420px) { .compare { grid-template-columns: 1fr; } }
.mermaid { background: var(--panel); border-radius: 8px; padding: 16px; }
.zoom { position: relative; overflow: hidden; background: var(--panel); border-radius: 8px; } .zoom .mermaid { margin: 0; cursor: grab; }
.zbar { position: absolute; top: 8px; right: 8px; z-index: 1; display: flex; gap: 4px; }
.zbar button { background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 2px 9px; font: inherit; cursor: pointer; }
.d2h-wrapper { --d2h-bg-color: var(--bg); }
.error { color: var(--red); }
.note { color: var(--dim); }
</style></head>
<body>
<h1>${heading}</h1>
<main id="view"></main>
<script type="application/json" id="spec">${data}</script>
<script src="${LIBS.marked}"></script>
<script src="${LIBS.mermaid}"></script>
<script src="${LIBS.chart}"></script>
<script src="${LIBS.diff}"></script>
<script>
const spec = JSON.parse(document.getElementById('spec').textContent)
const P = spec.palette
const SERIES = P.series
const view = document.getElementById('view')
const el = (tag, props = {}, children = []) => { const e = Object.assign(document.createElement(tag), props); e.append(...children); return e }
// why: blocks are written by a model that may have read untrusted text; the page opens with no prompt.
marked.use({ renderer: { html: (t) => String(typeof t === 'string' ? t : t.text ?? t.raw ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;') } })
// A chart measures its box, so it is drawn once the page holds it.
const later = []
const render = {
  markdown: b => {
    const box = el('div', { innerHTML: marked.parse(b.text) })
    for (const a of box.querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? ''
      if (!/^(https?:\\/\\/|#|mailto:)/.test(href)) a.removeAttribute('href')
    }
    return box
  },
  table: b => el('div', { className: 'scroll' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, b.columns.map(c => el('th', { textContent: c })))]),
    el('tbody', {}, b.rows.map(r => el('tr', {}, r.map(v => el('td', { textContent: v ?? '', className: typeof v === 'number' ? 'num' : '' }))))),
  ])]),
  stats: b => el('div', { className: 'stats' }, b.items.map(t => el('div', { className: 'stat' }, [
    el('div', { className: 'label', textContent: t.label }),
    el('div', { className: 'value', textContent: typeof t.value === 'number' ? t.value.toLocaleString('en-US') : t.value }),
    ...(Array.isArray(t.spark) && t.spark.length >= 2 ? [spark(t.spark)] : []),
    ...(t.delta !== undefined ? [el('div', { className: t.good === true ? 'good' : t.good === false ? 'bad' : 'note', textContent: String(t.delta) })] : []),
    ...(t.note ? [el('div', { className: 'note', textContent: t.note })] : []),
  ]))),
  chart: b => {
    const canvas = el('canvas')
    const x = b.x ?? b.columns[0], xi = b.columns.indexOf(x)
    const ys = b.y ?? b.columns.filter(c => c !== x)
    const donut = b.kind === 'donut', stacked = Boolean(b.stacked || b.percent)
    const totals = b.rows.map(r => ys.reduce((sum, c) => sum + (r[b.columns.indexOf(c)] ?? 0), 0))
    const value = (r, i, c) => { const v = r[b.columns.indexOf(c)]; return b.percent && v !== null && totals[i] ? (v / totals[i]) * 100 : v }
    Chart.defaults.color = P.dim; Chart.defaults.borderColor = P.line; Chart.defaults.font.family = P.font
    const datasets = donut
      ? [{ label: ys[0], data: b.rows.map(r => r[b.columns.indexOf(ys[0])]), backgroundColor: b.rows.map((_, i) => SERIES[i % SERIES.length]), borderColor: P.bg, borderWidth: 2 }]
      : ys.map((c, i) => ({ label: c, data: b.rows.map((r, j) => value(r, j, c)), borderColor: SERIES[i % SERIES.length], backgroundColor: b.kind === 'area' ? SERIES[i % SERIES.length] + (stacked ? '99' : '33') : SERIES[i % SERIES.length],
          fill: b.kind === 'area' ? (stacked && i > 0 ? '-1' : 'origin') : false, pointRadius: 0, tension: .2 }))
    const scale = { stacked, ...(b.percent ? { max: 100, ticks: { callback: v => v + '%' } } : typeof b.unit === 'string' ? { ticks: { callback: v => v + ' ' + b.unit } } : {}) }
    const options = donut ? { maintainAspectRatio: false, animation: false, cutout: '62%', plugins: { legend: { position: 'right' } } }
      : { maintainAspectRatio: false, animation: false, indexAxis: b.horizontal || (b.kind === 'bar' && b.rows.length > 12) ? 'y' : 'x', scales: { x: { stacked }, y: { stacked }, ...(b.horizontal ? { x: scale } : { y: scale }) } }
    later.push(() => new Chart(canvas, { type: donut ? 'doughnut' : b.kind === 'area' ? 'line' : b.kind, data: { labels: b.rows.map(r => r[xi]), datasets }, options }))
    return el('div', { className: donut ? 'chart donut' : 'chart' }, [canvas])
  },
  mermaid: b => el('div', { className: 'zoom' }, [
    el('div', { className: 'zbar' }, ['\\u2212', '+', 'Fit'].map(t => el('button', { textContent: t }))),
    el('pre', { className: 'mermaid', textContent: b.text }),
  ]),
  // Before and after side by side.
  compare: b => el('div', { className: 'compare' }, [
    el('figure', {}, [el('figcaption', { textContent: 'Before' }), el('img', { src: b.before })]),
    el('figure', {}, [el('figcaption', { textContent: 'After' }), el('img', { src: b.after })]),
  ]),
  image: b => el('figure', {}, [el('img', { src: b.url }), ...(b.caption ? [el('figcaption', { textContent: b.caption })] : [])]),
  diff: b => {
    const box = el('div')
    new Diff2HtmlUI(box, b.patch, { outputFormat: 'side-by-side', drawFileList: true, matching: 'lines', colorScheme: P.dark ? 'dark' : 'light' }).draw()
    return box
  },
}
function spark(values) {
  const ns = 'http://www.w3.org/2000/svg'
  const min = Math.min(...values), max = Math.max(...values), n = values.length
  const svg = document.createElementNS(ns, 'svg')
  for (const [k, v] of [['viewBox', '0 0 100 24'], ['preserveAspectRatio', 'none'], ['width', '100%'], ['height', '24']]) svg.setAttribute(k, v)
  const line = document.createElementNS(ns, 'polyline')
  const points = values.map((v, i) => (i * 100 / (n - 1)) + ',' + (22 - (v - min) * 20 / ((max - min) || 1))).join(' ')
  for (const [k, v] of [['points', points], ['fill', 'none'], ['stroke', P.accent], ['stroke-width', '1.5'], ['vector-effect', 'non-scaling-stroke']]) line.setAttribute(k, v)
  svg.append(line)
  return svg
}
const QUIET = ['table', 'chart', 'diff']
for (const b of spec.blocks) {
  if (b.title) view.append(el('h2', { className: 'block', textContent: b.title }))
  if (b.error) view.append(el('p', { className: 'error', textContent: b.error }))
  if (b.loading) { view.append(el('p', { className: 'note', textContent: 'loading\\u2026' })); continue }
  if (b.error && QUIET.includes(b.type)) continue
  try { view.append(render[b.type](b)) } catch (err) { view.append(el('p', { className: 'error', textContent: String(err) })) }
}
;(async () => {
  for (const draw of later) draw()
  mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { darkMode: P.dark, background: P.panel, primaryColor: P.panel, primaryTextColor: P.text, primaryBorderColor: P.accent, lineColor: P.dim, textColor: P.text, fontFamily: P.font } })
  await mermaid.run({ querySelector: '.mermaid' })
  for (const box of document.querySelectorAll('.zoom')) {
    const svg = box.querySelector('svg'); if (!svg) continue
    let k = 1, x = 0, y = 0, drag = null
    svg.style.transformOrigin = '0 0'
    const apply = () => { svg.style.transform = \`translate(\${x}px,\${y}px) scale(\${k})\` }
    const by = (f) => { k = Math.min(8, Math.max(0.2, k * f)); apply() }
    const [minus, plus, fit] = box.querySelectorAll('.zbar button')
    minus.onclick = () => by(1 / 1.25); plus.onclick = () => by(1.25); fit.onclick = () => { k = 1; x = 0; y = 0; apply() }
    box.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); by(e.deltaY < 0 ? 1.1 : 1 / 1.1) }, { passive: false })
    box.addEventListener('pointerdown', (e) => { if (e.target.closest('.zbar')) return; drag = { px: e.clientX - x, py: e.clientY - y }; box.setPointerCapture(e.pointerId) })
    box.addEventListener('pointermove', (e) => { if (!drag) return; x = e.clientX - drag.px; y = e.clientY - drag.py; apply() })
    box.addEventListener('pointerup', () => { drag = null })
  }
})()
window.__seen=${JSON.stringify(version)}
setInterval(() => {
  const s = document.createElement('script')
  s.src = ${JSON.stringify(stem + ".v.js")} + '?t=' + Date.now()
  s.onload = () => { s.remove(); if (window.__v !== undefined && window.__v !== window.__seen) location.reload() }
  s.onerror = () => s.remove()
  document.head.appendChild(s)
}, 1500)
</script>
</body></html>
`
}
