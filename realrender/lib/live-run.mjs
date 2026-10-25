// One launch of the live pass: open the sealed session at one width, take the
// copies from the LIVE screen, run every planned case, scan for the canary,
// collect the side-channel evidence, close. The decisions about what counts
// live in live-score.mjs and live-rule.mjs.

import fs from "node:fs";
import path from "node:path";
import { bannerVersion, listTree } from "./evidence.mjs";
import { CANARY, planWidth } from "./live-cases.mjs";
import { BUSY_TEXT, captureAccountError, collectSince, observe, reconcileWrites, settleCaptureAccounting, settleWrites, takeMark, typeCc, waitIdle } from "./live-observe.mjs";
import { sessionTurns, sentinelOf } from "./corpus-set.mjs";
import { scoreCase } from "./live-score.mjs";
import { noticeLines } from "./live-summary.mjs";
import { profileRecord } from "./profile.mjs";
import { openSession, closeSession, waitDrawn, stubRequests } from "./live-session.mjs";
import { summarize } from "./netproof.mjs";
import { copiesFor, locateOnScreen, rowsOf } from "./screen.mjs";
import { logLength, setPbpaste } from "./shims.mjs";

/** The copy a terminal selection yields from the LIVE screen for each holdout record (null = not on screen). */
export function liveCopies({ historyText, records, messages, width }) {
  const rows = rowsOf(historyText);
  const loc = locateOnScreen(rows, messages.flatMap((m) => m.tokens.map((t) => t.id)));
  return records.map((rec) => copiesFor(rows, loc.where, rec, width)?.trimmed ?? null);
}

/** One attempt of a case: arm the shim, wait for idle, type, observe, collect. */
async function attempt(ctx, c) {
  setPbpaste(ctx.shimDir, { mode: c.mode, text: c.fixture });
  const idle = await waitIdle(ctx);
  const mark = takeMark(ctx);
  const started = Date.now();
  await typeCc(ctx);
  const seen = await observe(ctx);
  const settle = await settleWrites(ctx, mark);
  const got = collectSince(ctx, mark);
  return { idle, seen, got, settle, ms: Date.now() - started };
}

/** What a discarded first attempt saw and did: kept, scored and reported with the case. */
function firstAttemptOf(run) {
  return {
    pbpasteCalls: run.got.pbpasteCalls, osc52: run.got.osc52, writers: run.got.writers, toasts: run.seen.toasts,
    toastAfterMs: run.seen.toastAfterMs, endedBy: run.seen.endedBy, stubRequests: run.got.stubRequests, sessionAdded: run.got.sessionAdded,
  };
}

/**
 * Run one case; a case whose command never ran (no pbpaste call) is retried once with the
 * same fixture. The first attempt is NOT discarded: its toast, counts and any write it made
 * stay in the case record (`firstAttempt`) and its writes are scored with the case.
 * `attemptFn` is injectable for the tests.
 */
export async function runCase(ctx, c, attemptFn = attempt) {
  let run = await attemptFn(ctx, c);
  let attempts = 1;
  let first;
  if (run.got.pbpasteCalls === 0) {
    first = firstAttemptOf(run);
    run = await attemptFn(ctx, c);
    attempts = 2;
  }
  const obs = { attempts, first, pbpasteCalls: run.got.pbpasteCalls, osc52: run.got.osc52, writers: run.got.writers, toasts: run.seen.toasts };
  const scored = scoreCase(c, obs);
  return {
    ...scored,
    idleBefore: run.idle, settled: run.settle.settled, settlePolls: run.settle.polls, endedBy: run.seen.endedBy, toastAfterMs: run.seen.toastAfterMs, caseMs: run.ms,
    stubRequests: run.got.stubRequests, sessionAdded: run.got.sessionAdded,
    osc52Count: run.got.osc52.length, writerCalls: run.got.writers.map((w) => ({ name: w.name, bytes: w.bytes, sha: w.sha })),
    screenTail: run.seen.tail,
  };
}

/** Every file under the sandbox (except the shim directory, which holds the fixtures) that contains the canary. */
export function canaryHits(root, skipDirs = ["shims"]) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!(dir === root && skipDirs.includes(entry.name))) walk(full);
      } else if (entry.isFile() && fs.readFileSync(full).includes(CANARY)) hits.push(path.relative(root, full));
    }
  };
  walk(root);
  return hits;
}

/**
 * The whole launch.
 * @param {object} o
 * @param {number} o.width
 * @param {object} o.corpus the corpus (messages with tokens) the session replays
 * @param {object[]} o.records the holdout records of this width (file order)
 * @param {string} o.evidenceDir
 * @param {string} [o.claude]
 * @param {string} [o.profile] terminal profile (profile.mjs), default "default"; recorded in results.json
 * @param {string} [o.repo] plugin source folder (default: this repository; a mutant copy for the harness controls)
 * @param {number} [o.limit] run only the first `limit` positives (development); all refusals still run
 * @param {(line: string) => void} [o.log]
 */
