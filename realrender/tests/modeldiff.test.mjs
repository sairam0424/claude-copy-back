import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clusterHunks, compareMessage, diffHunks, firstDifference, fold, holdoutReason, messageRegions, normalizeHunk, regionText, skeleton } from "../lib/modeldiff.mjs";

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

describe("diffHunks: every difference of a message, not only the first", () => {
  test("equal texts, and texts that differ only in whitespace, have no hunk", () => {
    assert.deepEqual(diffHunks("a b c", "a  b\nc"), []);
  });

  test("a word the screen does not draw is a hunk with an empty screen side", () => {
    assert.deepEqual(diffHunks("see label (https://x.y/z) now", "see label now"), [{ model: ["(https://x.y/z)"], screen: [], before: "label", after: "now" }]);
  });

  test("a changed word is one hunk with both sides", () => {
    assert.deepEqual(diffHunks("1. one two", "a. one two"), [{ model: ["1."], screen: ["a."], before: "", after: "one" }]);
  });

  test("several differences in one message are all listed, in order", () => {
    const hunks = diffHunks("x ~~old~~ y (https://u) z", "x old y z");
    assert.deepEqual(hunks.map((h) => [h.model, h.screen]), [[["~~old~~"], ["old"]], [["(https://u)"], []]]);
  });

  test("a token split by a row wrap is not a hunk (whitespace-free equal)", () => {
    assert.deepEqual(diffHunks("see https://very/long/url here", "see https://very/lo ng/url here"), []);
  });
});

describe("clusterHunks: the same difference counted once, with where it was seen", () => {
  test("tokens, counters and URLs are normalised so they cluster", () => {
    assert.equal(normalizeHunk(["gadget0412:", "(~3"]), "T: (~#");
    assert.equal(normalizeHunk(["(https://a.b/c)"]), "(URL)");
    assert.equal(normalizeHunk([]), "(nothing)");
  });

  test("clusters carry a count and the first example", () => {
    const rows = [
      { width: 80, message: 1, hunks: [{ model: ["(https://a.b)"], screen: [], before: "x", after: "y" }] },
      { width: 100, message: 4, hunks: [{ model: ["(https://c.d)"], screen: [], before: "p", after: "q" }, { model: ["1."], screen: ["a."], before: "", after: "z" }] },
    ];
    const clusters = clusterHunks(rows);
    assert.deepEqual(clusters.map((c) => [c.model, c.screen, c.count]), [["(URL)", "(nothing)", 2], ["#.", "a.", 1]]);
    assert.deepEqual(clusters[0].example, { width: 80, message: 1, before: "x", after: "y" });
  });
});

describe("holdoutReason: the calibration tools never look at a holdout", () => {
  const ok = { name: "warp-4101", hasHoldoutResults: false, corpus: { family: "C", seed: 4101 } };
  test("a calibration set is allowed", () => {
    assert.equal(holdoutReason(ok), null);
  });
  test("a folder named holdout, one with holdout results, family B and a holdout seed are refused", () => {
    assert.match(holdoutReason({ ...ok, name: "holdout-warp-5202" }), /name says holdout/);
    assert.match(holdoutReason({ ...ok, hasHoldoutResults: true }), /holdout results/);
    assert.match(holdoutReason({ ...ok, corpus: { family: "B", seed: 1 } }), /family B/);
    for (const seed of [5202, 5303, 7331, 202]) assert.match(holdoutReason({ ...ok, corpus: { family: "C", seed } }), new RegExp(`seed ${seed} is a holdout seed`));
  });
});
