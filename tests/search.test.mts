import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_HITS_PER_MESSAGE,
  MAX_HITS_TOTAL,
  NATIVE_WORK,
  findAll,
  newMeter,
  newNeedle,
} from "../src/core/search.ts";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

// The bounded substring search under the matcher: the same answer as
// String.prototype.indexOf looped over every (overlapping) start, but with a
// hard limit on hits kept and on work done, and a linear-time path that takes
// over where the engine's own search can go quadratic.

/** Every start of `needle` in `hay`, overlapping, the plain way. */
function naive(hay: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = 0; i + needle.length <= hay.length; i++) {
    if (hay.startsWith(needle, i)) out.push(i);
  }
  return out;
}

/** A small deterministic generator, so a failing case can be replayed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const ALPHABETS = ["ab", "abc", "a b", "aあ😀", "xyz\n"];

function randomText(next: () => number, alphabet: string[], length: number) {
  let text = "";
  for (let i = 0; i < length; i++) {
    text += alphabet[Math.floor(next() * alphabet.length)];
  }
  return text;
}

for (const [label, forceLinear] of [
  ["native search", false],
  ["linear search", true],
] as const) {
  test(`${label}: every start, overlapping, equal to the plain loop on 3000 random cases`, () => {
    const next = lcg(forceLinear ? 7 : 11);
    for (let n = 0; n < 3000; n++) {
      const alphabet = [...(ALPHABETS[n % ALPHABETS.length] as string)];
      const hay = randomText(next, alphabet, Math.floor(next() * 70));
      const needle = randomText(next, alphabet, 1 + Math.floor(next() * 8));
      const meter = newMeter(forceLinear ? { native: 0 } : {});
      assert.deepEqual(
        findAll(hay, newNeedle(needle), meter),
        naive(hay, needle),
        JSON.stringify({ hay, needle }),
      );
    }
  });
}

test("a needle longer than the text, or equal to it, or absent", () => {
  const meter = () => newMeter();
  assert.deepEqual(findAll("abc", newNeedle("abcd"), meter()), []);
  assert.deepEqual(findAll("abc", newNeedle("abc"), meter()), [0]);
  assert.deepEqual(findAll("", newNeedle("a"), meter()), []);
  assert.deepEqual(findAll("abc", newNeedle("x"), meter()), []);
});

test("overlapping starts are all found", () => {
  assert.deepEqual(findAll("aaaaa", newNeedle("aaa"), newMeter()), [0, 1, 2]);
  assert.deepEqual(
    findAll("aaaaa", newNeedle("aaa"), newMeter({ native: 0 })),
    [0, 1, 2],
  );
});

test("a message with exactly the per-message limit of hits is answered, one more is not", () => {
  const word = "alpha beta ";
  const at = (n: number) =>
    findAll(word.repeat(n), newNeedle("alpha beta"), newMeter());
  assert.equal(at(MAX_HITS_PER_MESSAGE)?.length, MAX_HITS_PER_MESSAGE);
  assert.equal(at(MAX_HITS_PER_MESSAGE + 1), null);
});

test("the per-message limit is a parameter, and the same on both search paths", () => {
  for (const native of [Number.POSITIVE_INFINITY, 0]) {
    const hay = "ab".repeat(50);
    assert.equal(
      findAll(hay, newNeedle("ab"), newMeter({ native }), 50)?.length,
      50,
    );
    assert.equal(findAll(hay, newNeedle("ab"), newMeter({ native }), 49), null);
  }
});

test("the total limit of hits is shared by every call that uses one meter", () => {
  const meter = newMeter();
  const hay = "ab ".repeat(MAX_HITS_PER_MESSAGE - 1);
  let answered = 0;
  while (findAll(hay, newNeedle("ab"), meter) !== null) answered++;
  assert.equal(
    answered,
    Math.floor(MAX_HITS_TOTAL / (MAX_HITS_PER_MESSAGE - 1)),
  );
  assert.ok(meter.hits < MAX_HITS_PER_MESSAGE);
});

test("the work limit counts hits times the length of the needle", () => {
  const needle = "x".repeat(1000);
  const hay = `${needle} `.repeat(20);
  assert.equal(
    findAll(hay, newNeedle(needle), newMeter({ work: 20_000 }))?.length,
    20,
  );
  assert.equal(
    findAll(hay, newNeedle(needle), newMeter({ work: 19_999 })),
    null,
  );
});

test("a hit that would pass a limit leaves the meter as it was or lower, never negative", () => {
  const meter = newMeter({ hits: 3 });
  assert.equal(findAll("ab ab ab ab ab", newNeedle("ab"), meter), null);
  assert.ok(meter.hits >= 0 && meter.work >= 0 && meter.native >= 0);
});

test("a mismatch in the middle of long repetitive text goes to the linear search (the native search alone takes seconds)", () => {
  const hay = "a".repeat(300_000);
  const needle = `${"a".repeat(5000)}b${"a".repeat(5000)}`;
  const meter = newMeter();
  const { value, cpuMs } = cpuTimed(() =>
    findAll(hay, newNeedle(needle), meter),
  );
  assert.deepEqual(value, []);
  // The fact that matters: the engine's own search was never asked.
  assert.equal(meter.native, NATIVE_WORK);
  assertCpuWithin("search: mismatch in the middle", cpuMs, 1500);
});

test("the failure table of a needle is built once and reused for the next text", () => {
  const needle = newNeedle(`${"ab".repeat(2000)}c`);
  const meter = newMeter({ native: 0 });
  findAll("ab".repeat(2500), needle, meter);
  const built = needle.table;
  assert.ok(built instanceof Int32Array);
  findAll(`${"ab".repeat(2000)}c`, needle, meter);
  assert.equal(needle.table, built);
});
