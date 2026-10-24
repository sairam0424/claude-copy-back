import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { project, projectText, BULLET, OPAQUE } from "../src/core/project.ts";

// What the reader sees (projected), and where each visible character came from
// (map). Width-independent: rows and wrapping are covered in layout.test.ts.

const B = BULLET;

const constructs: Array<[string, string, string]> = [
  ["paragraph", "Hello world.", "Hello world."],
  [
    "two paragraphs",
    "First para.\n\nSecond para.",
    "First para.\n\nSecond para.",
  ],
  ["soft break stays a line break", "line one\nline two", "line one\nline two"],
  ["trailing newline is dropped", "alone\n", "alone"],
  ["CRLF source", "a\r\n\r\nb", "a\n\nb"],
  ["empty source", "", ""],
  ["blank lines only", "\n\n  \n", ""],
  ["heading", "# Title\n\nbody", "Title\n\nbody"],
  ["heading levels and closing hashes", "### Sub ###\ntext", "Sub\ntext"],
  ["hash without a space is text", "#hashtag here", "#hashtag here"],
  ["setext heading", "Title\n=====\n\nbody", "Title\n\nbody"],
  ["bold italic code link", "a **b** *c* `d` [e](http://x.y) f", "a b c d e (http://x.y) f"],
  ["strikethrough is not interpreted", "keep ~~drop~~ keep", "keep ~~drop~~ keep"],
  ["escapes", "\\*not\\* a \\[link\\]", "*not* a [link]"],
  ["bullet list", "- one\n- two", `${B} one\n${B} two`],
  ["star and plus bullets", "* one\n+ two", `${B} one\n${B} two`],
  [
    "numbered list counts up from its start",
    "1. one\n2. two\n10. ten",
    "1. one\n2. two\n3. ten",
  ],
  ["numbered list with parens is drawn with dots", "1) one\n2) two", "1. one\n2. two"],
  [
    "nested bullets",
    "- a\n  - b\n    - c\n- d",
    `${B} a\n${B} b\n${B} c\n${B} d`,
  ],
  ["numbered inside bullet", "- a\n  1. b\n  2. c", `${B} a\n1. b\n2. c`],
  ["bullet inside numbered", "1. a\n   - b\n2. c", `1. a\n${B} b\n2. c`],
  ["loose list", "- a\n\n- b", `${B} a\n\n${B} b`],
  [
    "item with a second paragraph",
    "- a\n\n  more\n- b",
    `${B} a\n\nmore\n${B} b`,
  ],
  ["lazy continuation line", "- a\nlazy\n- b", `${B} a\nlazy\n${B} b`],
  [
    "list right after a paragraph line",
    "intro:\n- a\n- b",
    `intro:\n${B} a\n${B} b`,
  ],
  [
    "inline markers inside items",
    "- **bold** item\n- `code` item",
    `${B} bold item\n${B} code item`,
  ],
  ["empty item keeps its bullet", "- a\n-\n- b", `${B} a\n${B} \n${B} b`],
  ["block quote", "> quoted\n> more\n\nafter", "quoted\nmore\n\nafter"],
  ["nested quote", "> a\n> > b", "a\nb"],
  ["quote holding a list", "> - x\n> - y", `${B} x\n${B} y`],
  ["lazy quote continuation", "> a\nb", "a\nb"],
  [
    "fenced code verbatim",
    "```js\nconst a = 1;\n  indented();\n```",
    "const a = 1;\n  indented();",
  ],
  [
    "fence between paragraphs",
    "pre\n\n```\ncode\n```\n\npost",
    "pre\n\ncode\n\npost",
  ],
  ["tilde fence", "~~~\nx\n~~~", "x"],
  [
    "longer fence may contain a short one",
    "````\n```\ninner\n```\n````",
    "```\ninner\n```",
  ],
  ["unterminated fence runs to the end", "```\ncode\nmore", "code\nmore"],
  [
    "code keeps markdown markers literally",
    "```\n**x** `y` # z\n```",
    "**x** `y` # z",
  ],
  ["blank lines inside code are kept", "```\na\n\nb\n```", "a\n\nb"],
  [
    "fence inside a list item",
    "1. step\n   ```bash\n   cmd --flag\n   ```\n2. next",
    "1. step\ncmd --flag\n2. next",
  ],
  [
    "indented code block",
    "para\n\n    code line\n    more",
    "para\n\ncode line\nmore",
  ],
  ["horizontal rule", "a\n\n---\n\nb", "a\n\n---\n\nb"],
  [
    "table is one opaque region",
    "x\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\ny",
    `x\n\n${OPAQUE}\n\ny`,
  ],
  ["table without outer pipes", "a | b\n--|--\n1 | 2", OPAQUE],
  ["a lone pipe line is text", "a | b is just text", "a | b is just text"],
  [
    "non-ASCII text",
    "café — a → b 你好 \u{1F600}",
    "café — a → b 你好 \u{1F600}",
  ],
  ["emphasis around CJK", "这是**重点**内容", "这是重点内容"],
  [
    "url with underscores",
    "see https://x.y/a_b_c now",
    "see https://x.y/a_b_c now",
  ],
];

