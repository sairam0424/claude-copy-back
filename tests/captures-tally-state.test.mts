// `tally`: when a PASS must NOT be printed. Synthetic entries only.
//   C1  invalid verdict files or unjudged captures: never PASS.
//   I6  a dangerous result is a FAIL at once.
//   I7  a PASS needs 10 matched and right copies: see captures-tally-matches.
//   I1  a verdict is tied to what the person was shown (the code).
//   I2  misses with other active sessions or a tiny window are called out.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { formatTally, parseVerdict, summarize } from "../src/captures/tally.ts";
import { parseVerdictLine } from "../src/captures/verdict.ts";
import type { TallyEntry } from "../src/captures/tally.ts";

type Spec = Partial<TallyEntry> & {
  kind: string;
  verdict: TallyEntry["verdict"];
};

/** Entries with sequential ids; `count` copies of one spec. */
function make(...groups: Array<[count: number, spec: Spec]>): TallyEntry[] {
  const out: TallyEntry[] = [];
  for (const [count, spec] of groups)
    for (let i = 0; i < count; i++)
      out.push({
        id: String(out.length + 1).padStart(2, "0"),
        binding: "bound",
        rivalSessions: 0,
        windowSize: 40,
        ...spec,
        kind: spec.kind as TallyEntry["kind"],
      });
  return out;
}

const RIGHT: Spec = { kind: "ok", verdict: "ok" };
const MISSED: Spec = { kind: "no-match", verdict: "bad" };
const WRONG_TEXT: Spec = { kind: "ok", verdict: "bad" };

