// Reading transcripts of any size: a line reader that works in chunks, and the
// window index on a file bigger than one chunk. The real transcripts of heavy
// sessions run to hundreds of megabytes, past what one string can hold.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { forEachLine } from "../src/captures/lines.ts";
import { TranscriptIndex } from "../src/captures/window.ts";
import { MINUTE, T0, recordLine, scratch } from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

function linesOf(content: string, chunkBytes?: number): string[] {
  const file = path.join(tmp.make("lines"), "f.txt");
  fs.writeFileSync(file, content);
  const out: string[] = [];
  forEachLine(file, (line) => out.push(line), chunkBytes);
  return out;
}

describe("forEachLine", () => {
  const cases: Array<[string, string]> = [
    ["plain lines", "one\ntwo\nthree\n"],
    ["no final newline", "one\ntwo\nthree"],
    ["empty lines are lines", "one\n\n\ntwo\n"],
    ["carriage returns stay on the line", "one\r\ntwo\r\n"],
    ["multi-byte characters", "café \u{1F600} 你好\nüber\n"],
    ["one very long line", `${"x".repeat(5000)}\nshort\n`],
    ["a single line, no newline at all", "just one line"],
  ];
  for (const [name, content] of cases)
    for (const chunk of [1, 2, 3, 7, 64, 8 * 1024 * 1024])
      test(`${name} @ ${chunk}-byte chunks matches split("\\n")`, () => {
        const expected = content.split("\n");
        if (expected[expected.length - 1] === "") expected.pop();
        assert.deepEqual(linesOf(content, chunk), expected);
      });

  test("an empty file has no lines", () => assert.deepEqual(linesOf(""), []));

  test("a file that cannot be opened throws a plain error the caller counts", () => {
    assert.throws(() =>
      forEachLine(path.join(tmp.make("lines"), "nope.txt"), () => {}),
    );
  });
});

describe("the window index on a transcript bigger than one read chunk", () => {
  test("messages around 9 MB lines are found, in order, with no text lost", () => {
    const root = tmp.make("root");
    const filler = JSON.stringify({
      type: "user",
      message: { role: "user", content: "f".repeat(9 * 1024 * 1024) },
    });
    const lines = [
      recordLine({ at: T0, text: "first é\u{1F600} message" }),
      filler,
      recordLine({ at: T0 + MINUTE, text: "second message" }),
      filler,
      recordLine({ at: T0 + 2 * MINUTE, text: "third message" }),
      "",
    ];
    const file = path.join(root, "p", "big.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join("\n"));
    const t = new Date(T0 + 2 * MINUTE);
    fs.utimesSync(file, t, t);
    const index = new TranscriptIndex(root);
    assert.deepEqual(index.windowAt(T0 + 3 * MINUTE, 40)?.messages, [
      "third message",
      "second message",
      "first é\u{1F600} message",
    ]);
    assert.equal(index.stats.filesRead, 1);
    assert.equal(index.stats.filesTooLarge, 0);
  });
  test("a transcript over 64 MiB (the replay harness limit) is read, not skipped", () => {
    const root = tmp.make("root");
    const filler = JSON.stringify({ type: "user", message: { role: "user", content: "f".repeat(13 * 1024 * 1024) } });
    const file = path.join(root, "p", "huge.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const lines = [recordLine({ at: T0, text: "early message" })];
    for (let i = 0; i < 5; i++) lines.push(filler);
    lines.push(recordLine({ at: T0 + MINUTE, text: "late message" }), "");
    fs.writeFileSync(file, lines.join("\n"));
    assert.ok(fs.statSync(file).size > 64 * 1024 * 1024);
    const t = new Date(T0 + MINUTE);
    fs.utimesSync(file, t, t);
    const index = new TranscriptIndex(root);
    assert.deepEqual(index.windowAt(T0 + 2 * MINUTE, 40)?.messages, ["late message", "early message"]);
    assert.equal(index.stats.filesTooLarge, 0);
  });
});
