import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { runCase } from "../lib/live-run.mjs";
import { scoreCase } from "../lib/live-score.mjs";
import { buildSummary, buildSummary2 } from "../lib/live-summary.mjs";
import { captureAccounting, writeShims } from "../lib/shims.mjs";
import { captureAccountError, settleCaptureAccounting } from "../lib/live-observe.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbacct-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

/** A shim directory with canned writer files and log lines: `files` exist on disk, `lines` are in clip.log. */
function shimDir(name, { files, lines }) {
  const dir = path.join(base, name);
  writeShims(dir);
  for (const f of files) fs.writeFileSync(path.join(dir, "captured", f), "x");
  const log = lines.map((f) => `1792800000 ${f.split("-")[1].replace(".bin", "")} argc=0 bytes=1 sha=0123456789abcdef file=${f}`);
  fs.writeFileSync(path.join(dir, "clip.log"), log.length ? `${log.join("\n")}\n` : "");
  return dir;
}

describe("captureAccounting: every capture file must have a log line and the other way round", () => {
  test("an empty shim directory balances", () => {
    const a = captureAccounting(shimDir("empty", { files: [], lines: [] }));
    assert.deepEqual(a, { files: 0, loggedLines: 0, unlogged: [], missing: [], duplicated: [], ok: true });
  });

  test("files and log lines that match balance", () => {
    const a = captureAccounting(shimDir("balanced", { files: ["0-pbcopy.bin", "1-pbcopy.bin"], lines: ["0-pbcopy.bin", "1-pbcopy.bin"] }));
    assert.equal(a.ok, true);
    assert.equal(a.files, 2);
    assert.equal(a.loggedLines, 2);
  });

  test("a capture file with no log line is named and the account does not balance", () => {
    const a = captureAccounting(shimDir("unlogged", { files: ["0-pbcopy.bin", "1-pbcopy.bin", "2-pbcopy.bin"], lines: ["0-pbcopy.bin", "2-pbcopy.bin"] }));
    assert.deepEqual(a.unlogged, ["1-pbcopy.bin"]);
    assert.equal(a.ok, false);
  });

  test("a log line whose file is gone is named", () => {
    const a = captureAccounting(shimDir("missing", { files: ["0-pbcopy.bin"], lines: ["0-pbcopy.bin", "1-xclip.bin"] }));
    assert.deepEqual(a.missing, ["1-xclip.bin"]);
    assert.equal(a.ok, false);
  });

  test("two log lines naming one file mean one write overwrote another", () => {
    const a = captureAccounting(shimDir("dup", { files: ["0-pbcopy.bin"], lines: ["0-pbcopy.bin", "0-pbcopy.bin"] }));
    assert.deepEqual(a.duplicated, ["0-pbcopy.bin"]);
    assert.equal(a.ok, false);
  });

  test("a directory with no captured folder or log at all counts as nothing written", () => {
    const dir = path.join(base, "bare");
    fs.mkdirSync(dir);
    assert.equal(captureAccounting(dir).ok, true);
  });
});

describe("settleCaptureAccounting: a late log line is given a moment, a missing one is not forgiven", () => {
  const ctx = { watch: { wait: async () => {} }, shimDir: "" };

  test("returns the first balanced account", async () => {
    const answers = [{ ok: false, unlogged: ["1-pbcopy.bin"] }, { ok: true, unlogged: [] }];
    let i = 0;
    const out = await settleCaptureAccounting(ctx, { account: () => answers[i++], maxPolls: 5 });
    assert.equal(out.ok, true);
    assert.equal(i, 2);
  });

  test("gives up after the limit and returns the last account unbalanced", async () => {
    let i = 0;
    const out = await settleCaptureAccounting(ctx, { account: () => (i++, { ok: false, unlogged: ["3-pbcopy.bin"] }), maxPolls: 4 });
    assert.equal(out.ok, false);
    assert.equal(i, 4);
  });
});

