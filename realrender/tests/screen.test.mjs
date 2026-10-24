import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { charPos, copiesFor, displayWidth, endPos, locateOnScreen, rowsOf, selectionText, stripEscapes } from "../lib/screen.mjs";

const rows = [
  "⏺ Intro gadget0001 words here",
  "  more words widget0002 and",
  "  - item render0003 tail",
  "  wrapped words fill the row here ok bridge00",
  "  04 and the rest of the line",
];

/** A span from the first id (offset into it) to the second id (cut from its end). */
const mk = (first, startOffset, last, endCut) => ({ startToken: first, startOffset, endToken: last, endCut });

describe("locating tokens", () => {
  test("whole tokens are found with row and columns, whatever precedes them", () => {
    const loc = locateOnScreen(rows, ["gadget0001", "widget0002", "render0003"]);
    assert.deepEqual(loc.where.get("gadget0001"), [{ row: 0, from: 8, to: 18 }]);
    assert.deepEqual(loc.where.get("render0003"), [{ row: 2, from: 9, to: 19 }]);
    assert.equal(loc.locatable.size, 3);
  });

  test("a token cut by a row wrap is found in two segments, skipping the continuation margin", () => {
    const loc = locateOnScreen(rows, ["bridge0004"]);
    assert.deepEqual(loc.where.get("bridge0004"), [
      { row: 3, from: 37, to: 45 },
      { row: 4, from: 2, to: 4 },
    ]);
  });

  test("a token seen twice is repeated, a token never seen is missing, neither is locatable", () => {
    const twice = [...rows, "  again gadget0001 here"];
    const loc = locateOnScreen(twice, ["gadget0001", "ghost0009"]);
    assert.deepEqual(loc.repeated, ["gadget0001"]);
    assert.deepEqual(loc.missing, ["ghost0009"]);
    assert.equal(loc.locatable.size, 0);
  });

  test("a longer word that merely ends in the token's letters and digits is not a match", () => {
    const loc = locateOnScreen(["  xgadget0001 and gadget00012"], ["gadget0001"]);
    assert.equal(loc.locatable.size, 0);
  });

  test("character positions walk across the two segments", () => {
    const segs = locateOnScreen(rows, ["bridge0004"]).where.get("bridge0004");
    assert.deepEqual(charPos(segs, 0), { row: 3, col: 37 });
    assert.deepEqual(charPos(segs, 7), { row: 3, col: 44 });
    assert.deepEqual(charPos(segs, 8), { row: 4, col: 2 });
    assert.deepEqual(endPos(segs, 10), { row: 4, col: 4 });
    assert.deepEqual(endPos(segs, 3), { row: 3, col: 40 });
    assert.throws(() => charPos(segs, 10));
  });
});

describe("what a terminal selection yields", () => {
  test("one row: from the start column to the end column", () => {
    assert.equal(selectionText(rows, { row: 0, col: 8 }, { row: 0, col: 18 }), "gadget0001");
  });

  test("several rows: first row from its column, whole middle rows, last row up to its column, hard newlines", () => {
    const text = selectionText(rows, { row: 0, col: 8 }, { row: 2, col: 19 });
    assert.equal(text, "gadget0001 words here\n  more words widget0002 and\n  - item render0003");
  });

  test("trailing blanks are trimmed in the main variant and kept to the width in the padded one", () => {
    const withBlanks = ["  alpha   ", "  beta   ", "  gamma delta"];
    const trimmed = selectionText(withBlanks, { row: 0, col: 2 }, { row: 2, col: 7 });
    assert.equal(trimmed, "alpha\n  beta\n  gamma");
    const padded = selectionText(withBlanks, { row: 0, col: 2 }, { row: 2, col: 7 }, { pad: true, width: 12 });
    assert.equal(padded, "alpha     \n  beta      \n  gamma");
    assert.equal(padded.split("\n")[0].length + 2, 12);
  });

  test("padding counts wide characters as two cells", () => {
    assert.equal(displayWidth("日本a"), 5);
    assert.equal(displayWidth("é"), 1);
    assert.equal(displayWidth("😀"), 2);
    const padded = selectionText(["日本語 x", "  y"], { row: 0, col: 0 }, { row: 1, col: 3 }, { pad: true, width: 10 });
    assert.equal(padded.split("\n")[0], "日本語 x  ");
  });

  test("copiesFor applies the mid-word start offset and the end cut", () => {
    const where = locateOnScreen(rows, ["gadget0001", "widget0002"]).where;
    const copy = copiesFor(rows, where, mk("gadget0001", 3, "widget0002", 2), 40);
    assert.equal(copy.trimmed, "get0001 words here\n  more words widget00");
    assert.equal(copy.rowsSpanned, 2);
  });

  test("copiesFor works when the start token is cut by a wrap", () => {
    const where = locateOnScreen(rows, ["bridge0004"]).where;
    assert.equal(copiesFor(rows, where, mk("bridge0004", 7, "bridge0004", 0), 80).trimmed, "0\n  04");
    assert.equal(copiesFor(rows, where, mk("bridge0004", 2, "bridge0004", 0), 80).trimmed, "idge00\n  04");
  });

  test("copiesFor refuses an endpoint that is not on the screen and an empty range", () => {
    const where = locateOnScreen(rows, ["gadget0001"]).where;
    assert.equal(copiesFor(rows, where, mk("gadget0001", 0, "nope0001", 0), 80), null);
    assert.equal(copiesFor(rows, where, mk("gadget0001", 9, "gadget0001", 5), 80), null);
  });
});

describe("capture text helpers", () => {
  test("rowsOf drops only the final empty element", () => {
    assert.deepEqual(rowsOf("a\n\nb\n"), ["a", "", "b"]);
    assert.deepEqual(rowsOf("a\n\n"), ["a", ""]);
  });

  test("stripEscapes removes SGR, cursor and OSC sequences and keeps the text", () => {
    assert.equal(stripEscapes("\u001b[1;3mbold\u001b[0m \u001b]8;;http://x\u0007link\u001b]8;;\u0007 \u001b[38;5;153mc\u001b[39m"), "bold link c");
  });
});
