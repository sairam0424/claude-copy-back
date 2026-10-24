import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildSet } from "../lib/corpus-set.mjs";
import { MAX_SRC, MIN_SRC, chooseSpans, coverage, pasteForms, sortedTokens } from "../lib/spans.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";
import { FAMILY_B } from "../lib/templates-b.mjs";

const SETS = [["A", buildSet(FAMILY_A, { seed: 101 }), FAMILY_A], ["B", buildSet(FAMILY_B, { seed: 202 }), FAMILY_B]];
const allIds = (set) => new Set(set.messages.flatMap((m) => m.tokens.map((t) => t.id)));
const classesOf = (family) => family.classes.filter((c) => c !== "table");
const draw = (set, family, seed, count = 80) => chooseSpans({ messages: set.messages, locatable: allIds(set), seed, count, classes: classesOf(family) });

describe("span chooser", () => {
  for (const [name, set, family] of SETS) {
    test(`family ${name}: expected is exactly the source slice between the chosen offsets`, () => {
      for (const s of draw(set, family, 7)) {
        const msg = set.messages[s.message];
        assert.equal(s.expected, msg.text.slice(s.start, s.end));
        const first = msg.tokens.find((t) => t.id === s.startToken);
        const last = msg.tokens.find((t) => t.id === s.endToken);
        assert.equal(s.start, first.start + s.startOffset);
        assert.equal(s.end, last.end - s.endCut);
        assert.ok(s.startOffset < first.wordLen, "a mid-word start stays inside the word part");
        assert.ok(last.id.length - s.endCut >= 3);
      }
    });

    test(`family ${name}: lengths stay within 12 to ${MAX_SRC}, no span covers a table, and a share of starts and ends are mid-word`, () => {
      const spans = draw(set, family, 9, 120);
      assert.ok(spans.length >= 100);
      for (const s of spans) {
        assert.ok(s.length >= MIN_SRC && s.length <= MAX_SRC, `length ${s.length}`);
        assert.ok(!s.covers.includes("table"));
      }
      assert.ok(spans.filter((s) => s.startMode === "mid-word").length > 20);
      assert.ok(spans.filter((s) => s.endMode === "mid-word").length > 20);
      assert.ok(spans.some((s) => s.length > 200) && spans.some((s) => s.length < 40));
    });

    test(`family ${name}: every class gets a share and is covered by its own spans`, () => {
      const spans = draw(set, family, 11, 130);
      for (const cls of classesOf(family)) {
        const mine = spans.filter((s) => s.anchor === cls);
        assert.ok(mine.length >= 5, `${cls}: ${mine.length}`);
        if (cls !== "rule") assert.ok(mine.some((s) => s.covers.includes(cls)), `${cls} not covered`);
      }
    });
  }

  test("a rule span starts before the rule and ends after it, and its expected text holds the rule", () => {
    const [, set, family] = SETS[0];
    const rules = draw(set, family, 3, 200).filter((s) => s.anchor === "rule");
    assert.ok(rules.length >= 5);
    for (const s of rules) {
      assert.match(s.expected, /\n---\n/);
      assert.ok(s.covers.includes("rule"));
    }
  });

  test("same seed gives the same spans, another seed other spans, and no duplicates", () => {
    const [, set, family] = SETS[1];
    const a = draw(set, family, 5);
    assert.deepEqual(a, draw(set, family, 5));
    assert.notDeepEqual(a.map((s) => s.expected), draw(set, family, 6).map((s) => s.expected));
    assert.equal(new Set(a.map((s) => `${s.message}:${s.start}:${s.end}`)).size, a.length);
  });

  test("only locatable tokens are used as endpoints", () => {
    const [, set, family] = SETS[0];
    const some = new Set([...allIds(set)].filter((_, i) => i % 3 === 0));
    const spans = chooseSpans({ messages: set.messages, locatable: some, seed: 2, count: 60, classes: classesOf(family) });
    assert.ok(spans.length > 20);
    for (const s of spans) assert.ok(some.has(s.startToken) && some.has(s.endToken));
  });

  test("coverage names the blocks and features a range touches", () => {
    const m = SETS[0][1].messages.find((x) => x.features.length && x.blocks.length > 1);
    const f = m.features[0];
    const c = coverage(m, f.from, f.to);
    assert.ok(c.features.includes(f.kind));
    assert.ok(c.blocks.length >= 1);
    assert.deepEqual(sortedTokens(m).map((t) => t.start), [...m.tokens].map((t) => t.start).sort((x, y) => x - y));
  });
});

/** Lines of a canned text with the given per-line flags, offsets derived from the text. */
function cannedMessage(text, flags) {
  let at = 0;
  const lines = text.split("\n").map((row, i) => {
    const line = { from: at, to: at + row.length, prefix: 0, marker: false, soft: false, quote: false, ...flags[i] };
    at += row.length + 1;
    return line;
  });
  return { text, lines };
}

describe("expected paste forms", () => {
  const msg = cannedMessage("1. run it:\n   ```sh\n   npm i x\n   npm run y\n   ```\n2. next", [
    { marker: true }, { prefix: 3 }, { prefix: 3 }, { prefix: 3 }, { prefix: 3 }, { marker: true },
  ]);

  test("the container prefix of later lines is dropped, the first line is kept as sliced", () => {
    const start = msg.text.indexOf("npm i");
    const end = msg.text.indexOf("run y") + 5;
    const forms = pasteForms(msg, start, end);
    assert.ok(forms.includes("npm i x\nnpm run y"), JSON.stringify(forms));
    assert.ok(forms.includes(msg.text.slice(start, end).trim()), "the plain slice is accepted too");
  });

  test("a line that holds a list marker is left alone", () => {
    const forms = pasteForms(msg, 0, msg.text.length);
    assert.ok(forms.some((f) => f.endsWith("\n2. next")));
    assert.ok(forms.some((f) => f.startsWith("1. run it:\n```sh\nnpm i x")));
  });

  test("indented code keeps or loses its own 4 spaces, both accepted", () => {
    const code = cannedMessage("para\n\n    one\n        two", [{}, {}, { prefix: 4, soft: true }, { prefix: 4, soft: true }]);
    const forms = pasteForms(code, 10, code.text.length);
    assert.ok(forms.includes("one\n    two"), JSON.stringify(forms));
    assert.ok(forms.includes("one\n        two"), JSON.stringify(forms));
  });
});
