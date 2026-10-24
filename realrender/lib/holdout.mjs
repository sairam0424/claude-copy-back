import path from "node:path";

/**
 * The folder of a live-pass case set (corpus.json and results-holdout.json),
 * as an absolute path. There is deliberately no default: a case set is made
 * for one run with gen-live-set.mjs, and a default would point at somebody's
 * private workspace. A missing value stops the run before anything starts.
 *
 * @param {unknown} value the --holdout argument
 * @returns {string}
 */
export function requireHoldout(value) {
  if (typeof value !== "string" || value === "") {
    throw new Error("--holdout DIR is required: a folder with corpus.json and results-holdout.json. Make one with: node realrender/gen-live-set.mjs --seed N --out DIR");
  }
  return path.resolve(value);
}
