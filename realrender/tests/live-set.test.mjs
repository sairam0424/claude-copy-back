import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { LIVE_WIDTHS, PER_WIDTH, buildLiveSet, payloadCoverage } from "../lib/live-set.mjs";

describe("a new live case set", () => {
  const a = buildLiveSet({ seed: 7331 });

  test("40 messages, 40 spans per width at the four widths, every record in the shape the live run reads", () => {
    assert.equal(a.corpus.messages.length, 40);
    assert.deepEqual([...new Set(a.results.records.map((r) => r.width))], [...LIVE_WIDTHS]);
    for (const w of LIVE_WIDTHS) assert.equal(a.results.records.filter((r) => r.width === w).length, PER_WIDTH);
    for (const r of a.results.records) {
      assert.ok(Array.isArray(r.pasteForms) && r.pasteForms.length > 0);
      assert.equal(typeof r.message, "number");
      assert.equal(typeof r.anchor, "string");
      assert.equal(r.copied, null);
    }
  });

  test("the same seed gives the same set and another seed gives a different one", () => {
    assert.deepEqual(buildLiveSet({ seed: 7331 }), a);
    assert.notDeepEqual(buildLiveSet({ seed: 7332 }).corpus.messages[0].text, a.corpus.messages[0].text);
  });

  test("all 13 construct classes appear", () => {
    const classes = new Set(a.results.records.map((r) => r.anchor));
    assert.equal(classes.size, 13);
  });

  test("payload coverage counts the accepted forms, not the screen", () => {
    const records = [
      { pasteForms: ["plain ascii"] },
      { pasteForms: [" Café — 日本語 🚀 "] },
      { pasteForms: ["x", "family \u{1F468}\u200d\u{1F469}"] },
    ];
    assert.deepEqual(payloadCoverage(records), { records: 3, nonAscii: 2, emDash: 1, zeroWidthJoiner: 1, cjk: 1, latinAccent: 1, astral: 2 });
  });

  test("the generator's own text has no em dash and no joined emoji, which is why the control launch carries a probe", () => {
    const c = payloadCoverage(a.results.records);
    assert.equal(c.emDash, 0);
    assert.equal(c.zeroWidthJoiner, 0);
    assert.ok(c.nonAscii > 0);
  });
});
