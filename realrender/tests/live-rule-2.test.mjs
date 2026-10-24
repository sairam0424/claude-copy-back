import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIVE_RULE } from "../lib/live-rule.mjs";
import { LIVE_RULE_2, applyLiveRule2 } from "../lib/live-rule-2.mjs";

const classes = ["para", "ul", "ol"];
const base = () => ({
  engineBlocked: null, plannedCases: 100, validCases: 100, validPositives: 60, exactPositives: 60,
  perWidthValid: { 60: 15, 80: 15, 100: 15, 120: 15 }, classesPresent: classes, classesRequired: classes, nonAsciiValid: 4,
  wrongPayloads: 0, refusalValid: 32, refusalWithWrites: 0, refusalToastSeen: 32, wrongToasts: 0, toastSeenCases: 90, loadNotices: 0,
  canaryLeaks: 0, stubRequests: 0, stubModelRequests: 0, assistantRecordsAdded: 0, controlsHold: true, controlFailures: [],
  clipboardBefore: "aa", clipboardAfter: "aa", externalSockets: 0,
  clipReads: 2,
  control: { ok: true, detail: "requests after /cc 0, after the ordinary prompt 1 (POST /v1/messages 1)" },
  probe: { planned: 11, valid: 11, exact: 11, wrongPayloads: 0, wrongToasts: 0, emDashExact: 2, zwjExact: 2 },
});
const verdict = (over) => applyLiveRule2({ ...base(), ...over });

describe("pre-registered live rule, version 2", () => {
  test("keeps every number of version 1 and adds its own", () => {
    for (const key of Object.keys(LIVE_RULE)) assert.deepEqual(LIVE_RULE_2[key], LIVE_RULE[key], key);
    assert.equal(LIVE_RULE_2.maxRealClipboardReads, 2);
    assert.equal(LIVE_RULE_2.probeMinCases, 10);
    assert.throws(() => { "use strict"; LIVE_RULE_2.maxRealClipboardReads = 3; });
  });

  test("passes when all twelve conditions hold", () => {
    const v = verdict({});
    assert.equal(v.verdict, "LIVE PASS");
    assert.deepEqual(v.checks.map((c) => c.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test("condition 8 still needs identical hashes, and condition 10 needs exactly two reads", () => {
    const changed = verdict({ clipboardAfter: "bb" });
    assert.equal(changed.verdict, "LIVE FAIL");
    assert.deepEqual(changed.checks.filter((c) => !c.ok).map((c) => c.n), [8]);
    for (const clipReads of [1, 3, 10]) {
      const v = verdict({ clipReads });
      assert.equal(v.verdict, "LIVE FAIL", String(clipReads));
      assert.deepEqual(v.checks.filter((c) => !c.ok).map((c) => c.n), [10]);
    }
  });

  test("the positive control failing alone is INCONCLUSIVE, not a plugin failure", () => {
    const v = verdict({ control: { ok: false, detail: "requests after /cc 0, after the ordinary prompt 0 (POST /v1/messages 0)" } });
    assert.equal(v.verdict, "INCONCLUSIVE");
    assert.match(v.reasons.join(" "), /11/);
  });

  test("a missing control or probe is a failure of that condition", () => {
    assert.equal(verdict({ control: null }).verdict, "INCONCLUSIVE");
    assert.equal(verdict({ probe: null }).verdict, "LIVE FAIL");
  });

  test("the probe needs every case valid and exact, no wrong payload, an em dash and a joined emoji", () => {
    const cases = {
      "too few cases": { planned: 9, valid: 9, exact: 9 },
      "a case not valid": { valid: 10 },
      "a case not exact": { exact: 10 },
      "a wrong payload": { wrongPayloads: 1 },
      "a wrong toast": { wrongToasts: 1 },
      "no em dash payload": { emDashExact: 0 },
      "no joined emoji payload": { zwjExact: 0 },
    };
    for (const [name, over] of Object.entries(cases)) {
      const v = verdict({ probe: { ...base().probe, ...over } });
      assert.equal(v.verdict, "LIVE FAIL", name);
      assert.deepEqual(v.checks.filter((c) => !c.ok).map((c) => c.n), [12], name);
    }
  });

  test("a version 1 failure still fails the pass, and a blocked engine is INCONCLUSIVE", () => {
    assert.equal(verdict({ wrongPayloads: 1 }).verdict, "LIVE FAIL");
    assert.equal(verdict({ engineBlocked: "launch at width 60: not drawn" }).verdict, "INCONCLUSIVE");
  });
});
