import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TIME_FACTOR,
  assertCpuWithin,
  cpuTimed,
  parseTimeFactor,
  sanityMs,
  threadCpuMs,
} from "./timing.ts";

// The helper every time-bound test goes through: the bound is CPU time, scaled
// by CB_TEST_TIME_FACTOR, and a bad factor is an error, not a silent default.

test("the factor is 1 when CB_TEST_TIME_FACTOR is unset or blank", () => {
  assert.equal(parseTimeFactor(undefined), 1);
  assert.equal(parseTimeFactor(""), 1);
  assert.equal(parseTimeFactor("   "), 1);
});

test("a positive number is the factor, a fraction included", () => {
  assert.equal(parseTimeFactor("3"), 3);
  assert.equal(parseTimeFactor("2.5"), 2.5);
  assert.equal(parseTimeFactor("0.5"), 0.5);
});

test("zero, a negative number, a word and a non-finite number are refused with the variable named", () => {
  for (const bad of ["0", "-1", "fast", "NaN", "Infinity", "1x"]) {
    assert.throws(() => parseTimeFactor(bad), /CB_TEST_TIME_FACTOR/, bad);
  }
});

test("the factor in force is a positive finite number, and scales a bound", () => {
  assert.ok(Number.isFinite(TIME_FACTOR) && TIME_FACTOR > 0);
  assert.equal(sanityMs(1000), 1000 * TIME_FACTOR);
});

test("thread CPU time never goes backwards and cpuTimed returns the value", () => {
  const first = threadCpuMs();
  const { value, cpuMs } = cpuTimed(() => {
    let sum = 0;
    for (let i = 0; i < 200_000; i++) sum += i;
    return sum;
  });
  assert.equal(value, 19_999_900_000);
  assert.ok(cpuMs >= 0);
  assert.ok(threadCpuMs() >= first);
});

test("a figure under the scaled bound passes, one over it fails and says what to turn", () => {
  assertCpuWithin("timing: well under", 1, 1_000_000);
  assert.throws(
    () => assertCpuWithin("timing: over", 1e12, 1000),
    /timing: over: .*CB_TEST_TIME_FACTOR=/,
  );
});

test("the bound is exclusive: a figure equal to the bound fails", () => {
  assert.throws(() => assertCpuWithin("timing: equal", sanityMs(50), 50));
});
