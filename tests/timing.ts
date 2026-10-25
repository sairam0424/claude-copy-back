// Time bounds for the tests that guard against pathological slowness.
//
// A test of that kind must not fail because the machine is busy, so:
//   - it asserts a fact first (the answer, a spent counter), never the clock;
//   - the clock it does read is CPU time, of the main thread in the same
//     process or of the whole child process, which other processes cannot
//     inflate the way they inflate wall time;
//   - the bound is generous (many times the idle figure) and is multiplied by
//     CB_TEST_TIME_FACTOR (default 1), so a slow or shared CI machine can relax
//     it without editing a test.
// A bound like this still catches the failures it exists for (work that grows
// with the square of the input, a loop that never ends); it does not measure
// speed. CB_TEST_TIME_REPORT=<file> appends one JSON line per check, to tune
// the bounds against a loaded machine.

import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";

/** The multiplier for every sanity bound; see `parseTimeFactor`. */
export const TIME_FACTOR: number = parseTimeFactor(
  process.env.CB_TEST_TIME_FACTOR,
);

/**
 * Read CB_TEST_TIME_FACTOR: unset or blank is 1; anything else must be a
 * positive finite number. A typo is an error, not a silent default.
 */
export function parseTimeFactor(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 1;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `CB_TEST_TIME_FACTOR must be a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  return value;
}

/** A base bound in milliseconds, scaled by CB_TEST_TIME_FACTOR. */
export function sanityMs(baseMs: number): number {
  return baseMs * TIME_FACTOR;
}

/** CPU time of this thread so far, in milliseconds. */
export function threadCpuMs(): number {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
}

/** Run `run` once and say how much CPU time this thread spent on it. */
export function cpuTimed<T>(run: () => T): { value: T; cpuMs: number } {
  const before = threadCpuMs();
  const value = run();
  return { value, cpuMs: threadCpuMs() - before };
}

function record(label: string, cpuMs: number, boundMs: number): void {
  const file = process.env.CB_TEST_TIME_REPORT;
  if (file === undefined || file === "") return;
  appendFileSync(file, `${JSON.stringify({ label, cpuMs, boundMs })}\n`);
}

/**
 * Fail when `cpuMs` is not under the scaled bound. The message names the
 * factor so the person who sees it knows what to turn.
 */
export function assertCpuWithin(
  label: string,
  cpuMs: number,
  baseMs: number,
): void {
  const boundMs = sanityMs(baseMs);
  record(label, cpuMs, boundMs);
  assert.ok(
    cpuMs < boundMs,
    `${label}: ${cpuMs.toFixed(0)} ms of CPU, sanity bound ${boundMs} ms (CB_TEST_TIME_FACTOR=${TIME_FACTOR})`,
  );
}
