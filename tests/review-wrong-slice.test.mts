import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { assertHit, makeCase } from "../src/sim/testkit.ts";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

// Regression tests for the review findings that made findSource return a
// WRONG slice (worse than no match): F1 head-truncated copies, F2 a newer
// message with the same words, F4 refusals that should have searched, F5 the
// hit cap, and the independent K1 false positive (list numbers).

describe("F1: a first row that starts with a real glyph keeps it", () => {
  const cases: Array<[string, string, string, string]> = [
    [
      "tree row in a code fence",
      "Layout:\n\n```\nproject/\n├── src\n│   ├── components.ts\n│   └── utils.ts\n└── lib\n```\n",
      "│   ├── components.ts",
      "components.ts",
    ],
    [
      "box diagram row",
      "Diagram:\n\n```\n┌──────────────────────┐\n│ Orchestrator service │\n└──────────────────────┘\n```\n",
      "│ Orchestrator service │",
      "service │",
    ],
    [
      "prose that starts with a bullet glyph",
      "Status report follows.\n\n● Orchestrator service is running fine and healthy today.\n",
      "● Orchestrator service is running fine",
      "running fine",
    ],
    [
      "tool-output style row in code",
      "Output:\n\n```\n⎿  Read 120 lines from the file\n```\n",
      "⎿  Read 120 lines from the file",
      "the file",
    ],
    [
      "quote-bar glyph typed inside code",
      "Sample:\n\n```\n▎ not a quote just text here ok\n```\n",
      "▎ not a quote just text here ok",
      "here ok",
    ],
  ];
  for (const [name, source, from, to] of cases) {
    for (const width of [60, 100]) {
      test(`${name} @ ${width}`, () => {
        const made = makeCase(source, from, to, width, {
          marginOnFirstRow: true,
        });
        const result = findSource(made.copied, [source]);
        assertHit(result, [source]);
        assert.equal(result.source, made.expected);
      });
    }
  }

  test("a real quote still loses its bars (the stripped form is still tried)", () => {
    const source =
      "Intro line.\n\n> quoted words that are long enough to match\n> and a second quoted row of words\n";
    const made = makeCase(source, "quoted words", "quoted row", 80, {
      marginOnFirstRow: true,
    });
    assert.ok(made.copied.includes("▎"));
    const result = findSource(made.copied, [source]);
    assertHit(result, [source]);
    assert.equal(result.source, made.expected);
  });
});

