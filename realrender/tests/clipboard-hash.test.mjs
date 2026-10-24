import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { MAX_REAL_READS, readLog, summarizeReads, takeHash } from "../lib/clipboard-hash.mjs";

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
