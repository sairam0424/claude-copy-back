// Does a message show the copied text with the SAME line structure?
//
// The search folds whitespace, so two messages with the same words but
// different indentation both match. That is the right thing for prose (a hard
// wrap is just a space) and the wrong thing for code, where indentation is
// the meaning. `indentationConflicts` is the tie-breaker the matcher applies
// only when two candidate slices differ: it compares, for every place where
// BOTH the copy and the message break the line, the indentation that follows.
//
//   copy row indent  =  message line indent  +  d          (d is the same everywhere)
//
// d is the container prefix the copy carries and the message projection does
// not (list hanging indent, an unknown renderer margin), so it is the same
// for every row of one block and never negative: a container only ADDS
// indentation. A candidate whose rows would need a negative or a changing d
// cannot be what was copied.
//
// A shift of exactly 0 (the rows carry the message's own indentation, which is
// what top-level code gives) beats a positive shift (the rows would need an
// unexplained container) when candidates still differ. Used by the matcher
// only; see match.ts.
//
// Deliberately blind to everything else: gaps where either side has no line
// break (a prose wrap), gaps that contain tabs, and rows that wrap inside a
// token. Unknown renderer behaviour should never demote the true message.

/** Whitespace runs between tokens, in order (the text must already be trimmed). */
function gapsOf(text: string): string[] {
  return text.match(/\s+/g) ?? [];
}

/** Blanks after the last newline of a gap that contains one. */
function indentAfterBreak(gap: string): number {
  return gap.length - gap.lastIndexOf("\n") - 1;
}

export interface IndentFit {
  /** The rows' indentation cannot be what `shown` draws. */
  conflict: boolean;
  /**
   * The constant d (copy indent minus message indent) when there was at least
   * one comparable row break, else null. 0 means the rows carry exactly the
   * message's own indentation.
   */
  shift: number | null;
}

/**
 * Compare `copy` (the stripped, trimmed copy) with `shown` (the message's
 * visible text for the hit). Both must be equal once whitespace is folded.
 */
export function compareIndentation(copy: string, shown: string): IndentFit {
  const mine = gapsOf(copy);
  const theirs = gapsOf(shown);
  if (mine.length !== theirs.length) return { conflict: false, shift: null };
  let shift: number | null = null;
  for (let i = 0; i < mine.length; i++) {
    const a = mine[i] as string;
    const b = theirs[i] as string;
    if (!a.includes("\n") || !b.includes("\n")) continue;
    if (a.includes("\t") || b.includes("\t")) continue;
    const d = indentAfterBreak(a) - indentAfterBreak(b);
    if (d < 0) return { conflict: true, shift };
    if (shift === null) shift = d;
    else if (d !== shift) return { conflict: true, shift };
  }
  return { conflict: false, shift };
}

/**
 * Does the message draw a line break where the copy has none? Claude Code ends every
 * row itself and draws a source line break as a row break, so a copy that spans rows has
 * a newline wherever the message it came from has one; the copy may have MORE (a wrap at
 * the screen width). A copy with no newline at all says nothing about breaks, and texts
 * that do not split into the same words (a row split inside a token) cannot be compared.
 * Used by the matcher to tell apart candidates with the same words and different breaks.
 */
export function breakConflict(copy: string, shown: string): boolean {
  if (!copy.includes("\n")) return false;
  const mine = gapsOf(copy);
  const theirs = gapsOf(shown);
  if (mine.length !== theirs.length) return false;
  return theirs.some((gap, i) => gap.includes("\n") && !(mine[i] as string).includes("\n"));
}
