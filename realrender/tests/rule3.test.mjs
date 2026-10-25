import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { RULE3, applyRule3, classesOf, judgeVariant } from "../lib/rule3.mjs";

const WIDTHS = [60, 80, 100, 120];

/** A holdout record. `over` overrides fields; `paddedKind` defaults to the main kind. */
function rec(i, over = {}) {
  const kind = over.kind ?? "exact";
  return {
    width: WIDTHS[i % 4], anchor: ["para", "ul", "quote", "link"][i % 4], features: [], kind,
    control: { withoutOk: false, twinOk: false, falsePositive: false },
    padded: { kind: over.paddedKind ?? kind, control: { falsePositive: false } },
    ...over,
  };
}

const make = (n, over = (i) => ({})) => Array.from({ length: n }, (_, i) => rec(i, over(i)));

const input = (records, extra = {}) => ({
  profile: "warp", capturedProfile: "warp", seed: 5202, discards: 0, matcherFrozen: true, rendered: true, sealed: true, records, ...extra,
});

describe("rule 3, frozen numbers", () => {
  test("the thresholds are the ones the task fixed", () => {
    assert.deepEqual([RULE3.minCaptures, RULE3.minPerWidth, RULE3.minExactPercent, RULE3.minClassExactPercent, RULE3.classMinCaptures], [120, 25, 95, 80, 10]);
    assert.deepEqual([RULE3.maxWrongSlice, RULE3.maxControlFalsePositives, RULE3.minMatchedAndRight], [0, 0, 10]);
    assert.deepEqual([...RULE3.widths], WIDTHS);
    assert.deepEqual([...RULE3.profiles], ["warp", "default"]);
    assert.ok(Object.isFrozen(RULE3));
  });
});

describe("classesOf: anchor classes and feature classes", () => {
  test("a record counts in its anchor class and in each inline feature class it covers, once", () => {
    assert.deepEqual(classesOf({ anchor: "ul", features: ["link", "strike", "link"] }), ["anchor:ul", "feature:link", "feature:strike"]);
    assert.deepEqual(classesOf({ anchor: "para", features: [] }), ["anchor:para"]);
  });
});

describe("rule 3: one profile's holdout", () => {
  test("160 exact captures with no wrong slice and no false positive pass", () => {
    const out = applyRule3(input(make(160)));
    assert.equal(out.verdict, "HOLDOUT PASS");
    assert.deepEqual(out.reasons, []);
  });

  test("exactly 95 percent passes, one capture fewer fails (integer test)", () => {
    const at95 = make(200, (i) => (i < 10 ? { kind: "no-match", paddedKind: "no-match", anchor: "para" } : {}));
    assert.equal(applyRule3(input(at95)).verdict, "HOLDOUT PASS");
    const below = make(200, (i) => (i < 11 ? { kind: "no-match", paddedKind: "no-match", anchor: "para" } : {}));
    const out = applyRule3(input(below));
    assert.equal(out.verdict, "HOLDOUT FAIL");
    assert.match(out.reasons.join("\n"), /exact 189\/200 is below 95%/);
  });

  test("a single wrong slice fails, whatever the exact rate", () => {
    const out = applyRule3(input(make(400, (i) => (i === 3 ? { kind: "wrong-slice", paddedKind: "wrong-slice" } : {}))));
    assert.equal(out.verdict, "HOLDOUT FAIL");
    assert.match(out.reasons.join("\n"), /wrong-slice 1/);
  });

  test("a negative-control false positive fails, from either control", () => {
    for (const control of [{ withoutOk: true, twinOk: false, falsePositive: true }, { withoutOk: false, twinOk: true, falsePositive: true }]) {
      const out = applyRule3(input(make(200, (i) => (i === 7 ? { control } : {}))));
      assert.equal(out.verdict, "HOLDOUT FAIL");
      assert.match(out.reasons.join("\n"), /false positives 1/);
    }
  });

  test("a class with at least 10 captures needs 80 percent; one with 9 is not ruled on", () => {
    // class 'rare' is a tenth of 400 captures (40); 9 failing there is 77.5 percent, while the overall rate stays at 97.75
    const records = make(400, (i) => (i % 10 === 0 ? { anchor: "rare", ...(i < 90 ? { kind: "no-match", paddedKind: "no-match" } : {}) } : { anchor: "para" }));
    const out = applyRule3(input(records));
    assert.equal(out.verdict, "HOLDOUT FAIL");
    assert.deepEqual(out.reasons.filter((r) => !r.startsWith("padded")), ["anchor:rare exact 31/40 is below 80%"]);
    const small = [...make(400), ...Array.from({ length: 9 }, (_, i) => rec(i, { anchor: "rare", kind: "no-match", paddedKind: "no-match" }))];
    assert.equal(applyRule3(input(small)).verdict, "HOLDOUT PASS");
  });

  test("a feature class is ruled on like an anchor class: links and strike are their own classes", () => {
    const records = make(300, (i) => {
      if (i % 5 === 0) return { features: ["link"], ...(i < 100 ? { kind: "no-match", paddedKind: "no-match" } : {}) };
      return {};
    });
    const out = applyRule3(input(records));
    assert.equal(out.verdict, "HOLDOUT FAIL");
    assert.match(out.reasons.join("\n"), /feature:link/);
    assert.ok(out.classes["feature:link"].total >= 10);
    assert.ok("anchor:para" in out.classes);
  });

  test("the padded-trailing-space variant must also pass, on the same four conditions", () => {
    const out = applyRule3(input(make(200, (i) => (i < 15 ? { paddedKind: "ambiguous" } : {}))));
    assert.equal(out.verdict, "HOLDOUT FAIL");
    assert.match(out.reasons.join("\n"), /padded: exact 185\/200 is below 95%/);
    const padFp = applyRule3(input(make(200, (i) => (i === 1 ? { padded: { kind: "exact", control: { falsePositive: true } } } : {}))));
    assert.match(padFp.reasons.join("\n"), /padded: .*false positives 1/);
  });

  test("at least 10 matched and right", () => {
    const out = judgeVariant(make(8), (r) => ({ kind: r.kind, falsePositive: false }));
    assert.match(out.failures.join("\n"), /matched and right 8 is below 10/);
  });
});

