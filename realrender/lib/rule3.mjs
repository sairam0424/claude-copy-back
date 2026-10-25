// PRE-REGISTERED RULE 3 (WARP FIDELITY). Written, hashed and recorded BEFORE any
// family C screen was captured; not to be edited after data exists. The words are
// in realrender/RULE-3.md, the numbers here, and a test pins both. The sha256 of
// both files was written to WARP-RULE-HASH.txt before the first capture.
//
// The rule judges ONE profile's HOLDOUT (a fresh synthetic window of family C,
// captured at 60, 80, 100 and 120 columns with the sealed rig under that terminal
// profile, scored once with the frozen matcher). It is applied to the warp profile
// and to the default profile separately; WARP PASS needs both.
//
//   size          at least 120 captures, at least 25 per width      (else INCONCLUSIVE)
//   exact         at least 95 percent of all captures are exact
//   per class     every construct class with at least 10 captures has at least 80 percent exact
//   wrong slice   0
//   controls      0 negative-control false positives, with message A removed and with A
//                 replaced by its twin (same words, other token digits)
//   matched       at least 10 captures matched and right
//   padded        the same five conditions hold on the padded-trailing-space variant
//   frozen        the matcher that scores is the one in the freeze record made before the capture
//                 (otherwise INCONCLUSIVE: the holdout was not scored with the frozen matcher)
//
// Definitions (the scorer's, unchanged): `exact` = the matcher returned ok, its source
// equals the generator's expected slice and its paste is one of the expected paste forms;
// `wrong-slice` = ok but not exact; the rest are refusals. A capture belongs to its ANCHOR
// class ("anchor:para", the construct its start token sits in) and to every inline FEATURE
// class its source range touches ("feature:link", "feature:strike", ...): links and strike
// are reported, and ruled on, as their own classes.

export const RULE3 = Object.freeze({
  profiles: Object.freeze(["warp", "default"]),
  widths: Object.freeze([60, 80, 100, 120]),
  minCaptures: 120,
  minPerWidth: 25,
  minExactPercent: 95,
  minClassExactPercent: 80,
  classMinCaptures: 10,
  maxWrongSlice: 0,
  maxControlFalsePositives: 0,
  minMatchedAndRight: 10,
  // a holdout may never be (or reuse) a set the matcher was calibrated on
  calibrationSeeds: Object.freeze([101, 103, 202, 303, 5151, 7331, 8402, 6159, 4101, 4102, 4103, 4104]),
});

const atLeast = (part, whole, percent) => whole > 0 && part * 100 >= whole * percent;

/** The classes a record counts in: its anchor class, then each inline feature class it covers (once). */
export function classesOf(record) {
  return [`anchor:${record.anchor}`, ...[...new Set(record.features ?? [])].map((f) => `feature:${f}`)];
}

/**
 * Judge one variant of the records. `pick(record)` gives { kind, falsePositive } for the
 * variant (the main copy or the padded copy). Returns the counts and the failed conditions.
 */
export function judgeVariant(records, pick) {
  const rows = records.map((r) => ({ r, ...pick(r) }));
  const total = rows.length;
  const exact = rows.filter((x) => x.kind === "exact").length;
  const wrong = rows.filter((x) => x.kind === "wrong-slice").length;
  const falsePositives = rows.filter((x) => x.falsePositive).length;
  const classes = {};
  for (const x of rows) {
    for (const name of classesOf(x.r)) {
      classes[name] ??= { total: 0, exact: 0 };
      classes[name].total += 1;
      if (x.kind === "exact") classes[name].exact += 1;
    }
  }
  const failures = [];
  if (!atLeast(exact, total, RULE3.minExactPercent)) failures.push(`exact ${exact}/${total} is below ${RULE3.minExactPercent}%`);
  for (const [name, c] of Object.entries(classes)) {
    if (c.total >= RULE3.classMinCaptures && !atLeast(c.exact, c.total, RULE3.minClassExactPercent)) {
      failures.push(`${name} exact ${c.exact}/${c.total} is below ${RULE3.minClassExactPercent}%`);
    }
  }
  if (wrong > RULE3.maxWrongSlice) failures.push(`wrong-slice ${wrong} is above ${RULE3.maxWrongSlice}`);
  if (falsePositives > RULE3.maxControlFalsePositives) failures.push(`negative-control false positives ${falsePositives} is above ${RULE3.maxControlFalsePositives}`);
  if (exact < RULE3.minMatchedAndRight) failures.push(`matched and right ${exact} is below ${RULE3.minMatchedAndRight}`);
  return { total, exact, wrong, falsePositives, classes, failures };
}

