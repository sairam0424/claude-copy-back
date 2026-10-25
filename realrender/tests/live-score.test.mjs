import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { scoreCase, writeEvents } from "../lib/live-score.mjs";
import { copiedLine } from "../lib/toast.mjs";

const positive = { id: "w80-p01", kind: "positive", width: 80, anchor: "ul", covers: ["ul"], nonAscii: true, accepted: ["alpha beta", "alpha\nbeta"], rank: 33 };
const refusal = { id: "w80-r-empty", kind: "refusal", refusal: "empty", width: 80, expectedLine: "copy-back: clipboard is empty, nothing changed" };
const obs = (over = {}) => ({ attempts: 1, pbpasteCalls: 1, osc52: [], writers: [], toasts: [], ...over });
const osc = (text) => ({ kind: "write", text, validUtf8: text !== null });
const toast = (text, truncated = false) => ({ text, truncated });

describe("live case scoring", () => {
  test("a positive is exact when every write event is an accepted form (trim-insensitive)", () => {
    const r = scoreCase(positive, obs({ osc52: [osc("alpha beta\n")], writers: [{ name: "pbcopy", text: "alpha beta" }], toasts: [toast(copiedLine(11, 33))] }));
    assert.equal(r.exact, true);
    assert.equal(r.wrongPayload, false);
    assert.equal(r.valid, true);
    assert.deepEqual(r.channels, ["osc52", "pbcopy"]);
    assert.equal(r.verdict, "complete");
  });

  test("one wrong channel makes the whole case a wrong payload even if another channel is right", () => {
    const r = scoreCase(positive, obs({ osc52: [osc("alpha beta")], writers: [{ name: "pbcopy", text: "alpha  beta" }] }));
    assert.equal(r.exact, false);
    assert.equal(r.wrongPayload, true);
  });

  test("a positive with no write event is neither exact nor a wrong payload", () => {
    const r = scoreCase(positive, obs());
    assert.deepEqual([r.exact, r.wrongPayload], [false, false]);
  });

  test("a payload that is not valid UTF-8 is wrong", () => {
    const r = scoreCase(positive, obs({ osc52: [osc(null)] }));
    assert.equal(r.wrongPayload, true);
  });

  test("the toast counts must match the payload: characters of what was written, rank from the message", () => {
    const right = scoreCase(positive, obs({ osc52: [osc("alpha beta")], toasts: [toast(copiedLine(10, 33))] }));
    assert.equal(right.verdict, "complete");
    const wrongRank = scoreCase(positive, obs({ osc52: [osc("alpha beta")], toasts: [toast(copiedLine(10, 34))] }));
    assert.equal(wrongRank.verdict, "wrong");
    const cut = scoreCase(positive, obs({ osc52: [osc("alpha beta")], toasts: [toast("copy-back: copied 10 chars from reply 3", true)] }));
    assert.equal(cut.verdict, "prefix");
    assert.equal(scoreCase(positive, obs({ osc52: [osc("alpha beta")] })).verdict, "missing");
  });

  test("characters are counted as code points, not UTF-16 units", () => {
    const emoji = { ...positive, accepted: ["🚀 go"] };
    const r = scoreCase(emoji, obs({ osc52: [osc("🚀 go")], toasts: [toast(copiedLine(4, 33))] }));
    assert.equal(r.verdict, "complete");
  });

  test("a refusal leaves the clipboard untouched only with zero write events", () => {
    const ok = scoreCase(refusal, obs({ toasts: [toast(refusal.expectedLine)] }));
    assert.deepEqual([ok.untouched, ok.wrongPayload, ok.verdict], [true, false, "complete"]);
    const dirty = scoreCase(refusal, obs({ writers: [{ name: "xclip", text: "anything" }] }));
    assert.deepEqual([dirty.untouched, dirty.wrongPayload], [false, true]);
    const query = scoreCase(refusal, obs({ osc52: [{ kind: "query", text: null, validUtf8: true }] }));
    assert.equal(query.untouched, true);
  });

  test("valid means exactly one pbpaste call", () => {
    assert.equal(scoreCase(refusal, obs({ pbpasteCalls: 0 })).valid, false);
    assert.equal(scoreCase(refusal, obs({ pbpasteCalls: 0 })).commandRan, false);
    assert.equal(scoreCase(refusal, obs({ pbpasteCalls: 2 })).valid, false);
    assert.equal(scoreCase(refusal, obs({ pbpasteCalls: 2 })).commandRan, true);
  });

  test("writeEvents lists osc52 writes then shim calls and skips queries", () => {
    const events = writeEvents(obs({ osc52: [osc("a"), { kind: "query", text: null, validUtf8: true }], writers: [{ name: "pbcopy", text: "b" }] }));
    assert.deepEqual(events, [{ channel: "osc52", text: "a" }, { channel: "pbcopy", text: "b" }]);
  });
});
