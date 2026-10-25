// The lossless source match: given text copied out of the terminal and the
// session's assistant messages (NEWEST FIRST), find the exact slice of the
// source markdown the user selected.
//
//   1. strip the renderer's decoration from the copy (strip.ts)
//   2. fold whitespace runs (spaces, newlines, tabs) to one space on BOTH
//      sides, because the copy arrives hard-wrapped
//   3. project each message to what the renderer draws (project.ts) under each
//      way it can draw links and struck text (drawing.ts), search every message,
//      and map each hit back to source offsets
//
// The searches, in order (patterns.ts): literal, then marker-agnostic, each in
// fold then skeleton form, each with the copy kept as typed before it is
// stripped. Every message is searched by one search before the next starts.
//
// LOSSLESS: `source` is message.slice(start, end) and nothing else; characters
// are never edited or invented. `paste` is a derived, paste-ready form of the
// same slice (container prefixes dropped, first-line indentation restored; see
// paste.ts) and also contains only source characters.
//
// NEVER GUESS. A wrong slice is worse than no answer, so these all refuse:
//   - the text sits at several places with DIFFERENT slices (one message or
//     several): "ambiguous". Identical slices are not ambiguous.
//   - when messages disagree, the row indentation of the copy decides first
//     (fit.ts): code that only differs in indentation is told apart. If that
//     cannot decide, the answer is "ambiguous" rather than "the newest".
//     `newestWinsOnConflict` turns that last step back into newest-first.
//   - the text sits in too many places to tell apart (search.ts: more than
//     MAX_HITS_PER_MESSAGE in one message, MAX_HITS_TOTAL in all, or more
//     candidate work than MAX_CANDIDATE_WORK): also "ambiguous". The search is
//     bounded in memory and in time whatever the messages hold.

import { breakConflict, compareIndentation } from "./fit.ts";
import type { IndentFit } from "./fit.ts";
import { pasteText } from "./paste.ts";
import { buildPatterns, charCount } from "./patterns.ts";
import type { Pattern } from "./patterns.ts";
import { isSpace } from "./fold.ts";
import {
  foldedOf,
  inProjected,
  isLead,
  leadSources,
  locator,
  markerlessView,
  prepareAll,
} from "./views.ts";
import type { Prepared, View } from "./views.ts";
import { findAll, newMeter, newNeedle } from "./search.ts";
import type { Meter, Needle } from "./search.ts";
import { lowerBound } from "./sorted.ts";

export { projectedOf, resetMatchCache, setMatchCacheLimit } from "./views.ts";

export interface FindOptions {
  /** Shortest copy (in characters, after folding) worth searching for. Default 12. */
  minProjectedChars?: number;
  /** How many messages, newest first, to search. Default 40. */
  maxMessages?: number;
  /**
   * Row widths the real renderer may have used. Reserved for the fidelity
   * report; the match itself is width-free and ignores it.
   */
  widths?: number[];
  /**
   * When messages hold the same words with different slices and nothing in the
   * copy tells them apart, take the newest message instead of refusing as
   * ambiguous. Does not apply to a conflict inside the newest message itself.
   * Default false.
   */
  newestWinsOnConflict?: boolean;
  /**
   * Limits on the search (search.ts); the defaults are the ones to use. A test
   * lowers `native` to 0 to force the linear-time search on small inputs.
   */
  budget?: Partial<Meter>;
}

export type FindResult =
  | {
      ok: true;
      /** The exact slice of the message: message.slice(start, end). */
      source: string;
      /** The same slice made paste-ready (paste.ts). Equals `source` outside containers. */
      paste: string;
      messageIndex: number;
      start: number;
      end: number;
      projectedChars: number;
      /** Occurrences found in the winning message (all map to this slice). */
      candidates: number;
    }
  | { ok: false; reason: "too-short" | "no-match" | "ambiguous" | "empty" };

const DEFAULT_MIN_CHARS = 12;
const DEFAULT_MAX_MESSAGES = 40;

/** One occurrence of the copy in a message, as source offsets plus where it sits in the view. */
interface Hit {
  start: number;
  end: number;
  view: View;
  lo: number;
  hi: number;
}

interface Candidate {
  mi: number;
  hit: Hit;
  slice: string;
  /** The projection (one drawing of the message) the hit was found in. */
  p: Prepared;
}

/** Index in `projected` of the list marker just before `first` (skipping blanks), or null. */
function reachBack(p: Prepared, first: number): number | null {
  let j = first - 1;
  while (j >= 0 && isSpace(p.projected.charCodeAt(j))) j--;
  if (j < 0 || !isLead(p, j)) return null;
  while (j > 0 && isLead(p, j - 1)) j--;
  return j;
}

/** The mirror image for a copy that ended on a lone marker: index of its last unit, or null. */
function reachForward(p: Prepared, last: number): number | null {
  const n = p.projected.length;
  let j = last + 1;
  while (j < n && isSpace(p.projected.charCodeAt(j))) j++;
  if (j >= n || !isLead(p, j)) return null;
  while (j + 1 < n && isLead(p, j + 1)) j++;
  return j;
}

