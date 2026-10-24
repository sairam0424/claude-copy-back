// A NEW set of cases for a live pass: a fresh synthetic corpus and, per width,
// the spans chosen from it, built with the rig's own generator code. The same
// construction measure.mjs and the independent re-run used, minus the earlier
// screen capture (a new seed has none): every token counts as locatable, and a
// span the live screen cannot show is dropped by the live run and reported.
// Pure: nothing here reads the clipboard, a session or the matcher.

import { createHash } from "node:crypto";
import { buildSet } from "./corpus-set.mjs";
import { mixSeed } from "./prng.mjs";
import { chooseSpans } from "./spans.mjs";
import { FAMILY_B } from "./templates-b.mjs";

export const LIVE_WIDTHS = Object.freeze([60, 80, 100, 120]);
export const PER_WIDTH = 40;
const NON_ASCII = /[^\x00-\x7f]/;

/** The corpus and records of a live set: { corpus, results } in the shapes `live.mjs width` reads. */
export function buildLiveSet({ seed, family = FAMILY_B, widths = LIVE_WIDTHS, perWidth = PER_WIDTH }) {
  const corpus = { ...buildSet(family, { seed }), generatorSha: "live-set" };
  const locatable = new Set(corpus.messages.flatMap((m) => m.tokens.map((t) => t.id)));
  const classes = family.classes.filter((c) => c !== "table");
  const records = widths.flatMap((width) =>
    chooseSpans({ messages: corpus.messages, locatable, seed: mixSeed(seed, width), count: perWidth, classes }).map((span) => ({ width, ...span, copied: null })),
  );
  return { corpus, results: { role: "holdout", seed, family: corpus.family, records } };
}

/** What the payloads of a set hold, by the accepted forms (not the screen copy): counts for the report and the rule. */
export function payloadCoverage(records) {
  const forms = records.map((r) => r.pasteForms.map((f) => f.trim()));
  const any = (test) => forms.filter((fs) => fs.some(test)).length;
  return {
    records: records.length,
    nonAscii: any((f) => NON_ASCII.test(f)),
    emDash: any((f) => f.includes("—")),
    zeroWidthJoiner: any((f) => f.includes("\u200d")),
    cjk: any((f) => /[぀-ヿ一-鿿]/u.test(f)),
    latinAccent: any((f) => /[À-ɏ]/u.test(f)),
    astral: any((f) => /[\u{10000}-\u{10ffff}]/u.test(f)),
  };
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex");
