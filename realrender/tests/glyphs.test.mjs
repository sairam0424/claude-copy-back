import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { codePointLabel, leadingSpaces, longestRow, nonAsciiInventory, rowPrefixes, rowsWithToken, tokensIn } from "../lib/glyphs.mjs";

const rows = [
  "⏺ Heading q0001",
  "",
  "  - item q0002",
  "    - nested q0003",
  "  ▎ quote q0004",
  "  1. one q0005",
  "  - item q0006",
];

describe("glyph inventory", () => {
  test("labels code points", () => {
    assert.equal(codePointLabel("⏺"), "U+23FA");
    assert.equal(codePointLabel("▎"), "U+258E");
  });

  test("lists non-ASCII characters with counts and first row", () => {
    const inv = nonAsciiInventory(rows);
    assert.deepEqual(inv.map((e) => [e.ch, e.count, e.firstRow]), [["⏺", 1, 1], ["▎", 1, 5]]);
  });

  test("row prefixes are the decoration before the first letter or digit", () => {
    const prefixes = rowPrefixes(rows);
    const byPrefix = Object.fromEntries(prefixes.map((p) => [p.prefix, p.count]));
    assert.equal(byPrefix["  - "], 2);
    assert.equal(byPrefix["    - "], 1);
    assert.equal(byPrefix["⏺ "], 1);
    assert.equal(byPrefix["  ▎ "], 1);
    assert.equal(byPrefix["  "], 1);
    assert.equal(prefixes.reduce((n, p) => n + p.count, 0), 6);
  });

  test("margins, widths and tokens", () => {
    assert.equal(leadingSpaces("    x"), 4);
    assert.equal(longestRow(["ab", "日本語x"]), 4);
    assert.deepEqual(tokensIn("a q0001 b q0002x q00033"), ["q0001"]);
    assert.deepEqual(rowsWithToken(rows, "q0004"), [5]);
  });
});
