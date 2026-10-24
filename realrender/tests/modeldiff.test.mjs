import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { compareMessage, firstDifference, fold, messageRegions, regionText, skeleton } from "../lib/modeldiff.mjs";

const rows = [
  "❯ prompt 01",
  "",
  "⏺ First message text",
  "  second row of it",
  "",
  "❯ prompt 02",
  "⏺ ▎ quoted start",
  "  ▎ ▎ nested bar",
  "  ▎",
  "  - item",
  "────────────────",
  "  ignored chrome",
];

describe("model-versus-screen helpers", () => {
  test("regions run from a reply marker to the next marker, prompt or divider", () => {
    assert.deepEqual(messageRegions(rows), [{ start: 2, end: 5 }, { start: 6, end: 10 }]);
  });

  test("region text drops the reply marker, the margin and the quote bars", () => {
    const [a, b] = messageRegions(rows);
    assert.equal(regionText(rows, a), "First message text\nsecond row of it");
    assert.equal(regionText(rows, b), "quoted start\nnested bar\n\n- item");
  });

  test("folding and skeletons", () => {
    assert.equal(fold("  a \n b\t c "), "a b c");
    assert.equal(skeleton(" a b\nc"), "abc");
    assert.equal(firstDifference("abc", "abd"), 2);
    assert.equal(firstDifference("abc", "abc"), -1);
    assert.equal(firstDifference("abc", "abcd"), 3);
  });

  test("same, wrap-only and differs", () => {
    assert.deepEqual(compareMessage("a b\nc", "a b c"), { status: "same" });
    assert.deepEqual(compareMessage("long token here", "long tok en here"), { status: "wrap-only" });
    const d = compareMessage("see label (url) now", "see label url now");
    assert.equal(d.status, "differs");
    assert.match(d.model, /\(/);
    assert.doesNotMatch(d.screen, /\(/);
  });
});
