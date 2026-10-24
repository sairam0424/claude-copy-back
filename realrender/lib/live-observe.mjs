// Watching the screen and the side channels around one /cc invocation.
// Everything here reads a captured screen string or a file; the tmux and
// session handles are passed in, so the pure parts are tested on canned text.

import fs from "node:fs";
import { findOsc52 } from "./osc52.mjs";
import { logLength, pbpasteCallsSince, writerCallsSince } from "./shims.mjs";
import { readStubLog } from "./stubproc.mjs";
import { extractToasts, hasToast } from "./toast.mjs";
import { LIVE_RULE } from "./live-rule.mjs";
import { sleep } from "./util.mjs";

const DIVIDER = /^─{10,}$/;
export const BUSY_TEXT = "esc to interrupt";

/** The live prompt row (a "❯" row with a divider row right above it), as {row, empty}, or null. */
export function promptOf(screen) {
  const rows = screen.split("\n");
  for (let r = rows.length - 1; r > 0; r -= 1) {
    if (rows[r].startsWith("❯") && DIVIDER.test(rows[r - 1])) {
      return { row: r, empty: rows[r].slice(1).replace(/\s/g, "") === "" };
    }
  }
  return null;
}

/** Idle: the prompt is empty, nothing is running and no toast is up. */
export function isIdle(screen) {
  const prompt = promptOf(screen);
  return Boolean(prompt?.empty) && !screen.includes(BUSY_TEXT) && !hasToast(screen);
}

/** Read the bytes of `file` from `offset` on. */
export function readFrom(file, offset) {
  const size = fs.statSync(file).size;
  if (size <= offset) return Buffer.alloc(0);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

const sessionLines = (ctx) => fs.readFileSync(ctx.sessionFile, "utf8").split("\n").filter(Boolean);

/** Where every side channel stands right now. */
export function takeMark(ctx) {
  return {
    raw: fs.statSync(ctx.rawFile).size,
    pbpaste: logLength(ctx.shimDir, "pbpaste"),
    clip: logLength(ctx.shimDir, "clip"),
    stub: readStubLog(ctx.stub.logPath).length,
    session: sessionLines(ctx).length,
  };
}

/** What each side channel gained since `mark`. */
export function collectSince(ctx, mark) {
  const added = sessionLines(ctx).slice(mark.session).map((line) => {
    const rec = JSON.parse(line);
    return { type: rec.type, role: rec.message?.role ?? null, bytes: line.length };
  });
  return {
    pbpasteCalls: pbpasteCallsSince(ctx.shimDir, mark.pbpaste).length,
    writers: writerCallsSince(ctx.shimDir, mark.clip),
    osc52: findOsc52(readFrom(ctx.rawFile, mark.raw), mark.raw),
    stubRequests: readStubLog(ctx.stub.logPath).slice(mark.stub).map((l) => `${l.method} ${l.target}`),
    sessionAdded: added,
  };
}

const SETTLE_POLL_MS = 100;
const SETTLE_MAX_POLLS = 30;

/**
 * After the toast window: if the terminal channel (OSC 52) wrote but the native
 * tool's shim has not logged its call yet, wait for it, at most `maxPolls`
 * polls of 100 ms. The engine starts the native tool without waiting for it, so
 * its log line can land after the toast and the quiet window; without this wait
 * the line falls between two cases and belongs to none (seen in a development
 * launch: 2 of 11 cases). Returns { polls, settled }; `settled` false means the
 * limit was reached and the line was still missing.
 */
export async function settleWrites(ctx, mark, { collect = collectSince, maxPolls = SETTLE_MAX_POLLS } = {}) {
  for (let polls = 1; polls <= maxPolls; polls += 1) {
    const got = collect(ctx, mark);
    const wroteOnTerminal = got.osc52.some((o) => o.kind === "write");
    if (!wroteOnTerminal || got.writers.length > 0) return { polls, settled: true };
    await ctx.watch.wait(SETTLE_POLL_MS);
  }
  return { polls: maxPolls, settled: false };
}

/**
 * Every call of a clipboard-writer shim must belong to some case. `shimCalls`
 * is the number of lines in the writers' log at the end of the launch;
 * `cases` are the scored cases (each lists the writer calls it was given).
 * A call that no case holds was made outside every observation window and
 * counts as a write event nobody judged.
 */
export function reconcileWrites(shimCalls, cases) {
  const attributed = cases.reduce((n, c) => n + (c.writerCalls?.length ?? 0), 0);
  return { shimCalls, attributed, unattributed: Math.max(0, shimCalls - attributed) };
}

/** Wait until the screen is idle (no toast, no spinner, empty prompt); clears typed text if it stays. Returns the reason. */
export async function waitIdle(ctx, maxMs = 7000) {
  const end = Date.now() + maxMs;
  let cleared = false;
  while (Date.now() < end) {
    const screen = ctx.tmux.capture("plain");
    if (isIdle(screen)) return "idle";
    const prompt = promptOf(screen);
    if (prompt && !prompt.empty && !cleared && end - Date.now() < maxMs / 2) {
      ctx.tmux.sendKeys("C-u");
      cleared = true;
    }
    await ctx.watch.wait(150);
  }
  return "not-idle";
}

/** Type /cc into the prompt and press Enter. */
export async function typeCc(ctx) {
  ctx.tmux.sendKeys("-l", "/cc");
  await ctx.watch.wait(300);
  ctx.tmux.sendKeys("Enter");
}

/**
 * Poll the screen after Enter until the toast has been up for quietMs and the
 * spinner is gone, or windowMaxMs passes. Returns the distinct toasts seen.
 */
export async function observe(ctx) {
  const R = LIVE_RULE;
  const t0 = Date.now();
  const toasts = new Map();
  let toastAt = null;
  let tail = [];
  while (Date.now() - t0 < R.windowMaxMs) {
    await ctx.watch.wait(100);
    const screen = ctx.tmux.capture("plain");
    for (const t of extractToasts(screen)) {
      toasts.set(`${t.text}|${t.truncated}`, t);
      if (toastAt === null) {
        toastAt = Date.now();
        tail = screen.split("\n").filter((r) => r.trim()).slice(-6);
      }
    }
    if (toastAt !== null && !screen.includes(BUSY_TEXT) && Date.now() - toastAt >= R.quietMs) break;
  }
  const settleMs = toastAt === null ? null : toastAt - t0;
  return { toasts: [...toasts.values()], toastAfterMs: settleMs, endedBy: toastAt === null ? "timeout" : "toast", tail };
}

/** Sleep helper re-exported for the drivers. */
export { sleep };
