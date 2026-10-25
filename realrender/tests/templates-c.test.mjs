import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";
import { buildMessage, buildSet, planBlocks, sentinelOf, sessionTurns, twinOf, TWIN_SHIFT } from "../lib/corpus-set.mjs";
import { Rng } from "../lib/prng.mjs";
import { chooseSpans, coverage } from "../lib/spans.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";
import { FAMILY_B } from "../lib/templates-b.mjs";
import { FAMILY_C, TWIN_EVERY } from "../lib/templates-c.mjs";

// calibration seeds and two neutral ones; the holdout seeds (5202, 5303) are deliberately NOT built by any test
const SEEDS = [4101, 4103, 9001, 9002];
const SETS = new Map(SEEDS.map((seed) => [seed, buildSet(FAMILY_C, { seed })]));
const all = (pick) => SEEDS.flatMap((seed) => SETS.get(seed).messages.flatMap(pick));
const texts = () => all((m) => [m.text]);

const wordsOf = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w) && !/^\d+[.)]$/.test(w));
const isToken = (w) => /[a-z]\d{4}\W*$/.test(w);
const share = (set) => {
  const words = set.messages.flatMap((m) => wordsOf(m.text));
  return set.messages.reduce((n, m) => n + m.tokens.length, 0) / words.length;
};

describe("family C: a set is well formed", () => {
  test("is deterministic for a seed and differs between seeds", () => {
    assert.deepEqual(buildSet(FAMILY_C, { seed: 4101 }).messages.map((m) => m.text), SETS.get(4101).messages.map((m) => m.text));
    assert.notDeepEqual(SETS.get(4101).messages.map((m) => m.text), SETS.get(4103).messages.map((m) => m.text));
  });

  test("every token is unique in its set and sits where the generator says", () => {
    for (const set of SETS.values()) {
      const seen = new Set();
      for (const m of set.messages) {
        for (const t of m.tokens) {
          assert.ok(!seen.has(t.id), `duplicate ${t.id}`);
          seen.add(t.id);
          assert.equal(m.text.slice(t.start, t.end), t.id);
          assert.ok(t.block, `token ${t.id} is in no block`);
        }
      }
      assert.ok(seen.size > 400 && Math.max(...[...seen].map((id) => Number(id.slice(-4)))) + TWIN_SHIFT < 10000);
    }
  });

  test("blocks, lines and features stay inside the text", () => {
    for (const m of all((x) => [x])) {
      for (const b of m.blocks) assert.ok(b.from >= 0 && b.to <= m.text.length && b.from <= b.to);
      for (const l of m.lines) assert.ok(l.to <= m.text.length && l.prefix >= 0);
      for (const f of m.features) assert.ok(f.to <= m.text.length && f.from < f.to);
    }
  });

  test("every class holds tokens somewhere in every set, and every class is featured", () => {
    for (const set of SETS.values()) {
      const withTokens = new Set(set.messages.flatMap((m) => m.tokens.map((t) => t.block)));
      for (const cls of FAMILY_C.classes.filter((c) => c !== "rule")) assert.ok(withTokens.has(cls), `no token in class ${cls}`);
      assert.deepEqual([...new Set(set.messages.map((m) => m.featured))].sort(), [...FAMILY_C.classes].sort());
    }
  });

  test("tables are out, and the words that need a paragraph around them get one", () => {
    for (const m of all((x) => [x])) {
      assert.equal(m.blocks.some((b) => b.kind === "table"), false);
      assert.doesNotMatch(m.text, /^\|.*\|$/m);
      m.plan.forEach((kind, i) => {
        if (kind === "rule") assert.equal(m.plan[i - 1], "para");
        if (kind === "heading") assert.equal(m.plan[i + 1], "para");
      });
    }
    assert.ok(planBlocks(FAMILY_C, new Rng(1), "rule").includes("rule"));
  });

  test("the session alternates a user prompt and an assistant message, and the sentinel is the last token", () => {
    const set = SETS.get(4101);
    const turns = sessionTurns(set);
    assert.equal(turns.length, 80);
    assert.match(turns[0].text, /for the C set/);
    const last = set.messages.at(-1);
    assert.equal(sentinelOf(set), last.tokens.reduce((a, b) => (b.start > a.start ? b : a)).id);
  });

  test("a message built alone equals the same message built inside the set (twins included)", () => {
    for (const index of [3, 4, 9, 22]) {
      const m = SETS.get(4101).messages[index];
      assert.equal(buildMessage(FAMILY_C, { seed: 4101, index, tokenStart: m.tokenStart }).text, m.text);
    }
  });
});

