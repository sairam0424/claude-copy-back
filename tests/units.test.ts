import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { compareIndentation } from "../src/core/fit.ts";
import { unfold, foldText } from "../src/core/fold.ts";
import type { Mode } from "../src/core/fold.ts";
import { pasteText } from "../src/core/paste.ts";
import { firstWithin, lowerBound } from "../src/core/sorted.ts";
import {
  firstRowIndent,
  glyphEdges,
  listMarkersOf,
} from "../src/core/strip.ts";
import { inProjected, locator } from "../src/core/views.ts";
import type { View } from "../src/core/views.ts";
import { parseDocument, MAX_DEPTH } from "../src/core/blocks.ts";
import { mulberry32, randInt } from "../src/sim/prng.ts";

// Unit tests for the pieces the review fixes added.

describe("compareIndentation (the cross-message tie-breaker)", () => {
  const table: Array<
    [string, string, string, { conflict: boolean; shift: number | null }]
  > = [
    [
      "no line break anywhere",
      "a b c",
      "a b c",
      { conflict: false, shift: null },
    ],
    [
      "a prose wrap against a space is not compared",
      "a\n  b",
      "a b",
      { conflict: false, shift: null },
    ],
    [
      "identical rows",
      "a\n    b\n  c",
      "a\n    b\n  c",
      { conflict: false, shift: 0 },
    ],
    [
      "the copy carries a container prefix",
      "a\n      b\n    c",
      "a\n    b\n  c",
      { conflict: false, shift: 2 },
    ],
    [
      "the copy has LESS indentation than the message",
      "a\n  b",
      "a\n    b",
      { conflict: true, shift: null },
    ],
    [
      "the shift changes between rows",
      "a\n    b\n    c",
      "a\n    b\n  c",
      { conflict: true, shift: 0 },
    ],
    [
      "tabs are not compared",
      "a\n\tb",
      "a\n    b",
      { conflict: false, shift: null },
    ],
    [
      "blank lines count the indentation after the last break",
      "a\n\n   b",
      "a\n\n   b",
      { conflict: false, shift: 0 },
    ],
    [
      "different token counts are not compared",
      "a b",
      "a b c",
      { conflict: false, shift: null },
    ],
  ];
  for (const [name, copy, shown, expected] of table) {
    test(name, () =>
      assert.deepEqual(compareIndentation(copy, shown), expected),
    );
  }
});

describe("strip helpers", () => {
  test("listMarkersOf lists what { markers: true } would remove", () => {
    assert.deepEqual(listMarkersOf("  • one\n  1. two\n  - three"), [
      "•",
      "1.",
      "-",
    ]);
    assert.deepEqual(listMarkersOf("  ii) roman\n  b. letter"), ["ii)", "b."]);
    assert.deepEqual(listMarkersOf("plain text\n  more"), []);
    assert.deepEqual(listMarkersOf("one\n  •"), ["•"]);
    assert.deepEqual(listMarkersOf("  •\n  one"), []);
  });

  test("firstRowIndent is the blanks before the first character", () => {
    assert.equal(firstRowIndent("    def f():\n        pass"), 4);
    assert.equal(firstRowIndent("\n\n  text"), 2);
    assert.equal(firstRowIndent("text"), 0);
    assert.equal(firstRowIndent(""), 0);
    assert.equal(firstRowIndent("   \n  \n"), 0);
  });

  test("glyphEdges sees a glyph at the head and a lone glyph at the tail", () => {
    assert.deepEqual(glyphEdges("  ● item text\n  more"), {
      head: true,
      tail: false,
    });
    assert.deepEqual(glyphEdges("  text\n  ●"), { head: false, tail: true });
    assert.deepEqual(glyphEdges("  ▎ quote\n  ▎"), { head: true, tail: true });
    assert.deepEqual(glyphEdges("  ●item glued\n  text"), {
      head: false,
      tail: false,
    });
    assert.deepEqual(glyphEdges("plain\ntext"), { head: false, tail: false });
    assert.deepEqual(glyphEdges(""), { head: false, tail: false });
  });
});

describe("sorted helpers", () => {
  const values = Int32Array.from([2, 5, 5, 9, 14]);
  test("lowerBound", () => {
    assert.equal(lowerBound(values, 0), 0);
    assert.equal(lowerBound(values, 5), 1);
    assert.equal(lowerBound(values, 6), 3);
    assert.equal(lowerBound(values, 15), -1);
    assert.equal(lowerBound(new Int32Array(0), 1), -1);
  });
  test("firstWithin", () => {
    assert.equal(firstWithin(values, 6, 10), 9);
    assert.equal(firstWithin(values, 6, 9), null);
    assert.equal(firstWithin(values, 15, 99), null);
  });
});