describe("C1: no PASS while anything is unresolved", () => {
  test("20 judged ok plus invalid verdict files plus unjudged captures is INCOMPLETE, naming every id", () => {
    const report = summarize(
      make(
        [20, RIGHT],
        [3, { kind: "ok", verdict: "invalid" }],
        [2, { kind: "ok", verdict: null }],
      ),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
    assert.deepEqual(report.invalidIds, ["21", "22", "23"]);
    assert.deepEqual(report.unjudgedIds, ["24", "25"]);
    const text = formatTally(report);
    assert.match(text, /K1 on real copies: INCOMPLETE/);
    assert.doesNotMatch(text, /K1 on real copies: PASS/);
    assert.doesNotMatch(text, /nothing dangerous/i);
    for (const id of ["21", "22", "23", "24", "25"])
      assert.ok(text.includes(id));
  });

  test("one invalid verdict file alone blocks a PASS", () => {
    const report = summarize(
      make([20, RIGHT], [1, { kind: "ok", verdict: "invalid" }]),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
  });

  test("one unjudged capture alone blocks a PASS", () => {
    const report = summarize(
      make([20, RIGHT], [1, { kind: "ok", verdict: null }]),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
  });

  test("a skip is an explicit judgement: 20 ok and 5 skips still passes", () => {
    const report = summarize(
      make([20, RIGHT], [5, { kind: "ok", verdict: "skip" }]),
    );
    assert.equal(report.k1.verdict, "PASS");
    assert.equal(report.unjudgedIds.length, 0);
  });

  test("a failing rate is also INCOMPLETE while something is unresolved, because the unresolved ones could change it", () => {
    const report = summarize(
      make([10, RIGHT], [10, MISSED], [2, { kind: "ok", verdict: null }]),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
  });

  test("a clean PASS says what is true: nothing was judged dangerous", () => {
    const text = formatTally(summarize(make([20, RIGHT])));
    assert.match(text, /K1 on real copies: PASS/);
    assert.match(text, /no capture was judged dangerous/i);
  });

  test("INCOMPLETE still ends with the plain stop-loss sentences", () => {
    const text = formatTally(
      summarize(make([20, RIGHT], [1, { kind: "ok", verdict: null }])),
    );
    assert.match(text, /real stop-loss evidence/);
    assert.match(text, /stop or rethink the mod/);
  });

  test("the existing boundaries are untouched when everything is resolved", () => {
    assert.equal(summarize(make([14, RIGHT], [6, MISSED])).k1.verdict, "PASS");
    assert.equal(summarize(make([13, RIGHT], [7, MISSED])).k1.verdict, "FAIL");
    assert.equal(summarize(make([19, RIGHT])).k1.verdict, "INSUFFICIENT");
  });
});

describe("I6: a dangerous result is a FAIL at once", () => {
  test("8 captures, 7 ok and 1 wrong text: FAIL, no request for 12 more", () => {
    const report = summarize(make([7, RIGHT], [1, WRONG_TEXT]));
    assert.equal(report.k1.verdict, "FAIL");
    assert.equal(report.k1.early, true);
    const text = formatTally(report);
    assert.match(text, /K1 on real copies: FAIL/);
    assert.doesNotMatch(text, /more to judge/);
    assert.match(text, /stop or rethink the mod/);
    assert.match(text, /already/i);
  });

  test("a dangerous result fails even with unresolved files around it", () => {
    const report = summarize(
      make([5, RIGHT], [1, WRONG_TEXT], [2, { kind: "ok", verdict: null }]),
    );
    assert.equal(report.k1.verdict, "FAIL");
  });

  test("a FAIL at 20 or more is not called early", () => {
    const report = summarize(make([19, RIGHT], [1, WRONG_TEXT]));
    assert.deepEqual([report.k1.verdict, report.k1.early], ["FAIL", false]);
  });

  test("a plain miss (a refusal judged bad) is not dangerous and does not fail early", () => {
    const report = summarize(make([7, RIGHT], [1, MISSED]));
    assert.deepEqual(
      [report.k1.verdict, report.dangerous],
      ["INSUFFICIENT", 0],
    );
  });
});

describe("I1: a verdict is tied to what the person was shown", () => {
  test("a stale verdict (the tool answers differently now) blocks PASS and is listed by id", () => {
    const report = summarize(
      make([19, RIGHT], [1, { ...RIGHT, binding: "stale" }]),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
    assert.deepEqual(report.staleIds, ["20"]);
    const text = formatTally(report);
    assert.match(text, /20/);
    assert.match(text, /answers differently now/i);
    assert.match(text, /run --show/);
  });

  test("a judged verdict without a code blocks PASS and is listed by id", () => {
    const report = summarize(
      make([19, RIGHT], [1, { ...RIGHT, binding: "unbound" }]),
    );
    assert.equal(report.k1.verdict, "INCOMPLETE");
    assert.deepEqual(report.unboundIds, ["20"]);
    assert.match(formatTally(report), /without the code/i);
  });

  test("a skip needs no code, and neither does a capture nobody judged", () => {
    const report = summarize(
      make(
        [20, RIGHT],
        [3, { kind: "ok", verdict: "skip", binding: "unbound" }],
      ),
    );
    assert.equal(report.k1.verdict, "PASS");
    assert.deepEqual(report.unboundIds, []);
  });

  test("a stale verdict is not counted as dangerous, a miss or a right answer: it is simply unresolved", () => {
    const report = summarize(
      make(
        [1, { ...WRONG_TEXT, binding: "stale" }],
        [1, { ...MISSED, binding: "stale" }],
        [1, { ...RIGHT, binding: "stale" }],
      ),
    );
    assert.deepEqual(
      [
        report.dangerous,
        report.refusals.missedMatch,
        report.matches.judgedRight,
        report.staleIds.length,
      ],
      [0, 0, 0, 3],
    );
  });

  test("an unbound bad on a returned text is still dangerous (best effort)", () => {
    const report = summarize(make([1, { ...WRONG_TEXT, binding: "unbound" }]));
    assert.equal(report.dangerous, 1);
    assert.equal(report.k1.verdict, "FAIL");
  });
});

describe("verdict files: the optional code", () => {
  const table: Array<[string, string | null, string | null]> = [
    ["ok", "ok", null],
    ["ok 1a2b3c4d", "ok", "1a2b3c4d"],
    ["  BAD   1A2B3C4D \r\n", "bad", "1a2b3c4d"],
    ["skip\tdeadbeef\n", "skip", "deadbeef"],
    ["ok 1a2b3c4", null, null],
    ["ok 1a2b3c4d5", null, null],
    ["ok 1a2b3c4g", null, null],
    ["ok 1a2b3c4d extra", null, null],
    ["ok\n1a2b3c4d", null, null],
    ["1a2b3c4d ok", null, null],
    ["", null, null],
  ];
  for (const [raw, verdict, code] of table)
    test(`${JSON.stringify(raw)}`, () => {
      const parsed = parseVerdictLine(raw);
      assert.equal(parsed === null ? null : parsed.verdict, verdict);
      assert.equal(
        parsed === null ? null : parsed.code,
        verdict === null ? null : code,
      );
      assert.equal(parseVerdict(raw), verdict);
    });
});

describe("I2: a FAIL may be the session choice, not the matcher", () => {
  test("misses with another active session, a tiny window or no window are counted and called out", () => {
    const report = summarize(
      make(
        [2, { ...MISSED, rivalSessions: 1 }],
        [1, { ...MISSED, windowSize: 3 }],
        [1, { kind: "no-window", verdict: "bad", windowSize: 0 }],
        [4, MISSED],
        [3, RIGHT],
      ),
    );
    assert.equal(report.refusals.missedMatch, 8);
    assert.equal(report.suspectMisses, 4);
    const text = formatTally(report);
    assert.match(text, /4 of the 8 missed matches/);
    assert.match(text, /wrong session/);
    assert.match(text, /--project/);
  });

  test("no note when the misses came with a normal window and no rivals", () => {
    const report = summarize(make([5, MISSED], [5, RIGHT]));
    assert.equal(report.suspectMisses, 0);
    assert.doesNotMatch(formatTally(report), /wrong session/);
  });

  test("only misses count: a wrong text with a rival is dangerous, not a suspect miss", () => {
    const report = summarize(make([1, { ...WRONG_TEXT, rivalSessions: 2 }]));
    assert.equal(report.suspectMisses, 0);
  });
});

describe("notes about what was read", () => {
  test("messages without a usable time are named when captures found no window", () => {
    const report = summarize(
      make([2, { kind: "no-window", verdict: "bad", windowSize: 0 }]),
      { messagesWithoutTime: 40, sidechainMessages: 3 },
    );
    const text = formatTally(report);
    assert.match(text, /40 message\(s\) had no usable timestamp/);
    assert.match(text, /transcript format/);
  });

  test("a project filter that matched no transcript folder is named", () => {
    const report = summarize(make([1, RIGHT]), { projectMatchedNothing: true });
    assert.ok(
      report.notes.some((n) => /--project/.test(n) && /no transcript/.test(n)),
    );
  });

  test("the settings used are printed, never a path", () => {
    const report = summarize(make([1, RIGHT]), {
      config: { messages: 25, customRoot: true, projectFilter: true },
    });
    const text = formatTally(report);
    assert.match(text, /25 replies/);
    assert.match(text, /--root/);
    assert.match(text, /project filter: on/);
  });

  test("every tally tells the person not to tune the matcher on these captures", () => {
    for (const entries of [
      make([20, RIGHT]),
      make([3, RIGHT]),
      make([10, RIGHT], [10, MISSED]),
    ])
      assert.match(
        formatTally(summarize(entries)),
        /do not tune the matcher on these captures/i,
      );
  });
});
