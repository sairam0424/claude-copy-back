// PRE-REGISTERED RULE. Written BEFORE any real-render measurement was taken and
// not to be changed after seeing data. The report records this file's sha256
// and modification time as the ordering evidence.
//
// Definitions (fixed here, used by score.mjs):
//   capture      one (message, intended token span, terminal width) triple, with the
//                text a terminal selection yields from the REAL Claude Code screen.
//   exact        the matcher returned ok AND trim(source) equals trim(expected slice)
//                AND trim(paste) equals trim(expected slice) or trim(expected paste
//                form). The expected values come from the generator, never from the
//                matcher.
//   wrong-slice  the matcher returned ok but the result is not exact (text that is
//                not the intended text: the dangerous kind).
//   no-match / ambiguous / too-short / empty: the matcher refused.
//   matched and right: exact (an exact capture is by definition a returned text).
//   control FP   an ok result for copied text from message A tested against a
//                window WITHOUT A (either control variant: plain removal, or A
//                replaced by a twin with the same words and other token digits).
//
// The rule applies to the HOLDOUT set, the main variant (trailing spaces
// trimmed). The padded variant is reported, not ruled on.

export const RULE = Object.freeze({
  minCaptures: 60,
  minPerWidth: 15,
  minPerConstruct: 5,
  widths: Object.freeze([60, 80, 100, 120]),
  minExactRate: 0.7,
  maxWrongSlice: 0,
  maxControlFalsePositives: 0,
  minMatchedAndRight: 10,
});

/** Integer comparison: exact/total >= 7/10 without floating point. */
function rateAtLeast(exact, total) {
  return total > 0 && exact * 10 >= total * 7;
}

/**
 * Apply the rule.
 * @param {object} s
 * @param {boolean} s.rendered the rig drew the session at every width
 * @param {number} s.total captures scored
 * @param {Record<number, number>} s.perWidth captures per width
 * @param {Record<string, number>} s.perConstruct captures per construct class
 * @param {string[]} s.constructsPresent classes that exist in the corpus
 * @param {number} s.exact
 * @param {number} s.wrongSlice
 * @param {number} s.controlFalsePositives
 * @returns {{verdict: "PROXY PASS"|"PROXY FAIL"|"INCONCLUSIVE", reasons: string[]}}
 */
export function applyRule(s) {
  const sizeProblems = sizeShortfalls(s);
  if (!s.rendered) return { verdict: "INCONCLUSIVE", reasons: ["the rig could not render the session"] };
  if (sizeProblems.length) return { verdict: "INCONCLUSIVE", reasons: sizeProblems };
  const reasons = [];
  if (!rateAtLeast(s.exact, s.total)) reasons.push(`exact ${s.exact}/${s.total} is below ${RULE.minExactRate * 100}%`);
  if (s.wrongSlice > RULE.maxWrongSlice) reasons.push(`wrong-slice ${s.wrongSlice} is above ${RULE.maxWrongSlice}`);
  if (s.controlFalsePositives > RULE.maxControlFalsePositives) {
    reasons.push(`negative-control false positives ${s.controlFalsePositives} is above ${RULE.maxControlFalsePositives}`);
  }
  if (s.exact < RULE.minMatchedAndRight) reasons.push(`matched and right ${s.exact} is below ${RULE.minMatchedAndRight}`);
  return { verdict: reasons.length ? "PROXY FAIL" : "PROXY PASS", reasons };
}

/** Why a set is too small to rule on (empty list when it is big enough). */
export function sizeShortfalls(s) {
  const out = [];
  if (s.total < RULE.minCaptures) out.push(`only ${s.total} captures, need ${RULE.minCaptures}`);
  for (const w of RULE.widths) {
    if ((s.perWidth[w] ?? 0) < RULE.minPerWidth) out.push(`width ${w} has ${s.perWidth[w] ?? 0} captures, need ${RULE.minPerWidth}`);
  }
  for (const c of s.constructsPresent) {
    if ((s.perConstruct[c] ?? 0) < RULE.minPerConstruct) out.push(`construct ${c} has ${s.perConstruct[c] ?? 0} captures, need ${RULE.minPerConstruct}`);
  }
  return out;
}
