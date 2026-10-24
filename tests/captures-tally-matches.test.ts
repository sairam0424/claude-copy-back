// `tally`: a PASS needs at least 10 copies MATCHED AND RIGHT (the tool returned
// text and the person judged it ok). Refusals judged right never make up for
// missing matches. The rule is pre-registered: these tests pin every boundary
// and the three numbers. Synthetic entries only.
//
// World letters (see tallyWorld in fixtures.ts), "10R 4F 6M" = ten of R ...
//   R matched and right   F refusal judged right   M refusal judged a miss
//   W wrong text (dangerous)   S skipped   U unjudged   I invalid verdict file
//   T stale verdict   B verdict without its code

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_JUDGED,
  MIN_MATCHED_RIGHT,
  summarize,
} from "../src/captures/tally.ts";
import { tallyWorld } from "../src/captures/fixtures.ts";

const verdictOf = (world: string) => summarize(tallyWorld(world)).k1.verdict;

describe("the pre-registered numbers", () => {
  test("20 judged, 70 percent ok, 10 matched and right: nothing else", () => {
    const k1 = summarize(tallyWorld("20R")).k1;
    assert.deepEqual(
      [
        MIN_JUDGED,
        k1.minJudged,
        MIN_MATCHED_RIGHT,
        k1.minMatchedRight,
        k1.threshold,
      ],
      [20, 20, 10, 10, 0.7],
    );
  });
});

describe("the matched-and-right bar: every boundary", () => {
  // [name, world, verdict, matched and right, more to judge, more matched and right]
  type Row = [string, string, string, number, number, number];
  const rows: Row[] = [
    ["20 matched and right", "20R", "PASS", 20, 0, 0],
    ["exactly 10 matched + 10 refusals right", "10R 10F", "PASS", 10, 0, 0],
    [
      "9 matched + 11 refusals right: 1 more",
      "9R 11F",
      "INSUFFICIENT",
      9,
      0,
      1,
    ],
    ["20 refusals right: 10 more", "20F", "INSUFFICIENT", 0, 0, 10],
    ["70% exactly, exactly 10 matched", "10R 4F 6M", "PASS", 10, 0, 0],
    ["70% exactly, 9 matched: 1 more", "9R 5F 6M", "INSUFFICIENT", 9, 0, 1],
    ["14 ok of 20, 6 matched: 4 more", "6R 8F 6M", "INSUFFICIENT", 6, 0, 4],
    ["65% with 5 matched stays FAIL", "5R 8F 7M", "FAIL", 5, 0, 5],
    ["65% with no match stays FAIL", "13F 7M", "FAIL", 0, 0, 10],
    ["65% with 10 matched stays FAIL", "10R 3F 7M", "FAIL", 10, 0, 0],
    ["19 judged, all matched", "19R", "INSUFFICIENT", 19, 1, 0],
    ["19 judged, 5 matched: both", "5R 14F", "INSUFFICIENT", 5, 1, 5],
    ["nothing at all", "", "INSUFFICIENT", 0, 20, 10],
    ["30 judged, 70% exactly, 9 matched", "9R 12F 9M", "INSUFFICIENT", 9, 0, 1],
    ["30 judged, 70% exactly, 10 matched", "10R 11F 9M", "PASS", 10, 0, 0],
    ["25 matched, no upper limit", "25R", "PASS", 25, 0, 0],
    [
      "skips count for nothing (9 matched)",
      "9R 11F 5S",
      "INSUFFICIENT",
      9,
      0,
      1,
    ],
    ["skips count for nothing (10 matched)", "10R 10F 5S", "PASS", 10, 0, 0],
  ];
  for (const [name, world, verdict, right, toJudge, toMatch] of rows)
    test(name, () => {
      const report = summarize(tallyWorld(world));
      assert.equal(report.k1.verdict, verdict);
      assert.equal(report.matches.judgedRight, right, "matched and right");
      assert.equal(report.k1.moreNeeded, toJudge, "more to judge");
      assert.equal(
        report.k1.moreMatchedRightNeeded,
        toMatch,
        "more matched and right",
      );
    });

  test("every refusal kind is a refusal, never a match: 20 of them judged right is INSUFFICIENT", () => {
    const kinds = ["ambiguous", "no-match", "too-short", "empty", "no-window"];
    const entries = tallyWorld("20F").map((e, i) => ({
      ...e,
      kind: kinds[i % kinds.length] as typeof e.kind,
    }));
    const report = summarize(entries);
    assert.deepEqual(
      [report.judged, report.k1.verdict, report.matches.judgedRight],
      [20, "INSUFFICIENT", 0],
    );
  });

  test("too few matches is INSUFFICIENT, never an early FAIL", () => {
    assert.equal(summarize(tallyWorld("6R 14F")).k1.early, false);
  });
});

describe("the matched-and-right bar: what outranks it", () => {
  test("a dangerous result stays a FAIL, even with few matches and 20 judged", () => {
    const report = summarize(tallyWorld("5R 14F 1W"));
    assert.deepEqual(
      [report.k1.verdict, report.dangerous, report.k1.early],
      ["FAIL", 1, false],
    );
  });

  test("a dangerous result under 20 judged stays an early FAIL", () => {
    const report = summarize(tallyWorld("3R 1W"));
    assert.deepEqual([report.k1.verdict, report.k1.early], ["FAIL", true]);
  });

  test("a dangerous result fails an otherwise complete 10 + 9", () => {
    assert.equal(verdictOf("10R 9F 1W"), "FAIL");
  });

  test("unresolved stays INCOMPLETE, with or without enough matches", () => {
    for (const world of ["20F 1U", "20F 1I", "10R 10F 1U", "10R 10F 1I"])
      assert.equal(verdictOf(world), "INCOMPLETE", world);
  });

  test("a stale or unbound verdict is no match and blocks first: INCOMPLETE", () => {
    const stale = summarize(tallyWorld("9R 1T 10F"));
    assert.deepEqual(
      [stale.k1.verdict, stale.matches.judgedRight],
      ["INCOMPLETE", 9],
    );
    assert.equal(verdictOf("9R 1B 10F"), "INCOMPLETE");
  });

  test("a returned text skipped is not a match", () => {
    assert.equal(summarize(tallyWorld("9R 1S 11F")).matches.judgedRight, 9);
  });
});