export async function runWidth(o) {
  const log = o.log ?? (() => {});
  const turns = sessionTurns(o.corpus);
  const sentinel = sentinelOf(o.corpus);
  const ctx = await openSession({ width: o.width, height: 50, turns, sentinel, claude: o.claude, repo: o.repo, profile: o.profile });
  const out = { width: o.width, ...profileRecord(o.profile), drawn: false, error: null };
  const unguard = guardSignals(ctx, o);
  try {
    out.drawn = await waitDrawn(ctx, sentinel, 120_000);
    if (!out.drawn) throw new Error("the session was not drawn");
    ctx.watch.phase = "drawn";
    await ctx.watch.wait(1500);
    const history = ctx.tmux.capture("plain", { history: true });
    fs.writeFileSync(path.join(ctx.sandbox.out, `live-history-w${o.width}.txt`), history);
    const records = o.limit ? o.records.slice(0, o.limit) : o.records;
    const copies = liveCopies({ historyText: history, records, messages: o.corpus.messages, width: o.width });
    out.copyCheck = { records: records.length, onScreen: copies.filter((c) => c !== null).length, sameAsSaved: copies.filter((c, i) => c === records[i].copied).length };
    out.plugin = ctx.plugin;
    out.promptBefore = ctx.tmux.capture("plain").split("\n").filter((r) => r.trim()).slice(-4);
    const cases = planWidth({ width: o.width, records, copies });
    ctx.watch.phase = "cases";
    out.planned = cases.length;
    out.expectedAssistant = o.corpus.messages.length;
    out.cases = [];
    for (const c of cases) {
      const r = await runCase(ctx, c);
      out.cases.push(r);
      log(`${r.id} ${r.kind} valid=${r.valid} ${r.kind === "positive" ? `exact=${r.exact}` : `untouched=${r.untouched}`} toast=${r.verdict} ${r.caseMs}ms`);
    }
    await waitIdle(ctx);
    ctx.watch.phase = "after";
    await ctx.watch.wait(1000);
    await finish(ctx, out);
  } catch (error) {
    out.error = String(error.message);
  } finally {
    unguard();
    out.teardown = await closeSession(ctx, { evidenceDir: path.join(o.evidenceDir, `w${o.width}`) });
    fs.writeFileSync(path.join(o.evidenceDir, `w${o.width}`, "results.json"), `${JSON.stringify(out, null, 1)}\n`);
  }
  return out;
}

/** Facts read once the cases are done. A capture file without a log line (or the reverse) fails the launch. */
async function finish(ctx, out) {
  out.stub = { requests: stubRequests(ctx).length, lines: stubRequests(ctx).map((l) => `${l.method} ${l.target}`) };
  out.network = summarize(ctx.watch.samples);
  out.homeFiles = listTree(ctx.sandbox.home).map((f) => `${f.path} (${f.bytes})`);
  out.writes = reconcileWrites(logLength(ctx.shimDir, "clip"), out.cases);
  out.captureFiles = await settleCaptureAccounting(ctx);
  const unbalanced = captureAccountError(out.captureFiles);
  if (unbalanced) out.error = unbalanced;
  out.canaryHits = canaryHits(ctx.sandbox.dir);
  const finalScreen = ctx.tmux.capture("plain", { history: true });
  out.canaryOnScreen = finalScreen.includes(CANARY);
  fs.writeFileSync(path.join(ctx.sandbox.out, `live-history-final-w${out.width}.txt`), finalScreen);
  out.commandEchoRows = finalScreen.split("\n").filter((row) => row.trim() === "❯ /cc").length;
  out.noticeHits = noticeLines(finalScreen);
  out.busyAtEnd = finalScreen.includes(BUSY_TEXT);
  const lines = fs.readFileSync(ctx.sessionFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  out.sessionRecords = {
    total: lines.length, assistant: lines.filter((l) => l.type === "assistant").length, user: lines.filter((l) => l.type === "user").length,
    otherTypes: [...new Set(lines.map((l) => l.type).filter((t) => t !== "assistant" && t !== "user"))],
  };
  out.promptHistory = promptHistory(path.join(ctx.sandbox.home, ".claude", "history.jsonl"));
  out.banner = bannerVersion(fs.readFileSync(path.join(ctx.sandbox.out, `live-history-w${out.width}.txt`), "utf8"));
}

/** Tear down on Ctrl-C or SIGTERM too (only this launch's own pids and the cbrender server), then exit. */
function guardSignals(ctx, o) {
  const handlers = ["SIGINT", "SIGTERM"].map((sig) => {
    const handler = () => {
      closeSession(ctx, { evidenceDir: path.join(o.evidenceDir, `w${o.width}`) }).finally(() => process.exit(sig === "SIGINT" ? 130 : 143));
    };
    process.once(sig, handler);
    return [sig, handler];
  });
  return () => handlers.forEach(([sig, handler]) => process.off(sig, handler));
}

/** What the prompt history file holds: line count and the distinct typed lines (synthetic: "/cc"). */
export function promptHistory(file) {
  if (!fs.existsSync(file)) return { lines: 0, distinct: [] };
  const rows = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { lines: rows.length, distinct: [...new Set(rows.map((r) => (typeof r.display === "string" ? r.display : "?")))] };
}
