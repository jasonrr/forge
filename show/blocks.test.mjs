import { test } from "node:test"
import assert from "node:assert/strict"
import { PAGE, TYPES, specError, flowText, sequenceText, rowsFrom, answerText } from "./blocks.mjs"

const view = (block) => ({ pane: "a", title: "T", blocks: [block] })
const bad = (v, path) => {
  const err = specError(v)
  assert.equal(typeof err, "string", `expected an error at ${path}`)
  assert.ok(err.startsWith(`at ${path}:`), err)
}
const ok = (block) => assert.equal(specError(view(block)), undefined)
const badBlock = (block, path = "/blocks/0/") => bad(view(block), path.endsWith("/") ? path.slice(0, -1) : path)

test("type lists", () => {
  assert.deepEqual(PAGE, ["markdown", "stats", "table", "chart", "flow", "sequence", "mermaid", "image", "compare", "diff"])
  assert.deepEqual(TYPES, [...PAGE, "log", "choice", "confirm"])
})

test("valid view", () => {
  assert.equal(specError({ pane: "a", title: "T", blocks: [{ type: "markdown", text: "hi" }] }), undefined)
})

test("pane, title, placement, blocks, in order", () => {
  bad({ pane: "Bad Name", title: "t", blocks: [{ type: "markdown", text: "x" }] }, "/pane")
  bad({ pane: "Bad Name", title: "t", blocks: [] }, "/pane")
  bad({ pane: "-a", title: "t", blocks: [{ type: "markdown", text: "x" }] }, "/pane")
  bad({ pane: "a".repeat(41), title: "t", blocks: [{ type: "markdown", text: "x" }] }, "/pane")
  bad({ pane: "a", title: 1, blocks: [] }, "/title")
  bad({ pane: "a", title: "t", placement: "left", blocks: [{ type: "markdown", text: "x" }] }, "/placement")
  assert.equal(specError({ pane: "a", title: "t", placement: "down", blocks: [{ type: "markdown", text: "x" }] }), undefined)
  bad({ pane: "a", title: "t", blocks: [] }, "/blocks")
  bad({ pane: "a", title: "t", blocks: "x" }, "/blocks")
  bad({ pane: "a", title: "t", blocks: [1] }, "/blocks")
})

test("unknown types and block title", () => {
  badBlock({ type: "blueprint", text: "x" }, "/blocks/0/type")
  badBlock({ type: "ci" }, "/blocks/0/type")
  badBlock({ type: "markdown", text: "x", title: 3 }, "/blocks/0/title")
  ok({ type: "markdown", text: "x", title: "ok" })
  bad({ pane: "a", title: "t", blocks: [{ type: "markdown", text: "x" }, { type: "nope" }] }, "/blocks/1/type")
})

test("markdown and mermaid", () => {
  ok({ type: "mermaid", text: "flowchart TD" })
  badBlock({ type: "markdown" }, "/blocks/0/text")
  badBlock({ type: "mermaid", text: 1 }, "/blocks/0/text")
})

test("stats", () => {
  ok({ type: "stats", items: [{ label: "a", value: 1, spark: [1, 2] }, { label: "b", value: "x" }] })
  badBlock({ type: "stats", items: [] }, "/blocks/0/items")
  badBlock({ type: "stats", items: Array.from({ length: 9 }, () => ({ label: "a", value: 1 })) }, "/blocks/0/items")
  badBlock({ type: "stats", items: [{ label: 1, value: 1 }] }, "/blocks/0/items/0/label")
  badBlock({ type: "stats", items: [{ label: "a", value: true }] }, "/blocks/0/items/0/value")
  badBlock({ type: "stats", items: [{ label: "a", value: 1, spark: ["x"] }] }, "/blocks/0/items/0/spark")
})

test("table", () => {
  ok({ type: "table", columns: ["a", "b"], rows: [[1, "x"], [null, true]] })
  ok({ type: "table", command: "echo hi" })
  ok({ type: "table", command: "echo hi", every: 5 })
  badBlock({ type: "table" }, "/blocks/0/columns")
  badBlock({ type: "table", columns: [], rows: [] }, "/blocks/0/columns")
  badBlock({ type: "table", columns: ["a"] }, "/blocks/0/rows")
  badBlock({ type: "table", columns: ["a"], rows: [[1, 2]] }, "/blocks/0/rows/0")
  badBlock({ type: "table", columns: ["a"], rows: [[{}]] }, "/blocks/0/rows/0/0")
  badBlock({ type: "table", columns: ["a"], rows: Array.from({ length: 5001 }, () => [1]) }, "/blocks/0/rows")
  badBlock({ type: "table", command: "" }, "/blocks/0/command")
  badBlock({ type: "table", command: "x", every: 4 }, "/blocks/0/every")
})

