// Re-scoring a SAVED set: the records of an earlier measurement (their spans and
// expected slices came from the generator and are not recomputed) against the
// saved real screens, with whichever matcher is imported. This is the regression
// check for a matcher change: the old exact captures must stay exact, and a
// wrong slice must stay at zero. Pure given its inputs; the driver reads files.

import { evaluate } from "./evaluate.mjs";
import { copiesFor, locateOnScreen, rowsOf } from "./screen.mjs";

const spanKey = (r) => `${r.width}:${r.message}:${r.start}:${r.end}`;

function offScreen(rec) {
  return { key: spanKey(rec), width: rec.width, message: rec.message, anchor: rec.anchor, oldKind: rec.kind ?? null, kind: "off-screen", paddedKind: "off-screen", falsePositive: false, paddedFalsePositive: false };
}

/**
 * @param {object} o
 * @param {object[]} o.messages corpus messages (index order; each has tokens)
 * @param {string[]} o.twins twin text per message index (the negative control)
 * @param {Record<number, string>} o.screens width -> the saved whole-history text of that width
 * @param {object[]} o.records the saved records (width, message, start, end, startToken, endToken, startOffset, endCut, expected, pasteForms, anchor, kind?)
 * @param {Function} [o.find] matcher override (tests)
 * @returns {{results: object[], locate: Record<number, object>}}
 */
export function rescoreRecords({ messages, twins, screens, records, find }) {
  const texts = messages.map((m) => m.text);
  const ids = messages.flatMap((m) => m.tokens.map((t) => t.id));
  const locate = {};
  const results = [];
  for (const width of Object.keys(screens).map(Number)) {
    const rows = rowsOf(screens[width]);
    const loc = locateOnScreen(rows, ids);
    locate[width] = { rows: rows.length, tokens: ids.length, locatable: loc.locatable.size, missing: loc.missing.length, repeated: loc.repeated.length };
    for (const rec of records.filter((r) => r.width === width)) {
      const copy = copiesFor(rows, loc.where, rec, width);
      if (!copy) {
        results.push(offScreen(rec));
        continue;
      }
      const main = evaluate(rec, copy.trimmed, texts, twins[rec.message], find);
      const padded = evaluate(rec, copy.padded, texts, twins[rec.message], find);
      results.push({
        key: spanKey(rec), width, message: rec.message, anchor: rec.anchor, oldKind: rec.kind ?? null, kind: main.kind, paddedKind: padded.kind,
        falsePositive: main.control.falsePositive, paddedFalsePositive: padded.control.falsePositive,
      });
    }
  }
  return { results, locate };
}

const count = (rows, pick) => rows.filter(pick).length;

/** The numbers of a regression table row for one set. */
export function summarizeRescore(results) {
  const known = results.filter((r) => r.oldKind !== null);
  return {
    records: results.length,
    exact: count(results, (r) => r.kind === "exact"),
    paddedExact: count(results, (r) => r.paddedKind === "exact"),
    wrongSlice: count(results, (r) => r.kind === "wrong-slice"),
    paddedWrongSlice: count(results, (r) => r.paddedKind === "wrong-slice"),
    falsePositives: count(results, (r) => r.falsePositive),
    paddedFalsePositives: count(results, (r) => r.paddedFalsePositive),
    offScreen: count(results, (r) => r.kind === "off-screen"),
    refused: count(results, (r) => ["no-match", "ambiguous", "too-short", "empty"].includes(r.kind)),
    savedExact: known.length ? count(known, (r) => r.oldKind === "exact") : null,
    lost: known.length ? results.filter((r) => r.oldKind === "exact" && r.kind !== "exact").map((r) => r.key) : null,
    gained: known.length ? count(known, (r) => r.oldKind !== "exact" && r.kind === "exact") : null,
  };
}
