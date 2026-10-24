import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { isIdle, promptOf, readFrom, reconcileWrites, settleWrites } from "../lib/live-observe.mjs";

const bar = "─".repeat(60);
const idle = `  last reply row\n\n${bar}\n❯ \n${bar}\n  ⏸ manual mode on · ? for shortcuts · ← for agents\n`;
const busy = `❯ /cc\n\n✻ Crunching…\n\n${bar}\n❯ \n${bar}\n  ⏸ manual mode on · esc to interrupt · ← for agents\n`;
const typed = `${bar}\n❯ /cc\n${bar}\n  ❯ /cc                         Put the text you copied\n`;
const toasted = `${idle}  copy-back: copy-back: clipboard is empty, nothing chang…\n`;
const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbobs-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("screen readers of the live pass", () => {
  test("the live prompt is the ❯ row under a divider; transcript echoes do not count", () => {
    assert.deepEqual(promptOf(idle), { row: 3, empty: true });
    assert.equal(promptOf(busy)?.empty, true);
    assert.equal(promptOf(typed)?.empty, false);
    assert.equal(promptOf("❯ prompt 01 for the B set\nplain\n"), null);
  });

  test("idle means empty prompt, no spinner and no toast", () => {
    assert.equal(isIdle(idle), true);
    assert.equal(isIdle(busy), false);
    assert.equal(isIdle(typed), false);
    assert.equal(isIdle(toasted), false);
  });

  test("readFrom returns only the bytes after the offset", () => {
    const file = path.join(base, "raw.bin");
    fs.writeFileSync(file, "abcdef");
    assert.equal(readFrom(file, 3).toString(), "def");
    assert.equal(readFrom(file, 6).length, 0);
    assert.equal(readFrom(file, 99).length, 0);
  });
});

describe("settleWrites: a write on the terminal channel waits for the native tool's log line", () => {
  const osc = (kind = "write") => ({ kind, text: "x", validUtf8: true });
  const ctx = { watch: { wait: async () => {} } };
  const scripted = (answers) => {
    let i = 0;
    return () => answers[Math.min(i++, answers.length - 1)];
  };

  test("returns at once when nothing was written on the terminal channel (a refusal)", async () => {
    const collect = scripted([{ osc52: [], writers: [] }]);
    const out = await settleWrites(ctx, {}, { collect });
    assert.deepEqual(out, { polls: 1, settled: true });
  });

  test("returns at once when the native tool has already logged", async () => {
    const collect = scripted([{ osc52: [osc()], writers: [{ name: "pbcopy" }] }]);
    assert.deepEqual(await settleWrites(ctx, {}, { collect }), { polls: 1, settled: true });
  });

  test("waits while only the terminal channel has written, then settles when the log line appears", async () => {
    const collect = scripted([
      { osc52: [osc()], writers: [] }, { osc52: [osc()], writers: [] }, { osc52: [osc()], writers: [{ name: "pbcopy" }] },
    ]);
    assert.deepEqual(await settleWrites(ctx, {}, { collect }), { polls: 3, settled: true });
  });

  test("gives up after the limit and says so", async () => {
    const collect = scripted([{ osc52: [osc()], writers: [] }]);
    const out = await settleWrites(ctx, {}, { collect, maxPolls: 5 });
    assert.deepEqual(out, { polls: 5, settled: false });
  });

  test("a terminal-channel read request is not a write", async () => {
    const collect = scripted([{ osc52: [osc("query")], writers: [] }]);
    assert.deepEqual(await settleWrites(ctx, {}, { collect }), { polls: 1, settled: true });
  });
});

describe("reconcileWrites: no writer call may fall between two cases", () => {
  const withCalls = (n) => ({ writerCalls: Array.from({ length: n }, () => ({ name: "pbcopy" })) });
  test("every shim call attributed", () => {
    assert.deepEqual(reconcileWrites(3, [withCalls(1), withCalls(0), withCalls(2)]), { shimCalls: 3, attributed: 3, unattributed: 0 });
  });
  test("a shim call that no case holds is counted", () => {
    assert.deepEqual(reconcileWrites(4, [withCalls(1), withCalls(2)]), { shimCalls: 4, attributed: 3, unattributed: 1 });
  });
  test("cases without a list count as none, and the count is never negative", () => {
    assert.deepEqual(reconcileWrites(0, [{}, withCalls(1)]), { shimCalls: 0, attributed: 1, unattributed: 0 });
  });
});