test("chart", () => {
  ok({ type: "chart", kind: "line", columns: ["a", "b"], rows: [[1, 2]], x: "a", y: ["b"] })
  ok({ type: "chart", kind: "bar", command: "x" })
  badBlock({ type: "chart", columns: ["a"], rows: [[1]] }, "/blocks/0/kind")
  badBlock({ type: "chart", kind: "pie", columns: ["a"], rows: [[1]] }, "/blocks/0/kind")
  badBlock({ type: "chart", kind: "line", columns: ["a"], rows: [[1]], x: "z" }, "/blocks/0/x")
  badBlock({ type: "chart", kind: "line", columns: ["a"], rows: [[1]], y: [] }, "/blocks/0/y")
  badBlock({ type: "chart", kind: "line", columns: ["a"], rows: [[1]], y: ["z"] }, "/blocks/0/y")
})

test("flow", () => {
  const nodes = [{ id: "a", label: "A" }, { id: "b", label: "B", kind: "round" }]
  ok({ type: "flow", nodes, edges: [{ from: "a", to: "b", label: "x" }], direction: "right" })
  badBlock({ type: "flow", nodes: [] }, "/blocks/0/nodes")
  badBlock({ type: "flow", nodes: Array.from({ length: 61 }, (_, i) => ({ id: `n${i}`, label: "x" })) }, "/blocks/0/nodes")
  badBlock({ type: "flow", nodes: [{ id: "", label: "A" }] }, "/blocks/0/nodes/0/id")
  badBlock({ type: "flow", nodes: [{ id: "a", label: 1 }] }, "/blocks/0/nodes/0/label")
  badBlock({ type: "flow", nodes: [{ id: "a", label: "A" }, { id: "a", label: "B" }] }, "/blocks/0/nodes/1/id")
  badBlock({ type: "flow", nodes: [{ id: "a", label: "A", kind: "star" }] }, "/blocks/0/nodes/0/kind")
  badBlock({ type: "flow", nodes, edges: [{ from: "z", to: "b" }] }, "/blocks/0/edges/0/from")
  badBlock({ type: "flow", nodes, edges: [{ from: "a", to: "z" }] }, "/blocks/0/edges/0/to")
  badBlock({ type: "flow", nodes, edges: [{ from: "a", to: "b", label: 1 }] }, "/blocks/0/edges/0/label")
  badBlock({ type: "flow", nodes, direction: "up" }, "/blocks/0/direction")
})

test("sequence", () => {
  ok({ type: "sequence", actors: ["a", { id: "b", label: "B" }, { id: "c" }], messages: [{ from: "a", to: "b", label: "x" }, { note: "n", over: "a" }] })
  badBlock({ type: "sequence", actors: "a", messages: [{ from: "a", to: "b" }] }, "/blocks/0/actors")
  badBlock({ type: "sequence", actors: [1], messages: [{ from: "a", to: "b" }] }, "/blocks/0/actors/0")
  badBlock({ type: "sequence", actors: [{ id: 1 }], messages: [{ from: "a", to: "b" }] }, "/blocks/0/actors/0")
  badBlock({ type: "sequence", messages: [] }, "/blocks/0/messages")
  badBlock({ type: "sequence", messages: [{ from: "a" }] }, "/blocks/0/messages/0")
  badBlock({ type: "sequence", messages: [{ from: "a", to: "b", label: 1 }] }, "/blocks/0/messages/0/label")
  badBlock({ type: "sequence", messages: [{ note: "n" }] }, "/blocks/0/messages/0")
})

test("image and compare", () => {
  ok({ type: "image", path: "/tmp/x.png" })
  ok({ type: "image", url: "https://x.test/a.png" })
  badBlock({ type: "image" }, "/blocks/0")
  badBlock({ type: "image", path: "/a", url: "http://b" }, "/blocks/0")
  badBlock({ type: "image", path: "rel.png" }, "/blocks/0/path")
  badBlock({ type: "image", url: "ftp://x" }, "/blocks/0/url")
  ok({ type: "compare", before: "/a.png", after: "http://x/b.png" })
  badBlock({ type: "compare", before: "a.png", after: "/b.png" }, "/blocks/0/before")
  badBlock({ type: "compare", before: "/a.png" }, "/blocks/0/after")
})

