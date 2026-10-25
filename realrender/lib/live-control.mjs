// The control launch of the live pass: one extra sealed launch that does two
// jobs the four counted launches cannot.
//
// 1. A UNICODE PROBE. The generator's text never contains an em dash, a zero
//    width joiner, a flag, a combining mark, a no-break space or right-to-left
//    text, so the counted pass cannot cover them. A small synthetic session of
//    six replies holds them, and /cc runs on exact copies of lines and parts of
//    lines of those replies, through the real engine and the shims.
// 2. A POSITIVE CONTROL for "/cc starts no model turn". Zero requests in the
//    stub log during /cc means something only if the stub WOULD log a model
//    request. After the /cc cases, an ordinary prompt is submitted in the same
//    session; the stub must then log at least one POST to /v1/messages. The
//    stub answers 401 on loopback, so no model is reached and nothing is spent.

import fs from "node:fs";
import path from "node:path";
import { canaryHits, runCase } from "./live-run.mjs";
import { BUSY_TEXT, captureAccountError, reconcileWrites, settleCaptureAccounting, takeMark, waitIdle } from "./live-observe.mjs";
import { closeSession, openSession, stubRequests, waitDrawn } from "./live-session.mjs";
import { profileRecord } from "./profile.mjs";
import { logLength } from "./shims.mjs";
import { summarize } from "./netproof.mjs";
import { unicodeClasses } from "./unicode-classes.mjs";

export const PROBE_MARKER = "zebra7741";
export const PROBE_WIDTH = 120;
const PROMPT_TEXT = "hello";
const PROMPT_WAIT_MS = 30_000;
const RETRY_GRACE_MS = 3000;

const FAMILY = "\u{1F468}\u200d\u{1F469}\u200d\u{1F467}\u200d\u{1F466}";

/** [reply text, [parts of it that are copied on their own]] */
const PROBE = [
  ["Every café needs a résumé — naïve façade checks → done by noon today.", ["résumé — naïve façade checks → done by noon"]],
  ["日本語のテキストと絵文字 \u{1F680}\u{1F389} stay exactly as written in this reply.", ["絵文字 \u{1F680}\u{1F389} stay exactly as written"]],
  [`Family ${FAMILY} joined emoji keep their zero width joiners here.`, [`${FAMILY} joined emoji keep their zero width joiners`]],
  ["Flags \u{1F1EE}\u{1F1F3} and \u{1F1EF}\u{1F1F5} plus é with a combining accent stay intact.", ["and \u{1F1EF}\u{1F1F5} plus é with a combining accent"]],
  ["No\u00a0break space and Hebrew שלום after it stay as written in this line.", ["Hebrew שלום after it stay as written"]],
  [`Plain ASCII control sentence with the marker ${PROBE_MARKER} inside it and nothing else.`, []],
];

export const PROBE_MESSAGES = Object.freeze(PROBE.map(([text]) => text));

/** The synthetic session of the probe: a user turn before each reply. */
export function probeTurns() {
  return PROBE.flatMap(([text], i) => [
    { role: "user", text: `probe prompt ${String(i + 1).padStart(2, "0")}` },
    { role: "assistant", text },
  ]);
}

function probeCase(width, message, accepted, kind, ordinal) {
  return {
    id: `probe-${String(ordinal).padStart(2, "0")}`, kind: "positive", width, message, anchor: "probe", covers: [kind],
    mode: "fixture", fixture: kind === "line" ? `  ${accepted}` : accepted, accepted: [accepted], rank: PROBE.length - message,
    nonAscii: unicodeClasses(accepted).length > 0, unicode: unicodeClasses(accepted), screenOnlyNonAscii: false,
  };
}

/** The probe's positive cases: each reply as a whole line (with the terminal's margin), then the listed parts of it. */
export function probeCases(width = PROBE_WIDTH) {
  const lines = PROBE.map(([text], i) => ["line", i, text]);
  const parts = PROBE.flatMap(([, copies], i) => copies.map((copy) => ["part", i, copy]));
  return [...lines, ...parts].map(([kind, message, text], n) => probeCase(width, message, text, kind, n + 1));
}