describe("F4: the floor applies per pattern, not to the first one", () => {
  const tree =
    "Layout:\n\n```\nproject/\n├── src\n│   ├── a\n│   └── b\n└── lib\n```\n";

  test("a copy that is long enough only with its glyphs is searched", () => {
    const result = findSource("  │   ├── a\n  │   └── b", [tree]);
    assertHit(result, [tree]);
    assert.equal(result.source, "│   ├── a\n│   └── b");
  });

  test("a long run of one glyph is searched (no-match), not called empty", () => {
    assert.deepEqual(findSource("│".repeat(130), [tree]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("a lone glyph or genuinely short copy keeps its refusal", () => {
    assert.deepEqual(findSource("  │ ", [tree]), {
      ok: false,
      reason: "empty",
    });
    assert.deepEqual(findSource("  │ a", [tree]), {
      ok: false,
      reason: "too-short",
    });
    assert.deepEqual(findSource("short text", [tree]), {
      ok: false,
      reason: "too-short",
    });
  });
});

describe("F5: ambiguity is judged on every hit, not the first 64", () => {
  test("a differing hit after 100 identical ones makes it ambiguous", () => {
    const source =
      "x y z w v u ".repeat(100) +
      "**x y z w v u** " +
      "x y z w v u ".repeat(5);
    assert.deepEqual(findSource("x y z w v u x y z w v u", [source]), {
      ok: false,
      reason: "ambiguous",
    });
  });

  test("thousands of identical hits stay bounded and unambiguous", () => {
    const source = "ab cd ef gh ij kl ".repeat(5000);
    const { value: result, cpuMs } = cpuTimed(() =>
      findSource("ab cd ef gh ij kl ab cd ef gh ij kl", [source]),
    );
    assertHit(result, [source]);
    assert.ok(result.candidates > 4000, `candidates ${result.candidates}`);
    assertCpuWithin("review-wrong-slice: identical hits", cpuMs, 1500);
  });
});

describe("F2: a newer message with the same words does not win blindly", () => {
  const older =
    "Here is the helper:\n\n```python\ndef f(x):\n    if x:\n        return 1\n    return 2\n```";
  const newer =
    "Wrapped in a class:\n\n```python\nclass C:\n    def f(self, x):\n        if x:\n            return 1\n        return 2\n```";

  test("indentation that matches the copy beats recency", () => {
    const made = makeCase(older, "if x:", "return 2", 80);
    const result = findSource(made.copied, [newer, older]);
    assertHit(result, [newer, older]);
    assert.equal(result.messageIndex, 1);
    assert.equal(result.source, made.expected);
  });

  test("a copy that carries no margin at all (the minimal reproduction)", () => {
    // Rows keep their full source indentation: stripping the assumed 2-column
    // margin would make every candidate look too shallow. The margin-free
    // comparison still tells the older message from the deeper newer one.
    const copied = "if x:\n        return 1\n    return 2";
    const result = findSource(copied, [newer, older]);
    assertHit(result, [newer, older]);
    assert.equal(result.messageIndex, 1);
    assert.equal(result.source, "if x:\n        return 1\n    return 2");
  });

  test("the newer message is still chosen when the copy came from it", () => {
    const made = makeCase(newer, "if x:", "return 2", 80);
    const result = findSource(made.copied, [newer, older]);
    assertHit(result, [newer, older]);
    assert.equal(result.messageIndex, 0);
    assert.equal(result.source, made.expected);
  });

  test("a copy from the older, DEEPER code is not taken from a newer shallower one", () => {
    const deeper =
      "Wrapped in a class:\n\n```python\nclass C:\n    def f(self, x):\n        if x:\n            return 1\n        return 2\n```";
    const shallower =
      "Here is the helper:\n\n```python\ndef f(x):\n    if x:\n        return 1\n    return 2\n```";
    const made = makeCase(deeper, "if x:", "return 2", 80);
    const result = findSource(made.copied, [shallower, deeper]);
    assertHit(result, [shallower, deeper]);
    assert.equal(result.messageIndex, 1);
    assert.equal(result.source, made.expected);
  });

  test("a relative indentation change (not only a shift) is told apart", () => {
    const a = "```\nstart\n    middle\n    end\n```";
    const b = "```\nstart\nmiddle\n    end\n```";
    const made = makeCase(a, "start", "end", 80);
    const result = findSource(made.copied, [b, a]);
    assertHit(result, [b, a]);
    assert.equal(result.messageIndex, 1);
    assert.equal(result.source, made.expected);
  });

  test("identical slices in two messages still go to the newest", () => {
    const text = "Everything you copy here is found in more than one reply.";
    const result = findSource("found in more than one", [
      `**new** ${text}`,
      `old ${text}`,
    ]);
    assertHit(result, [`**new** ${text}`, `old ${text}`]);
    assert.equal(result.messageIndex, 0);
  });

  const markedUp =
    "Check **error: file not found** carefully before you continue.";
  const plain = "Check error: file not found carefully before you continue.";

  test("same words, different markup, nothing to tell them apart: ambiguous", () => {
    const made = makeCase(plain, "Check error", "carefully", 80);
    assert.deepEqual(findSource(made.copied, [markedUp, plain]), {
      ok: false,
      reason: "ambiguous",
    });
  });

  test("newestWinsOnConflict restores newest-first for that case only", () => {
    const made = makeCase(plain, "Check error", "carefully", 80);
    const result = findSource(made.copied, [markedUp, plain], {
      newestWinsOnConflict: true,
    });
    assertHit(result, [markedUp, plain]);
    assert.equal(result.messageIndex, 0);
  });

  test("a conflict inside the newest message stays ambiguous under newestWinsOnConflict", () => {
    const twice =
      "Run the **full test suite** now.\n\nRun the full test suite now.";
    assert.deepEqual(
      findSource("the full test suite now", [twice], {
        newestWinsOnConflict: true,
      }),
      { ok: false, reason: "ambiguous" },
    );
  });
});

describe("independent K1: the marker-agnostic tier checks list numbers", () => {
  const numbered =
    "Steps:\n\n1. alpha bravo charlie delta\n2. echo foxtrot golf hotel\n3. india juliet kilo lima\n";
  const copy = "  2. echo foxtrot golf hotel\n  3. india juliet kilo lima";

  test("the true message matches", () => {
    const result = findSource(copy, [numbered]);
    assertHit(result, [numbered]);
    assert.equal(
      result.source,
      "2. echo foxtrot golf hotel\n3. india juliet kilo lima",
    );
  });

  test("the same words with no list markers at all do not match", () => {
    const flat =
      "Notes: echo foxtrot golf hotel india juliet kilo lima and more.";
    assert.deepEqual(findSource(copy, [flat]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("the same words under different list numbers do not match", () => {
    const other =
      "Steps:\n\n5. echo foxtrot golf hotel\n6. india juliet kilo lima\n";
    assert.deepEqual(findSource(copy, [other]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("a numbered copy against bullets does not match", () => {
    const bullets = "- echo foxtrot golf hotel\n- india juliet kilo lima\n";
    assert.deepEqual(findSource(copy, [bullets]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("a start marker with another number is refused", () => {
    const other = "Steps:\n\n7. echo foxtrot golf hotel and some more words\n";
    assert.deepEqual(findSource("  2. echo foxtrot golf hotel", [other]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("a bulleted copy against numbered items does not match", () => {
    assert.deepEqual(
      findSource("  • echo foxtrot golf hotel\n  • india juliet kilo lima", [
        "5. echo foxtrot golf hotel\n6. india juliet kilo lima\n",
      ]),
      { ok: false, reason: "no-match" },
    );
  });

  test("a lettered copy against bullets does not match", () => {
    assert.deepEqual(
      findSource("  a. echo foxtrot golf hotel\n  b. india juliet kilo lima", [
        "- echo foxtrot golf hotel\n- india juliet kilo lima\n",
      ]),
      { ok: false, reason: "no-match" },
    );
  });

  test("letters and roman numerals still stand in for numbers, bullets for bullets", () => {
    for (const drawn of [
      "  a. echo foxtrot golf hotel\n  b. india juliet kilo lima",
      "  ii) echo foxtrot golf hotel\n  iii) india juliet kilo lima",
    ]) {
      const result = findSource(drawn, [numbered]);
      assertHit(result, [numbered]);
    }
  });
});
