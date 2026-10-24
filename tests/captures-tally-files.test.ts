// `tally` through real files: captures, transcripts and verdict files on disk.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { summarize } from "../src/captures/tally.ts";
import {
  MINUTE,
  T0,
  makeCli,
  scratch,
  shownCodes,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
  writeVerdict,
} from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

/** 30 messages, 30 captures that each match their own message. */
function world() {
  const root = tmp.make("root");
  const dir = path.join(tmp.make(), "caps");
  const ns = Array.from({ length: 30 }, (_, i) => i + 1);
  writeSession(
    root,
    "p/main.jsonl",
    ns.map((n) => ({ at: T0 + n * MINUTE, text: worldMessage(n) })),
  );
  const capture = (n: number, text = worldCopy(n)) =>
    writeCapture(
      dir,
      String(n).padStart(2, "0"),
      text,
      T0 + n * MINUTE + 20_000,
    );
  return { root, dir, ns, capture };
}

describe("tally through real files", () => {
  const run = makeCli(tmp.make("home"));
  const json = (dir: string, root: string) =>
    JSON.parse(
      run(["tally", "--dir", dir, "--root", root, "--json"]).out,
    ) as ReturnType<typeof summarize>;

  test("20 right matches judged ok: PASS", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 20; n++) capture(n);
    const codes = shownCodes(run, dir, root);
    for (let n = 1; n <= 20; n++) {
      const id = String(n).padStart(2, "0");
      writeVerdict(dir, id, n % 2 === 0 ? `ok ${codes[id]}\n` : `OK ${codes[id]}`);
    }
    const report = json(dir, root);
    assert.equal(report.k1.verdict, "PASS");
    assert.equal(report.judged, 20);
    assert.match(run(["tally", "--dir", dir, "--root", root]).out, /PASS/);
  });

  test("14 right matches and 6 refusals judged bad: PASS at exactly 70 percent; 13 and 7 is FAIL", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 20; n++)
      capture(
        n,
        n <= 14 ? worldCopy(n) : `nothing like any message here number ${n}`,
      );
    const codes = shownCodes(run, dir, root);
    for (let n = 1; n <= 20; n++) {
      const id = String(n).padStart(2, "0");
      writeVerdict(dir, id, `${n <= 14 ? "ok" : "bad"} ${codes[id]}`);
    }
    const pass = json(dir, root);
    assert.deepEqual(
      [pass.k1.verdict, pass.refusals.missedMatch, pass.dangerous],
      ["PASS", 6, 0],
    );
    writeVerdict(dir, "14", `bad ${codes["14"]}`);
    const fail = json(dir, root);
    assert.deepEqual(
      [fail.k1.verdict, fail.ok, fail.dangerous],
      ["FAIL", 13, 1],
    );
  });

  test("6 right matches and 14 refusals judged right: INSUFFICIENT, 4 more matched and right", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 20; n++)
      capture(
        n,
        n <= 6 ? worldCopy(n) : `nothing like any message here number ${n}`,
      );
    const codes = shownCodes(run, dir, root);
    for (let n = 1; n <= 20; n++) {
      const id = String(n).padStart(2, "0");
      writeVerdict(dir, id, `ok ${codes[id]}`);
    }
    const report = json(dir, root);
    assert.deepEqual(
      [
        report.k1.verdict,
        report.judged,
        report.ok,
        report.matches.judgedRight,
        report.k1.moreNeeded,
        report.k1.moreMatchedRightNeeded,
      ],
      ["INSUFFICIENT", 20, 20, 6, 0, 4],
    );
    const text = run(["tally", "--dir", dir, "--root", root]).out;
    assert.match(text, /K1 on real copies: INSUFFICIENT/);
    assert.match(text, /4 more matched and right/);
  });

  test("a returned text judged bad is dangerous and fails the run", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 20; n++) {
      capture(n);
      writeVerdict(dir, String(n).padStart(2, "0"), n === 20 ? "bad" : "ok");
    }
    const report = json(dir, root);
    assert.deepEqual(
      [report.k1.verdict, report.dangerous, report.dangerousIds],
      ["FAIL", 1, ["20"]],
    );
  });

  test("a returned text judged bad is dangerous, a refusal judged bad is only a miss", () => {
    const { root, dir, capture } = world();
    capture(1);
    capture(2, "nothing like any message here at all");
    writeVerdict(dir, "01", "bad");
    writeVerdict(dir, "02", "bad");
    const report = json(dir, root);
    assert.deepEqual([report.dangerous, report.refusals.missedMatch], [1, 1]);
  });

  test("odd verdict files: spaces and case are fine, anything else is invalid by id, no file is unjudged", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 5; n++) capture(n);
    writeVerdict(dir, "01", "  ok  \r\n");
    writeVerdict(dir, "02", "Bad");
    writeVerdict(dir, "03", "SKIP");
    writeVerdict(dir, "04", "looks fine to me");
    writeVerdict(dir, "09", "ok");
    const report = json(dir, root);
    assert.deepEqual(
      [
        report.ok,
        report.bad,
        report.skip,
        report.invalid,
        report.invalidIds,
        report.unjudged,
        report.orphanVerdicts,
      ],
      [1, 1, 1, 1, ["04"], 1, 1],
    );
  });

  test("an empty verdict file and an over-long one are invalid, not unjudged", () => {
    const { root, dir, capture } = world();
    for (let n = 1; n <= 3; n++) capture(n);
    writeVerdict(dir, "01", "");
    writeVerdict(dir, "02", `ok${" ".repeat(100)}`);
    writeVerdict(dir, "03", "ok");
    const report = json(dir, root);
    assert.deepEqual(
      [report.ok, report.invalid, report.invalidIds, report.unjudged],
      [1, 2, ["01", "02"], 0],
    );
  });

  test("tally matches again from scratch each time: a verdict edited later is picked up", () => {
    const { root, dir, capture } = world();
    capture(1);
    writeVerdict(dir, "01", "ok");
    assert.equal(json(dir, root).ok, 1);
    writeVerdict(dir, "01", "bad");
    assert.deepEqual([json(dir, root).ok, json(dir, root).dangerous], [0, 1]);
  });
  test("a transcript that cannot be read is called out in the tally", { skip: process.getuid?.() === 0 }, () => {
    const { root, dir, capture } = world();
    capture(1);
    writeVerdict(dir, "01", "ok");
    const locked = writeSession(root, "p/locked.jsonl", [{ at: T0 + 40 * MINUTE, text: "hidden" }]);
    fs.chmodSync(locked, 0o000);
    try {
      const report = json(dir, root);
      assert.equal(report.ok, 1);
      assert.ok(report.notes.some((n) => /1 transcript file\(s\) could not be read/.test(n)));
    } finally {
      fs.chmodSync(locked, 0o600);
    }
  });
});
