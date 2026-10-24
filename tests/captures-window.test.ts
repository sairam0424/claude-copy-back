// Which messages a capture would have seen: the window. Synthetic transcripts only.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { forEachAssistantText, emptyStats } from "../src/replay/corpus.ts";
import { CapturesError } from "../src/captures/errors.ts";
import { TranscriptIndex } from "../src/captures/window.ts";
import {
  CANARY,
  MINUTE,
  T0,
  recordLine,
  scratch,
  writeSession,
} from "../src/captures/fixtures.ts";
import type { SessionRecord } from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

/** Messages "<tag>1", "<tag>2", ... at one-minute steps from `start`. */
function steps(tag: string, count: number, start = T0): SessionRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    at: start + i * MINUTE,
    text: `${tag}${i + 1}`,
  }));
}

function windowOf(root: string, at: number, count = 40, opts = {}) {
  return new TranscriptIndex(root, opts).windowAt(at, count);
}

describe("the shared transcript reader", () => {
  test("hands out text, time and sidechain flag, and counts what it skips", () => {
    const raw = [
      recordLine({ at: T0, text: "plain" }),
      recordLine({ at: T0 + 1, text: "side", sidechain: true }),
      recordLine({ at: T0 + 2, text: "no time", noTimestamp: true }),
      recordLine({ at: T0 + 3, text: "bad time", badTimestamp: true }),
      recordLine({
        at: T0 + 4,
        blocks: [
          { type: "tool_use", name: "x" },
          { type: "text", text: "second block" },
        ],
      }),
      recordLine({ at: T0 + 5, text: "a user turn", kind: "user" }),
      `{"type":"assistant","message":{"content":[{"type":"text","text":"${CANARY} cut off`,
    ].join("\n");
    const stats = emptyStats();
    const seen: Array<[string, number | null, boolean]> = [];
    forEachAssistantText(raw, stats, (b) =>
      seen.push([b.text, b.time, b.sidechain]),
    );
    assert.deepEqual(seen, [
      ["plain", T0, false],
      ["side", T0 + 1, true],
      ["no time", null, false],
      ["bad time", null, false],
      ["second block", T0 + 4, false],
    ]);
    assert.equal(stats.linesUnparseable, 1);
  });
});

describe("window: the session and the messages", () => {
  test("takes the newest messages at or before the capture time, newest first", () => {
    const root = tmp.make("root");
    writeSession(root, "p/one.jsonl", steps("m", 5));
    const w = windowOf(root, T0 + 3 * MINUTE + 5_000);
    assert.deepEqual(w?.messages, ["m4", "m3", "m2", "m1"]);
    assert.equal(w?.anchorMs, T0 + 3 * MINUTE);
    assert.equal(w?.ageMs, 5_000);
  });

  test("a message exactly at the capture time is in; one millisecond later is out", () => {
    const root = tmp.make("root");
    writeSession(root, "p/one.jsonl", steps("m", 3));
    assert.equal(windowOf(root, T0 + MINUTE)?.messages[0], "m2");
    assert.equal(windowOf(root, T0 + MINUTE - 1)?.messages[0], "m1");
  });

  test("the count caps the window at the newest N", () => {
    const root = tmp.make("root");
    writeSession(root, "p/one.jsonl", steps("m", 10));
    assert.deepEqual(windowOf(root, T0 + 9 * MINUTE, 3)?.messages, [
      "m10",
      "m9",
      "m8",
    ]);
  });

  test("a capture older than every session has no window", () => {
    const root = tmp.make("root");
    writeSession(root, "p/one.jsonl", steps("m", 3));
    writeSession(root, "p/two.jsonl", steps("n", 3, T0 + 20 * MINUTE));
    assert.equal(windowOf(root, T0 - 1), null);
  });

  test("an empty or missing set of sessions has no window", () => {
    assert.equal(windowOf(tmp.make("root"), T0), null);
  });

  test("a session that goes on after the capture still serves it, with only what came before", () => {
    const root = tmp.make("root");
    writeSession(root, "p/one.jsonl", steps("m", 20));
    assert.deepEqual(windowOf(root, T0 + 2 * MINUTE + 1)?.messages, [
      "m3",
      "m2",
      "m1",
    ]);
  });

  test("the session whose latest message before the capture is closest to it wins", () => {
    const root = tmp.make("root");
    writeSession(root, "p/a.jsonl", steps("a", 4)); // last at +3
    writeSession(root, "p/b.jsonl", steps("b", 4, T0 + 10 * MINUTE)); // +10 .. +13
    writeSession(root, "p/c.jsonl", steps("c", 4, T0 + 30 * MINUTE)); // after
    assert.equal(windowOf(root, T0 + 11 * MINUTE + 30_000)?.messages[0], "b2");
    assert.equal(windowOf(root, T0 + 5 * MINUTE)?.messages[0], "a4");
    assert.equal(windowOf(root, T0 + 40 * MINUTE)?.messages[0], "c4");
  });

  test("sessions never mix: the window comes from one transcript", () => {
    const root = tmp.make("root");
    writeSession(root, "p/a.jsonl", steps("a", 3));
    writeSession(root, "p/b.jsonl", steps("b", 3, T0 + 5 * MINUTE));
    const w = windowOf(root, T0 + 6 * MINUTE + 1);
    assert.deepEqual(w?.messages, ["b2", "b1"]);
  });

  test("an idle session, last written long before the capture, is still found", () => {
    const root = tmp.make("root");
    writeSession(root, "p/idle.jsonl", steps("i", 3));
    writeSession(root, "p/older.jsonl", steps("o", 3, T0 - 60 * MINUTE));
    assert.equal(windowOf(root, T0 + 600 * MINUTE)?.messages[0], "i3");
  });
});

