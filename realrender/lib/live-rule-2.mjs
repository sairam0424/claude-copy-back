// PRE-REGISTERED RULE, VERSION 2, of the sealed live pass, in code. The words
// were written down before any case of the second pass ran. Version 1
// (live-rule.mjs) is untouched: its nine conditions are used as they are, with
// one change of MEANING that is not a change of number: condition 3's
// "non-ASCII" now counts the payload that was written, not the screen copy (the
// rig set the flag from the copy; see live-cases.mjs). Three conditions are
// added, from the review findings, and condition 4 is widened:
//
//   4  (meaning widened) a write event nobody judged counts as a wrong payload:
//      every call of a clipboard-writer shim must belong to some case window
//      (live-observe.mjs: settleWrites and reconcileWrites).
//  10  exactly two reads of the real clipboard (hash only), counted by
//      clipboard-hash.mjs, were taken: one before the first launch, one after
//      the last. (Version 1 allowed two and the pass took ten.)
//  11  the positive control: after the /cc cases of the control launch the stub
//      log was empty, and an ordinary prompt then put at least one POST to
//      /v1/messages in it. Without it "zero requests during /cc" shows nothing.
//  12  the unicode probe: every case of the control launch's unicode probe was
//      valid and exact, with no wrong payload or toast, and at least one
//      payload held an em dash and one a zero width joiner.
//
// Verdicts: LIVE PASS when all twelve hold; LIVE FAIL when any of 1 to 10 or 12
// fails; INCONCLUSIVE when only 11 fails (the harness could not show it would
// see a model request), or when version 1's own INCONCLUSIVE tests apply.

import { LIVE_RULE, applyLiveRule } from "./live-rule.mjs";

export const LIVE_RULE_2 = Object.freeze({
  ...LIVE_RULE,
  maxRealClipboardReads: 2,
  probeMinCases: 10,
});

const check = (n, name, ok, detail) => ({ n, name, ok: Boolean(ok), detail });

function probeCheck(p) {
  const ok = Boolean(p) && p.planned >= LIVE_RULE_2.probeMinCases && p.valid === p.planned && p.exact === p.valid
    && p.wrongPayloads === 0 && p.wrongToasts === 0 && p.emDashExact >= 1 && p.zwjExact >= 1;
  const detail = p
    ? `cases ${p.planned}, valid ${p.valid}, exact ${p.exact}, wrong payloads ${p.wrongPayloads}, wrong toasts ${p.wrongToasts}, em dash payloads ${p.emDashExact}, joined-emoji payloads ${p.zwjExact}`
    : "no unicode probe ran";
  return check(12, "unicode probe: every case exact, em dash and joined emoji covered", ok, detail);
}

/**
 * @param {object} s the version 1 summary plus
 *   { clipReads, control: {ok, detail}|null, probe: {planned, valid, exact, wrongPayloads, wrongToasts, emDashExact, zwjExact}|null }
 */
export function applyLiveRule2(s) {
  const base = applyLiveRule(s);
  if (base.verdict === "INCONCLUSIVE") return base;
  const checks = [
    ...base.checks,
    check(10, "exactly two real-clipboard reads", s.clipReads === LIVE_RULE_2.maxRealClipboardReads, `reads ${s.clipReads}`),
    check(11, "positive control: an ordinary prompt reaches the stub, /cc did not", s.control?.ok, s.control?.detail ?? "no control launch ran"),
    probeCheck(s.probe),
  ];
  const failed = checks.filter((c) => !c.ok);
  const onlyControl = failed.length > 0 && failed.every((c) => c.n === 11);
  const verdict = failed.length === 0 ? "LIVE PASS" : onlyControl ? "INCONCLUSIVE" : "LIVE FAIL";
  return { verdict, reasons: failed.map((c) => `${c.n} ${c.name}: ${c.detail}`), checks };
}
