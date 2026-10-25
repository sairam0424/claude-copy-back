import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { capturedProfile, captureSealed, matcherFrozen, rendered, ruleInput3 } from "../lib/measure3.mjs";

const launch = (over = {}) => ({ width: 60, drawn: true, sealed: true, ...over });

describe("measure3: what a capture summary and the locate counts mean", () => {
  test("sealed means every launch drew the session and saw no external remote or stub request", () => {
    assert.equal(captureSealed({ launches: [launch(), launch({ width: 80 })] }), true);
    assert.equal(captureSealed({ launches: [launch(), launch({ sealed: false })] }), false);
    assert.equal(captureSealed({ launches: [launch({ drawn: false })] }), false);
    assert.equal(captureSealed({ launches: [] }), false);
    assert.equal(captureSealed(null), false);
  });

  test("a summary with no profile is an old one and ran as default", () => {
    assert.equal(capturedProfile({ launches: [] }), "default");
    assert.equal(capturedProfile({ profile: "warp" }), "warp");
    assert.equal(capturedProfile(null), "default");
  });

  test("rendered needs 90 percent of the tokens located once at every width", () => {
    assert.equal(rendered({ 60: { tokens: 100, locatable: 90 }, 80: { tokens: 100, locatable: 100 } }), true);
    assert.equal(rendered({ 60: { tokens: 100, locatable: 89 } }), false);
    assert.equal(rendered({}), false);
  });

  test("the matcher is frozen only when its digest equals the freeze record's", () => {
    assert.equal(matcherFrozen({ matcher: { sha256: "abc" } }, "abc"), true);
    assert.equal(matcherFrozen({ matcher: { sha256: "abc" } }, "abd"), false);
    assert.equal(matcherFrozen(null, "abc"), false);
    assert.equal(matcherFrozen({ matcher: { sha256: "abc" } }, undefined), false);
  });

  test("ruleInput3 carries the profile of the capture next to the one being judged", () => {
    const input = ruleInput3({ records: [1], locates: { 60: { tokens: 10, locatable: 10 } }, captureSummary: { profile: "warp", launches: [launch()] }, profile: "default", seed: 5303, discards: 1, freeze: { matcher: { sha256: "m" } }, matcherSha: "m" });
    assert.deepEqual([input.profile, input.capturedProfile, input.seed, input.discards, input.rendered, input.sealed, input.matcherFrozen], ["default", "warp", 5303, 1, true, true, true]);
  });
});
