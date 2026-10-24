import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RULE, applyRule } from "../lib/rule.mjs";

const base = () => ({
  rendered: true,
  total: 100,
  perWidth: { 60: 25, 80: 25, 100: 25, 120: 25 },
  perConstruct: { para: 10, ul: 10 },
  constructsPresent: ["para", "ul"],
  exact: 80,
  wrongSlice: 0,
  controlFalsePositives: 0,
});

describe("pre-registered rule", () => {
  test("is frozen at the registered values", () => {
    assert.equal(RULE.minCaptures, 60);
    assert.equal(RULE.minPerWidth, 15);
    assert.equal(RULE.minPerConstruct, 5);
    assert.equal(RULE.minExactRate, 0.7);
    assert.equal(RULE.maxWrongSlice, 0);
    assert.equal(RULE.maxControlFalsePositives, 0);
    assert.equal(RULE.minMatchedAndRight, 10);
    assert.throws(() => {
      "use strict";
      RULE.minExactRate = 0.1;
    });
  });

  test("passes a good set", () => {
    assert.equal(applyRule(base()).verdict, "PROXY PASS");
  });

  test("exactly 70% passes and one below fails (integer comparison)", () => {
    assert.equal(applyRule({ ...base(), exact: 70 }).verdict, "PROXY PASS");
    assert.equal(applyRule({ ...base(), exact: 69 }).verdict, "PROXY FAIL");
  });

  test("a single wrong slice fails whatever the rate", () => {
    const r = applyRule({ ...base(), exact: 99, wrongSlice: 1 });
    assert.equal(r.verdict, "PROXY FAIL");
    assert.match(r.reasons.join(" "), /wrong-slice/);
  });

  test("a single control false positive fails", () => {
    assert.equal(applyRule({ ...base(), controlFalsePositives: 1 }).verdict, "PROXY FAIL");
  });

  test("fewer than 10 matched and right fails even at a high rate", () => {
    const s = { ...base(), total: 60, perWidth: { 60: 15, 80: 15, 100: 15, 120: 15 }, exact: 9 };
    assert.equal(applyRule(s).verdict, "PROXY FAIL");
  });

  test("an unrendered session or an undersized set is INCONCLUSIVE, not a pass or fail", () => {
    assert.equal(applyRule({ ...base(), rendered: false }).verdict, "INCONCLUSIVE");
    assert.equal(applyRule({ ...base(), total: 59 }).verdict, "INCONCLUSIVE");
    assert.equal(applyRule({ ...base(), perWidth: { 60: 14, 80: 30, 100: 30, 120: 26 } }).verdict, "INCONCLUSIVE");
    assert.equal(applyRule({ ...base(), perConstruct: { para: 10, ul: 4 } }).verdict, "INCONCLUSIVE");
  });

  test("a construct that does not exist in the corpus is not required", () => {
    const s = { ...base(), constructsPresent: ["para"], perConstruct: { para: 10 } };
    assert.equal(applyRule(s).verdict, "PROXY PASS");
  });
});
