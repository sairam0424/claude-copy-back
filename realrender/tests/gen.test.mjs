import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { buildMessage, buildSet, planBlocks, sentinelOf, sessionTurns, twinOf, TWIN_SHIFT } from "../lib/corpus-set.mjs";
import { Rng } from "../lib/prng.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";
import { FAMILY_B } from "../lib/templates-b.mjs";

const A = buildSet(FAMILY_A, { seed: 101 });
const B = buildSet(FAMILY_B, { seed: 202 });

describe("generator", () => {
  test("is deterministic for a seed and differs between seeds", () => {
    assert.deepEqual(buildSet(FAMILY_A, { seed: 101 }).messages.map((m) => m.text), A.messages.map((m) => m.text));
    assert.notDeepEqual(buildSet(FAMILY_A, { seed: 102 }).messages.map((m) => m.text), A.messages.map((m) => m.text));
  });

  test("a window is 40 messages", () => {
    assert.equal(A.messages.length, 40);
    assert.equal(B.messages.length, 40);
  });

  for (const [name, set] of [["A", A], ["B", B]]) {
    test(`family ${name}: every token is unique in the whole set and sits where the generator says`, () => {
      const seen = new Set();
      for (const m of set.messages) {
        for (const t of m.tokens) {
          assert.ok(!seen.has(t.id), `duplicate ${t.id}`);
          seen.add(t.id);
          assert.equal(m.text.slice(t.start, t.end), t.id);
          assert.ok(t.block, `token ${t.id} is in no block`);
        }
      }
      assert.ok(seen.size > 1500);
    });

    test(`family ${name}: blocks and lines stay inside the text and every class is featured`, () => {
      const featured = new Set();
      for (const m of set.messages) {
        featured.add(m.featured);
        for (const b of m.blocks) assert.ok(b.from >= 0 && b.to <= m.text.length && b.from <= b.to);
        for (const l of m.lines) assert.ok(l.to <= m.text.length && l.prefix >= 0);
        for (const f of m.features) assert.ok(f.to <= m.text.length && f.from < f.to);
      }
      assert.deepEqual([...featured].sort(), [...(name === "A" ? FAMILY_A : FAMILY_B).classes].sort());
    });
  }

  test("token numbering continues across messages", () => {
    A.messages.slice(1).forEach((m, i) => assert.equal(m.tokenStart, A.messages[i].tokenEnd));
  });

  test("the twin has the same words and shape, and every token has other digits", () => {
    for (const index of [0, 5, 13, 22, 39]) {
      const original = A.messages[index];
      const twin = twinOf(FAMILY_A, A, index);
      let rebuilt = original.text;
      for (const t of original.tokens) {
        const shifted = `${t.id.slice(0, -4)}${String(Number(t.id.slice(-4)) + TWIN_SHIFT).padStart(4, "0")}`;
        rebuilt = rebuilt.split(t.id).join(shifted);
      }
      assert.equal(twin.text, rebuilt);
      assert.equal(twin.blocks.length, original.blocks.length);
    }
  });

  test("tokens hold at most 8999 so a twin never collides with the originals", () => {
    const max = Math.max(...A.messages.flatMap((m) => m.tokens.map((t) => Number(t.id.slice(-4)))));
    assert.ok(max + TWIN_SHIFT < 10000);
  });

  test("blocks that markdown would merge or reinterpret get a paragraph around them", () => {
    for (const set of [A, B]) {
      for (const m of set.messages) {
        m.plan.forEach((kind, i) => {
          if (kind === "codeind" || kind === "rule") assert.equal(m.plan[i - 1], "para");
          if (kind === "heading") assert.equal(m.plan[i + 1], "para");
        });
      }
    }
    const plan = planBlocks(FAMILY_A, new Rng(1), "codeind");
    assert.ok(plan.includes("codeind"));
  });

  test("the sentinel is the last token in the text of the last message", () => {
    const last = A.messages.at(-1);
    const lastInText = last.tokens.reduce((a, b) => (b.start > a.start ? b : a)).id;
    assert.equal(sentinelOf(A), lastInText);
  });

  test("the session alternates a user prompt and an assistant message", () => {
    const turns = sessionTurns(A);
    assert.equal(turns.length, 80);
    turns.forEach((t, i) => assert.equal(t.role, i % 2 === 0 ? "user" : "assistant"));
    assert.equal(turns[1].text, A.messages[0].text);
  });

  test("calibration and holdout families do not share token words, vocabulary shapes or builders", () => {
    assert.equal(FAMILY_A.tokenWords.filter((w) => FAMILY_B.tokenWords.includes(w)).length, 0);
    const shared = FAMILY_A.vocab.filter((w) => FAMILY_B.vocab.includes(w));
    assert.ok(shared.length < FAMILY_A.vocab.length / 3, "vocabularies should mostly differ");
    // `rule` is identical on purpose: models write "---" and nothing else
    for (const kind of Object.keys(FAMILY_A.build).filter((k) => k !== "rule")) {
      if (FAMILY_B.build[kind]) assert.notEqual(FAMILY_A.build[kind].toString(), FAMILY_B.build[kind].toString(), `${kind} builder is identical`);
    }
    const tokensA = new Set(A.messages.flatMap((m) => m.tokens.map((t) => t.id)));
    assert.equal(B.messages.flatMap((m) => m.tokens.map((t) => t.id)).filter((id) => tokensA.has(id)).length, 0);
  });

  test("family B holds shapes family A never writes", () => {
    const textB = B.messages.map((m) => m.text).join("\n");
    const textA = A.messages.map((m) => m.text).join("\n");
    assert.match(textB, /^=+$/m, "setext heading");
    assert.match(textB, /__\w/, "underscore bold");
    assert.match(textB, /^ {4}[*+-] /m, "four-space nesting");
    assert.doesNotMatch(textA, /^=+$/m);
    assert.doesNotMatch(textA, /__\w/);
  });

  test("a message built alone equals the same message built inside the set", () => {
    const m = A.messages[7];
    assert.equal(buildMessage(FAMILY_A, { seed: 101, index: 7, tokenStart: m.tokenStart }).text, m.text);
  });
});

describe("independence of the ground truth", () => {
  const files = ["gen-core", "gen-text", "prng", "corpus-set", "templates-a", "templates-b", "spans", "screen", "score", "rule"];
  for (const name of files) {
    test(`${name}.mjs does not import the matcher or the simulator`, () => {
      const source = fs.readFileSync(new URL(`../lib/${name}.mjs`, import.meta.url), "utf8");
      const imports = source.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
      for (const line of imports) assert.doesNotMatch(line, /src\/|match\.ts|project\.ts|strip\.ts|sim\//, line);
    });
  }
});