describe("captureAccountError: the sentence that fails the launch", () => {
  test("a balanced account gives no error", () => {
    assert.equal(captureAccountError({ ok: true, unlogged: [], missing: [], duplicated: [] }), null);
  });

  test("each kind of imbalance is named, with the file names and no content", () => {
    const text = captureAccountError({ ok: false, unlogged: ["1-pbcopy.bin"], missing: ["4-xclip.bin"], duplicated: ["2-pbcopy.bin"] });
    assert.match(text, /capture files without a log line: 1-pbcopy\.bin/);
    assert.match(text, /log lines without a capture file: 4-xclip\.bin/);
    assert.match(text, /overwritten\): 2-pbcopy\.bin/);
  });
});

const positive = { id: "w80-p01", kind: "positive", width: 80, anchor: "ul", covers: ["ul"], nonAscii: false, accepted: ["alpha beta"], rank: 33, mode: "fixture", fixture: "alpha beta" };
const refusal = { id: "w80-r-empty", kind: "refusal", refusal: "empty", width: 80, expectedLine: "copy-back: clipboard is empty, nothing changed", mode: "fixture", fixture: "" };
const osc = (text) => ({ kind: "write", text, validUtf8: true });
const toast = (text) => ({ text, truncated: false });
const attemptOf = (over = {}) => ({
  idle: "idle", ms: 900, settle: { settled: true, polls: 1 },
  seen: { toasts: [], endedBy: "toast", toastAfterMs: 400, tail: [] },
  got: { pbpasteCalls: 1, osc52: [], writers: [], stubRequests: [], sessionAdded: [] },
  ...over,
});

describe("runCase: the first attempt of a retried case is reported, never hidden", () => {
  const scripted = (runs) => {
    let i = 0;
    return async () => runs[i++];
  };

  test("a case that ran at once has attempts 1 and no first-attempt record", async () => {
    const r = await runCase({}, positive, scripted([attemptOf({ got: { pbpasteCalls: 1, osc52: [osc("alpha beta")], writers: [], stubRequests: [], sessionAdded: [] } })]));
    assert.equal(r.attempts, 1);
    assert.equal(r.retried, false);
    assert.equal(r.firstAttempt, null);
  });

  test("a case whose command did not run is retried once, and the first attempt's toast and counts are kept", async () => {
    const first = attemptOf({
      seen: { toasts: [toast("copy-back: could not read the clipboard, nothing changed")], endedBy: "toast", toastAfterMs: 2300, tail: [] },
      got: { pbpasteCalls: 0, osc52: [], writers: [], stubRequests: [], sessionAdded: [] },
    });
    const second = attemptOf({ got: { pbpasteCalls: 1, osc52: [osc("alpha beta")], writers: [], stubRequests: [], sessionAdded: [] } });
    const r = await runCase({}, positive, scripted([first, second]));
    assert.equal(r.attempts, 2);
    assert.equal(r.retried, true);
    assert.deepEqual(r.firstAttempt.toasts, ["copy-back: could not read the clipboard, nothing changed"]);
    assert.equal(r.firstAttempt.pbpasteCalls, 0);
    assert.equal(r.firstAttempt.toastAfterMs, 2300);
    assert.equal(r.valid, true);
    assert.equal(r.exact, true);
  });

  test("a write made by the discarded first attempt still counts: a refusal is then not untouched", async () => {
    const first = attemptOf({ got: { pbpasteCalls: 0, osc52: [osc("stray")], writers: [], stubRequests: [], sessionAdded: [] } });
    const second = attemptOf({ seen: { toasts: [toast(refusal.expectedLine)], endedBy: "toast", toastAfterMs: 300, tail: [] } });
    const r = await runCase({}, refusal, scripted([first, second]));
    assert.equal(r.untouched, false);
    assert.equal(r.wrongPayload, true);
    assert.equal(r.firstAttempt.writeEvents, 1);
  });

  test("a wrong payload written by the first attempt makes a positive a wrong payload even if the retry is right", async () => {
    const first = attemptOf({ got: { pbpasteCalls: 0, osc52: [osc("something else")], writers: [], stubRequests: [], sessionAdded: [] } });
    const second = attemptOf({ got: { pbpasteCalls: 1, osc52: [osc("alpha beta")], writers: [], stubRequests: [], sessionAdded: [] } });
    const r = await runCase({}, positive, scripted([first, second]));
    assert.equal(r.wrongPayload, true);
    assert.equal(r.exact, false);
  });

  test("scoreCase alone: no first attempt behaves as before", () => {
    const r = scoreCase(positive, { attempts: 1, pbpasteCalls: 1, osc52: [osc("alpha beta")], writers: [], toasts: [] });
    assert.equal(r.exact, true);
    assert.equal(r.retried, false);
    assert.equal(r.firstAttempt, null);
  });
});