const isMessageRequest = (line) => line.startsWith("POST ") && line.includes("/v1/messages");

/**
 * The positive control's verdict from the stub lines ("METHOD target") seen
 * after the /cc cases and after the ordinary prompt.
 */
export function judgeControl({ afterCc, afterPrompt }) {
  const messages = afterPrompt.filter(isMessageRequest).length;
  const ok = afterCc.length === 0 && messages >= 1;
  return {
    ok, requestsAfterCc: afterCc.length, requestsAfterPrompt: afterPrompt.length, messageRequestsAfterPrompt: messages,
    detail: `requests after /cc ${afterCc.length}, after the ordinary prompt ${afterPrompt.length} (POST /v1/messages ${messages})`,
  };
}

const linesOf = (ctx) => stubRequests(ctx).map((l) => `${l.method} ${l.target}`);

/** Submit an ordinary prompt and watch the stub: { lines, busyMs, screenTail, sessionAdded }. */
async function submitPrompt(ctx) {
  await waitIdle(ctx);
  const mark = takeMark(ctx);
  ctx.tmux.sendKeys("-l", PROMPT_TEXT);
  await ctx.watch.wait(300);
  ctx.tmux.sendKeys("Enter");
  const started = Date.now();
  let busyMs = 0;
  let last = started;
  while (Date.now() - started < PROMPT_WAIT_MS && !linesOf(ctx).some(isMessageRequest)) {
    await ctx.watch.wait(250);
    const now = Date.now();
    if (ctx.tmux.capture("plain").includes(BUSY_TEXT)) busyMs += now - last;
    last = now;
  }
  await ctx.watch.wait(RETRY_GRACE_MS);
  const lines = fs.readFileSync(ctx.sessionFile, "utf8").split("\n").filter(Boolean).slice(mark.session);
  return {
    lines: linesOf(ctx), busyMs,
    screenTail: ctx.tmux.capture("plain").split("\n").filter((r) => r.trim()).slice(-8),
    sessionAdded: lines.map((l) => JSON.parse(l).type),
  };
}

/** The whole control launch. Writes DIR/control/results.json. */
export async function runControlLaunch(o) {
  const log = o.log ?? (() => {});
  const ctx = await openSession({ width: PROBE_WIDTH, height: 50, turns: probeTurns(), sentinel: PROBE_MARKER, claude: o.claude, repo: o.repo, profile: o.profile });
  const out = { width: PROBE_WIDTH, ...profileRecord(o.profile), drawn: false, error: null };
  try {
    out.drawn = await waitDrawn(ctx, PROBE_MARKER, 120_000);
    if (!out.drawn) throw new Error("the session was not drawn");
    ctx.watch.phase = "cases";
    await ctx.watch.wait(1500);
    const cases = probeCases();
    out.planned = cases.length;
    out.expectedAssistant = PROBE.length;
    out.cases = [];
    for (const c of cases) {
      const r = await runCase(ctx, c);
      out.cases.push(r);
      log(`${r.id} valid=${r.valid} exact=${r.exact} toast=${r.verdict} ${r.caseMs}ms`);
    }
    await waitIdle(ctx);
    out.afterCc = linesOf(ctx);
    ctx.watch.phase = "prompt";
    const prompt = await submitPrompt(ctx);
    out.prompt = prompt;
    out.control = judgeControl({ afterCc: out.afterCc, afterPrompt: prompt.lines });
    log(`positive control: ${out.control.detail}`);
    out.writes = reconcileWrites(logLength(ctx.shimDir, "clip"), out.cases);
    out.captureFiles = await settleCaptureAccounting(ctx);
    out.error = captureAccountError(out.captureFiles) ?? out.error;
    out.network = summarize(ctx.watch.samples);
    out.canaryHits = canaryHits(ctx.sandbox.dir);
  } catch (error) {
    out.error = String(error.message);
  } finally {
    out.teardown = await closeSession(ctx, { evidenceDir: path.join(o.evidenceDir, "control") });
    fs.writeFileSync(path.join(o.evidenceDir, "control", "results.json"), `${JSON.stringify(out, null, 1)}\n`);
  }
  return out;
}
