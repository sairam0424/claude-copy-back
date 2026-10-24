// Calibration aid: compare what the matcher's model says a message looks like
// with what the real screen shows for it, whole message at a time. Unlike
// random spans this sees EVERY character of the message. Pure functions over
// rows and strings; the driver (modeldiff.mjs) supplies the model's text.

const DIVIDER = "─";

/** Row ranges [start, end) of each assistant message: from a "⏺ " row to the next marker, user prompt or divider. */
export function messageRegions(rows) {
  const regions = [];
  for (let r = 0; r < rows.length; r += 1) {
    if (!rows[r].startsWith("⏺ ")) continue;
    let end = r + 1;
    while (end < rows.length && !/^(⏺ |❯ )/.test(rows[end]) && !rows[end].startsWith(DIVIDER)) end += 1;
    regions.push({ start: r, end });
  }
  return regions;
}

/**
 * The text of one region: the reply marker, the two-column margin and the
 * quote bars removed (the model keeps bars in the row prefix, not in its
 * visible text), rows joined by newlines.
 */
export function regionText(rows, region) {
  const out = [];
  for (let r = region.start; r < region.end; r += 1) {
    const body = r === region.start ? rows[r].slice(2) : rows[r].replace(/^ {1,2}/, "");
    out.push(body.replace(/^(?:▎ ?)+/, ""));
  }
  return out.join("\n").replace(/\s+$/, "");
}

/** Whitespace runs folded to one space. */
export const fold = (text) => text.replace(/\s+/g, " ").trim();

/** Whitespace removed (rows split inside a token cannot tell a wrap from a space). */
export const skeleton = (text) => text.replace(/\s+/g, "");

/** First index where two strings differ, or -1. */
export function firstDifference(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/**
 * Compare the model's visible text with the screen's, for one message.
 * @returns {{status: "same"|"wrap-only"|"differs", at?: number, model?: string, screen?: string}}
 *   "same": equal once whitespace is folded; "wrap-only": equal without
 *   whitespace (a token split by a row wrap); "differs": a character differs.
 */
export function compareMessage(modelText, screenText) {
  const a = fold(modelText);
  const b = fold(screenText);
  if (a === b) return { status: "same" };
  const sa = skeleton(a);
  const sb = skeleton(b);
  if (sa === sb) return { status: "wrap-only" };
  const at = firstDifference(sa, sb);
  return { status: "differs", at, model: sa.slice(Math.max(0, at - 25), at + 25), screen: sb.slice(Math.max(0, at - 25), at + 25) };
}
