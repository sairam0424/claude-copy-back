import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { inlineMask } from "../src/core/inline.ts";
import { cellWidth, stringWidth } from "../src/core/width.ts";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

// inlineMask marks which characters of one paragraph's markdown the renderer
// does NOT draw (emphasis markers, backticks, link brackets, escapes).
// Everything else is visible, including unmatched markers ("2 * 3 * 4" stays
// as typed) and strikethrough tildes. A link is drawn "label (destination)" and,
// with a title, "label (destination) ("title")" like the real renderer
// (calibration seeds 101 and 4103; the title was believed hidden until the
// seed 4103 screens showed it). The Warp drawing is in drawings.test.mts.

// Mask values: 0 drawn as typed, 1 hidden, 2 drawn as a space (the "]" of a link),
// 3 drawn as ") (" (blanks before a title), 4 drawn as a double quote (a title's delimiter).
function visible(text: string): string {
  const hidden = inlineMask(text);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    if (hidden[i] === 0) out += text[i];
    else if (hidden[i] === 2) out += " ";
    else if (hidden[i] === 3) out += ") (";
    else if (hidden[i] === 4) out += '"';
  }
  return out;
}

const table: Array<[string, string, string]> = [
  ["plain text", "hello world", "hello world"],
  ["bold stars", "a **bold** b", "a bold b"],
  ["bold underscores", "a __bold__ b", "a bold b"],
  ["italic star", "a *it* b", "a it b"],
  ["italic underscore", "a _it_ b", "a it b"],
  ["bold italic", "***both***", "both"],
  ["nested emphasis", "**bold *and italic* text**", "bold and italic text"],
  ["emphasis across a soft break", "**bold\nacross**", "bold\nacross"],
  ["inline code", "use `npm test` now", "use npm test now"],
  ["double backtick span holding a backtick", "``a`b``", "a`b"],
  ["code span trims one padding space each side", "x ` a ` y", "x a y"],
  ["code span is literal inside", "`**x** [y](z)`", "**x** [y](z)"],
  ["code span across a newline (drawn as a space)", "`a\nb`", "a b"],
  ["unclosed backtick stays", "a ` b", "a ` b"],
  ["link", "see [the docs](https://x.y/a) now", "see the docs (https://x.y/a) now"],
  ["link destination with parens", "[l](https://x.y/a_(b))", "l (https://x.y/a_(b))"],
  ["link with title (the title is drawn after the destination)", '[l](http://x "title") end', 'l (http://x) ("title") end'],
  ["link with an apostrophe title", "[l](http://x 'title') end", 'l (http://x) ("title") end'],
  ["link with a parenthesised title", "[l](http://x (title)) end", 'l (http://x) ("title") end'],
  ["link with blanks around the destination", "[l]( http://x )", "l (http://x)"],
  ["link with angle destination", "[l](<http://x y>)", "l (http://x y)"],
  ["emphasis inside a link label", "[**bold** link](u)", "bold link (u)"],
  ["brackets inside a label", "[a [b] c](u)", "a [b] c (u)"],
  ["image keeps alt text and destination", "![alt text](img.png)", "alt text (img.png)"],
  ["autolink", "go <https://x.y/z> now", "go https://x.y/z now"],
  [
    "bare url with intraword underscores",
    "see https://x.y/a_b_c now",
    "see https://x.y/a_b_c now",
  ],
  [
    "unmatched brackets stay",
    "[not a link] and (parens)",
    "[not a link] and (parens)",
  ],
  ["reference style is not interpreted", "[text][ref]", "[text][ref]"],
  [
    "snake_case is not emphasis",
    "use snake_case_name here",
    "use snake_case_name here",
  ],
  ["math stars stay", "2 * 3 * 4", "2 * 3 * 4"],
  ["glob stars stay", "match *.ts and *.js files", "match *.ts and *.js files"],
  ["lone double star stays", "a ** b", "a ** b"],
  ["unclosed bold stays", "**unclosed text", "**unclosed text"],
  ["intraword star emphasis", "foo*bar*baz", "foobarbaz"],
  ["punctuation-flanked closer cannot close", "**Note:**text", "**Note:**text"],
  ["escaped star", "\\*not italic\\*", "*not italic*"],
  ["escaped backtick", "\\`not code\\`", "`not code`"],
  ["backslash before a letter stays", "C:\\path", "C:\\path"],
  ["hard break backslash is not drawn", "one\\\ntwo", "one\ntwo"],
  ["strikethrough is not interpreted", "a ~~gone~~ b", "a ~~gone~~ b"],
  ["single tilde stays", "about ~5 min or ~10 min", "about ~5 min or ~10 min"],
  ["strong then code", "**use `x`** now", "use x now"],
  ["empty string", "", ""],
  ["CJK with emphasis", "这是**重点**内容", "这是重点内容"],
  ["emoji next to emphasis", "ok **done** \u{1F600}", "ok done \u{1F600}"],
];

describe("inlineMask: what the renderer draws", () => {
  for (const [name, input, expected] of table) {
    test(name, () => assert.equal(visible(input), expected));
  }

  test("the mask has one entry per UTF-16 unit", () => {
    const text = "a **b** \u{1F600} c";
    assert.equal(inlineMask(text).length, text.length);
  });

  test("hidden characters are exactly the removed ones", () => {
    const text = "x **y** `z`";
    const hidden = inlineMask(text);
    const dropped = [...text].filter((_, i) => hidden[i] === 1).join("");
    assert.equal(dropped, "****``");
  });

  test("pathological delimiter soup terminates, and masks every character", () => {
    const soup = "*_~".repeat(3000) + " tail";
    const { value: mask, cpuMs } = cpuTimed(() => inlineMask(soup));
    assert.equal(mask.length, soup.length);
    assertCpuWithin("inline: delimiter soup", cpuMs, 1500);
  });
});

describe("cellWidth / stringWidth: what the terminal grid counts", () => {
  const widths: Array<[string, string, number]> = [
    ["ASCII", "abc", 3],
    ["accent", "café", 4],
    ["arrow and dash are narrow", "→—", 2],
    ["CJK is two cells per character", "你好", 4],
    ["Hangul", "한글", 4],
    ["fullwidth form", "Ａ", 2],
    ["emoji is two cells", "\u{1F600}", 2],
    ["combining accent adds nothing", "e\u0301", 1],
    ["zero-width joiner adds nothing", "\u{1F468}\u200d\u{1F469}", 4],
    ["variation selector adds nothing", "a\ufe0f", 1],
    ["box drawing is narrow", "─│", 2],
    ["control characters have no width", "\t", 0],
  ];
  for (const [name, input, expected] of widths) {
    test(name, () => assert.equal(stringWidth(input), expected));
  }

  test("cellWidth takes code points", () => {
    assert.equal(cellWidth(0x4f60), 2);
    assert.equal(cellWidth(0x61), 1);
    assert.equal(cellWidth(0x301), 0);
  });
});
