import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource, resetMatchCache } from "../src/core/match.ts";
import { project } from "../src/core/project.ts";
import { assertHit, find, makeCase, WIDTHS } from "../src/sim/testkit.ts";
import { randomMarkdown } from "../src/sim/grammar.ts";
import { mulberry32 } from "../src/sim/prng.ts";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

describe("findSource: refusals", () => {
  const message =
    "A plain message about abcdefghijkl and abcdefghijk and the rest of it.";

  test("under 12 projected characters is too-short", () => {
    assert.deepEqual(findSource("abcdefghijk", [message]), {
      ok: false,
      reason: "too-short",
    });
  });

  test("exactly 12 is searched", () => {
    const result = findSource("abcdefghijkl", [message]);
    assertHit(result, [message]);
    assert.equal(result.source, "abcdefghijkl");
    assert.equal(result.projectedChars, 12);
  });

  test("the floor counts folded characters, not raw ones", () => {
    assert.deepEqual(findSource("  a    b   \n  c  d  ", [message]), {
      ok: false,
      reason: "too-short",
    });
  });

  test("minProjectedChars moves the floor", () => {
    assert.equal(findSource("the rest", [message]).ok, false);
    assert.equal(
      findSource("the rest", [message], { minProjectedChars: 8 }).ok,
      true,
    );
  });

  for (const [name, copied] of [
    ["empty string", ""],
    ["spaces", "    "],
    ["blank rows", "\n \n   \n"],
    ["only an escape", "\u001b[0m"],
    ["only a reply bullet", "  ⏺ "],
    ["only a quote bar", "▎ "],
    ["only NUL", "\u0000\u0000"],
  ] as const) {
    test(`empty: ${name}`, () => {
      assert.deepEqual(findSource(copied, [message]), {
        ok: false,
        reason: "empty",
      });
    });
  }

  test("a non-string copy is empty, not a crash", () => {
    assert.deepEqual(findSource(undefined as unknown as string, [message]), {
      ok: false,
      reason: "empty",
    });
  });

  test("no messages is no-match", () => {
    assert.deepEqual(findSource("something long enough", []), {
      ok: false,
      reason: "no-match",
    });
  });

  test("a mutated word is no-match", () => {
    const made = makeCase(
      "the quick brown fox jumps over the lazy dog again and again",
      "brown fox",
      "lazy dog",
      40,
    );
    assert.equal(find(made).ok, true);
    const mutated = made.copied.replace("jumps", "jumpz");
    assert.deepEqual(findSource(mutated, [made.source]), {
      ok: false,
      reason: "no-match",
    });
  });

  test("text from outside the session never matches", () => {
    assert.deepEqual(
      findSource("https://elsewhere.example/a/b/c?x=1 and a password", [
        message,
      ]),
      { ok: false, reason: "no-match" },
    );
  });

  test("junk inputs never throw", () => {
    for (const junk of [
      "\ud800",
      "\u001b]8;;",
      "\\",
      "`".repeat(50),
      "*".repeat(200),
      "[[[[]]]]((((",
      "\u0000",
    ]) {
      const result = findSource(junk.repeat(3), [message, junk.repeat(10)]);
      assert.equal(typeof result.ok, "boolean");
    }
  });
});

