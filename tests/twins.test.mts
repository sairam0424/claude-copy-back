import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { OPAQUE, project } from "../src/core/project.ts";
import { copySpan } from "../src/sim/copy.ts";
import { randomMarkdown } from "../src/sim/grammar.ts";
import { mulberry32, pick, randInt } from "../src/sim/prng.ts";
import { trueSlice } from "../src/sim/testkit.ts";

// Property: two messages with (nearly) the same words never make the matcher
// return a WRONG slice. A copy from message A, searched in a window that also
// holds a twin B (same words, different indentation / markup / numbering), is
// answered with A's slice or with a refusal, never with B's different slice.

type Mutation = (source: string, rng: () => number) => string;

/** Apply `edit` to the lines inside ``` fences only. */
function inFences(source: string, edit: (line: string) => string): string {
  let inside = false;
  return source
    .split("\n")
    .map((line) => {
      if (/^```/.test(line)) {
        inside = !inside;
        return line;
      }
      return inside ? edit(line) : line;
    })
    .join("\n");
}

const MUTATIONS: Record<string, Mutation> = {
  indent: (s, rng) => {
    const pad = " ".repeat(pick(rng, [2, 4]));
    return inFences(s, (line) => (line === "" ? line : pad + line));
  },
  dedent: (s) => inFences(s, (line) => line.replace(/^ {1,2}/, "")),
  bold: (s) =>
    s.replace(
      /(^|\n)([A-Za-z][^\n`*|#>-]*?) ([a-z]{3,}) ([a-z]{3,}) /,
      "$1$2 **$3 $4** ",
    ),
  renumber: (s) =>
    s.replace(
      /(^|\n)(\s*)(\d+)\. /g,
      (_, nl, sp, n) => `${nl}${sp}${Number(n) + 1}. `,
    ),
  rebullet: (s) => s.replace(/(^|\n)(\s*)- /g, "$1$2* "),
  prefix: (s) => `An extra opening line for the twin.\n\n${s}`,
};

function randomSpan(
  rng: () => number,
  projected: string,
): [number, number] | null {
  for (let attempt = 0; attempt < 30; attempt++) {
    let a = randInt(rng, 0, projected.length - 1);
    let b = Math.min(projected.length, a + randInt(rng, 25, 250));
    while (a < b && /\s/.test(projected[a] as string)) a++;
    while (b > a && /\s/.test(projected[b - 1] as string)) b--;
    if (a > 0 && /[\udc00-\udfff]/.test(projected[a] as string)) a--;
    if (
      b < projected.length &&
      /[\ud800-\udbff]/.test(projected[b - 1] as string)
    )
      b++;
    const text = projected.slice(a, b);
    if (text.includes(OPAQUE) || text.replace(/\s+/g, " ").length < 20)
      continue;
    return [a, b];
  }
  return null;
}

describe("twin messages never produce a wrong slice", () => {
  for (const [name, mutate] of Object.entries(MUTATIONS)) {
    test(`${name}`, () => {
      const rng = mulberry32(31337 + name.length);
      let trials = 0;
      let answered = 0;
      for (let d = 0; d < 80; d++) {
        const a = randomMarkdown(rng, randInt(rng, 3, 8));
        const b = mutate(a, rng);
        const width = pick(rng, [40, 60, 80, 100]);
        const p = project(a, { width });
        for (let k = 0; k < 3; k++) {
          const span = randomSpan(rng, p.projected);
          if (span === null) continue;
          const [from, to] = span;
          const copied = copySpan(p, from, to, {
            width,
            marginOnFirstRow: rng() < 0.5,
          });
          const expected = trueSlice(a, p, from, to);
          for (const window of [
            [b, a],
            [a, b],
          ]) {
            const result = findSource(copied, window);
            trials++;
            if (!result.ok) continue;
            answered++;
            assert.equal(
              result.source.trim(),
              expected,
              `${name} doc ${d} width ${width} window ${window[0] === a ? "A,B" : "B,A"}`,
            );
          }
        }
      }
      assert.ok(trials > 100, `only ${trials} trials`);
      assert.ok(answered / trials > 0.5, `answered ${answered} of ${trials}`);
    });
  }
});
