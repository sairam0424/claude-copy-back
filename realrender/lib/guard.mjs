// "A holdout is scored once." The scorer refuses to overwrite holdout results.
// A re-score needs a stated reason; the old results are kept (renamed) and the
// reason is logged next to them, so a discarded holdout can be reported.

import fs from "node:fs";
import path from "node:path";

/**
 * @param {object} o
 * @param {string} o.role "calibration" or "holdout"
 * @param {string} o.setDir the directory of the captured set
 * @param {string} o.resultsFile where the results of this role are written
 * @param {string} [o.discard] reason for scoring the holdout again
 * @returns {{discarded: number}} how many holdouts were discarded so far
 */
export function guardHoldout({ role, setDir, resultsFile, discard }) {
  const log = path.join(setDir, "holdout-discards.json");
  const old = fs.existsSync(log) ? JSON.parse(fs.readFileSync(log, "utf8")) : [];
  if (role !== "holdout" || !fs.existsSync(resultsFile)) return { discarded: old.length };
  if (!discard) throw new Error(`holdout already scored (${resultsFile}); a holdout is scored once. Use --discard "reason" after capturing a new one.`);
  fs.renameSync(resultsFile, `${resultsFile}.discarded-${old.length + 1}`);
  fs.writeFileSync(log, JSON.stringify([...old, { reason: discard, at: new Date().toISOString() }], null, 2));
  return { discarded: old.length + 1 };
}
