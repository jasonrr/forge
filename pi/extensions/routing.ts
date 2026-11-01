import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Single copy of the routing block, shared with hooks/session-start.sh.
// Read at import so a wrong path fails loudly at load, not silently per turn.
// Assumes pi loads this file in place (it does today); a bundler would break the relative path.
const DEV_LOOP_BLOCK = readFileSync(new URL("../../hooks/routing.md", import.meta.url), "utf8").trimEnd();

// Mirrors hooks/session-start.sh: look in cwd first, then its git toplevel; in each,
// .claude/dev-loop.md then the older .claude/tally-dev-loop.md. The first that is a
// regular file (`[ -f ]`) decides alone — an unreadable one means off, never a
// fall-through. A `routing: on` line, exact (no CRLF).
export function routingEnabled(cwd: string): boolean {
  for (const dir of [cwd, gitToplevel(cwd)]) {
    if (!dir) continue;
    for (const name of ["dev-loop.md", "tally-dev-loop.md"]) {
      const p = join(dir, ".claude", name);
      if (!statSync(p, { throwIfNoEntry: false })?.isFile()) continue;
      try {
        return readFileSync(p, "utf8").split("\n").some((line) => line === "routing: on");
      } catch {
        return false;
      }
    }
  }
  return false;
}

// ponytail: one git call per turn (~ms); cache per cwd if it ever shows up in profiles.
function gitToplevel(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return "";
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    // Injected every turn (not once per session): pi resets systemPrompt to
    // base before each call, so a once-per-session flag would only ever fire
    // on turn 1. Content-guarded instead, so re-injection is a no-op if pi
    // ever starts accumulating systemPrompt across turns.
    if (!routingEnabled(ctx.cwd)) return;
    if (event.systemPrompt.includes(DEV_LOOP_BLOCK)) return;
    // Framework-free test marker: greppable on stderr in -p mode. Only there —
    // in the interactive TUI, stderr paints over the "Working" line every turn.
    if (!ctx.hasUI) console.error("[loop-routing] dev-loop routing injected");
    return { systemPrompt: `${event.systemPrompt}\n\n${DEV_LOOP_BLOCK}` };
  });
}
