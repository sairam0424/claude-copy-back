// PRE-REGISTERED RULE of the sealed live pass, in code. The words were written
// down before the first case ran; this file freezes the numbers. The summary
// records this file's sha256 and time, and those of the written rule when it is
// given with --rule. Not to be changed after data is seen.

export const LIVE_RULE = Object.freeze({
  widths: Object.freeze([60, 80, 100, 120]),
  minValidPositives: 20,
  minValidPerWidth: 5,
  // exact x 10 >= valid x 9, integer test
  exactNumerator: 9,
  exactDenominator: 10,
  maxWrongPayloads: 0,
  maxWrongToasts: 0,
  // refusal toast seen in at least 9 of 10 valid refusal cases
  refusalToastNumerator: 9,
  refusalToastDenominator: 10,
  // planned cases that must be valid, else INCONCLUSIVE
  harnessNumerator: 9,
  harnessDenominator: 10,
  windowMaxMs: 8000,
  quietMs: 700,
  refusalKinds: Object.freeze(["mutated", "short", "empty", "blank", "exit1", "sleep", "huge", "canary"]),
  refusalEvery: 6,
});

const atLeast = (part, whole, num, den) => whole > 0 && part * den >= whole * num;

/**
 * @param {object} s the summary built from the case results and controls (see live.mjs)
 * @returns {{verdict: "LIVE PASS"|"LIVE FAIL"|"INCONCLUSIVE", reasons: string[], checks: Array<{n:number, name:string, ok:boolean, detail:string}>}}
 */
export function applyLiveRule(s) {
  const R = LIVE_RULE;
  if (s.engineBlocked) return { verdict: "INCONCLUSIVE", reasons: [s.engineBlocked], checks: [] };
  if (!atLeast(s.validCases, s.plannedCases, R.harnessNumerator, R.harnessDenominator)) {
    return { verdict: "INCONCLUSIVE", reasons: [`only ${s.validCases} of ${s.plannedCases} planned cases were valid (harness)`], checks: [] };
  }
  const perWidthOk = R.widths.every((w) => (s.perWidthValid[w] ?? 0) >= R.minValidPerWidth);
  const classesOk = s.classesRequired.every((c) => s.classesPresent.includes(c));
  const checks = [
    check(1, "plugin loads and /cc runs", s.validPositives >= R.minValidPositives && s.toastSeenCases > 0 && s.loadNotices === 0, `valid positives ${s.validPositives}, cases with a toast ${s.toastSeenCases}, load notices ${s.loadNotices}`),
    check(2, "no model request, no assistant record", s.stubRequests === 0 && s.assistantRecordsAdded === 0, `stub requests ${s.stubRequests} (/v1/messages ${s.stubModelRequests}), assistant records added ${s.assistantRecordsAdded}`),
    check(3, "valid positives, coverage, 90 percent exact", s.validPositives >= R.minValidPositives && perWidthOk && classesOk && s.nonAsciiValid >= 1 && atLeast(s.exactPositives, s.validPositives, R.exactNumerator, R.exactDenominator), `exact ${s.exactPositives}/${s.validPositives}, per width ${JSON.stringify(s.perWidthValid)}, classes ${s.classesPresent.length}/${s.classesRequired.length}, non-ASCII ${s.nonAsciiValid}`),
    check(4, "zero wrong payloads", s.wrongPayloads <= R.maxWrongPayloads, `wrong payloads ${s.wrongPayloads}`),
    check(5, "refusals leave the clipboard untouched", s.refusalWithWrites === 0, `refusal cases with a write event ${s.refusalWithWrites} of ${s.refusalValid}`),
    check(6, "toasts are counts only; canary absent", s.wrongToasts <= R.maxWrongToasts && s.canaryLeaks === 0 && atLeast(s.refusalToastSeen, s.refusalValid, R.refusalToastNumerator, R.refusalToastDenominator), `wrong toasts ${s.wrongToasts}, refusal toast seen ${s.refusalToastSeen}/${s.refusalValid}, canary leaks ${s.canaryLeaks}`),
    check(7, "sandbox controls hold", s.controlsHold, s.controlFailures.length ? s.controlFailures.join("; ") : "all controls held"),
    check(8, "real clipboard hash unchanged", Boolean(s.clipboardBefore) && s.clipboardBefore === s.clipboardAfter, `before ${String(s.clipboardBefore).slice(0, 12)} after ${String(s.clipboardAfter).slice(0, 12)}`),
    check(9, "no non-local socket", s.externalSockets === 0, `external socket observations ${s.externalSockets}`),
  ];
  const failed = checks.filter((c) => !c.ok);
  return { verdict: failed.length ? "LIVE FAIL" : "LIVE PASS", reasons: failed.map((c) => `${c.n} ${c.name}: ${c.detail}`), checks };
}

function check(n, name, ok, detail) {
  return { n, name, ok: Boolean(ok), detail };
}