/** Why a holdout cannot be ruled on (an empty list when it can). */
function unfit(s) {
  const out = [];
  if (!RULE3.profiles.includes(s.profile)) out.push(`unknown profile "${s.profile}"`);
  else if (s.capturedProfile !== s.profile) out.push(`the set was captured under "${s.capturedProfile}" but is judged as "${s.profile}"`);
  if (RULE3.calibrationSeeds.includes(s.seed)) out.push(`seed ${s.seed} is a calibration seed; a holdout must be a fresh one`);
  if (s.matcherFrozen !== true) out.push("the matcher scored is not the one in the freeze record (or no freeze record was given)");
  if (!s.rendered) out.push("the rig could not render the session at every width");
  if (!s.sealed) out.push("the rig was not sealed (a non-local socket or a stub request was seen)");
  if (s.records.length < RULE3.minCaptures) out.push(`only ${s.records.length} captures, need ${RULE3.minCaptures}`);
  for (const w of RULE3.widths) {
    const n = s.records.filter((r) => r.width === w).length;
    if (n < RULE3.minPerWidth) out.push(`width ${w} has ${n} captures, need ${RULE3.minPerWidth}`);
  }
  return out;
}

/**
 * @param {object} s
 * @param {string} s.profile the profile being judged
 * @param {string} s.capturedProfile the profile recorded in the capture's own summary
 * @param {number} s.seed the holdout seed
 * @param {number} [s.discards] holdouts discarded before this one (reported)
 * @param {boolean} s.matcherFrozen the matcher that scored has the sha256 recorded in freeze.json (realrender/freeze.mjs)
 * @param {boolean} s.rendered the rig drew the session at every width
 * @param {boolean} s.sealed no non-local socket and no stub request in any launch
 * @param {object[]} s.records the scored records (score.mjs shape: width, anchor, features, kind, control, padded)
 */
export function applyRule3(s) {
  const base = { profile: s.profile, seed: s.seed, discards: s.discards ?? 0 };
  const problems = unfit(s);
  if (problems.length) return { ...base, verdict: "INCONCLUSIVE", reasons: problems, classes: {} };
  const main = judgeVariant(s.records, (r) => ({ kind: r.kind, falsePositive: r.control.falsePositive }));
  const padded = judgeVariant(s.records, (r) => ({ kind: r.padded.kind, falsePositive: r.padded.control.falsePositive }));
  const reasons = [...main.failures, ...padded.failures.map((f) => `padded: ${f}`)];
  return {
    ...base, verdict: reasons.length ? "HOLDOUT FAIL" : "HOLDOUT PASS", reasons,
    total: main.total, exact: main.exact, wrong: main.wrong, falsePositives: main.falsePositives, classes: main.classes,
    padded: { total: padded.total, exact: padded.exact, wrong: padded.wrong, falsePositives: padded.falsePositives, classes: padded.classes },
  };
}

/** WARP PASS needs both profiles' holdouts to pass; a failure stands; anything missing or unfit is INCONCLUSIVE. */
export function combineProfiles(byProfile) {
  const verdicts = RULE3.profiles.map((p) => byProfile[p]?.verdict ?? "MISSING");
  const reasons = RULE3.profiles.flatMap((p, i) => (verdicts[i] === "HOLDOUT PASS" ? [] : [`${p}: ${verdicts[i]}${byProfile[p]?.reasons?.length ? ` (${byProfile[p].reasons.join("; ")})` : ""}`]));
  if (verdicts.every((v) => v === "HOLDOUT PASS")) return { verdict: "WARP PASS", reasons: [] };
  return { verdict: verdicts.includes("HOLDOUT FAIL") ? "WARP FAIL" : "INCONCLUSIVE", reasons };
}