const launchOf = (over = {}) => ({
  width: 80, drawn: true, error: null, planned: 2, expectedAssistant: 40,
  cases: [
    { id: "w80-p01", kind: "positive", width: 80, anchor: "ul", valid: true, exact: true, wrongPayload: false, nonAscii: true, verdict: "complete", writeEvents: 1, retried: false, firstAttempt: null },
    { id: "w80-r-empty", kind: "refusal", width: 80, valid: true, exact: null, wrongPayload: false, writeEvents: 0, verdict: "complete", retried: true, firstAttempt: { toasts: ["copy-back: could not read the clipboard, nothing changed"], pbpasteCalls: 0, writeEvents: 0 } },
  ],
  stub: { requests: 0, lines: [] }, network: { socketObservations: { external: 0 } }, canaryHits: [], canaryOnScreen: false, noticeHits: [],
  writes: { shimCalls: 1, attributed: 1, unattributed: 0 }, captureFiles: { files: 1, loggedLines: 1, unlogged: [], missing: [], duplicated: [], ok: true },
  sessionRecords: { assistant: 40 },
  ...over,
});
const ctl = { ok: true, failures: [] };

describe("the summary reports retried cases and the capture-file account", () => {
  test("retried cases are listed with their first-attempt toasts", () => {
    const s = buildSummary({ launches: [launchOf()], controls: ctl, clipboardBefore: "a", clipboardAfter: "a", classesRequired: [] });
    assert.equal(s.retriedCases.length, 1);
    assert.equal(s.retriedCases[0].id, "w80-r-empty");
    assert.deepEqual(s.retriedCases[0].firstAttemptToasts, ["copy-back: could not read the clipboard, nothing changed"]);
  });

  test("an unbalanced capture-file account is counted and named in the summary", () => {
    const bad = launchOf({ captureFiles: { files: 2, loggedLines: 1, unlogged: ["1-pbcopy.bin"], missing: [], duplicated: [], ok: false }, error: "capture files without a log line: 1-pbcopy.bin" });
    const s = buildSummary({ launches: [bad], controls: ctl, clipboardBefore: "a", clipboardAfter: "a", classesRequired: [] });
    assert.equal(s.unloggedCaptureFiles, 1);
    assert.deepEqual(s.captureAccountProblems, [{ width: 80, unlogged: ["1-pbcopy.bin"], missing: [], duplicated: [] }]);
    assert.match(s.engineBlocked, /capture files without a log line/);
  });

  test("the control launch's account is added in rule version 2", () => {
    const control = { drawn: true, error: null, cases: [], captureFiles: { files: 11, loggedLines: 10, unlogged: ["10-pbcopy.bin"], missing: [], duplicated: [], ok: false }, writes: { unattributed: 0 }, network: { socketObservations: { external: 0 } } };
    const s = buildSummary2({ launches: [launchOf()], controls: ctl, classesRequired: [], controlLaunch: control, clip: { before: "a", after: "a", reads: 2 } });
    assert.equal(s.unloggedCaptureFiles, 1);
    assert.equal(s.captureAccountProblems.at(-1).width, "control");
  });
});