/** The list markers as drawn (glyph or number, without the space) in projected[from..to]. */
function leadGlyphs(p: Prepared, from: number, to: number): string[] {
  const out: string[] = [];
  const { leadAt } = p;
  let k = lowerBound(leadAt, from);
  if (k < 0) return out;
  while (k < leadAt.length && (leadAt[k] as number) <= to) {
    let e = k;
    while (
      e + 1 < leadAt.length &&
      (leadAt[e + 1] as number) === (leadAt[e] as number) + 1 &&
      (leadAt[e + 1] as number) <= to
    )
      e++;
    out.push(p.projected.slice(leadAt[k] as number, (leadAt[e] as number) + 1));
    k = e + 1;
  }
  return out;
}

const DIGITS = /^\d+/;
const LETTERS = /^[a-zA-Z]/;

/**
 * The marker-agnostic search ignores the CONTENT of list markers, which is
 * only safe when what it ignored is compatible with what is there:
 *   - the copy's markers are as many as the message draws in the hit;
 *   - a numbered marker in the copy is the same number in the message;
 *   - a lettered or roman marker (another numbering style) needs an ordered
 *     item, a bullet-like glyph needs a bullet item.
 * A copy with no markers at all is a renderer that draws none.
 */
function markersAgree(
  p: Prepared,
  copy: readonly string[],
  from: number,
  to: number,
): boolean {
  if (copy.length === 0) return true;
  const drawn = leadGlyphs(p, from, to);
  if (drawn.length !== copy.length) return false;
  return copy.every((marker, i) => {
    const theirs = DIGITS.exec(drawn[i] as string);
    const mine = DIGITS.exec(marker);
    if (mine !== null) return theirs !== null && Number(theirs[0]) === Number(mine[0]);
    return LETTERS.test(marker) ? theirs !== null : theirs === null;
  });
}

/** The hit for view indices [lo, hi], or null when the marker rules refuse it. */
function hitAt(
  p: Prepared,
  view: View,
  pattern: Pattern,
  lo: number,
  hi: number,
): Hit | null {
  const first = inProjected(view, lo);
  const last = inProjected(view, hi);
  // The copy began / ended on a list marker the search skipped: the hit is only
  // the whole selection if a real marker sits right there. Refuse otherwise.
  let from = pattern.startedWithMarker ? reachBack(p, first) : first;
  let to = pattern.endedWithMarker ? reachForward(p, last) : last;
  if (from === null || to === null) return null;
  if (pattern.markerless && !markersAgree(p, pattern.markers, from, to))
    return null;
  // A glyph the strip step took off an edge may have been a list marker drawn
  // with the reply-bullet glyph: if a real marker sits right there, it was.
  // (After the marker check: the copy's marker list does not count this one.)
  if (pattern.glyphHead && !pattern.startedWithMarker)
    from = reachBack(p, first) ?? from;
  if (pattern.glyphTail && !pattern.endedWithMarker)
    to = reachForward(p, last) ?? to;
  const start = Math.min(p.map[from] as number, p.map[first] as number);
  return { start, end: (p.map[to] as number) + 1, view, lo, hi };
}

/** The hits of the pattern in one message, or null when it sits in too many places to keep. */
function occurrences(
  p: Prepared,
  pattern: Pattern,
  needle: Needle,
  meter: Meter,
): Hit[] | null {
  const view = pattern.markerless ? markerlessView(p) : p.whole;
  const ats = findAll(foldedOf(view, pattern.mode), needle, meter);
  if (ats === null) return null;
  if (ats.length === 0) return [];
  const where = locator(view, pattern.mode, ats.length);
  const hits: Hit[] = [];
  for (const at of ats) {
    const hit = hitAt(
      p,
      view,
      pattern,
      where(at),
      where(at + pattern.text.length - 1),
    );
    if (hit !== null) hits.push(hit);
  }
  return hits;
}

/**
 * Every hit of the pattern in every searched message, newest message first; or
 * null when the pattern sits in more places than the budget keeps.
 */
