// `tally`: the arithmetic and the K1 verdict (pure functions, no files).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatTally, parseVerdict, summarize } from "../src/captures/tally.ts";
import type { TallyEntry } from "../src/captures/tally.ts";

type Group = [count: number, kind: string, verdict: TallyEntry["verdict"]];

/** Entries with sequential ids from [count, tool result kind, verdict] groups. */
function build(groups: readonly Group[]): TallyEntry[] {
  const out: TallyEntry[] = [];
  for (const [count, kind, verdict] of groups)
    for (let i = 0; i < count; i++)
      out.push({
        id: String(out.length + 1).padStart(2, "0"),
        kind: kind as TallyEntry["kind"],
        verdict,
        binding: "bound",
        rivalSessions: 0,
        windowSize: 40,
      });
  return out;
}

describe("parseVerdict", () => {
  const table: Array<[string, string | null]> = [
    ["ok", "ok"],
    [" OK \r\n", "ok"],
    ["Bad\n", "bad"],
    ["SKIP", "skip"],
    ["okay", null],
    ["", null],
    ["   \n", null],
    ["ok ok", null],
    ["ok\nbad", null],
    ["yes", null],
  ];
  for (const [raw, expected] of table)
    test(`${JSON.stringify(raw)} is ${expected ?? "invalid"}`, () =>
      assert.equal(parseVerdict(raw), expected));
});

describe("the K1 verdict boundaries", () => {
  const cases: Array<[string, Group[], string, Record<string, unknown>]> = [
    [
      "19 judged: not enough",
      [[19, "ok", "ok"]],
      "INSUFFICIENT",
      { judged: 19, moreNeeded: 1 },
    ],
    [
      "20 judged, all right",
      [[20, "ok", "ok"]],
      "PASS",
      { judged: 20, moreNeeded: 0 },
    ],
    [
      "20 judged at exactly 14 of 20 is 70 percent: pass",
      [
        [14, "ok", "ok"],
        [6, "no-match", "bad"],
      ],
      "PASS",
      { judged: 20, ok: 14, bad: 6 },
    ],
    [
      "20 judged at 13 of 20 is 65 percent: fail",
      [
        [13, "ok", "ok"],
        [7, "no-match", "bad"],
      ],
      "FAIL",
      { judged: 20, ok: 13, bad: 7 },
    ],
    [
      "one dangerous result fails an otherwise perfect 20",
      [
        [19, "ok", "ok"],
        [1, "ok", "bad"],
      ],
      "FAIL",
      { judged: 20, ok: 19, dangerous: 1 },
    ],
    [
      "a dangerous result is a FAIL at once, however few are judged (more copies cannot rescue it)",
      [
        [5, "ok", "ok"],
        [1, "ok", "bad"],
      ],
      "FAIL",
      { judged: 6, moreNeeded: 14, dangerous: 1 },
    ],
    [
      "skips are not judged: 19 ok and 5 skips is insufficient",
      [
        [19, "ok", "ok"],
        [5, "ok", "skip"],
      ],
      "INSUFFICIENT",
      { judged: 19, skip: 5, moreNeeded: 1 },
    ],
    [
      "skips are not judged: 20 ok and 10 skips passes",
      [
        [20, "ok", "ok"],
        [10, "ok", "skip"],
      ],
      "PASS",
      { judged: 20, skip: 10 },
    ],
    [
      "21 judged at 15 is 71 percent: pass",
      [
        [15, "ok", "ok"],
        [6, "no-match", "bad"],
      ],
      "PASS",
      { judged: 21 },
    ],
    [
      "21 judged at 14 is 67 percent: fail",
      [
        [14, "ok", "ok"],
        [7, "no-match", "bad"],
      ],
      "FAIL",
      { judged: 21 },
    ],
    [
      "30 judged at 21 is exactly 70 percent: pass",
      [
        [21, "ok", "ok"],
        [9, "no-match", "bad"],
      ],
      "PASS",
      { judged: 30 },
    ],
    [
      "30 judged at 20 is 67 percent: fail",
      [
        [20, "ok", "ok"],
        [10, "no-match", "bad"],
      ],
      "FAIL",
      { judged: 30 },
    ],
    [
      "nothing at all",
      [],
      "INSUFFICIENT",
      { judged: 0, moreNeeded: 20, okRate: null },
    ],
  ];
  for (const [name, groups, verdict, expected] of cases)
    test(name, () => {
      const report = summarize(build(groups));
      assert.equal(report.k1.verdict, verdict);
      for (const [key, value] of Object.entries(expected)) {
        const actual =
          key === "moreNeeded"
            ? report.k1.moreNeeded
            : (report as unknown as Record<string, unknown>)[key];
        assert.equal(actual, value, key);
      }
    });
});

