import { test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { isSuspect, leaks, withSpies } from "./cc-spies.ts";

// The spies (tests/cc-spies.ts) are the third privacy layer, so they get their
// own tests. The 0.1.1 safety review found a print they could not see: the
// code points of the clipboard, from a promise job. A call used to be blamed
// on the plugin only by a stack frame under hooks/ or src/core/ or by the
// verbatim canary; a promise job has no such frame and the code points are
// not the canary. A spied call is now innocent only when its stack positively
// shows Node's own streams or test runner (the runner reporting its results).

const ROOT = new URL("..", import.meta.url).pathname;
const PLUGIN_FRAME = `    at go (file://${ROOT}hooks/cc.ts:114:3)`;
const RUNNER_FRAMES = [
  "    at Writable.write (node:internal/streams/writable:511:14)",
  "    at TestsStream.emit (node:internal/test_runner/tests_stream:80:7)",
];

/** The text a covert channel would carry: the code points of a string, so the string itself never appears. */
const encode = (text: string): string =>
  Array.from(text)
    .map((c) => c.codePointAt(0))
    .join(",");

test("a stack is suspect when a frame is under hooks/ or src/core/", () => {
  assert.equal(isSuspect(`Error\n${PLUGIN_FRAME}`), true);
  assert.equal(
    isSuspect(`Error\n    at go (${ROOT}src/core/match.ts:9:1)`),
    true,
  );
});

test("a stack with no frame that shows the runner is suspect (the default is deny)", () => {
  assert.equal(isSuspect(""), true);
  assert.equal(isSuspect("Error"), true);
  assert.equal(
    isSuspect("Error\n    at node:internal/process/task_queues:105:5"),
    true,
  );
  assert.equal(
    isSuspect(`Error\n    at go (file://${ROOT}tests/cc-fakes.ts:5:1)`),
    true,
  );
});

test("a stack that shows Node's streams or test runner is not suspect", () => {
  for (const frame of RUNNER_FRAMES)
    assert.equal(isSuspect(`Error\n${frame}`), false, frame);
});

test("a plugin frame wins over a runner frame", () => {
  assert.equal(isSuspect(`Error\n${PLUGIN_FRAME}\n${RUNNER_FRAMES[0]}`), true);
});

test("the encoded clipboard printed from a promise job is a leak, and is not passed on", async () => {
  const encoded = encode("zq7 a clipboard text");
  const { calls } = await withSpies(async () => {
    Promise.resolve().then(console.log.bind(console, encoded));
  });
  const found = leaks(calls);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.channel, "console.log");
  assert.equal(found[0]?.hasCanary, false, "the encoded text is not verbatim");
  assert.equal(found[0]?.fromPlugin, false, "a promise job has no plugin frame");
  assert.equal(found[0]?.fromRunner, false);
});

test("a stream write from a promise job is a leak as well", async () => {
  const { calls } = await withSpies(async () => {
    Promise.resolve().then(process.stdout.write.bind(process.stdout, encode("ab")));
  });
  assert.deepEqual(
    leaks(calls).map((c) => c.channel),
    ["stdout.write"],
  );
});

test("a call made later, from a timer, is still seen", async () => {
  const { calls } = await withSpies(async () => {
    setTimeout(console.error.bind(console, encode("later")), 1);
  });
  assert.deepEqual(
    leaks(calls).map((c) => c.channel),
    ["console.error"],
  );
});

test("a call that a Node stream makes while it runs is the runner's, not a leak", async () => {
  const sink = new Writable({
    write(_chunk, _encoding, done) {
      process.stderr.write("");
      done();
    },
  });
  const { calls } = await withSpies(async () => {
    sink.write("x");
  });
  assert.ok(
    calls.some((c) => c.channel === "stderr.write" && c.fromRunner),
    "the stream's write was seen",
  );
  assert.deepEqual(leaks(calls), []);
});

test("the spies are put back after a throw", async () => {
  const before = [console.log, process.stdout.write];
  await assert.rejects(
    withSpies(async () => {
      throw new Error("inside");
    }),
    /inside/,
  );
  assert.deepEqual([console.log, process.stdout.write], before);
});