function collect(
  pattern: Pattern,
  searched: readonly string[],
  meter: Meter,
): Candidate[] | null {
  const out: Candidate[] = [];
  const needle = newNeedle(pattern.text);
  for (let mi = 0; mi < searched.length; mi++) {
    const message = searched[mi];
    if (typeof message !== "string" || message === "") continue;
    const seen = new Set<string>(); // the same slice found under two drawings is one hit
    for (const prepared of prepareAll(message)) {
      if (pattern.sameAsLiteral && prepared.leadAt.length === 0) continue;
      const hits = occurrences(prepared, pattern, needle, meter);
      if (hits === null) return null;
      for (const hit of hits) {
        const key = `${hit.start}:${hit.end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ mi, hit, slice: message.slice(hit.start, hit.end), p: prepared });
      }
    }
  }
  return out;
}

function allSame(candidates: readonly Candidate[]): boolean {
  const first = (candidates[0] as Candidate).slice;
  return candidates.every((c) => c.slice === first);
}

interface Judged {
  c: Candidate;
  fit: IndentFit;
}

/**
 * Rows that carry exactly the message's own indentation beat rows that would
 * need an unexplained shift (a container the message does not have there),
 * but only when every other candidate is proven shifted.
 */
function exactIndentation(pool: readonly Judged[]): Judged[] {
  const exact = pool.filter((j) => j.fit.shift === 0);
  const shifted = pool.filter((j) => j.fit.shift !== null && j.fit.shift > 0);
  return exact.length > 0 && exact.length + shifted.length === pool.length
    ? exact
    : [...pool];
}

/** The candidates that draw no line break the copy lacks (fit.ts); if none is left, all stay. */
function withTheCopysBreaks(candidates: readonly Candidate[], pattern: Pattern): Candidate[] {
  const kept = candidates.filter(
    (c) => !breakConflict(pattern.raw, c.hit.view.text.slice(c.hit.lo, c.hit.hi + 1)),
  );
  return kept.length > 0 ? kept : [...candidates];
}

function judge(candidates: readonly Candidate[], copy: string): Judged[] {
  return candidates.map((c) => ({
    c,
    fit: compareIndentation(copy, c.hit.view.text.slice(c.hit.lo, c.hit.hi + 1)),
  }));
}

/**
 * The candidates the copy's row indentation leaves standing. First with the
 * renderer's margin removed from the copy (then rows that carry exactly the
 * message's own indentation win). If that rules out every candidate, the copy
 * may carry no margin at all, so try once more with the margin left alone: a
 * container only ever ADDS indentation, so the true message still never needs a
 * negative shift. If nothing is ruled out either way, nothing is decided.
 */
function indentationPool(candidates: readonly Candidate[], pattern: Pattern): Judged[] {
  const assumed = judge(candidates, pattern.raw).filter((j) => !j.fit.conflict);
  if (assumed.length > 0) return exactIndentation(assumed);
  const flat = judge(candidates, pattern.flat).filter((j) => !j.fit.conflict);
  return flat.length > 0 ? flat : judge(candidates, pattern.raw);
}

/**
 * The candidate to answer with, or null when the answer must be "ambiguous".
 * Identical slices are one answer (the newest message's). Differing slices: the
 * copy's row indentation rules out candidates that cannot be what was copied
 * and prefers the one that fits exactly; if the rest still differ, refuse (or
 * take the newest if the caller allows it and the newest message itself is
 * unambiguous).
 */
function choose(
  candidates: readonly Candidate[],
  pattern: Pattern,
  newestWins: boolean,
): Candidate | null {
  if (allSame(candidates)) return candidates[0] as Candidate;
  const drawn = withTheCopysBreaks(candidates, pattern);
  if (allSame(drawn)) return drawn[0] as Candidate;
  const pool = indentationPool(drawn, pattern).map((j) => j.c);
  const head = pool[0] as Candidate;
  if (allSame(pool)) return head;
  if (newestWins && allSame(pool.filter((c) => c.mi === head.mi))) return head;
  return null;
}

function answer(
  winner: Candidate,
  candidates: readonly Candidate[],
  pattern: Pattern,
  message: string,
): FindResult {
  const { hit, p: prepared } = winner;
  const paste = pasteText(
    { message, contentAt: prepared.contentAt, leadSrc: leadSources(prepared) },
    hit.start,
    hit.end,
    pattern.indent,
  );
  return {
    ok: true,
    source: winner.slice,
    paste,
    messageIndex: winner.mi,
    start: hit.start,
    end: hit.end,
    projectedChars: charCount(pattern.text),
    candidates: candidates.filter(
      (c) => c.mi === winner.mi && c.slice === winner.slice,
    ).length,
  };
}

export function findSource(
  copied: string,
  messages: readonly string[],
  opts: FindOptions = {},
): FindResult {
  const minChars = opts.minProjectedChars ?? DEFAULT_MIN_CHARS;
  const searched = messages.slice(0, opts.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const built = buildPatterns(
    typeof copied === "string" ? copied : "",
    minChars,
  );
  if ("refuse" in built) return { ok: false, reason: built.refuse };

  const meter = newMeter(opts.budget);
  for (const pattern of built.tries) {
    if (charCount(pattern.text) < minChars) continue;
    const candidates = collect(pattern, searched, meter);
    if (candidates === null) return { ok: false, reason: "ambiguous" };
    if (candidates.length === 0) continue;
    const winner = choose(
      candidates,
      pattern,
      opts.newestWinsOnConflict === true,
    );
    if (winner === null) return { ok: false, reason: "ambiguous" };
    return answer(winner, candidates, pattern, searched[winner.mi] as string);
  }
  return { ok: false, reason: "no-match" };
}
