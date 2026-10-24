import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { controlWindows, evaluate, hasTokenDigits, newestFirst } from "../lib/evaluate.mjs";
import { classify, pct, summarize, tableText } from "../lib/score.mjs";

const cap = { message: 1, expected: "  alpha beta  ", pasteForms: ["alpha beta", "alpha\nbeta"] };
const ok = (source, paste = source) => ({ ok: true, source, paste, messageIndex: 0 });

describe("classification (the pre-registered definitions)", () => {
  test("exact needs the source to equal the expected slice and the paste to be an accepted form", () => {
    assert.equal(classify(ok("alpha beta"), cap).kind, "exact");
    assert.equal(classify(ok(" alpha beta \n"), cap).kind, "exact", "outer whitespace is trimmed");
    assert.equal(classify(ok("alpha beta", "alpha\nbeta"), cap).kind, "exact", "a listed paste form is accepted");
  });

  test("an ok result that is not the intended text is a wrong slice, even if only the paste is off", () => {
    assert.equal(classify(ok("alpha gamma"), cap).kind, "wrong-slice");
    assert.equal(classify(ok("alpha beta", "alpha  gamma"), cap).kind, "wrong-slice");
    const half = classify(ok("alpha beta", "something else"), cap);
    assert.deepEqual([half.sourceExact, half.pasteOk], [true, false]);
  });

  test("refusals keep their own kind and are never wrong slices", () => {
    for (const reason of ["no-match", "ambiguous", "too-short", "empty"]) {
      assert.equal(classify({ ok: false, reason }, cap).kind, reason);
    }
  });
});

describe("tallies", () => {
  const rec = (over) => ({ width: 80, anchor: "para", covers: ["para"], features: [], startMode: "word-start", endMode: "word-end", length: 30, rowsSpanned: 1, kind: "exact", ...over });

  test("summarize counts overall, by width and by construct", () => {
    const s = summarize([rec({}), rec({ kind: "no-match", width: 60 }), rec({ kind: "wrong-slice", covers: ["para", "ul"], features: ["bold"], length: 400, rowsSpanned: 3 })]);
    assert.deepEqual([s.overall.total, s.overall.exact, s.overall["no-match"], s.overall["wrong-slice"]], [3, 1, 1, 1]);
    assert.equal(s.width[80].total, 2);
    assert.equal(s.width[60]["no-match"], 1);
    assert.equal(s.covers.ul["wrong-slice"], 1);
    assert.equal(s.features.bold.total, 1);
    assert.equal(s.length["300-420"].total, 1);
    assert.equal(s.wrap["multi-row"].total, 1);
  });

  test("percentages and the text table", () => {
    assert.equal(pct(7, 10), "70.0%");
    assert.equal(pct(0, 0), "-");
    assert.match(tableText("t", summarize([rec({})]).width), /80 +1 +1 +0/);
  });
});

describe("controls", () => {
  const texts = ["zero text", "one text", "two text"];

  test("windows are newest first, one without the message and one with its twin in its place", () => {
    const w = controlWindows(texts, 1, "ONE TWIN");
    assert.deepEqual(w.without, ["two text", "zero text"]);
    assert.deepEqual(w.twin, ["two text", "ONE TWIN", "zero text"]);
    assert.deepEqual(newestFirst(texts), ["two text", "one text", "zero text"]);
  });

  test("a matcher that answers ok on a control window is a false positive", () => {
    const calls = [];
    const find = (_copied, window) => {
      calls.push(window.length);
      return ok("alpha beta");
    };
    const r = evaluate(cap, "copied", texts, "ONE TWIN", find);
    assert.equal(r.kind, "exact");
    assert.deepEqual(r.control, { withoutOk: true, twinOk: true, falsePositive: true });
    assert.deepEqual(calls, [3, 2, 3]);
  });

  test("a matcher that refuses on the controls has no false positive; matchedMessage is in window order", () => {
    const find = (_c, window) => (window.includes("one text") ? { ok: true, source: "alpha beta", paste: "alpha beta", messageIndex: 1 } : { ok: false, reason: "no-match" });
    const r = evaluate(cap, "copied", texts, "ONE TWIN", find);
    assert.equal(r.control.falsePositive, false);
    assert.equal(r.matchedMessage, 1);
  });

  test("a copy keeps token digits when it holds four digits in a row", () => {
    assert.equal(hasTokenDigits("get0412 and"), true);
    assert.equal(hasTokenDigits("gadget and 12"), false);
  });
});