describe("tally: what each verdict means for each result", () => {
  const REFUSALS = ["ambiguous", "no-match", "too-short", "empty", "no-window"];

  test("every refusal kind counts as a refusal: ok is a right refusal, bad is a missed match", () => {
    const entries = build(
      REFUSALS.flatMap((k): Group[] => [
        [1, k, "ok"],
        [1, k, "bad"],
      ]),
    );
    const report = summarize(entries);
    assert.deepEqual(report.refusals, { judgedOkToRefuse: 5, missedMatch: 5 });
    assert.equal(report.dangerous, 0);
    assert.equal(report.matches.judgedRight, 0);
  });

  test("dangerous is exactly: verdict bad where the tool returned a text", () => {
    const report = summarize(
      build([
        [3, "ok", "ok"],
        [2, "ok", "bad"],
        [2, "no-match", "bad"],
        [2, "ok", "skip"],
        [1, "ok", null],
        [1, "ok", "invalid"],
      ]),
    );
    assert.equal(report.dangerous, 2);
    assert.deepEqual(report.dangerousIds, ["04", "05"]);
    assert.equal(report.matches.judgedRight, 3);
  });

  test("ok verdicts split into matches judged right and refusals judged right", () => {
    const report = summarize(
      build([
        [10, "ok", "ok"],
        [8, "no-match", "ok"],
        [2, "no-match", "bad"],
      ]),
    );
    assert.equal(report.judged, 20);
    assert.equal(report.ok, 18);
    assert.equal(report.okRate, 0.9);
    assert.equal(report.matches.judgedRight, 10);
    assert.equal(report.matchedRightRate, 0.5);
    assert.deepEqual(report.refusals, { judgedOkToRefuse: 8, missedMatch: 2 });
    assert.equal(report.k1.verdict, "PASS");
  });

  test("a tool that refused everything and was judged right cannot pass: INSUFFICIENT, with a note", () => {
    const report = summarize(build([[20, "no-match", "ok"]]));
    assert.equal(report.k1.verdict, "INSUFFICIENT");
    assert.equal(report.matchedRightRate, 0);
    assert.ok(report.notes.some((n) => /refus/i.test(n)));
    assert.deepEqual(summarize(build([[20, "ok", "ok"]])).notes, []);
  });

  test("invalid verdicts are listed by id and unjudged ones are counted, neither is judged", () => {
    const report = summarize(
      build([
        [20, "ok", "ok"],
        [2, "ok", "invalid"],
        [3, "ok", null],
      ]),
    );
    assert.equal(report.invalid, 2);
    assert.deepEqual(report.invalidIds, ["21", "22"]);
    assert.equal(report.unjudged, 3);
    assert.equal(report.judged, 20);
    assert.equal(report.captures, 25);
    assert.equal(report.k1.verdict, "INCOMPLETE");
  });

  test("transcripts that could not be read are called out, since they bend every window", () => {
    const notes = summarize(build([[3, "ok", "ok"]]), {
      transcriptsNotRead: 2,
    }).notes;
    assert.equal(notes.length, 1);
    assert.match(
      notes[0] as string,
      /2 transcript file\(s\) could not be read/,
    );
    assert.deepEqual(
      summarize(build([[3, "ok", "ok"]]), { transcriptsNotRead: 0 }).notes,
      [],
    );
  });

  test("orphan verdict files (no capture) are counted", () => {
    assert.equal(
      summarize(build([[1, "ok", "ok"]]), { orphanVerdicts: 4 }).orphanVerdicts,
      4,
    );
  });
});

describe("the printed tally", () => {
  const sentence = /real stop-loss evidence/;
  const stop = /stop or rethink the mod/;

  test("always states what a pass and a fail mean, plainly", () => {
    for (const groups of [
      [[20, "ok", "ok"]],
      [[5, "ok", "ok"]],
      [
        [10, "ok", "ok"],
        [10, "no-match", "bad"],
      ],
    ] as Group[][]) {
      const text = formatTally(summarize(build(groups)));
      assert.match(text, sentence);
      assert.match(text, stop);
    }
  });

  test("names the verdict, the counts, the dangerous count and how many more to judge", () => {
    const text = formatTally(
      summarize(
        build([
          [10, "ok", "ok"],
          [1, "no-match", "bad"],
        ]),
      ),
    );
    assert.match(text, /INSUFFICIENT/);
    assert.match(text, /9 more/);
    assert.match(text, /dangerous: 0/i);
    assert.match(text, /judged: 11/i);
  });

  test("a fail says so with the reason", () => {
    const text = formatTally(
      summarize(
        build([
          [10, "ok", "ok"],
          [10, "no-match", "bad"],
        ]),
      ),
    );
    assert.match(text, /FAIL/);
    assert.match(text, /50(\.0)?%|0\.5/);
  });
});