describe("views: the binary searches agree with the linear originals", () => {
  test("inProjected equals 'add one for each removed unit at or before'", () => {
    const rng = mulberry32(77);
    for (let round = 0; round < 200; round++) {
      const n = randInt(rng, 0, 40);
      const removed: number[] = [];
      let at = randInt(rng, 0, 3);
      for (let k = 0; k < n; k++) {
        removed.push(at);
        at += randInt(rng, 1, 4);
      }
      const view: View = { text: "", removed: Int32Array.from(removed) };
      for (let index = 0; index < 60; index++) {
        let expected = index;
        for (const gone of removed) {
          if (gone <= expected) expected++;
          else break;
        }
        assert.equal(
          inProjected(view, index),
          expected,
          `round ${round} index ${index}`,
        );
      }
    }
  });

  test("a view with nothing removed maps to itself", () => {
    assert.equal(inProjected({ text: "abc", removed: null }, 2), 2);
  });

  test("locator with many hits equals unfold, in both modes", () => {
    const rng = mulberry32(5);
    const pieces = ["a", "bc", " ", "  ", "\n", "\t", "é", "日"];
    for (let round = 0; round < 50; round++) {
      let text = "";
      for (let k = randInt(rng, 5, 60); k > 0; k--)
        text += pieces[randInt(rng, 0, pieces.length - 1)];
      for (const mode of ["fold", "skeleton"] as Mode[]) {
        const view: View = { text, removed: null };
        const where = locator(view, mode, 1000);
        const folded = foldText(text, mode);
        for (let k = 0; k < folded.length; k++) {
          assert.equal(
            where(k),
            unfold(text, mode, k),
            `round ${round} ${mode} ${k}`,
          );
        }
      }
    }
  });
});

describe("blocks: the depth cap and the content offsets", () => {
  test("a quote nested past the cap reads the rest as text", () => {
    const { blocks } = parseDocument(
      ">".repeat(MAX_DEPTH + 40) + " deep words",
      "•",
    );
    const deepest = Math.max(...blocks.map((b) => b.quote));
    assert.equal(deepest, MAX_DEPTH);
    assert.ok(
      blocks.some((b) => b.lines.some((l) => l.t.includes("deep words"))),
    );
  });

  test("content offsets point past every container prefix", () => {
    const source = "- item\n\n  > ```sh\n  > one\n  > two\n  > ```\n";
    const { contentAt } = parseDocument(source, "•");
    const one = source.indexOf("one");
    const two = source.indexOf("two");
    assert.ok(Array.from(contentAt).includes(one), "line 'one'");
    assert.ok(Array.from(contentAt).includes(two), "line 'two'");
    assert.ok(
      contentAt.every((v, i) => i === 0 || (contentAt[i - 1] as number) <= v),
      "ascending",
    );
  });

  test("every offset lies inside the source", () => {
    const rng = mulberry32(3);
    const alphabet = [
      "- ",
      "> ",
      "  ",
      "1. ",
      "```\n",
      "text ",
      "\n",
      "# ",
      "| a | b |\n|---|---|\n",
    ];
    for (let round = 0; round < 100; round++) {
      let source = "";
      for (let k = randInt(rng, 1, 30); k > 0; k--)
        source += alphabet[randInt(rng, 0, alphabet.length - 1)];
      const { contentAt } = parseDocument(source, "•");
      for (const at of contentAt)
        assert.ok(at >= 0 && at <= source.length, `${at} in ${source.length}`);
    }
  });
});

describe("pasteText: edges", () => {
  const src = (message: string) => ({
    message,
    contentAt: parseDocument(message, "•").contentAt,
    leadSrc: new Int32Array(0),
  });

  test("a slice at offset 0 is its own first line", () => {
    const message = "plain words here\nmore words here";
    assert.equal(pasteText(src(message), 0, message.length, 0), message);
  });

  test("a slice that ends right after the first line has no later lines", () => {
    const message = "first line words\nsecond line words";
    assert.equal(pasteText(src(message), 0, 16, 0), "first line words");
  });

  test("a blank quote line inside a slice becomes empty", () => {
    const message = "> first quoted line\n>\n> third quoted line";
    assert.equal(
      pasteText(src(message), 2, message.length, 0),
      "first quoted line\n\nthird quoted line",
    );
  });
});
