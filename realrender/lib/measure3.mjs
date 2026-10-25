// From a scored set to rule 3's input. Pure: the driver (measure.mjs --rule 3)
// reads the files; this decides what they mean.

import { combineProfiles, applyRule3, RULE3 } from "./rule3.mjs";

export { combineProfiles, applyRule3, RULE3 };

/** Every launch of the capture drew the session and was sealed (no external remote, no stub request). */
export function captureSealed(captureSummary) {
  const launches = captureSummary?.launches ?? [];
  return launches.length > 0 && launches.every((l) => l.drawn && l.sealed);
}

/** The profile a capture summary says it ran under; a summary from before profiles existed ran as default. */
export function capturedProfile(captureSummary) {
  return captureSummary?.profile ?? "default";
}

/** Tokens located exactly once on every width's screen, as the older rule's "rendered" test (at least 90 percent). */
export function rendered(locates) {
  const all = Object.values(locates);
  return all.length > 0 && all.every((l) => l.locatable / l.tokens >= 0.9);
}

/** The matcher that scored has the digest the freeze record holds (false when there is no freeze record). */
export function matcherFrozen(freeze, matcherSha) {
  return typeof matcherSha === "string" && freeze?.matcher?.sha256 === matcherSha;
}

/**
 * @param {object} o
 * @param {object[]} o.records scored records of all widths
 * @param {Record<number, object>} o.locates per width: { tokens, locatable, ... }
 * @param {object|null} o.captureSummary capture-summary.json of the set (null when absent)
 * @param {string} o.profile the profile being judged
 * @param {number} o.seed
 * @param {number} o.discards
 * @param {object|null} o.freeze freeze.json of the holdout (realrender/freeze.mjs)
 * @param {string} o.matcherSha digest of the matcher that scored
 */
export function ruleInput3({ records, locates, captureSummary, profile, seed, discards, freeze, matcherSha }) {
  return {
    profile, capturedProfile: capturedProfile(captureSummary), seed, discards, matcherFrozen: matcherFrozen(freeze, matcherSha),
    rendered: rendered(locates), sealed: captureSealed(captureSummary), records,
  };
}