describe("rule 3: what makes it INCONCLUSIVE rather than a verdict", () => {
  const cases = [
    ["fewer than 120 captures", () => input(make(119)), /only 119 captures, need 120/],
    ["a width under 25", () => input(make(200, (i) => ({ width: i < 24 ? 60 : 80 }))), /width 100 has 0 captures, need 25/],
    ["a screen the rig could not draw", () => input(make(160), { rendered: false }), /could not render/],
    ["a matcher that is not the frozen one", () => input(make(160), { matcherFrozen: false }), /not the one in the freeze record/],
    ["no freeze record at all", () => input(make(160), { matcherFrozen: undefined }), /not the one in the freeze record/],
    ["a rig that was not sealed", () => input(make(160), { sealed: false }), /not sealed/],
    ["a set captured under another profile than the one being judged", () => input(make(160), { capturedProfile: "default" }), /captured under "default".*judged as "warp"/],
    ["an unknown profile", () => input(make(160), { profile: "iterm", capturedProfile: "iterm" }), /unknown profile/],
    ["a holdout that reuses a calibration seed", () => input(make(160), { seed: 4101 }), /seed 4101 is a calibration seed/],
  ];
  for (const [name, build, pattern] of cases) {
    test(name, () => {
      const out = applyRule3(build());
      assert.equal(out.verdict, "INCONCLUSIVE");
      assert.match(out.reasons.join("\n"), pattern);
    });
  }

  test("a discarded earlier holdout is carried in the result", () => {
    const out = applyRule3(input(make(160), { discards: 2, seed: 5999 }));
    assert.equal(out.verdict, "HOLDOUT PASS");
    assert.equal(out.discards, 2);
  });
});

describe("rule 3: both profiles", () => {
  test("WARP PASS needs both profiles' holdouts to pass", async () => {
    const { combineProfiles } = await import("../lib/rule3.mjs");
    const pass = applyRule3(input(make(160)));
    const fail = applyRule3(input(make(160, (i) => (i === 0 ? { kind: "wrong-slice", paddedKind: "wrong-slice" } : {})), { profile: "default", capturedProfile: "default" }));
    assert.equal(combineProfiles({ warp: pass, default: pass }).verdict, "WARP PASS");
    assert.equal(combineProfiles({ warp: pass, default: fail }).verdict, "WARP FAIL");
    assert.equal(combineProfiles({ warp: pass }).verdict, "INCONCLUSIVE");
    const inconclusive = applyRule3(input(make(10)));
    assert.equal(combineProfiles({ warp: pass, default: inconclusive }).verdict, "INCONCLUSIVE");
  });
});

describe("RULE-3.md says what the code says", () => {
  test("the page names every number of the rule and both profiles", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync(new URL("../RULE-3.md", import.meta.url), "utf8");
    for (const phrase of ["At least 120 captures", "at least 25", "95 percent", "80 percent", "at least 10 captures", "Zero captures", "At least 10 exact", "`warp`", "`default`", "WARP PASS needs both", "4101", "4103", "5202", "5303", "padded", "INCONCLUSIVE"]) {
      assert.ok(page.includes(phrase), `RULE-3.md does not say: ${phrase}`);
    }
    assert.ok(page.split("\n").length < 600);
  });
});
