// `tally`, printed: when a PASS is missing only matched-and-right copies, the
// report says how many more and what to copy; the weak-pass label is gone.
// World letters: see captures-tally-matches.test.mts. Synthetic entries only.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_MATCHED_RIGHT,
  formatTally,
  summarize,
} from "../src/captures/tally.ts";
import { tallyWorld } from "../src/captures/fixtures.ts";

const textOf = (world: string): string =>
  formatTally(summarize(tallyWorld(world)));

describe("INSUFFICIENT for too few matches: how many more, and what to copy", () => {
  test("6 matched and right of 20: 4 more, what to copy and what not to", () => {
    const text = textOf("6R 8F 6M");
    assert.match(text, /K1 on real copies: INSUFFICIENT/);
    assert.doesNotMatch(text, /K1 on real copies: PASS/);
    assert.match(text, /4 more matched and right/);
    assert.match(text, /only 6 /);
    assert.match(text, /needs 10/);
    assert.match(text, /normal prose/i);
    assert.match(text, /lists/i);
    assert.match(text, /code blocks/i);
    assert.match(text, /not tables/i);
    assert.match(text, /command output/i);
    assert.match(text, /refusals judged right do not count/i);
  });

  test("with 20 judged there is nothing more to judge, so that line is not printed", () => {
    const text = textOf("6R 14F");
    assert.doesNotMatch(text, /more to judge/);
    assert.doesNotMatch(text, /\b0 more/);
  });

  test("with 19 judged and 5 matched both lines are printed", () => {
    const text = textOf("5R 14F");
    assert.match(text, /1 more to judge \(20 are needed\)/);
    assert.match(text, /5 more matched and right/);
  });

  test("with enough matches only the judged line is printed", () => {
    const text = textOf("10R 1M");
    assert.match(text, /9 more to judge/);
    assert.doesNotMatch(text, /more matched and right/);
  });

  test("the number printed is the number in the report, for every shortfall", () => {
    for (let right = 0; right < MIN_MATCHED_RIGHT; right++) {
      const report = summarize(tallyWorld(`${right}R ${20 - right}F`));
      const need = MIN_MATCHED_RIGHT - right;
      assert.equal(report.k1.moreMatchedRightNeeded, need);
      assert.match(
        formatTally(report),
        new RegExp(`\\b${need} more matched and right`),
      );
    }
  });

  test("the request is printed only for INSUFFICIENT", () => {
    for (const world of [
      "20R",
      "5R 8F 7M",
      "5R 14F 1W",
      "5R 14F 1U",
      "5R 14F 1T",
    ])
      assert.doesNotMatch(textOf(world), /more matched and right/, world);
  });

  test("the stop-loss sentences and the do-not-tune line are still printed", () => {
    const text = textOf("6R 14F");
    assert.match(text, /real stop-loss evidence/);
    assert.match(text, /stop or rethink the mod/);
    assert.match(text, /do not tune the matcher on these captures/i);
  });
});

describe("the counts block shows the bar", () => {
  test("the matched-and-right line names the 10 a PASS needs, for every verdict", () => {
    for (const world of ["6R 8F 6M", "10R 10F", "5R 14F 1W", "20R 1U", ""])
      assert.match(
        textOf(world),
        /matched and judged right: \d+ of \d+ \((n\/a|[\d.]+%); a PASS needs at least 10\)/,
        world,
      );
  });
});

describe("the other verdicts, printed", () => {
  test("a PASS states its matched-and-right count and that nothing was dangerous", () => {
    const text = textOf("10R 10F");
    assert.match(text, /K1 on real copies: PASS\n/);
    assert.match(text, /10 matched and judged right/);
    assert.match(text, /no capture was judged dangerous/i);
  });

  test("a FAIL by ok rate still names the rate, even with few matches", () => {
    const text = textOf("5R 8F 7M");
    assert.match(text, /K1 on real copies: FAIL/);
    assert.match(text, /65(\.0)?%/);
    assert.match(text, /below 70(\.0)?%/);
  });
});

describe("the weak-pass label is gone", () => {
  const worlds = ["20R", "9R 11F", "20F", "5R 1W", "20R 1U"];

  test("no report has a weak field", () => {
    for (const world of worlds)
      assert.equal("weak" in summarize(tallyWorld(world)).k1, false, world);
  });

  test("no printed tally and no JSON says weak", () => {
    for (const world of worlds) {
      assert.doesNotMatch(textOf(world), /weak/i, world);
      assert.doesNotMatch(
        JSON.stringify(summarize(tallyWorld(world))),
        /weak/i,
      );
    }
  });
});

describe("the refusal note matches the rule", () => {
  test("refusals outnumbering matches: only matches count toward the 10", () => {
    const report = summarize(tallyWorld("10R 11F"));
    assert.equal(report.k1.verdict, "PASS");
    const note =
      report.notes.find((n) => /refusals judged right/i.test(n)) ?? "";
    assert.match(note, /10 matched and judged right/);
    assert.doesNotMatch(note, /100%/);
  });

  test("no such note when matches outnumber refusals", () => {
    assert.deepEqual(summarize(tallyWorld("20R")).notes, []);
  });
});