describe("window: what is left out", () => {
  test("subagent transcripts are skipped even when they are closer in time", () => {
    const root = tmp.make("root");
    writeSession(root, "p/main.jsonl", steps("main", 3));
    writeSession(
      root,
      "p/sess/subagents/agent-1.jsonl",
      steps("sub", 3, T0 + 3 * MINUTE),
    );
    const index = new TranscriptIndex(root);
    assert.deepEqual(index.windowAt(T0 + 5 * MINUTE, 40)?.messages, [
      "main3",
      "main2",
      "main1",
    ]);
    assert.equal(index.stats.filesSkippedSubagent, 1);
    assert.equal(index.mainTranscripts, 1);
  });

  test("records marked as sidechain are skipped inside a main transcript", () => {
    const root = tmp.make("root");
    writeSession(root, "p/main.jsonl", [
      { at: T0, text: "kept1" },
      { at: T0 + MINUTE, text: "side", sidechain: true },
      { at: T0 + 2 * MINUTE, text: "kept2" },
    ]);
    assert.deepEqual(windowOf(root, T0 + 3 * MINUTE)?.messages, [
      "kept2",
      "kept1",
    ]);
  });

  test("only assistant text counts: user turns, tool blocks, blank text, records without a usable time, broken lines", () => {
    const root = tmp.make("root");
    writeSession(
      root,
      "p/main.jsonl",
      [
        { at: T0, text: "real1" },
        { at: T0 + 1 * MINUTE, text: "a user turn", kind: "user" },
        { at: T0 + 2 * MINUTE, blocks: [{ type: "tool_use", name: "x" }] },
        { at: T0 + 3 * MINUTE, text: "   \n " },
        { at: T0 + 4 * MINUTE, text: "no time", noTimestamp: true },
        { at: T0 + 5 * MINUTE, text: "bad time", badTimestamp: true },
        { at: T0 + 6 * MINUTE, text: "real2" },
      ],
      {
        raw: [
          `{"type":"assistant","message":{"content":[{"type":"text","text":"${CANARY}`,
        ],
      },
    );
    const index = new TranscriptIndex(root);
    assert.deepEqual(index.windowAt(T0 + 9 * MINUTE, 40)?.messages, [
      "real2",
      "real1",
    ]);
    assert.equal(index.stats.linesUnparseable, 1);
  });

  test("a transcript over the size cap or unreadable is counted and left out", () => {
    const root = tmp.make("root");
    writeSession(root, "p/big.jsonl", steps("big", 3, T0 + 5 * MINUTE));
    writeSession(root, "p/small.jsonl", steps("s", 1));
    const index = new TranscriptIndex(root, { maxFileBytes: 250 });
    assert.equal(index.windowAt(T0 + 9 * MINUTE, 40)?.messages[0], "s1");
    assert.equal(index.stats.filesTooLarge, 1);
  });

  test("an unreadable transcript root fails with a fixed code and no path", () => {
    const missing = path.join(tmp.make("root"), `nope-${CANARY}`);
    assert.throws(
      () => new TranscriptIndex(missing),
      (e: unknown) =>
        e instanceof CapturesError &&
        e.code === "ROOT_UNREADABLE" &&
        !e.message.includes(CANARY),
    );
  });
});

