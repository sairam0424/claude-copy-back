import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { OPAQUE, project } from "../src/core/project.ts";
import { copySpan } from "../src/sim/copy.ts";
import { randomMarkdown } from "../src/sim/grammar.ts";
import { mulberry32, pick, randInt } from "../src/sim/prng.ts";
import { WIDTHS, trueSlice } from "../src/sim/testkit.ts";

// Property: for random markdown, a simulated terminal copy of a random span
// comes back as exactly the source slice that produced it.

const DOCS = 60;
const SPANS_PER_WIDTH = 3;

function isSpace(ch: string): boolean {
  return /\s/.test(ch);
}

/** A random span of visible text, trimmed to non-space edges and whole code points. */
function randomSpan(rng: () => number, projected: string): [number, number] | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    let a = randInt(rng, 0, projected.length - 1);
    let b = Math.min(projected.length, a + randInt(rng, 30, 300));
    while (a < b && isSpace(projected[a] as string)) a++;
    while (b > a && isSpace(projected[b - 1] as string)) b--;
    if (a > 0 && /[\udc00-\udfff]/.test(projected[a] as string)) a--;
    if (b < projected.length && /[\ud800-\udbff]/.test(projected[b - 1] as string)) b++;
    if (projected.slice(a, b).includes(OPAQUE)) continue;
    if (projected.slice(a, b).replace(/\s+/g, " ").length < 20) continue;
    return [a, b];
  }
  return null;
}

describe("round trip: random markdown, random spans, every width", () => {
  const docs: string[] = [];
  const rng = mulberry32(20261023);
  for (let i = 0; i < DOCS; i++) docs.push(randomMarkdown(rng, randInt(rng, 3, 9), { tables: i % 5 === 0 }));

  test("the generator is deterministic", () => {
    const a = randomMarkdown(mulberry32(7), 6);
    const b = randomMarkdown(mulberry32(7), 6);
    assert.equal(a, b);
    assert.notEqual(a, randomMarkdown(mulberry32(8), 6));
  });

  for (const width of WIDTHS) {
    test(`width ${width}`, () => {
      const r = mulberry32(width * 7919);
      let trials = 0;
      for (let d = 0; d < docs.length; d++) {
        const source = docs[d] as string;
        const p = project(source, { width });
        for (let k = 0; k < SPANS_PER_WIDTH; k++) {
          const span = randomSpan(r, p.projected);
          if (span === null) continue;
          const [a, b] = span;
          const copied = copySpan(p, a, b, {
            width,
            pad: r() < 0.8,
            marginOnFirstRow: r() < 0.5,
            eol: r() < 0.1 ? "\r\n" : "\n",
            ansi: r() < 0.1,
          });
          const others = [pick(r, docs), pick(r, docs)].filter((o) => o !== source);
          const messages = [...others.slice(0, 1), source, ...others.slice(1)];
          const result = findSource(copied, messages);
          const expected = trueSlice(source, p, a, b);
          const label = `doc ${d} span [${a},${b}) width ${width}`;
          assert.equal(result.ok, true, `${label}: ${JSON.stringify(result)}`);
          if (!result.ok) return;
          assert.equal(result.source, expected, label);
          assert.equal(messages[result.messageIndex]?.slice(result.start, result.end), result.source, label);
          trials++;
        }
      }
      assert.ok(trials > docs.length * 2, `only ${trials} trials ran`);
    });
  }

  test("the same span copied twice returns the same slice (deterministic)", () => {
    const source = docs[3] as string;
    const p = project(source, { width: 80 });
    const span = randomSpan(mulberry32(5), p.projected) as [number, number];
    const copied = copySpan(p, span[0], span[1], { width: 80 });
    assert.deepEqual(findSource(copied, [source]), findSource(copied, [source]));
  });
});
