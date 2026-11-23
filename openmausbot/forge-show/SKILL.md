---
name: forge-show
description: Draw charts, stat tiles, tables, flow and sequence diagrams, Mermaid, pictures, diffs or markdown as a card in an OpenMausBot chat. Use when you have a show_html tool and an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a process, an architecture or an exchange between parts. Not for a session that has the mcp__forge__show tool - use that tool there.
---

# Forge show, in an OpenMausBot chat

Whenever an answer holds a trend, a breakdown, a distribution, a comparison, a share, a ranking, a process, an architecture or an exchange between parts, draw it as a card in the chat, without being asked: figures as a stats block, numbers as charts, structure as flow, Mermaid or sequence blocks. Keep the written answer to what the picture means. Do not hand-write an HTML page for what these blocks can draw.

If this session has a tool named `mcp__forge__show`, stop here and use that tool. This skill is for a session with a `show_html` tool.

## Draw

1. **Write the view** as JSON to `.forge-show/<name>.json` in your working folder, with your file tool. `<name>` is a short name for the drawing: lowercase letters, digits and dashes, at most 40 characters, starting with a letter or digit. Use the same `<name>` as the view's `pane`.

   ```json
   { "pane": "<name>", "title": "<the card's heading>", "blocks": [ ... ] }
   ```

2. **Build the page.** Run this from your working folder, exactly as written (no other quoting, no substitution):

   ```sh
   node "$HOME/.claude/skills/forge-show/page.mjs" .forge-show/<name>.json
   ```

   It prints one JSON line. `{"result": ...}` means the page is in `.forge-show/<name>/` and says what to do next. `{"deny": ...}` names what is wrong and where (`at /blocks/2/rows: ...`): fix the view and run it again.

3. **Show it**, when the result says to: call `show_html` with `path` set to `.forge-show/<name>`, `live` set to true, and a `title` (one line, at most 80 characters).

To change a drawing, write the view again under the same `<name>` and run step 2 again. The live card reloads by itself, so do not call `show_html` again for it, unless this conversation has no card for that folder (a new conversation, or the person says the card is gone): then call it once, as in step 3. A different `<name>` makes a new card.

## Blocks

Any block takes an optional `title`.

- `{type:"stats", items:[{label, value, note?, delta?, good?, spark?:[numbers]}]}`: headline figures as tiles, 1 to 8 items. `good` says whether the delta is good news.
- `{type:"chart", kind:"line"|"area"|"bar"|"donut", columns, rows, x?, y?:[columns], stacked?, percent?, horizontal?, unit?}`: rows are arrays of strings, numbers, booleans or null. Line or area over time, bar for categories, `horizontal:true` for rankings and long names, `stacked:true` or `percent:true` for parts of a whole per category, donut for one whole split in a few parts.
- `{type:"table", columns, rows}`: at most 5000 rows; cells are strings, numbers, booleans or null.
- `{type:"flow", nodes:[{id, label, kind?:"box"|"round"|"decision"}], edges:[{from, to, label?}], direction?:"down"|"right"}`: 1 to 60 nodes.
- `{type:"sequence", actors?:[...], messages:[{from, to, label, reply?} | {note, over}]}`
- `{type:"mermaid", text}`
- `{type:"image", path|url, caption?}`: `path` is an absolute file path, starting with `/` (run `pwd` for your working folder's; the picture is copied into the page folder); `url` is http or https.
- `{type:"compare", before, after}`: two pictures side by side, each an absolute path or an http(s) URL.
- `{type:"diff", repo:<absolute path>, base?}` or `{type:"diff", patch}`
- `{type:"markdown", text}`

## Not here

- A table or chart cannot take a `command`: run the command yourself and pass `columns` and `rows`. To keep a drawing fresh, write its view again (for example from a schedule).
- There are no log, choice or confirm blocks: show command output as markdown or a table, and ask questions with the chat's own question tools.
- The page loads Chart.js and Mermaid from jsdelivr, so it needs a network connection.
