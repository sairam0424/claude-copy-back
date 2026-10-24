// Planning the cases of one launch (one width). Pure: the copies come from
// the live screen (live-run.mjs hands them in), the expectations from the
// generator's holdout records. Nothing here imports the matcher.

import { LIVE_RULE } from "./live-rule.mjs";
import { REFUSAL_LINES } from "./toast.mjs";
import { unicodeClasses } from "./unicode-classes.mjs";

export const CANARY = "zq7canary8841";
export const WINDOW = 40;
const NON_ASCII = /[^\x00-\x7f]/;

/**
 * The positive case of record `rec` whose live copy is `copy` (null when the
 * live screen could not give it). `nonAscii` and `unicode` describe the
 * PAYLOAD (the accepted forms): that is the text the plugin must write and the
 * only text whose coverage means anything. `screenOnlyNonAscii` marks a copy
 * that is non-ASCII only because of what the renderer drew (the quote bar).
 */
export function positiveCase(rec, copy, ordinal) {
  const accepted = rec.pasteForms.map((f) => f.trim());
  const unicode = unicodeClasses(accepted.join("\n"));
  return {
    id: `w${rec.width}-p${String(ordinal).padStart(2, "0")}`,
    kind: "positive",
    width: rec.width,
    message: rec.message,
    anchor: rec.anchor,
    covers: rec.covers,
    mode: "fixture",
    fixture: copy,
    accepted,
    rank: WINDOW - rec.message,
    nonAscii: accepted.some((form) => NON_ASCII.test(form)),
    unicode,
    screenOnlyNonAscii: copy !== null && NON_ASCII.test(copy) && unicode.length === 0,
  };
}

/** A real copy with the last digit of its first four-digit run changed (no longer in any reply). */
export function mutate(copy) {
  return copy.replace(/(\d{3})(\d)/, (_, head, last) => `${head}${(Number(last) + 1) % 10}`);
}

function refusalSpec(kind, width, sample) {
  const table = {
    mutated: { mode: "fixture", fixture: mutate(sample) },
    short: { mode: "fixture", fixture: "short text" },
    empty: { mode: "fixture", fixture: "" },
    blank: { mode: "fixture", fixture: "   \n\n  \n" },
    exit1: { mode: "exit1", fixture: "" },
    sleep: { mode: "sleep", fixture: "" },
    huge: { mode: "huge", fixture: "" },
    canary: { mode: "fixture", fixture: `${CANARY} is an unrelated sentence that appears in no reply of this session` },
  };
  const spec = table[kind];
  return { id: `w${width}-r-${kind}`, kind: "refusal", refusal: kind, width, expectedLine: REFUSAL_LINES[kind], ...spec };
}

/** The refusal cases of a width; `sample` is a real copy of at least 40 characters with a digit run. */
export function refusalCases(width, sample) {
  return LIVE_RULE.refusalKinds.map((kind) => refusalSpec(kind, width, sample));
}

/** First live copy long enough, with a digit run, to mutate. */
export function pickSample(positives) {
  const hit = positives.find((p) => p.fixture && p.fixture.length >= 40 && /\d{4}/.test(p.fixture));
  if (!hit) throw new Error("no copy long enough to build the mutated refusal case");
  return hit.fixture;
}

/** Positives in order with a refusal after every `every`-th one, the rest at the end. */
export function interleave(positives, refusals, every = LIVE_RULE.refusalEvery) {
  const out = [];
  const left = refusals.slice();
  positives.forEach((p, i) => {
    out.push(p);
    if ((i + 1) % every === 0 && left.length) out.push(left.shift());
  });
  return [...out, ...left];
}

/**
 * @param {object} o
 * @param {number} o.width
 * @param {object[]} o.records holdout records of this width, file order
 * @param {Array<string|null>} o.copies live-screen copy per record (same order)
 */
export function planWidth({ width, records, copies }) {
  const positives = records.map((rec, i) => positiveCase(rec, copies[i], i + 1));
  const usable = positives.filter((p) => p.fixture !== null);
  return interleave(usable, refusalCases(width, pickSample(usable)));
}