describe("family C: about one word in ten is a unique token, and phrases repeat", () => {
  test("the token share of every set is between 7 and 13 percent", () => {
    for (const [seed, set] of SETS) {
      const s = share(set);
      assert.ok(s > 0.07 && s < 0.13, `seed ${seed}: ${(100 * s).toFixed(1)}%`);
    }
  });

  test("the earlier families were about a third tokens, so this one is much less unique", () => {
    const a = share(buildSet(FAMILY_A, { seed: 101 }));
    const b = share(buildSet(FAMILY_B, { seed: 202 }));
    for (const set of SETS.values()) assert.ok(share(set) < Math.min(a, b) / 2);
  });

  test("a quarter of the four-word runs without a token are seen at least twice in the set", () => {
    for (const [seed, set] of SETS) {
      const counts = new Map();
      for (const m of set.messages) {
        const words = wordsOf(m.text).map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""));
        for (let i = 0; i + 4 <= words.length; i += 1) {
          const gram = words.slice(i, i + 4);
          if (gram.some((w) => isToken(w) || w === "")) continue;
          counts.set(gram.join(" "), (counts.get(gram.join(" ")) ?? 0) + 1);
        }
      }
      const repeated = [...counts.values()].filter((n) => n > 1).length;
      assert.ok(repeated / counts.size > 0.1 && repeated > 40, `seed ${seed}: ${repeated} of ${counts.size}`);
    }
  });
});