describe("window: rival sessions and work saved", () => {
  test("sessions active within five minutes of the chosen one are counted as rivals; one long before the copy is not", () => {
    const root = tmp.make("root");
    writeSession(root, "p/a.jsonl", steps("a", 1, T0 + 108 * MINUTE));
    writeSession(root, "p/b.jsonl", steps("b", 1, T0 + 109 * MINUTE));
    writeSession(root, "p/c.jsonl", steps("c", 1, T0));
    const w = windowOf(root, T0 + 110 * MINUTE);
    assert.equal(w?.messages[0], "b1");
    assert.equal(w?.rivalSessions, 1);
  });

  test("two sessions with the same latest message time: the file written last wins, the other is a rival", () => {
    const root = tmp.make("root");
    writeSession(root, "z/older-file.jsonl", [{ at: T0, text: "from the older file" }], {
      mtime: T0 + 50 * MINUTE,
    });
    writeSession(root, "a/newer-file.jsonl", [{ at: T0, text: "from the newer file" }], {
      mtime: T0 + 100 * MINUTE,
    });
    const w = windowOf(root, T0 + MINUTE);
    assert.equal(w?.messages[0], "from the newer file");
    assert.equal(w?.rivalSessions, 1);
  });

  test("a lone session has no rivals", () => {
    const root = tmp.make("root");
    writeSession(root, "p/a.jsonl", steps("a", 3));
    assert.equal(windowOf(root, T0 + 10 * MINUTE)?.rivalSessions, 0);
  });

  test("old transcripts that cannot beat the best are not even read", () => {
    const root = tmp.make("root");
    writeSession(root, "p/best.jsonl", steps("best", 3, T0 + 100 * MINUTE));
    for (let n = 0; n < 6; n++)
      writeSession(
        root,
        `p/old${n}.jsonl`,
        steps(`old${n}-`, 3, T0 + n * MINUTE),
      );
    const index = new TranscriptIndex(root);
    assert.equal(index.windowAt(T0 + 110 * MINUTE, 40)?.messages[0], "best3");
    assert.equal(index.stats.filesRead, 1);
    assert.equal(index.mainTranscripts, 7);
  });

  test("a transcript is read once however many captures ask", () => {
    const root = tmp.make("root");
    writeSession(root, "p/a.jsonl", steps("a", 10));
    const index = new TranscriptIndex(root);
    for (let n = 1; n <= 8; n++) index.windowAt(T0 + n * MINUTE + 1, 40);
    assert.equal(index.stats.filesRead, 1);
  });

  test("file times far later than the messages (touched or restored files) change the work done, not the answer", () => {
    const root = tmp.make("root");
    writeSession(root, "z/a.jsonl", steps("a", 3), { mtime: T0 + 500 * MINUTE });
    writeSession(root, "a/b.jsonl", steps("b", 3, T0 + 20 * MINUTE), {
      mtime: T0 + 400 * MINUTE,
    });
    assert.equal(windowOf(root, T0 + 30 * MINUTE)?.messages[0], "b3");
    assert.equal(windowOf(root, T0 + 10 * MINUTE)?.messages[0], "a3");
  });
});
