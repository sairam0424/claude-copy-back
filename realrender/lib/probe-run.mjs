// Driving the rows probe in a live session: type /probe, read the one-line
// toast (counts and a checksum, never text). Waits for an older probe toast to
// leave the screen first, so two questions in one session do not read the
// same line twice.

import { waitIdle } from "./live-observe.mjs";
import { parseProbeToast } from "./probe-expect.mjs";

const MARK = "probe rows=";

const probeRows = (screen) => screen.split("\n").filter((row) => row.includes(MARK)).map((row) => row.trim());

async function waitGone(ctx, maxMs) {
  const end = Date.now() + maxMs;
  while (Date.now() < end && probeRows(ctx.tmux.capture("plain")).length) await ctx.watch.wait(200);
}

/** Ask the probe once. Returns {toast, parsed} (null when no toast appeared in time). */
export async function askProbe(ctx, timeoutMs = 8000) {
  await waitGone(ctx, 6000);
  await waitIdle(ctx);
  ctx.tmux.sendKeys("-l", "/probe");
  await ctx.watch.wait(500);
  ctx.tmux.sendKeys("Enter");
  const t0 = Date.now();
  let seen = [];
  while (Date.now() - t0 < timeoutMs && seen.length === 0) {
    await ctx.watch.wait(100);
    seen = probeRows(ctx.tmux.capture("plain"));
  }
  return { toast: seen[0] ?? null, parsed: seen.length ? parseProbeToast(seen[0]) : null };
}