describe("projectText: the visible text of each construct", () => {
  for (const [name, source, expected] of constructs) {
    test(name, () => assert.equal(projectText(source).projected, expected));
  }

  test("a custom bullet glyph", () => {
    assert.equal(projectText("- a", "-").projected, "- a");
  });
});

describe("project: map invariants", () => {
  const fixtures = constructs.filter(
    ([name]) => !name.includes("horizontal") && !name.includes("table"),
  );
  for (const [name, source] of fixtures) {
    test(`map fidelity: ${name}`, () => {
      const { projected, map, leadAt } = projectText(source);
      const markerUnits = new Set(leadAt);
      assert.equal(map.length, projected.length);
      let prev = -1;
      for (let i = 0; i < projected.length; i++) {
        const at = map[i] as number;
        assert.ok(
          at >= 0 && at < source.length,
          `map[${i}]=${at} out of range`,
        );
        assert.ok(at >= prev, `map is not non-decreasing at ${i}`);
        prev = at;
        const ch = projected[i] as string;
        // a drawn list marker replaces the typed one, so its digits need not equal the source's
        if (/\s/.test(ch) || ch === B || markerUnits.has(i)) continue;
        assert.equal(
          source[at],
          ch,
          `projected[${i}]=${JSON.stringify(ch)} came from ${JSON.stringify(source[at])}`,
        );
      }
    });
  }

  test("bullet glyph points at the source marker", () => {
    const { projected, map } = projectText("text\n\n- item");
    const at = projected.indexOf(B);
    assert.equal("text\n\n- item"[map[at] as number], "-");
  });

  test("map entries are per UTF-16 unit (astral characters)", () => {
    const source = "a \u{1F600} b";
    const { projected, map } = projectText(source);
    assert.equal(map.length, projected.length);
    assert.equal(
      source.slice(map[2] as number, (map[3] as number) + 1),
      "\u{1F600}",
    );
  });

  test("hidden markers sit between mapped characters", () => {
    const source = "x **bold** y";
    const { projected, map } = projectText(source);
    const at = projected.indexOf("bold");
    assert.equal(
      source.slice(map[at] as number, (map[at + 3] as number) + 1),
      "bold",
    );
  });

  test("projected and map do not depend on width", () => {
    const source =
      "- a **b** long enough text to wrap\n\n```\ncode line that is long enough to wrap too\n```";
    const base = project(source, { width: 120 });
    for (const width of [40, 60, 80, 100]) {
      const other = project(source, { width });
      assert.equal(other.projected, base.projected);
      assert.deepEqual(other.map, base.map);
    }
  });

  test("project() map is a plain number array of projected length", () => {
    const result = project("hello **x**", { width: 80 });
    assert.ok(Array.isArray(result.map));
    assert.equal(result.map.length, result.projected.length);
  });
});
