import { test } from "node:test"
import assert from "node:assert/strict"
import { palette, pageBlocks, pageHtml } from "./page.mjs"

test("palette defaults", () => {
  assert.deepEqual(palette(undefined), {
    dark: true, bg: "#111720", panel: "#0e131b", line: "#ffffff18", text: "#eeeeef", dim: "#96989c",
    accent: "#91b6ee", good: "#89c5aa", bad: "#e58c9a",
    series: ["#91b6ee", "#89c5aa", "#e5c07b", "#c678dd", "#e58c9a", "#56b6c2"],
    font: "Geist", mono: "MesloLGL Nerd Font Mono", size: 13,
  })
})

test("palette maps and sanitizes a theme file", () => {
  const p = palette({
    theme: { background: "#ffffff", foreground: "#111111", accent: "#0055ff80", ansi2: "nope" },
    settings: { dark: false, ui_font_family: 'Geist"; x', font_family: "Mono}; y", ui_font_size: 99 },
  })
  assert.equal(p.bg, "#ffffff")
  assert.equal(p.text, "#111111")
  assert.equal(p.series[0], "#0055ff")
  assert.equal(p.good, "#89c5aa")
  assert.equal(p.dark, false)
  assert.equal(p.font, "Geist x")
  assert.equal(p.mono, "Mono y")
  assert.equal(p.size, 20)
  assert.equal(palette({ settings: { ui_font_size: "big" } }).size, 13)
})

test("pageBlocks turns diagrams into mermaid", () => {
  assert.deepEqual(pageBlocks([{ type: "flow", title: "F", nodes: [{ id: "a", label: "A" }] }], new Map())[0], {
    type: "mermaid", title: "F", text: 'flowchart TD\n  n0["A"]',
  })
})

test("pageBlocks urls, extras and loading", () => {
  assert.equal(pageBlocks([{ type: "image", path: "/tmp/a b#1.png" }], new Map())[0].url, "file:///tmp/a%20b%231.png")
  const c = pageBlocks([{ type: "compare", before: "/tmp/a b.png", after: "https://x/y.png" }], new Map())[0]
  assert.equal(c.before, "file:///tmp/a%20b.png")
  assert.equal(c.after, "https://x/y.png")
  assert.equal(pageBlocks([{ type: "diff", repo: "/r" }], new Map([[0, { patch: "P" }]]))[0].patch, "P")
  assert.equal(pageBlocks([{ type: "diff", repo: "/r" }], new Map([[0, { error: "E" }]]))[0].error, "E")
  assert.equal(pageBlocks([{ type: "table", command: "x" }], new Map())[0].loading, true)
  assert.equal(pageBlocks([{ type: "log", command: "x" }], new Map())[0].loading, undefined)
})

test("pageHtml escapes and embeds", () => {
  const html = pageHtml({
    stem: "t1-p", title: "A <b>", blocks: [{ type: "markdown", text: "</script><script>alert(1)" }],
    palette: palette(), version: "v7",
  })
  assert.ok(html.includes("<title>A &lt;b></title>"))
  assert.ok(!html.includes("</script><script>alert(1)"))
  assert.ok(html.includes('window.__seen="v7"'))
  assert.ok(html.includes("t1-p.v.js"))
  assert.ok(html.includes("--bg: #111720"))
})

const gen = (o = {}) => pageHtml({ stem: "s", title: "t", blocks: [], palette: palette(), version: "v1", ...o })

test("pageHtml cannot be broken out of the script via stem or version", () => {
  const html = gen({ stem: "a</script><script>alert(1)//", version: 'v"</script><img src=x onerror=alert(1)>' })
  assert.ok(!html.includes("</script><script>alert(1)"))
  assert.ok(!html.includes("</script><img"))
})

test("page script drops markdown images", () => {
  assert.ok(/marked\.use\([^\n]*image: \(href, title, text\)/.test(gen()))
})

test("page script survives a bad mermaid block and a bad chart", () => {
  const html = gen()
  assert.ok(html.includes("suppressErrors: true"))
  assert.ok(html.includes("try { draw() } catch (err) { console.error(err) }"))
})

test("page script moves chart value-axis options with the flipped axis", () => {
  const html = gen()
  assert.ok(html.includes("const hz = b.horizontal || (b.kind === 'bar' && b.rows.length > 12)"))
  assert.ok(html.includes("indexAxis: hz ?"))
  assert.ok(html.includes("hz ? { x: scale } : { y: scale }"))
})

test("page script gives charts and mermaid a font stack", () => {
  const html = gen()
  assert.ok(html.includes("BlinkMacSystemFont, sans-serif'"))
  assert.ok(html.includes("fontFamily: FONT"))
  assert.ok(html.includes("Chart.defaults.font.family = FONT"))
})

test("page zoom: one padding, visible overflow, pointercancel", () => {
  const html = gen()
  assert.ok(html.includes("k = Math.max(0.05, Math.min(1, b.width / s.width, (b.height - (s.top - b.top) - 8) / s.height)) || 1"))
  assert.ok(html.includes(".zoom .mermaid { margin: 0; cursor: grab; overflow: visible; }"))
  assert.ok(html.includes("box.addEventListener('pointercancel'"))
})

test("diff2html inherits the page colours", () => {
  assert.ok(gen().includes(".d2h-file-list-wrapper, .d2h-files-diff"))
})
