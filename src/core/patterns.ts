// The searches findSource tries for one copy, in order.
//
//   literal    fold, then skeleton   (skeleton drops whitespace entirely, for
//                                     rows split inside a token: long URLs,
//                                     long code lines, CJK)
//   markerless the same two, with list markers ignored on BOTH sides: the
//              bullet glyph and numbering style are the simulator's least
//              certain guess, and a renderer that draws no marker still works
// each with the copy first kept as typed, then with the renderer's reply
// bullet and quote bars stripped.
//
// Kept-as-typed comes FIRST on purpose: a first row that starts with a
// character that is real source text but also looks like decoration ("│" of a
// model-drawn tree, "●" in a status line) would otherwise be stripped, match as
// a suffix of the selection and win, and the answer would lose its head. The
// stripped form only gets a say when the kept form finds nothing.

import { foldText } from "./fold.ts";
import type { Mode } from "./fold.ts";
import {
  endsWithLoneMarker,
  firstRowIndent,
  glyphEdges,
  listMarkersOf,
  startsWithMarker,
  stripDecoration,
} from "./strip.ts";

export interface Pattern {
  mode: Mode;
  markerless: boolean;
  /** The copy, folded for this mode and trimmed. */
  text: string;
  /** The copy as stripped (not folded), trimmed: its row structure, for the indentation check. */
  raw: string;
  /** Same, but with NO margin removed: for a copy that carries none. */
  flat: string;
  /** Blanks the copy's first row carried before its first character (paste step). */
  indent: number;
  /** List markers the copy carried, in order (only meaningful when markerless). */
  markers: readonly string[];
  /** The copy's first row began with a list marker (only meaningful when markerless). */
  startedWithMarker: boolean;
  /** The copy's last row was nothing but a list marker (only meaningful when markerless). */
  endedWithMarker: boolean;
  /** Same text as the literal search of this mode: pointless on a message without markers. */
  sameAsLiteral: boolean;
  /** The glyph step took a glyph off the first row: it may have been a list marker (match.ts takes it back). */
  glyphHead: boolean;
  /** The glyph step removed a last row that was nothing but a glyph. */
  glyphTail: boolean;
}

export type Built = { tries: Pattern[] } | { refuse: "empty" | "too-short" };

export function charCount(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

interface Variants {
  /** [kept as typed, decoration stripped] */
  plain: [string, string];
  /** Same, with list markers removed too. */
  bare: [string, string];
  /** [kept as typed, stripped] with the margin left alone, markers as in `plain` and `bare`. */
  flatPlain: [string, string];
  flatBare: [string, string];
}

function variantsOf(copied: string): Variants {
  return {
    plain: [
      stripDecoration(copied, { glyphs: false }),
      stripDecoration(copied),
    ],
    bare: [
      stripDecoration(copied, { glyphs: false, markers: true }),
      stripDecoration(copied, { markers: true }),
    ],
    flatPlain: [
      stripDecoration(copied, { glyphs: false, margin: 0 }),
      stripDecoration(copied, { margin: 0 }),
    ],
    flatBare: [
      stripDecoration(copied, { glyphs: false, markers: true, margin: 0 }),
      stripDecoration(copied, { markers: true, margin: 0 }),
    ],
  };
}

function patternFor(
  v: Variants,
  which: 0 | 1,
  mode: Mode,
  markerless: boolean,
  text: string,
): Pattern {
  const typed = v.plain[which];
  const raw = (markerless ? v.bare : v.plain)[which].trim();
  const edges = which === 1 ? glyphEdges(v.plain[0]) : { head: false, tail: false };
  return {
    mode,
    markerless,
    text,
    raw,
    flat: (markerless ? v.flatBare : v.flatPlain)[which].trim(),
    indent: firstRowIndent(typed),
    markers: markerless ? listMarkersOf(typed) : [],
    startedWithMarker: markerless && startsWithMarker(typed),
    endedWithMarker: markerless && endsWithLoneMarker(typed),
    sameAsLiteral: markerless && text === foldText(typed, mode).trim(),
    glyphHead: edges.head,
    glyphTail: edges.tail,
  };
}

function compile(v: Variants): Pattern[] {
  const out: Pattern[] = [];
  for (const markerless of [false, true]) {
    for (const mode of ["fold", "skeleton"] as const) {
      const seen = new Set<string>();
      for (const which of [0, 1] as const) {
        const text = foldText(
          (markerless ? v.bare : v.plain)[which],
          mode,
        ).trim();
        if (text === "" || seen.has(text)) continue;
        seen.add(text);
        out.push(patternFor(v, which, mode, markerless, text));
      }
    }
  }
  return out;
}

/**
 * The searches for a copy, or the reason there is nothing to search.
 * "empty": nothing visible once decoration is stripped (a lone reply bullet or
 * quote bar is nothing). "too-short": fewer than `minChars` folded characters
 * in every form worth searching.
 */
export function buildPatterns(copied: string, minChars: number): Built {
  const v = variantsOf(copied);
  const typed = foldText(v.plain[0], "fold").trim();
  const stripped = foldText(v.plain[1], "fold").trim();
  if (typed === "" || (stripped === "" && charCount(typed) < minChars))
    return { refuse: "empty" };
  const tries = compile(v);
  const searchable = tries.some(
    (t) => !t.markerless && t.mode === "fold" && charCount(t.text) >= minChars,
  );
  return searchable ? { tries } : { refuse: "too-short" };
}
