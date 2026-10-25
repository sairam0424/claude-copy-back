import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BULLET, project, projectText } from "../src/core/project.ts";
import { TAB_CELLS } from "../src/core/wrap.ts";
import { findSource } from "../src/core/match.ts";

// Facts about the REAL Claude Code renderer, observed in the calibration
// captures (realrender/, seed 101 on 2.1.309 and seeds 4101 and 4103 on
// 2.1.310, four widths; the capture output is not part of this repository).
// Each test names what the capture showed. They pin the matcher's model of the
// renderer to those observations. This file describes the DEFAULT profile (no
// TERM_PROGRAM: links as "label (url)", tildes drawn); the Warp profile's
// drawing and the nested ordered-list markers are pinned in drawings.test.mts.

const visible = (source: string): string => projectText(source).projected;

describe("strikethrough is not interpreted (calibration: '~~between copper0977~~' stays on screen)", () => {
  test("the tildes are drawn", () => {
    assert.equal(visible("a ~~gone~~ b"), "a ~~gone~~ b");
    assert.equal(visible("keep ~~drop~~ keep"), "keep ~~drop~~ keep");
  });

  test("emphasis next to tildes still works", () => {
    assert.equal(visible("**bold ~~x~~**"), "bold ~~x~~");
  });

  test("a copy that holds the tildes finds its source, tildes included", () => {
    const message =
      "Intro words here.\n\nbefore ~~between copper0977~~ after socket0978 more words follow.";
    const found = findSource("~~between copper0977~~ after socket0978", [
      message,
    ]);
    assert.equal(
      found.ok && found.source,
      "~~between copper0977~~ after socket0978",
    );
  });
});

describe("links and images are drawn 'label (url)' (calibration: 'some it\\n anchor0908 (https://exampl...')", () => {
  test("a link keeps its destination in parentheses after a space", () => {
    assert.equal(
      visible("see [named link](https://example.com/a/b) now"),
      "see named link (https://example.com/a/b) now",
    );
  });

  test("an image is drawn as its alt text and destination, without the bang", () => {
    assert.equal(
      visible("![alt text](https://example.com/p.png) after"),
      "alt text (https://example.com/p.png) after",
    );
  });

  test("a bracketed destination loses its angle brackets; a title is drawn in parentheses after the destination", () => {
    assert.equal(visible("[a](<https://x.y/z>)"), "a (https://x.y/z)");
    assert.equal(
      visible('[a](https://x.y/z "the title")'),
      'a (https://x.y/z) ("the title")',
    );
  });

  test("an autolink is drawn without its angle brackets", () => {
    assert.equal(
      visible("go <https://example.com/q> now"),
      "go https://example.com/q now",
    );
  });

  test("a copy across a link maps back to the exact source slice", () => {
    const message =
      "Lead sentence here.\n\nWords before [some anchor0908](https://example.com/signal0147/docs) and words after it end.";
    const found = findSource(
      "before some anchor0908 (https://example.com/signal0147/docs) and words",
      [message],
    );
    assert.equal(
      found.ok && found.source,
      "before [some anchor0908](https://example.com/signal0147/docs) and words",
    );
  });

  test("a copy that starts inside the destination maps to the destination text", () => {
    const message =
      "Lead sentence here.\n\nWords before [some anchor0908](https://example.com/signal0147/docs) and words after it end.";
    const found = findSource("com/signal0147/docs) and words after", [message]);
    assert.equal(
      found.ok && found.source,
      "com/signal0147/docs) and words after",
    );
  });
});

describe("every unordered marker is drawn '- ' (calibration: '-', '*' and '+' items all show '  - ')", () => {
  test("the bullet glyph is a hyphen", () => {
    assert.equal(BULLET, "-");
  });

  test("dash, star and plus items look the same", () => {
    assert.equal(visible("- one\n* two\n+ three"), "- one\n- two\n- three");
  });

  test("rows are margin, hyphen, space", () => {
    const rows = project("- alpha beta\n  - nested gamma", {
      width: 40,
    }).rows.map((r) => r.trimEnd());
    assert.deepEqual(rows, ["⏺ - alpha beta", "    - nested gamma"]);
  });

  test("a task-list marker stays literal text", () => {
    assert.equal(visible("- [ ] open\n- [x] done"), "- [ ] open\n- [x] done");
  });
});

describe("ordered lists are numbered start + index and merge across blank lines (calibration: 1,2,3 then 1,2 drawn 1,2,3,4,5)", () => {
  test("a clean list is drawn as typed", () => {
    assert.equal(visible("1. a\n2. b\n3. c"), "1. a\n2. b\n3. c");
  });

  test("the start number is kept and the rest count up from it", () => {
    assert.equal(visible("5. a\n7. b\n1. c"), "5. a\n6. b\n7. c");
  });

  test("a second list separated by a blank line continues the numbering", () => {
    assert.equal(
      visible("1. a\n2. b\n3. c\n\n1. d\n2. e"),
      "1. a\n2. b\n3. c\n\n4. d\n5. e",
    );
  });

  test("a list item that holds a code fence does not end the list", () => {
    const source = "1. run it:\n   ```sh\n   x\n   ```\n2. next\n\n1. later";
    assert.equal(visible(source), "1. run it:\nx\n2. next\n\n3. later");
  });

  test("a bullet list or a paragraph between two ordered lists restarts the numbering", () => {
    assert.equal(
      visible("1. a\n2. b\n\n- x\n\n1. c"),
      "1. a\n2. b\n\n- x\n\n1. c",
    );
    assert.equal(
      visible("1. a\n2. b\n\npara\n\n1. c"),
      "1. a\n2. b\n\npara\n\n1. c",
    );
  });

  test("a change of delimiter starts a new list", () => {
    assert.equal(
      visible("1. a\n2. b\n\n1) c\n2) d"),
      "1. a\n2. b\n\n1. c\n2. d",
    );
  });

  test("a parenthesis marker is drawn with a dot (calibration: '1) paren one' shows '1. paren one')", () => {
    assert.equal(visible("1) one\n2) two"), "1. one\n2. two");
  });

  test("the tenth item is drawn with two digits and the offsets stay inside the source", () => {
    const source = Array.from(
      { length: 11 },
      (_, i) => `1. item ${"abcdefghijk"[i]}`,
    ).join("\n");
    const p = projectText(source);
    assert.match(p.projected, /\n10\. item j\n11\. item k$/);
    for (const at of p.map) assert.ok(at >= 0 && at < source.length);
  });

  test("a copy of a renumbered item finds the item, with the number the screen showed", () => {
    const message =
      "Steps first.\n\n1. alpha one two\n2. beta three four\n3. gamma five six\n\n1. delta seven eight\n2. epsilon nine ten\n\nThe end.";
    const found = findSource(
      "3. gamma five six\n\n  4. delta seven eight\n  5. epsilon nine",
      [message],
    );
    assert.equal(
      found.ok && found.source,
      "3. gamma five six\n\n1. delta seven eight\n2. epsilon nine",
    );
  });
});

describe("a tab in code is eight columns wide (calibration: '\\treturn' drew 2 + 8 leading spaces)", () => {
  test("TAB_CELLS", () => {
    assert.equal(TAB_CELLS, 8);
  });
});