describe("findSource: ambiguity and recency", () => {
  test("same words, different slices in one message: ambiguous", () => {
    const source =
      "Run the **full test suite** now.\n\nRun the full test suite now.";
    assert.deepEqual(findSource("the full test suite now", [source]), {
      ok: false,
      reason: "ambiguous",
    });
  });

  test("identical slices in one message are not ambiguous", () => {
    const source =
      "Run the full test suite now.\n\nRun the full test suite now.";
    const result = findSource("Run the full test suite now", [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "Run the full test suite now");
    assert.equal(result.candidates, 2);
  });

  test("newest message wins when the text is in several", () => {
    const text = "Everything you copy here is found in more than one reply.";
    const result = findSource("found in more than one", [
      `new: ${text}`,
      `old: ${text}`,
    ]);
    assertHit(result, [`new: ${text}`]);
    assert.equal(result.messageIndex, 0);
  });

  test("an identical repeated paragraph in two messages is the newest one", () => {
    const paragraph =
      "This exact paragraph was repeated verbatim by the assistant twice.";
    const result = findSource(`  ${paragraph}  `, [
      "short intro\n\n" + paragraph,
      "older\n\n" + paragraph,
    ]);
    assertHit(result, ["short intro\n\n" + paragraph]);
    assert.equal(result.messageIndex, 0);
    assert.equal(result.source, paragraph);
  });

  test("falls back to an older message when the newer one lacks the text", () => {
    const result = findSource("only the older message has this sentence", [
      "nothing relevant",
      "yes: only the older message has this sentence.",
    ]);
    assertHit(result, [
      "nothing relevant",
      "yes: only the older message has this sentence.",
    ]);
    assert.equal(result.messageIndex, 1);
  });

  test("maxMessages bounds the search", () => {
    const hit = "this sentence lives only in the third message";
    const messages = ["one", "two", hit];
    assert.equal(findSource(hit, messages, { maxMessages: 2 }).ok, false);
    assert.equal(findSource(hit, messages).ok, true);
  });

  test("ambiguity in the newest hit does not fall through to an older message", () => {
    const newer = "Do the **same words** here.\n\nDo the same words here.";
    const older = "Do the same words here.";
    assert.deepEqual(findSource("the same words here", [newer, older]), {
      ok: false,
      reason: "ambiguous",
    });
  });
});

describe("findSource: fallbacks", () => {
  test("a model-drawn tree whose rows start with a bar still matches", () => {
    const source = "Layout:\n\n```\nsrc\n│   ├── core\n│   └── sim\n```";
    for (const width of WIDTHS) {
      const made = makeCase(source, "src\n│   ├── core", "└── sim", width, {
        marginOnFirstRow: true,
      });
      const result = find(made);
      assertHit(result, [source]);
      assert.equal(result.source, made.expected);
    }
  });

  test("a long URL split mid-token still matches", () => {
    const url = "https://example.com/" + "segment-".repeat(14) + "end";
    const source = `See ${url} for the full details, then continue reading the rest.`;
    for (const width of WIDTHS) {
      const made = makeCase(source, "full details", "continue reading", width);
      const wrapped = makeCase(source, "See https", "details, then", width);
      assert.equal(find(made).ok, true);
      const result = find(wrapped);
      assertHit(result, [source]);
      assert.equal(result.source, wrapped.expected);
    }
  });

  test("CJK text wrapped mid-sentence still matches", () => {
    const source =
      "这是一个很长的中文句子用来检查宽字符的换行行为是否正确并且不会被拆开，" +
      "继续写一些内容让它超过一行。";
    for (const width of WIDTHS) {
      const made = makeCase(source, "用来检查宽字符", "不会被拆开", width);
      const result = find(made);
      assertHit(result, [source]);
      assert.equal(result.source, made.expected);
    }
  });
});

describe("findSource: tables are opaque by design", () => {
  const source =
    "Intro paragraph that is long enough to search for.\n\n| name | value |\n|---|---|\n| alpha | one |\n| beta | two |\n\nOutro paragraph that is also long enough to search.";

  test("text before and after a table still matches", () => {
    for (const [from, to] of [
      ["Intro paragraph", "to search for"],
      ["Outro paragraph", "to search."],
    ] as const) {
      const made = makeCase(source, from, to, 80);
      const result = find(made);
      assertHit(result, [source]);
      assert.equal(result.source, made.expected);
    }
  });

  test("table rows alone never match", () => {
    const { rows } = project(source, { width: 80 });
    const first = rows.findIndex((r) => r.includes("| alpha"));
    const copied = rows.slice(first, first + 2).join("\n");
    assert.ok(copied.includes("| beta | two |"));
    assert.deepEqual(findSource(copied, [source]), { ok: false, reason: "no-match" });
  });

  test("a copy that runs across a table never matches", () => {
    const made = makeCase(
      source,
      "long enough to search for",
      "Outro paragraph",
      80,
    );
    assert.deepEqual(find(made), { ok: false, reason: "no-match" });
  });
});

describe("findSource: non-ASCII", () => {
  const source =
    "Café résumé naïve — an arrow → and a star ★, then 数据流程 and 日本語のテキスト, plus an emoji \u{1F600} and a **bold café** closing.";
  for (const width of WIDTHS) {
    test(`accents, dashes, arrows, CJK, emoji @ ${width}`, () => {
      for (const [from, to] of [
        ["résumé naïve", "star ★"],
        ["★, then 数据", "日本語のテキ"],
        ["emoji \u{1F600} and", "bold café"],
      ] as const) {
        const made = makeCase(source, from, to, width);
        const result = find(made);
        assertHit(result, [source]);
        assert.equal(result.source, made.expected);
      }
    });
  }
});

describe("findSource: speed", () => {
  // Main-thread CPU time, not wall time: other processes on a busy machine
  // cannot inflate it, and the bounds are scaled by CB_TEST_TIME_FACTOR
  // (tests/timing.ts). Idle, a cold search takes about 55 ms of CPU and a warm
  // repeat about 1 ms; the bounds are many times that, to catch work that
  // grows with the square of the input, not to measure speed.

  test("40 messages of 20 KB with no match are searched in bounded CPU time (cold, best of 3), and a warm repeat is served from the cache", () => {
    const rng = mulberry32(4242);
    const messages: string[] = [];
    for (let i = 0; i < 40; i++) {
      let doc = "";
      while (doc.length < 20_000) doc += randomMarkdown(rng, 6, { tables: true }) + "\n\n";
      messages.push(doc.slice(0, 20_000));
    }
    const needle = "this sentence is in none of the forty synthetic messages at all";
    const cold: number[] = [];
    for (let run = 0; run < 3; run++) {
      resetMatchCache();
      const { value: result, cpuMs } = cpuTimed(() =>
        findSource(needle, messages),
      );
      cold.push(cpuMs);
      assert.deepEqual(result, { ok: false, reason: "no-match" });
    }
    assertCpuWithin(
      "match-rules: cold search, best of 3",
      Math.min(...cold),
      1000,
    );
    const warm = cpuTimed(() => findSource(needle, messages));
    assert.deepEqual(warm.value, { ok: false, reason: "no-match" });
    assertCpuWithin("match-rules: warm repeat", warm.cpuMs, 100);
  });
});