test("diff", () => {
  ok({ type: "diff", patch: "x" })
  ok({ type: "diff", repo: "/r", base: "origin/main" })
  badBlock({ type: "diff" }, "/blocks/0")
  badBlock({ type: "diff", patch: "x", repo: "/r" }, "/blocks/0")
  badBlock({ type: "diff", patch: "x".repeat(500001) }, "/blocks/0/patch")
  badBlock({ type: "diff", repo: "r" }, "/blocks/0/repo")
  badBlock({ type: "diff", repo: "/r", base: "-x; rm" }, "/blocks/0/base")
})

test("log, choice, confirm", () => {
  ok({ type: "log", command: "tail x", every: 1, lines: 10 })
  badBlock({ type: "log", command: "" }, "/blocks/0/command")
  badBlock({ type: "log", command: "x", every: 0 }, "/blocks/0/every")
  badBlock({ type: "log", command: "x", lines: 0 }, "/blocks/0/lines")
  ok({ type: "choice", prompt: "p", options: [{ label: "a", preview: "x" }, { label: "b" }] })
  badBlock({ type: "choice", options: [{ label: "a" }] }, "/blocks/0/options")
  badBlock({ type: "choice", options: [{ label: "a" }, { label: 1 }] }, "/blocks/0/options/1/label")
  badBlock({ type: "choice", options: [{ label: "a", preview: 1 }, { label: "b" }] }, "/blocks/0/options/0/preview")
  badBlock({ type: "choice", prompt: 1, options: [{ label: "a" }, { label: "b" }] }, "/blocks/0/prompt")
  ok({ type: "confirm", summary: "s", consequence: "c", confirm_label: "Go" })
  badBlock({ type: "confirm" }, "/blocks/0/summary")
  badBlock({ type: "confirm", summary: "s", consequence: 1 }, "/blocks/0/consequence")
  badBlock({ type: "confirm", summary: "s", confirm_label: 1 }, "/blocks/0/confirm_label")
})

test("flowText", () => {
  assert.equal(
    flowText({ nodes: [{ id: "a", label: 'A "x"' }, { id: "b", label: "B", kind: "decision" }], edges: [{ from: "a", to: "b", label: "go" }], direction: "right" }),
    'flowchart LR\n  n0["A #quot;x#quot;"]\n  n1{"B"}\n  n0 -->|"go"| n1',
  )
})

test("sequenceText", () => {
  assert.equal(
    sequenceText({ messages: [{ from: "M", to: "S", label: "hi" }, { note: "n", over: "S" }, { from: "S", to: "M", label: "ok", reply: true }] }),
    "sequenceDiagram\n  participant a0 as M\n  participant a1 as S\n  a0->>a1: hi\n  Note over a1: n\n  a1-->>a0: ok",
  )
})

test("rowsFrom", () => {
  assert.deepEqual(rowsFrom({ columns: ["a"], rows: [[1]] }), { columns: ["a"], rows: [[1]] })
  assert.deepEqual(rowsFrom([{ a: 1, b: "x" }, { b: "y", c: 2 }]), { columns: ["a", "b", "c"], rows: [[1, "x", null], [null, "y", 2]] })
  for (const input of ["nope", { columns: "a", rows: [] }, [1, 2]]) {
    assert.throws(() => rowsFrom(input), (e) => e instanceof Error && e.message.startsWith("command output:"))
  }
})

test("answerText", () => {
  assert.equal(answerText("p", { type: "choice", prompt: "Which?" }, { label: "Blue", value: "b" }), 'In the p pane I chose "Blue" (value: b) for: Which?')
  assert.equal(answerText("p", { type: "choice", prompt: "Which?" }, { label: "Blue" }), 'In the p pane I chose "Blue" for: Which?')
  assert.equal(answerText("p", { type: "choice", prompt: "Which?" }, { label: "Blue", value: "Blue" }), 'In the p pane I chose "Blue" for: Which?')
  assert.equal(answerText("p", { type: "choice" }, { label: "Blue", value: "b" }), 'In the p pane I chose "Blue" (value: b)')
  assert.equal(answerText("p", { type: "confirm", summary: "Delete it?\nmore" }, { confirmed: true }), "In the p pane I confirmed: Delete it?")
  assert.equal(answerText("p", { type: "confirm", summary: "Delete it?\nmore" }, { confirmed: false }), "In the p pane I declined: Delete it?")
})
