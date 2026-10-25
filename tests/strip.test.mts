import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  DECORATION_TABLE,
  endsWithLoneMarker,
  startsWithMarker,
  stripDecoration,
} from "../src/core/strip.ts";

// stripDecoration is the ONE place that removes renderer decoration from copied
// text. These tests pin its contract: it removes only what the table names,
// never re-wraps, never collapses inner whitespace, and is idempotent.

describe("stripDecoration: the decoration table documents itself", () => {
  for (const row of DECORATION_TABLE) {
    const on = row.switch === "markers" ? { markers: true } : {};
    test(`table row "${row.name}": example cleans as documented`, () => {
      assert.equal(stripDecoration(row.example.raw, on), row.example.clean);
    });
    if (row.switch === "glyphs") {
      test(`table row "${row.name}": kept when glyph stripping is off`, () => {
        assert.equal(
          stripDecoration(row.example.raw, { glyphs: false }),
          row.example.kept,
        );
      });
    }
    if (row.switch === "markers") {
      test(`table row "${row.name}": kept by default`, () => {
        assert.equal(stripDecoration(row.example.raw), row.example.kept);
      });
    }
  }

  test("every table row has a unique name and a reason", () => {
    const names = DECORATION_TABLE.map((r) => r.name);
    assert.equal(new Set(names).size, names.length);
    for (const row of DECORATION_TABLE) assert.ok(row.why.length > 10, row.name);
  });
});

describe("stripDecoration: list markers (fallback option)", () => {
  const cases: Array<[string, string, string]> = [
    ["bullet dot", "  • one\n  • two", "one\ntwo"],
    ["hyphen", "  - one\n  - two", "one\ntwo"],
    ["star and plus", "  * one\n  + two", "one\ntwo"],
    ["hollow and small bullets", "  ◦ one\n  ▪ two\n  ‣ three", "one\ntwo\nthree"],
    ["numbers with dot or paren", "  1. one\n  2) two\n  10. ten", "one\ntwo\nten"],
    ["letters and roman numerals", "  a. one\n  b) two\n  iv. four", "one\ntwo\nfour"],
    ["nested indentation", "  • one\n    ◦ two", "one\n  two"],
    ["a marker with nothing after it, on the last row", "  • one\n  •", "one\n"],
    ["a lone marker-like token on any other row is text", "  e.\n  • one", "e.\none"],
    ["a lone token on the first row is text", "  2.\n  3. two", "2.\ntwo"],
    ["a dash inside a row is text", "  one - two", "one - two"],
    ["a hyphen glued to a word is text", "  -flag and 1.5 are fine", "-flag and 1.5 are fine"],
    ["a decimal is not a marker", "  3.14 is pi", "3.14 is pi"],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(stripDecoration(input, { markers: true }), expected));
  }

  test("startsWithMarker needs text after the marker", () => {
    assert.equal(startsWithMarker("  • one"), true);
    assert.equal(startsWithMarker("\n  1. one"), true);
    assert.equal(startsWithMarker("  e.\n  • one"), false);
    assert.equal(startsWithMarker("  •"), false);
    assert.equal(startsWithMarker("  plain"), false);
  });

  test("endsWithLoneMarker looks at the last non-blank row only", () => {
    assert.equal(endsWithLoneMarker("one\n  •"), true);
    assert.equal(endsWithLoneMarker("one\n  •\n\n"), true);
    assert.equal(endsWithLoneMarker("one\n  • two"), false);
    assert.equal(endsWithLoneMarker("•\none"), false);
  });

  test("off by default", () => {
    assert.equal(stripDecoration("  • one\n  1. two"), "• one\n1. two");
  });

  test("composes with glyph stripping", () => {
    assert.equal(stripDecoration("⏺ • one\n  • two", { markers: true }), "one\ntwo");
  });
});

