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

/** Longest-common-subsequence diff of two word lists: [{model: [...], screen: [...], before, after}] for every differing stretch. */
function wordHunks(a, b) {
  const n = a.length;
  const m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const hunks = [];
  let i = 0;
  let j = 0;
  let open = null;
  const close = () => {
    if (open) hunks.push({ ...open, after: a[i] === undefined && b[j] === undefined ? "" : (a[i] ?? b[j]) });
    open = null;
  };
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      close();
      i += 1;
      j += 1;
      continue;
    }
    open ??= { model: [], screen: [], before: a[i - 1] ?? b[j - 1] ?? "" };
    if (j >= m || (i < n && table[i + 1][j] >= table[i][j + 1])) open.model.push(a[i++]);
    else open.screen.push(b[j++]);
  }
  close();
  return hunks;
}

/**
 * Every difference between the model's text and the screen's for one message: whitespace is
 * ignored, and a stretch whose two sides are equal once whitespace is removed (a token cut by a
 * row wrap) is not a difference. `before` and `after` are the words next to the hunk.
 */
export function diffHunks(modelText, screenText) {
  const words = (t) => t.split(/\s+/).filter(Boolean);
  return wordHunks(words(modelText), words(screenText)).filter((h) => h.model.join("") !== h.screen.join(""));
}

const TOKEN = /[a-z]+\d{4}/g;

/** A hunk side as one comparable string: tokens become T, URLs URL, other digit runs #. */
export function normalizeHunk(words) {
  if (words.length === 0) return "(nothing)";
  return words.join(" ").replace(/https?:\/\/[^\s)]+/g, "URL").replace(TOKEN, "T").replace(/\d+/g, "#");
}

/**
 * Group the hunks of many messages by what they say. `rows`: [{width, message, hunks}].
 * Returns clusters, most frequent first: { model, screen, count, example: {width, message, before, after} }.
 */
export function clusterHunks(rows) {
  const clusters = new Map();
  for (const row of rows) {
    for (const h of row.hunks) {
      const key = `${normalizeHunk(h.model)}\u0000${normalizeHunk(h.screen)}`;
      const hit = clusters.get(key) ?? { model: normalizeHunk(h.model), screen: normalizeHunk(h.screen), count: 0, example: { width: row.width, message: row.message, before: h.before, after: h.after } };
      hit.count += 1;
      clusters.set(key, hit);
    }
  }
  return [...clusters.values()].sort((x, y) => y.count - x.count);
}

/** Seeds of holdout sets (and of the live case sets): the calibration tools refuse their screens. */
export const HOLDOUT_SEEDS = Object.freeze([202, 303, 5151, 5202, 5303, 6159, 7331, 8402]);

/** Why a set must not be used for calibration, or null. `hasHoldoutResults`: results-holdout.json exists in the set folder. */
export function holdoutReason({ name, hasHoldoutResults, corpus }) {
  if (/holdout/i.test(name)) return "its folder name says holdout";
  if (hasHoldoutResults) return "it already has holdout results";
  if (corpus.family === "B") return "family B is the old holdout family";
  if (HOLDOUT_SEEDS.includes(corpus.seed)) return `seed ${corpus.seed} is a holdout seed`;
  return null;
}
