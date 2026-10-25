import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { MAX_REAL_READS, readLog, runHashPipe, summarizeReads, takeHash } from "../lib/clipboard-hash.mjs";

// None of these tests reads the real clipboard: `exec` is always a fake.
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const fakeExec = (output) => () => output;
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "cbclip-"));
const at = () => new Date("2026-10-24T01:00:00Z");

describe("the real-clipboard hash reads (the rule allows exactly two)", () => {
  test("the allowance is two", () => {
    assert.equal(MAX_REAL_READS, 2);
  });

  test("the first read is labelled before, the second after; the log keeps hashes only", () => {
    const file = path.join(dir(), "clip-log.jsonl");
    assert.equal(takeHash({ file, label: "before", exec: fakeExec(`${HASH_A}  -\n`), now: at }), HASH_A);
    assert.equal(takeHash({ file, label: "after", exec: fakeExec(`${HASH_B}  -\n`), now: at }), HASH_B);
    const text = fs.readFileSync(file, "utf8");
    assert.deepEqual(summarizeReads(readLog(file)), { reads: 2, before: HASH_A, after: HASH_B, failed: 0 });
    assert.ok(!/[^0-9a-f"{}:,\-TZ.\w\s]/.test(text), "only hashes, labels and times");
  });

  test("a third read is refused before anything is run", () => {
    const file = path.join(dir(), "clip-log.jsonl");
    takeHash({ file, label: "before", exec: fakeExec(`${HASH_A}  -`), now: at });
    takeHash({ file, label: "after", exec: fakeExec(`${HASH_A}  -`), now: at });
    let ran = false;
    assert.throws(() => takeHash({ file, label: "after", exec: () => { ran = true; return HASH_A; }, now: at }), /already taken/);
    assert.equal(ran, false);
  });

  test("the labels must come in order and only once each", () => {
    const file = path.join(dir(), "clip-log.jsonl");
    assert.throws(() => takeHash({ file, label: "after", exec: fakeExec(HASH_A), now: at }), /before/);
    takeHash({ file, label: "before", exec: fakeExec(HASH_A), now: at });
    assert.throws(() => takeHash({ file, label: "before", exec: fakeExec(HASH_A), now: at }), /already taken|after/);
    assert.throws(() => takeHash({ file, label: "sideways", exec: fakeExec(HASH_A), now: at }), /label/);
  });

  test("a read that fails or prints no hash still counts as a read, and is reported", () => {
    const file = path.join(dir(), "clip-log.jsonl");
    assert.throws(() => takeHash({ file, label: "before", exec: () => { throw new Error("no pasteboard"); }, now: at }), /pbpaste/);
    assert.deepEqual(summarizeReads(readLog(file)), { reads: 1, before: null, after: null, failed: 1 });
    assert.throws(() => takeHash({ file, label: "after", exec: fakeExec("not a hash"), now: at }), /pbpaste/);
    assert.equal(summarizeReads(readLog(file)).reads, 2);
  });

  test("a missing log is no reads", () => {
    assert.deepEqual(summarizeReads(readLog(path.join(dir(), "none.jsonl"))), { reads: 0, before: null, after: null, failed: 0 });
  });

  test("the error text never holds what the tool printed", () => {
    const file = path.join(dir(), "clip-log.jsonl");
    try {
      takeHash({ file, label: "before", exec: fakeExec("SECRET CLIPBOARD WORDS"), now: at });
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(!String(error.message).includes("SECRET"));
    }
    assert.ok(!fs.readFileSync(file, "utf8").includes("SECRET"));
  });
});

describe("takeHash: the terminal profile rides on every logged event", () => {
  test("a profile is written on the attempt and on the hash, and nothing else changes", () => {
    const file = path.join(dir(), "log.jsonl");
    const hash = takeHash({ file, label: "before", exec: () => `${"a".repeat(64)}  -\n`, profile: "warp" });
    assert.equal(hash, "a".repeat(64));
    const lines = readLog(file);
    assert.deepEqual(lines.map((l) => [l.event, l.profile]), [["attempt", "warp"], ["hash", "warp"]]);
  });

  test("without a profile the log lines are exactly the old ones", () => {
    const file = path.join(dir(), "log.jsonl");
    takeHash({ file, label: "before", exec: () => `${"b".repeat(64)}  -\n` });
    assert.equal(readLog(file).some((l) => "profile" in l), false);
  });
});

// The hash is `pbpaste | shasum`. A plain shell pipeline reports the status of its LAST command, so a pbpaste that
// failed gave the hash of empty input and exit 0, the same value as an empty clipboard. The 0.1.1 live
// pass took two such hashes and could not tell the two cases apart. With pipefail a failed read is a failure.
// These tests use stand-in programs; none reads the real clipboard.
describe("runHashPipe: a failing source is a failure, not the hash of empty input", () => {
  const EMPTY_INPUT = createHash("sha256").update("").digest("hex");

  test("a source that exits non-zero throws, even though shasum itself succeeds", () => {
    assert.throws(() => runHashPipe("false"));
  });

  test("a source that succeeds with no output gives the hash of empty input", () => {
    assert.ok(runHashPipe("printf ''").startsWith(EMPTY_INPUT));
  });

  test("a source that prints text gives that text's hash and the text is not in the result", () => {
    const out = runHashPipe("printf secretwords");
    assert.match(out, /^[0-9a-f]{64}/);
    assert.ok(!out.includes("secretwords"));
    assert.ok(!out.startsWith(EMPTY_INPUT));
  });

  test("the real read is the same pipe with pbpaste as its source", async () => {
    const { PBPASTE_SOURCE } = await import("../lib/clipboard-hash.mjs");
    assert.equal(PBPASTE_SOURCE, "pbpaste");
  });
});
