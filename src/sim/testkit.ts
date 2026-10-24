// Shared test scaffolding (not a test file): turn a visible-text anchor pair
// into a simulated terminal copy plus the exact source slice it must come
// back as.

import assert from "node:assert/strict";
import { project } from "../core/project.ts";
import type { Projection } from "../core/project.ts";
import { copySpan } from "./copy.ts";
import { trueSlice } from "./truth.ts";
import type { CopyOptions } from "./copy.ts";
import { findSource } from "../core/match.ts";
import type { FindResult } from "../core/match.ts";

export const WIDTHS = [40, 60, 80, 100, 120];

export interface Case {
  source: string;
  projection: Projection;
  from: number;
  to: number;
  copied: string;
  expected: string;
}

/** Copy from the start of `fromText` to the end of the next `toText` (visible text anchors). */
export function makeCase(
  source: string,
  fromText: string,
  toText: string,
  width: number,
  copy: Partial<CopyOptions> = {},
): Case {
  const projection = project(source, { width });
  const from = projection.projected.indexOf(fromText);
  assert.ok(from >= 0, `anchor ${JSON.stringify(fromText)} not found`);
  const at = projection.projected.indexOf(toText, from);
  assert.ok(
    at >= 0,
    `anchor ${JSON.stringify(toText)} not found after ${JSON.stringify(fromText)}`,
  );
  const to = at + toText.length;
  const copied = copySpan(projection, from, to, { width, ...copy });
  return {
    source,
    projection,
    from,
    to,
    copied,
    expected: trueSlice(source, projection, from, to),
  };
}

/** Assert the result is a lossless hit: ok, and the slice is literally source[start, end). */
export function assertHit(
  result: FindResult,
  messages: readonly string[],
): asserts result is Extract<FindResult, { ok: true }> {
  assert.equal(
    result.ok,
    true,
    `expected a hit, got ${JSON.stringify(result)}`,
  );
  if (!result.ok) return;
  assert.equal(
    (messages[result.messageIndex] as string).slice(result.start, result.end),
    result.source,
  );
}

export function find(
  c: Case,
  extra: readonly string[] = [],
  opts?: Parameters<typeof findSource>[2],
): FindResult {
  return findSource(c.copied, [c.source, ...extra], opts);
}

export { trueSlice };
