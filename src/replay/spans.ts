// Picks the random spans the replay harness "selects with the mouse".
// A span is [from, to) over `projected` (the text the reader sees).
// The mix: 12 to 400 characters, about half start and end mid-word, about half
// cross at least one hard wrap.

import { OPAQUE } from "../core/project.ts";
import type { Projection } from "../core/project.ts";
import { rowsCovered } from "../sim/copy.ts";
import { pick, randInt } from "../sim/prng.ts";

export interface SpanWant {
  /** The span crosses at least one hard wrap inside a line. */
  wrap: boolean;
  /** The span starts and ends inside words (otherwise on word edges). */
  midWord: boolean;
}

export interface Span {
  from: number;
  to: number;
  /** What the span really is, after the edges were aligned. */
  wraps: boolean;
  midWord: boolean;
}

const WORD = /[\p{L}\p{N}_]/u;
const LOW_SURROGATE = /[\udc00-\udfff]/;
const HIGH_SURROGATE = /[\ud800-\udbff]/;
const MIN_VISIBLE = 12;
const MAX_CHARS = 400;
const ATTEMPTS = 60;

function isWordAt(text: string, i: number): boolean {
  const ch = text[i];
  return ch !== undefined && WORD.test(ch);
}

function isSpaceAt(text: string, i: number): boolean {
  const ch = text[i];
  return ch !== undefined && /\s/.test(ch);
}

/** Trim to non-space edges and whole code points. */
function trimEdges(text: string, from: number, to: number): [number, number] {
  let a = from;
  let b = to;
  while (a < b && isSpaceAt(text, a)) a++;
  while (b > a && isSpaceAt(text, b - 1)) b--;
  if (a > 0 && LOW_SURROGATE.test(text[a] ?? "")) a--;
  if (b < text.length && HIGH_SURROGATE.test(text[b - 1] ?? "")) b++;
  return [a, b];
}

/** Nudge the edges onto word interiors (mid) or word edges (not mid), at most 24 units each. */
function alignWords(
  text: string,
  from: number,
  to: number,
  mid: boolean,
): [number, number] {
  let a = from;
  let b = to;
  const startOk = (i: number): boolean =>
    mid
      ? isWordAt(text, i - 1) && isWordAt(text, i)
      : isWordAt(text, i) && !isWordAt(text, i - 1);
  const endOk = (i: number): boolean =>
    mid
      ? isWordAt(text, i - 1) && isWordAt(text, i)
      : isWordAt(text, i - 1) && !isWordAt(text, i);
  for (let step = 0; step < 24 && a < b && !startOk(a); step++) a++;
  for (let step = 0; step < 24 && b > a + 1 && !endOk(b); step++) b--;
  return [a, b];
}

function actuallyMid(text: string, a: number, b: number): boolean {
  return (
    isWordAt(text, a - 1) &&
    isWordAt(text, a) &&
    isWordAt(text, b - 1) &&
    isWordAt(text, b)
  );
}

export function chooseSpan(
  rng: () => number,
  p: Projection,
  want: SpanWant,
): Span | null {
  const text = p.projected;
  if (text.length < 40) return null;
  const wrapRows: number[] = [];
  p.layout.forEach((row, i) => {
    if (row.cont === true && row.from > 0 && row.literal === undefined)
      wrapRows.push(i);
  });
  if (want.wrap && wrapRows.length === 0) return null;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const length = want.wrap
      ? randInt(rng, MIN_VISIBLE + 8, MAX_CHARS)
      : randInt(rng, MIN_VISIBLE, 140);
    let a: number;
    if (want.wrap) {
      const row = p.layout[pick(rng, wrapRows)];
      a = (row?.from ?? 0) - randInt(rng, 1, Math.min(length - 1, 100));
    } else {
      a = randInt(rng, 0, text.length - 1);
    }
    a = Math.max(0, a);
    const b0 = Math.min(text.length, a + length);
    const [a1, b1] = alignWords(text, ...trimEdges(text, a, b0), want.midWord);
    const [from, to] = trimEdges(text, a1, b1);
    if (to <= from || to - from > MAX_CHARS) continue;
    const slice = text.slice(from, to);
    if (slice.includes(OPAQUE)) continue;
    if (slice.replace(/\s+/g, " ").length < MIN_VISIBLE) continue;
    const covered = rowsCovered(p, from, to);
    if (covered.first < 0 || covered.crossesWrap !== want.wrap) continue;
    return {
      from,
      to,
      wraps: covered.crossesWrap,
      midWord: actuallyMid(text, from, to),
    };
  }
  return null;
}
