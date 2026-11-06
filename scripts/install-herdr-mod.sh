#!/usr/bin/env bash
# Point Herdr at the forge mod in this checkout: ~/.config/herdr-app/mods/forge -> herdr/mods/forge.
# Also adds Forge keys to keys.json and prints how to hide the old docked block. Idempotent. A real folder already there (the old hand-made mod) is moved aside, never deleted.
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)/herdr/mods/forge"
dst="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods/forge"
[ -f "$src/main.js" ] || { echo "install-herdr-mod: $src/main.js missing" >&2; exit 1; }
mkdir -p "$(dirname "$dst")"
linked=
if [ -L "$dst" ]; then
  if [ "$(readlink "$dst")" = "$src" ]; then linked=1; echo "install-herdr-mod: already linked"; else rm "$dst"; fi
elif [ -e "$dst" ]; then
  mv "$dst" "$(dirname "$(dirname "$dst")")/forge-mod.bak-$(date +%Y%m%d%H%M%S)" # out of mods/, or Herdr loads the backup as a second mod
fi
[ -n "$linked" ] || { ln -s "$src" "$dst"; echo "install-herdr-mod: $dst -> $src"; }

app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
node - "$app" <<'EOF'
const fs = require("fs"), path = require("path"), app = process.argv[2], f = path.join(app, "keys.json");
const want = {
  "cmd-shift-h": { command: "tab.new", args: { name: "Forge", mod: "forge", props: { view: "home" } } },
  "cmd-shift-n": "mod.open:forge",
  "cmd-shift-j": { command: "pane.split", args: { direction: "right", mod: "forge", props: { view: "track" } } },
};
let k = null;
try { k = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { console.log(e.code === "ENOENT" ? `install-herdr-mod: no ${f} yet (Herdr writes it on first run); keys not added; open Herdr once, then rerun.` : `install-herdr-mod: ${f} is not valid JSON; keys not added.`); }
if (k) {
  const g = (k.global ??= {}); let changed = false;
  for (const [key, act] of Object.entries(want)) {
    if (JSON.stringify(g[key]) === JSON.stringify(act)) continue;
    if (key in g) { console.log(`install-herdr-mod: ${key} is already bound to ${JSON.stringify(g[key])}; left it. Bind Forge yourself if you want it.`); continue; } // never replace a key they use
    g[key] = act; changed = true;
  }
  if (changed) { fs.writeFileSync(f, JSON.stringify(k, null, 2) + "\n"); console.log("install-herdr-mod: added Forge keys (cmd-shift-h Home, cmd-shift-n Start, cmd-shift-j track pane). keys.json is now yours: new Herdr default shortcuts won't arrive automatically."); }
}
// The old docked block: print how to hide it; never hide it ourselves (the person decides; layout.show undoes it).
const dir = path.join(app, "layouts");
for (const name of (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((n) => n.endsWith(".json"))) {
  let tree; try { tree = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch { continue; }
  const found = [], walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "block" && n.content?.mod === "forge" && n.id) found.push(n.id); for (const v of Object.values(n)) walk(v); };
  walk(tree);
  for (const id of found) console.log(`install-herdr-mod: layout ${name} still has the old docked Forge block. Hide it: herdr-app do layout.hide '{"id":"${id}"}'   (undo: layout.show)`);
}
EOF
