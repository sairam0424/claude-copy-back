import { test } from "node:test";
import assert from "node:assert/strict";
import { runCc } from "../hooks/cc.ts";
import { MAX_REPLIES } from "../hooks/outcome.ts";
import { findSource } from "../src/core/match.ts";
import { fakes } from "./cc-fakes.ts";
import { COPY_PROSE, REPLY_MAIN, REPLY_OLDER, row } from "./cc-fixtures.ts";

// Guards on the edges of a /cc run that the main run tests do not reach: the
// reply window the toast names, an engine answer that is truthy but not true,
// and a match whose paste is empty. Each pins behaviour that was correct and
// unpinned (mutants that passed every suite).

const conversation = [
  row("user", "how do I fix the rollout?"),
  row("assistant", REPLY_OLDER),
  row("user", "and now?"),
  row("assistant", REPLY_MAIN),
];

test("the reply window the toast speaks of is the window the real matcher searches", async () => {
  // outcome.ts says "the last N replies" with N = MAX_REPLIES; the matcher has
  // its own default window. Probe the matcher for its window and compare.
  const sentence = "The sentence that sits in exactly one reply of the window";
  const newestFirst = (at: number) =>
    Array.from({ length: 80 }, (_, i) =>
      i === at ? sentence : `filler reply number ${i}`,
    );
  let window = 0;
  while (window < 80 && findSource(sentence, newestFirst(window)).ok) window++;
  assert.equal(
    window,
    MAX_REPLIES,
    "the matcher's window differs from the toast's",
  );

  // And through a run: the oldest reply of the window is found, one further back is not.
  const rows = (at: number) =>
    newestFirst(at)
      .map((t) => row("assistant", t))
      .reverse();
  const held = fakes({ stdout: sentence, rows: rows(MAX_REPLIES - 1) });
  const found = await runCc(held.deps);
  assert.equal(found.copied && found.rank, MAX_REPLIES);
  const outside = fakes({ stdout: sentence, rows: rows(MAX_REPLIES) });
  const refused = await runCc(outside.deps);
  assert.equal(!refused.copied && refused.reason, "no-match");
  assert.deepEqual(outside.toasts, [
    `no match in last ${MAX_REPLIES} replies, nothing changed`,
  ]);
});

test("a copy answer whose isCopied is truthy but not true is a failed write", async () => {
  for (const isCopied of ["yes", 1, {}, [], "true"]) {
    const f = fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copy: { isCopied },
    });
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "copy-failed", String(isCopied));
    assert.deepEqual(f.toasts, ["clipboard write failed"]);
  }
});

test("a match whose paste is empty or not text writes nothing and reads as no match", async () => {
  for (const paste of ["", undefined, 5, null]) {
    const f = fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      find: () =>
        ({
          ok: true,
          source: "x",
          paste,
          messageIndex: 0,
          start: 0,
          end: 1,
          projectedChars: 12,
          candidates: 1,
        }) as never,
    });
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "no-match", String(paste));
    assert.deepEqual(f.copies, []);
    assert.equal(f.count("copy"), 0);
    assert.deepEqual(f.toasts, ["no match in last 2 replies, nothing changed"]);
  }
});
