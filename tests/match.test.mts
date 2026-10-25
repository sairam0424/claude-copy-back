import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertHit, find, makeCase, WIDTHS } from "../src/sim/testkit.ts";

// findSource must hand back the EXACT source slice for a simulated copy, for
// every markdown construct at every width, whatever the selection edges are.

const PROSE =
  "Claude Code draws every reply with a two column margin and hard line breaks at the terminal width, " +
  "so a paragraph that is copied arrives as several rows with spaces at the end of each one.";

interface Construct {
  name: string;
  source: string;
  from: string;
  to: string;
}

const constructs: Construct[] = [
  {
    name: "paragraph",
    source: PROSE,
    from: "column margin",
    to: "several rows",
  },
  {
    name: "paragraph, mid-word edges",
    source: PROSE,
    from: "gin and hard",
    to: "arrives as sev",
  },
  {
    name: "inline markers inside the span",
    source:
      "Use the **bold phrase** and `some code` then [a link label](https://example.com/some/long/path) before the *final emphasis* ends here.",
    from: "bold phrase",
    to: "final emph",
  },
  {
    name: "span starts and ends inside markers",
    source:
      "Alpha **bravo charlie delta** echo `foxtrot golf hotel` india juliet kilo.",
    from: "charlie delta",
    to: "foxtrot gol",
  },
  {
    name: "heading and paragraph",
    source: `## Section title\n\nBody text after the heading with enough words to wrap around the row. ${PROSE}`,
    from: "title",
    to: "enough words",
  },
  {
    name: "two paragraphs",
    source: `${PROSE}\n\nThe second paragraph also wraps because it keeps going for quite a while.`,
    from: "end of each one.",
    to: "also wraps",
  },
  {
    name: "bullet list across items",
    source:
      "Steps:\n\n- first step has a fairly long description that wraps around the row\n- second step also has a long description that wraps\n- third step is short",
    from: "description that wraps around",
    to: "third step",
  },
  {
    name: "nested bullets",
    source:
      "- parent item with a long enough line to wrap around the terminal row\n  - child item with another long enough line to wrap around the row\n    - grandchild item that is also long enough to wrap around too\n- sibling",
    from: "terminal row",
    to: "grandchild item",
  },
  {
    name: "numbered list",
    source:
      "1. install the dependencies with the package manager of your choice\n2. run the build step and wait for it to finish completely\n3. start the server and open the page in a browser",
    from: "choice",
    to: "finish comp",
  },
  {
    name: "numbered list with a code fence in an item",
    source:
      "1. Run this:\n   ```bash\n   npm install --save-dev some-package another-package\n   ```\n2. Then run the build and wait for it to finish completely please",
    from: "npm install",
    to: "Then run the build",
  },
  {
    name: "block quote",
    source:
      "> quoted text that is long enough to need wrapping at the narrower widths here\n> and a second quoted line that also keeps going for a while",
    from: "narrower widths",
    to: "second quoted",
  },
  {
    name: "code fence with indentation",
    source:
      "Before.\n\n```ts\nfunction demo(value: number) {\n    if (value > 0) {\n        return value * 2;\n    }\n    return 0;\n}\n```\n\nAfter.",
    from: "if (value > 0)",
    to: "return 0;",
  },
  {
    name: "code fence with a long line",
    source:
      "```ts\nconst result = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, argumentNumberFour);\nconst other = 1;\n```",
    from: "someFunction(argumentNumberOne, argumentNumberTwo",
    to: "other = 1",
  },
  {
    name: "mixed document",
    source: `# Plan\n\n${PROSE}\n\n- item one ${PROSE}\n- item two\n\n> quoted ${PROSE}\n\n\`\`\`\ncode here\n  indented here\n\`\`\`\n\nClosing words for the document.`,
    from: "item two",
    to: "indented here",
  },
];

describe("findSource: exact slice for every construct at every width", () => {
  for (const c of constructs) {
    for (const width of WIDTHS) {
      test(`${c.name} @ ${width}`, () => {
        const made = makeCase(c.source, c.from, c.to, width);
        const result = find(made);
        assertHit(result, [c.source]);
        assert.equal(result.source, made.expected);
        assert.equal(result.messageIndex, 0);
      });
    }
  }
});

describe("findSource: the copy arrives in different shapes", () => {
  const variants: Array<[string, Parameters<typeof makeCase>[4]]> = [
    ["with the margin on the first row", { marginOnFirstRow: true }],
    ["without trailing padding", { pad: false }],
    ["with CRLF rows", { eol: "\r\n" }],
    ["with ANSI escapes around rows", { ansi: true }],
    [
      "all of them at once",
      { marginOnFirstRow: true, eol: "\r\n", ansi: true },
    ],
  ];
  const source = constructs[2]?.source as string;
  for (const [name, copy] of variants) {
    for (const width of WIDTHS) {
      test(`${name} @ ${width}`, () => {
        const made = makeCase(source, "bold phrase", "final emph", width, copy);
        const result = find(made);
        assertHit(result, [source]);
        assert.equal(result.source, made.expected);
      });
    }
  }

  test("a copy that starts at the first row carries the reply bullet", () => {
    const made = makeCase(PROSE, "Claude Code draws", "two column margin", 40, {
      marginOnFirstRow: true,
    });
    assert.ok(made.copied.startsWith("⏺ "));
    const result = find(made);
    assertHit(result, [PROSE]);
    assert.equal(result.source, made.expected);
  });

  test("a copy of a whole message, first row to last", () => {
    const made = makeCase(PROSE, "Claude Code", "each one.", 60, {
      marginOnFirstRow: true,
    });
    const result = find(made);
    assertHit(result, [PROSE]);
    assert.equal(result.source, PROSE);
  });
});

describe("findSource: the slice is source text, byte for byte", () => {
  test("code keeps its original indentation and line breaks", () => {
    const source =
      "```ts\nfunction demo(value: number) {\n    if (value > 0) {\n        return value * 2;\n    }\n}\n```";
    const made = makeCase(source, "if (value > 0)", "return value * 2;", 80);
    const result = find(made);
    assertHit(result, [source]);
    assert.equal(result.source, "if (value > 0) {\n        return value * 2;");
  });

  test("markdown markers inside the slice are kept as typed", () => {
    const source =
      "intro words here then **bold** and `code` and [link](http://x.y/z) closing";
    const made = makeCase(source, "then bold", "and link");
    const result = find(made);
    assertHit(result, [source]);
    assert.equal(result.source, "then **bold** and `code` and [link");
  });

  test("a list slice keeps its markers", () => {
    const source =
      "- alpha bravo charlie\n- delta echo foxtrot\n- golf hotel india";
    const made = makeCase(source, "charlie", "delta echo");
    const result = find(made);
    assertHit(result, [source]);
    assert.equal(result.source, "charlie\n- delta echo");
  });

  test("the result reports where it came from", () => {
    const made = makeCase(PROSE, "column margin", "several rows", 80);
    const result = find(made, [
      "unrelated message about something else entirely",
    ]);
    assertHit(result, [PROSE]);
    assert.equal(PROSE.slice(result.start, result.end), result.source);
    assert.equal(result.candidates, 1);
    assert.ok(result.projectedChars >= 12);
  });
});
