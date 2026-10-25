// Session choice and what is dropped on the way. Synthetic transcripts only.
//   I2  rivals are measured from the copy moment, not only from the chosen
//       session; --project pins the transcript folder.
//   I5  messages without a usable timestamp are counted and named; only ISO
//       times with a zone are accepted.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { emptyStats, forEachAssistantText } from "../src/replay/corpus.ts";
import { TranscriptIndex } from "../src/captures/window.ts";
import {
  MINUTE,
  T0,
  makeCli,
  scratch,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
} from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

const T = T0 + 60 * MINUTE;
const windowAt = (root: string, at = T, project: string | null = null) =>
  new TranscriptIndex(root, { project }).windowAt(at, 40);

interface Row {
  kind: string;
  windowSize: number;
  rivalSessions: number;
  windowAgeSeconds: number | null;
}
interface Report {
  captures: Row[];
  corpus: Record<string, number>;
}

describe("I2: rivals are measured from the copy moment", () => {
  test("regression: a long read of one session while another speaks 30 s before the copy", () => {
    const root = tmp.make("root");
    const dir = path.join(tmp.make(), "caps");
    writeSession(root, "p/user.jsonl", [
      { at: T - 600_000, text: worldMessage(1) },
    ]);
    writeSession(root, "p/cron.jsonl", [
      { at: T - 30_000, text: "a cron tick that nobody reads" },
    ]);
    writeCapture(dir, "01", worldCopy(1), T);
    const r = JSON.parse(
      makeCli(tmp.make("home"))(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    const row = r.captures[0] as Row;
    assert.deepEqual(
      [row.kind, row.windowSize, row.windowAgeSeconds, row.rivalSessions],
      ["no-match", 1, 30, 1],
    );
  });

  const table: Array<[string, number, number, number]> = [
    // [name, chosen anchor before T (ms), other anchor before T (ms), expected rivals]
    ["another session 20 minutes before the copy", 10_000, 20 * MINUTE, 1],
    ["another session 29 minutes before the copy", 10_000, 29 * MINUTE, 1],
    ["another session 40 minutes before the copy", 10_000, 40 * MINUTE, 0],
    [
      "chosen session 3 hours back, the other 4 minutes before it",
      180 * MINUTE,
      184 * MINUTE,
      1,
    ],
    [
      "chosen session 3 hours back, the other 6 minutes before it",
      180 * MINUTE,
      186 * MINUTE,
      0,
    ],
    [
      "chosen session 3 hours back, the other exactly 5 minutes before it",
      180 * MINUTE,
      185 * MINUTE,
      1,
    ],
  ];
  for (const [name, chosenBefore, otherBefore, rivals] of table)
    test(name, () => {
      const root = tmp.make("root");
      const at = T0 + 400 * MINUTE;
      writeSession(root, "p/chosen.jsonl", [
        { at: at - chosenBefore, text: "chosen" },
      ]);
      writeSession(root, "p/other.jsonl", [
        { at: at - otherBefore, text: "other" },
      ]);
      const w = windowAt(root, at);
      assert.equal(w?.messages[0], "chosen");
      assert.equal(w?.rivalSessions, rivals);
    });

  test("a session inside the active window is read (that is how it is counted); an older one is not", () => {
    const root = tmp.make("root");
    writeSession(root, "p/best.jsonl", [{ at: T - 10_000, text: "best" }]);
    writeSession(root, "p/recent.jsonl", [
      { at: T - 20 * MINUTE, text: "recent" },
    ]);
    writeSession(root, "p/old.jsonl", [{ at: T - 50 * MINUTE, text: "old" }]);
    const index = new TranscriptIndex(root);
    assert.equal(index.windowAt(T, 40)?.rivalSessions, 1);
    assert.equal(index.stats.filesRead, 2);
  });

  test("a chosen file evicted from the text cache is not counted twice", () => {
    const root = tmp.make("root");
    // Two files that look newest but only speak after the copy, the best one, and two near rivals.
    writeSession(
      root,
      "p/s1.jsonl",
      [{ at: T + 5 * MINUTE, text: "future 1" }],
      { mtime: T + 500 * MINUTE },
    );
    writeSession(
      root,
      "p/s2.jsonl",
      [{ at: T + 6 * MINUTE, text: "future 2" }],
      { mtime: T + 400 * MINUTE },
    );
    writeSession(root, "p/s3.jsonl", [{ at: T - MINUTE, text: "best" }]);
    writeSession(root, "p/s4.jsonl", [{ at: T - 2 * MINUTE, text: "rival 4" }]);
    writeSession(root, "p/s5.jsonl", [{ at: T - 3 * MINUTE, text: "rival 5" }]);
    const index = new TranscriptIndex(root);
    assert.equal(index.windowAt(T, 40)?.messages[0], "best");
    assert.equal(index.stats.filesRead, 5);
    assert.equal(index.mainTranscripts, 5);
  });
});

describe("I2: --project pins the transcript folder", () => {
  function two() {
    const root = tmp.make("root");
    writeSession(root, "-Users-me-proj-user/s.jsonl", [
      { at: T - 600_000, text: worldMessage(1) },
    ]);
    writeSession(root, "-Users-me-proj-cron/s.jsonl", [
      { at: T - 30_000, text: "cron tick" },
    ]);
    return root;
  }

  test("without it the newer session wins; with it the pinned folder is the only candidate", () => {
    const root = two();
    assert.equal(windowAt(root)?.messages[0], "cron tick");
    const index = new TranscriptIndex(root, { project: "PROJ-user" });
    const w = index.windowAt(T, 40);
    assert.deepEqual([w?.messages[0], w?.rivalSessions], [worldMessage(1), 0]);
    assert.equal(index.mainTranscripts, 1);
    assert.equal(index.filesSkippedProject, 1);
  });

  test("it matches the folder name only: not the file name, and not a file directly under the root", () => {
    const root = tmp.make("root");
    writeSession(root, "plain/needle-session.jsonl", [
      { at: T - MINUTE, text: "by file name" },
    ]);
    writeSession(root, "needle-at-root.jsonl", [
      { at: T - MINUTE, text: "at the root" },
    ]);
    assert.equal(windowAt(root, T, "needle"), null);
    assert.equal(windowAt(root, T, "plain")?.messages[0], "by file name");
  });

  test("run --project and tally --project work through the CLI, and the count shows in the corpus block", () => {
    const root = two();
    const dir = path.join(tmp.make(), "caps");
    writeCapture(dir, "01", worldCopy(1), T);
    const cli = makeCli(tmp.make("home"));
    const plain = JSON.parse(
      cli(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    assert.equal((plain.captures[0] as Row).kind, "no-match");
    const pinned = JSON.parse(
      cli(["run", "--dir", dir, "--root", root, "--project", "proj-user"]).out,
    ) as Report;
    assert.equal((pinned.captures[0] as Row).kind, "ok");
    assert.equal(pinned.corpus["filesSkippedProject"], 1);
    const tally = cli([
      "tally",
      "--dir",
      dir,
      "--root",
      root,
      "--project",
      "proj-user",
    ]);
    assert.equal(tally.code, 0);
    assert.match(tally.out, /project filter: on/);
  });

  test("a filter that matches nothing is named in the tally", () => {
    const root = two();
    const dir = path.join(tmp.make(), "caps");
    writeCapture(dir, "01", worldCopy(1), T);
    const out = makeCli(tmp.make("home"))([
      "tally",
      "--dir",
      dir,
      "--root",
      root,
      "--project",
      "nothing-like-it",
    ]).out;
    assert.match(out, /--project matched no transcript folder/);
  });
});

/** One assistant record with any timestamp value (undefined leaves the field out). */
function rawLine(
  timestamp: unknown,
  text = "a message with a timestamp",
): string {
  return JSON.stringify({
    type: "assistant",
    ...(timestamp === undefined ? {} : { timestamp }),
    message: { role: "assistant", content: [{ type: "text", text }] },
  });
}

describe("I5: only an ISO time with a zone is a time", () => {
  const accepted: Array<[string, string]> = [
    ["Z with milliseconds", "2026-10-23T10:00:00.000Z"],
    ["Z without milliseconds", "2026-10-23T10:00:00Z"],
    ["an offset with a colon", "2026-10-23T15:30:00+05:30"],
    ["an offset without a colon", "2026-10-23T15:30:00.000+0530"],
    ["a negative offset", "2026-10-23T05:00:00-05:00"],
  ];
  for (const [name, stamp] of accepted)
    test(`accepted: ${name}`, () => {
      const seen: Array<number | null> = [];
      forEachAssistantText(rawLine(stamp), emptyStats(), (b) =>
        seen.push(b.time),
      );
      assert.deepEqual(seen, [T0]);
    });

  const rejected: Array<[string, unknown]> = [
    ["missing", undefined],
    ["a number (epoch)", 1761213600000],
    ["an epoch string", "1761213600000"],
    ["a bare number string", "10"],
    ["no zone, space separated", "2026-10-23 09:59:55"],
    ["no zone, T separated", "2026-10-23T10:00:00"],
    ["a date only", "2026-10-23"],
    ["garbage", "not a time"],
    ["empty", ""],
    ["null", null],
  ];
  for (const [name, stamp] of rejected)
    test(`rejected: ${name}`, () => {
      const seen: Array<number | null> = [];
      forEachAssistantText(rawLine(stamp), emptyStats(), (b) =>
        seen.push(b.time),
      );
      assert.deepEqual(seen, [null]);
    });
});

describe("I5: what is dropped is counted and named", () => {
  function odd() {
    const root = tmp.make("root");
    const file = path.join(root, "p", "odd.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        rawLine(undefined, "no time 1"),
        rawLine(1761213600000, "epoch"),
        rawLine("2026-10-23 09:59:55", "no zone"),
        JSON.stringify({
          ...JSON.parse(rawLine("2026-10-23T10:00:00.000Z", "side 1")),
          isSidechain: true,
        }),
        JSON.stringify({
          ...JSON.parse(rawLine("2026-10-23T10:00:01.000Z", "side 2")),
          isSidechain: true,
        }),
        rawLine("2026-10-23T10:00:02.000Z", "the one good message"),
      ].join("\n") + "\n",
    );
    return root;
  }

  test("the index counts messages without a time and sidechain messages", () => {
    const index = new TranscriptIndex(odd());
    assert.equal(index.windowAt(T0 + MINUTE, 40)?.messages.length, 1);
    assert.deepEqual(
      [index.messagesWithoutTime, index.sidechainMessages],
      [3, 2],
    );
  });

  test("a transcript with only such messages gives no-window, and the counts say why", () => {
    const root = tmp.make("root");
    const dir = path.join(tmp.make(), "caps");
    const file = path.join(root, "p", "x.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        rawLine(1761213600000, worldMessage(1)),
        rawLine(undefined, worldMessage(2)),
      ].join("\n") + "\n",
    );
    writeCapture(dir, "01", worldCopy(1), T0);
    const cli = makeCli(tmp.make("home"));
    const r = JSON.parse(
      cli(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    assert.equal((r.captures[0] as Row).kind, "no-window");
    assert.equal(r.corpus["messagesWithoutTime"], 2);
    assert.equal(r.corpus["sidechainMessages"], 0);
    const text = cli(["tally", "--dir", dir, "--root", root]).out;
    assert.match(text, /2 message\(s\) had no usable timestamp/);
  });

  test("counts only: no message text in the run output", () => {
    const root = odd();
    const dir = path.join(tmp.make(), "caps");
    writeCapture(dir, "01", "no time 1 and the rest of a copy", T0 + MINUTE);
    const out = makeCli(tmp.make("home"))([
      "run",
      "--dir",
      dir,
      "--root",
      root,
    ]).out;
    for (const word of ["no time 1", "the one good message", "side 1"])
      assert.equal(out.includes(word), false);
  });
});
