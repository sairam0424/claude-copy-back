import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIVE_RULE, applyLiveRule } from "../lib/live-rule.mjs";

const classes = ["para", "ul", "ol"];
const good = () => ({
  engineBlocked: null, plannedCases: 100, validCases: 100, validPositives: 60, exactPositives: 60,
  perWidthValid: { 60: 15, 80: 15, 100: 15, 120: 15 }, classesPresent: classes, classesRequired: classes, nonAsciiValid: 4,
  wrongPayloads: 0, refusalValid: 32, refusalWithWrites: 0, refusalToastSeen: 32, wrongToasts: 0, toastSeenCases: 90, loadNotices: 0,
  canaryLeaks: 0, stubRequests: 0, stubModelRequests: 0, assistantRecordsAdded: 0, controlsHold: true, controlFailures: [],
  clipboardBefore: "aa", clipboardAfter: "aa", externalSockets: 0,
});
const verdict = (over) => applyLiveRule({ ...good(), ...over });

describe("pre-registered live rule", () => {
  test("is frozen at the registered values", () => {
    assert.deepEqual([...LIVE_RULE.widths], [60, 80, 100, 120]);
    assert.equal(LIVE_RULE.minValidPositives, 20);
    assert.equal(LIVE_RULE.minValidPerWidth, 5);
    assert.deepEqual([LIVE_RULE.exactNumerator, LIVE_RULE.exactDenominator], [9, 10]);
    assert.equal(LIVE_RULE.maxWrongPayloads, 0);
    assert.equal(LIVE_RULE.refusalKinds.length, 8);
    assert.equal(LIVE_RULE.windowMaxMs, 8000);
    assert.throws(() => { "use strict"; LIVE_RULE.maxWrongPayloads = 5; });
  });

  test("passes when every condition holds", () => {
    const v = verdict({});
    assert.equal(v.verdict, "LIVE PASS");
    assert.equal(v.checks.length, 9);
  });

  test("exactly 90 percent exact passes, below fails (integer test)", () => {
    assert.equal(verdict({ validPositives: 60, exactPositives: 54 }).verdict, "LIVE PASS");
    assert.equal(verdict({ validPositives: 60, exactPositives: 53 }).verdict, "LIVE FAIL");
  });

  test("each condition fails the pass on its own", () => {
    const cases = {
      "fewer than 20 valid positives": { validPositives: 19, exactPositives: 19 },
      "a width with fewer than 5": { perWidthValid: { 60: 4, 80: 15, 100: 15, 120: 15 } },
      "a missing construct class": { classesPresent: ["para", "ul"] },
      "no non-ASCII case": { nonAsciiValid: 0 },
      "a wrong payload": { wrongPayloads: 1 },
      "a refusal that wrote": { refusalWithWrites: 1 },
      "a wrong toast": { wrongToasts: 1 },
      "a canary leak": { canaryLeaks: 1 },
      "too few refusal toasts": { refusalToastSeen: 28 },
      "a model request": { stubRequests: 1, stubModelRequests: 1 },
      "an assistant record added": { assistantRecordsAdded: 1 },
      "a broken sandbox control": { controlsHold: false, controlFailures: ["pasteboard-in: kr=0"] },
      "a changed clipboard hash": { clipboardAfter: "bb" },
      "a missing clipboard hash": { clipboardBefore: undefined, clipboardAfter: undefined },
      "an external socket": { externalSockets: 1 },
      "a load notice": { loadNotices: 1 },
      "no toast ever": { toastSeenCases: 0 },
    };
    for (const [name, over] of Object.entries(cases)) assert.equal(verdict(over).verdict, "LIVE FAIL", name);
  });

  test("a blocked engine or a mostly invalid harness is INCONCLUSIVE, not a fail", () => {
    assert.equal(verdict({ engineBlocked: "launch at width 60: not drawn" }).verdict, "INCONCLUSIVE");
    assert.equal(verdict({ plannedCases: 100, validCases: 89 }).verdict, "INCONCLUSIVE");
    assert.equal(verdict({ plannedCases: 100, validCases: 90 }).verdict, "LIVE PASS");
  });
});
