// forge-show: the helper forge's show script calls with `herdr-app do mod.open --name forge-show`. It reads
// ~/.cache/forge/show/request.json, writes Herdr's theme colours where the script can read them, opens each asked
// terminal as a floating window, writes ack.json, then closes itself. It draws nothing.
import { View, div } from "gpui-kit";
import { props, openOverlay, closeOverlay, readTextFile, writeTextFile, home, theme, settings } from "herdr";
const DIR = `${home()}/.cache/forge/show`;
export default class ForgeShow extends View {
  init(_p, cx) {
    cx.spawn(async () => {
      let id = "";
      try {
        const req = JSON.parse((await readTextFile(`${DIR}/request.json`)) ?? "{}");
        id = String(req.id ?? "");
        if (req.theme) await writeTextFile(`${DIR}/theme.json`, JSON.stringify({ key: req.key ?? "", theme: theme(), settings: settings() }));
        for (const f of Array.isArray(req.floats) ? req.floats : []) {
          if (typeof f?.terminal !== "string") continue;
          openOverlay({ kind: "window", key: String(f.key ?? f.terminal), layout: { type: "block", content: { terminal: f.terminal } }, width: f.width ?? 640, height: f.height ?? 320 });
        }
      } catch (e) { /* a bad request draws nothing; the script falls back to its default palette */ }
      try { await writeTextFile(`${DIR}/ack.json`, JSON.stringify({ id })); } catch (e) { }
      if (props()?.overlay) closeOverlay(props().overlay); // only this overlay, by its captured id (docs/learnings.md:14)
    });
  }
  render() { return div(); }
}