describe("family C: twins", () => {
  const words = (m) => wordsOf(m.text.replace(/[*_`~[\]()<>#=\\-]/g, " ")).map((w) => w.replace(/\d{4}$/, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")).filter(Boolean);

  test("every fifth message is the twin of the one before it: same words, other markup, other token digits", () => {
    for (const set of SETS.values()) {
      for (let i = TWIN_EVERY - 1; i < set.messages.length; i += TWIN_EVERY) {
        const original = set.messages[i - 1];
        const twin = set.messages[i];
        assert.notEqual(twin.text, original.text);
        assert.equal(twin.tokens.length, original.tokens.length);
        assert.deepEqual(twin.plan, original.plan);
        assert.equal(twin.tokens.every((t, k) => t.id.slice(0, -4) === original.tokens[k].id.slice(0, -4) && t.id !== original.tokens[k].id), true);
        assert.deepEqual(words(twin).filter((w) => !["", "ref1", "ref2", "ref3"].includes(w)).length > 20, true);
      }
    }
  });

  test("a twin differs in markup and indentation across a set, not only in digits", () => {
    const pairs = [];
    for (const set of SETS.values()) for (let i = TWIN_EVERY - 1; i < set.messages.length; i += TWIN_EVERY) pairs.push([set.messages[i - 1].text, set.messages[i].text]);
    const strip = (t) => t.replace(/\d{4}/g, "####");
    const differing = pairs.filter(([a, b]) => strip(a) !== strip(b)).length;
    assert.ok(differing / pairs.length > 0.85, `${differing} of ${pairs.length} twins differ beyond the digits`);
    const joined = pairs.map(([, b]) => b).join("\n");
    assert.match(joined, /__\w/, "underscore bold in a twin");
    assert.match(joined, /^ {4}[*+-] /m, "four-space nesting in a twin");
  });

  test("the control twin of a message (shifted digits) keeps the variant", () => {
    const set = SETS.get(9001);
    for (const index of [3, 4, 8, 9]) {
      const original = set.messages[index];
      const twin = twinOf(FAMILY_C, set, index);
      let rebuilt = original.text;
      for (const t of original.tokens) rebuilt = rebuilt.split(t.id).join(`${t.id.slice(0, -4)}${String(Number(t.id.slice(-4)) + TWIN_SHIFT).padStart(4, "0")}`);
      assert.equal(twin.text, rebuilt);
    }
  });
});

describe("family C: what a realistic reply holds", () => {
  const joined = () => texts().join("\n\n");
  const featureCount = (kind) => all((m) => m.features.filter((f) => f.kind === kind)).length;

  test("inline markup sits inside list items, headings, quotes and ordinary paragraphs", () => {
    const hosts = new Set();
    for (const m of all((x) => [x])) {
      for (const f of m.features) {
        const block = m.blocks.find((b) => f.from >= b.from && f.to <= b.to)?.kind;
        const line = m.lines.find((l) => f.from >= l.from && f.from <= l.to);
        if (block === "heading") hosts.add("heading");
        if (block === "quote" && line?.prefix >= 2) hosts.add("quote");
        if (block === "para") hosts.add("para");
        if (line?.marker) hosts.add("list item");
      }
    }
    assert.deepEqual([...hosts].sort(), ["heading", "list item", "para", "quote"]);
  });

  test("bold lead-in bullets, inline code in prose, three kinds of link and strikethrough all occur", () => {
    const t = joined();
    assert.match(t, /^\s*[-*+] \*\*[^*\n]+:\*\*/m, "bold lead-in bullet");
    assert.match(t, /[a-z] `[^`\n]+` [a-z]/, "inline code in prose");
    assert.match(t, /\[[^\]\n]+\]\(https?:\/\/[^)\n]+\)/, "inline link");
    assert.match(t, /\[[^\]\n]+\]\[ref\d\]/, "reference link");
    assert.match(t, /^\[ref\d\]: https?:\/\//m, "reference definition");
    assert.match(t, /<https?:\/\/[^>\n]+>/, "autolink");
    assert.match(t, /~~[^~\n]+~~/, "strikethrough");
    assert.match(t, /\(~\d+ [a-z]+\d{4} each\)/, "tilde pair");
    for (const kind of ["bold", "italic", "code", "link", "reflink", "autolink", "strike"]) assert.ok(featureCount(kind) >= 20, `${kind}: ${featureCount(kind)}`);
  });

  test("reference definitions come last in their message and every reference has one", () => {
    for (const m of all((x) => [x])) {
      const refs = [...m.text.matchAll(/\]\[(ref\d)\]/g)].map((x) => x[1]);
      const defs = [...m.text.matchAll(/^\[(ref\d)\]: /gm)].map((x) => x[1]);
      assert.deepEqual(defs, refs);
      const def = m.blocks.find((b) => b.kind === "def");
      if (def) assert.equal(m.blocks.at(-1).kind, "def");
    }
  });

  test("ordered lists nest three levels, bullets and numbers mix, fences have lines longer than any screen", () => {
    const t = joined();
    assert.match(t, /^1\. .+\n {3}1\. .+\n {6}1\. /m, "three ordered levels");
    assert.match(t, /^\d\. .+\n {3}- /m, "bullets inside numbers");
    assert.match(t, /^- .+\n {2}1\. /m, "numbers inside bullets");
    assert.ok(texts().some((x) => x.split("\n").some((l) => l.length > 120 && l.includes('"aaaa'))), "long code line");
    assert.match(t, /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]/u, "wide characters");
    assert.match(t, /^- [^\n]*[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7a3]/mu, "wide characters in a list item");
  });

  test("a set covers every class with spans that never touch a table", () => {
    const set = SETS.get(9001);
    const locatable = new Set(set.messages.flatMap((m) => m.tokens.map((t) => t.id)));
    const spans = chooseSpans({ messages: set.messages, locatable, seed: 7, count: 160, classes: FAMILY_C.classes });
    assert.ok(spans.length >= 150);
    assert.equal(new Set(spans.map((s) => s.anchor)).size, FAMILY_C.classes.length);
    for (const s of spans) assert.equal(coverage(set.messages[s.message], s.start, s.end).blocks.includes("table"), false);
    assert.ok(spans.every((s) => s.pasteForms.length >= 1 && s.pasteForms.every((f) => f.length > 0)));
  });
});

describe("family C: independent of the matcher and the simulator", () => {
  for (const name of ["templates-c", "templates-c-inline"]) {
    test(`${name}.mjs does not import the matcher or the simulator`, () => {
      const source = fs.readFileSync(new URL(`../lib/${name}.mjs`, import.meta.url), "utf8");
      const imports = source.split("\n").filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l));
      for (const line of imports) assert.doesNotMatch(line, /src\/|match\.ts|project\.ts|strip\.ts|sim\//, line);
    });
  }

  test("family C shares no token word with A or B, and its vocabulary is its own", () => {
    for (const other of [FAMILY_A, FAMILY_B]) {
      assert.equal(FAMILY_C.tokenWords.filter((w) => other.tokenWords.includes(w)).length, 0);
      assert.ok(FAMILY_C.vocab.filter((w) => other.vocab.includes(w)).length < FAMILY_C.vocab.length / 2);
    }
  });
});