describe("stripDecoration: margin, padding, wraps", () => {
  const cases: Array<[string, string, string]> = [
    ["uniform two-space margin", "  hello\n  world", "hello\nworld"],
    [
      "trailing padding on every row",
      "  hello      \n  world   ",
      "hello\nworld",
    ],
    [
      "selection started mid-line (first row has no margin)",
      "ord is here   \n  continued",
      "ord is here\ncontinued",
    ],
    [
      "code indentation survives, only the margin goes",
      "  def f():\n      return 1",
      "def f():\n    return 1",
    ],
    ["blank rows stay blank rows", "  a\n      \n  b", "a\n\nb"],
    ["single row: leading whitespace is the margin", "   only", "only"],
    ["tabs in the middle are not touched", "  a\tb  c", "a\tb  c"],
    ["no decoration at all is a no-op", "plain text", "plain text"],
    ["empty string", "", ""],
    ["whitespace only", "   \n  \n", "\n\n"],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(stripDecoration(input), expected));
  }

  test("never joins rows: hard wraps are the matcher's problem", () => {
    assert.equal(
      stripDecoration("  one two\n  three four"),
      "one two\nthree four",
    );
  });

  test("keeps the first row's leading spaces when they are fewer than the margin", () => {
    assert.equal(stripDecoration(" x\n  y\n  z"), " x\ny\nz");
  });
});

describe("stripDecoration: control sequences and odd characters", () => {
  const cases: Array<[string, string, string]> = [
    ["CRLF", "a\r\nb\r\n", "a\nb\n"],
    ["lone CR", "a\rb", "a\nb"],
    ["SGR colour", "\u001b[1;31mred\u001b[0m", "red"],
    ["reverse-video padding", "\u001b[7m  hi  \u001b[0m", "hi"],
    ["erase-to-end", "text\u001b[K", "text"],
    [
      "OSC 8 hyperlink (BEL)",
      "\u001b]8;;https://x.example\u0007label\u001b]8;;\u0007",
      "label",
    ],
    [
      "OSC 8 hyperlink (ST)",
      "\u001b]8;;https://x.example\u001b\\label\u001b]8;;\u001b\\",
      "label",
    ],
    ["8-bit CSI", "\u009b31mred", "red"],
    ["NBSP becomes a space", "a\u00a0b", "a b"],
    ["zero-width space removed", "a\u200bb", "ab"],
    ["BOM removed", "\ufeffabc", "abc"],
    ["NUL and bell removed", "a\u0000b\u0007c", "abc"],
    [
    ["ZWJ emoji sequence kept intact", "\u{1F468}\u200d\u{1F469}", "\u{1F468}\u200d\u{1F469}"],
      "\u{1F468}‍\u{1F469}",
      "\u{1F468}‍\u{1F469}",
    ],
    [
      "accents, dashes, arrows, CJK untouched",
      "café — a → b 你好",
      "café — a → b 你好",
    ],
  ];
  for (const [name, input, expected] of cases) {
    test(name, () => assert.equal(stripDecoration(input), expected));
  }
});

describe("stripDecoration: glyphs", () => {
  test("reply bullet only at a row start", () => {
    assert.equal(stripDecoration("⏺ Hello\n  mid ⏺ dot"), "Hello\nmid ⏺ dot");
  });

  test("alternate reply bullet", () => {
    assert.equal(stripDecoration("● Hello"), "Hello");
  });

  test("a list bullet is part of the visible text and stays", () => {
    assert.equal(stripDecoration("  • one\n  • two"), "• one\n• two");
  });

  test("a quote bar goes, the quoted text stays", () => {
    assert.equal(stripDecoration("  ▎ quoted\n  ▎ more"), "quoted\nmore");
  });

  test("glyphs:false leaves bars and the reply bullet alone", () => {
    assert.equal(
      stripDecoration("⏺ Hello\n  │ tree", { glyphs: false }),
      "⏺ Hello\n│ tree",
    );
  });

  test("a mid-row bar is never touched", () => {
    assert.equal(stripDecoration("  a │ b"), "a │ b");
  });
});

describe("stripDecoration: properties", () => {
  const samples = [
    "  ⏺ x\n  y   \n",
    "\u001b[1m  a  \u001b[0m\r\n  b",
    "  ▎ q\n  ▎ r",
    "  code\n  more code",
    "",
  ];
  for (const sample of samples) {
    test(`idempotent on ${JSON.stringify(sample)}`, () => {
      const once = stripDecoration(sample);
      assert.equal(stripDecoration(once), once);
    });
  }

  test("pure: the input is not mutated and equal calls agree", () => {
    const input = "  a  \n  b  ";
    const copy = String(input);
    assert.equal(stripDecoration(input), stripDecoration(input));
    assert.equal(input, copy);
  });

  test("never throws on junk", () => {
    for (const junk of [
      "\u001b",
      "\u001b[",
      "\u001b]8;;",
      "\u009b",
      "\ud800",
      "\n\n\n",
    ]) {
      assert.equal(typeof stripDecoration(junk), "string");
    }
  });
});
