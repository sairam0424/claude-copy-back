import { test } from "node:test";
import assert from "node:assert/strict";
import { runCc } from "../hooks/cc.ts";
import { cleanRun, fakes } from "./cc-fakes.ts";
import type { FakeOptions } from "./cc-fakes.ts";
import {
  CANARY,
  COPY_CANARY,
  COPY_STRANGER,
  PASTE_CANARY,
  REPLY_CANARY,
  row,
} from "./cc-fixtures.ts";
import { leaks, seenFrom, withSpies } from "./cc-spies.ts";

// The clipboard text and the message text are private. Only the one write to
// the clipboard may carry them. These tests plant a canary in both and in the
// error messages of every dependency, run every path, and look for it in the
// toasts, the outcome, and whatever a run throws. Every run also happens under
// spies on the console, the standard streams and a global fetch
// (tests/cc-spies.ts): the code under test may not touch them at all.

const rows = [
  row("user", `a question with ${CANARY}`),
  row("assistant", REPLY_CANARY),
];

const scenarios: Record<string, FakeOptions> = {
  "success with the canary inside the paste": { stdout: COPY_CANARY, rows },
  "no match for a stranger": { stdout: COPY_STRANGER, rows },
  "ambiguous-looking short text": { stdout: `short ${CANARY}`, rows },
  "clipboard read fails with a canary in the error": {
    runError: new Error(`pbpaste failed on ${CANARY}`),
    rows,
  },
  "clipboard exits non-zero with the canary in stderr": {
    run: { ...cleanRun(COPY_CANARY), exitCode: 2, stderr: CANARY },
    rows,
  },
  "message read fails with a canary in the error": {
    stdout: COPY_CANARY,
    messagesError: new Error(`denied ${CANARY}`),
  },
  "copy rejects with a canary in the error": {
    stdout: COPY_CANARY,
    rows,
    copyError: new Error(`write failed for ${CANARY}`),
  },
  "copy is refused with a canary in the reason": {
    stdout: COPY_CANARY,
    rows,
    copy: { isCopied: false, reason: `refused ${CANARY}` },
  },
  "toast fails with a canary in the error": {
    stdout: COPY_CANARY,
    rows,
    toastError: new Error(`toast ${CANARY}`),
  },
  "matcher throws with a canary in the error": {
    stdout: COPY_CANARY,
    rows,
    find: () => {
      throw new Error(`bug ${CANARY}`);
    },
  },
  "non-text rows carry the canary": {
    stdout: COPY_CANARY,
    rows: [row("assistant", "", [{ name: "Bash", text: CANARY }]), ...rows],
  },
};

for (const [name, opts] of Object.entries(scenarios)) {
  test(`privacy: ${name}`, async () => {
    const f = fakes(opts);
    const { result: out, calls } = await withSpies(() => runCc(f.deps));
    assert.equal(
      f.toasts.some((t) => t.includes(CANARY)),
      false,
      "a toast",
    );
    assert.equal(JSON.stringify(out).includes(CANARY), false, "the outcome");
    assert.equal(f.log.join(",").includes(CANARY), false, "the call log");
    assert.deepEqual(leaks(calls), [], "a console, stream or fetch call");
  });
}

test("privacy: only the copy payload may carry the text, and only the matched slice", async () => {
  const f = fakes({ stdout: COPY_CANARY, rows });
  await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_CANARY]);
  assert.equal(f.toasts.join("\n").includes("Notes for the team"), false);
});

test("privacy: nothing but the copy is handed the text of a stranger copy", async () => {
  const f = fakes({ stdout: COPY_STRANGER, rows });
  await runCc(f.deps);
  assert.deepEqual(f.copies, []);
  assert.equal(f.toasts.join("\n").includes("Some text"), false);
});

test("privacy: a run never throws, so no error can carry a text", async () => {
  for (const [name, opts] of Object.entries(scenarios)) {
    await assert.doesNotReject(() => runCc(fakes(opts).deps), name);
  }
});

test("privacy: toasts hold digits and fixed words only", async () => {
  for (const opts of Object.values(scenarios)) {
    const f = fakes(opts);
    await runCc(f.deps);
    for (const t of f.toasts) {
      assert.match(t, /^copy-back: [a-z0-9 ,()=-]+$/, t);
    }
  }
});

test("privacy: the spies see a clipboard text sent to the console, a stream or fetch", async () => {
  const sends: Record<string, (text: string) => unknown> = {
    "console.error": (text) => console.error(text),
    "console.log of an object": (text) => console.log({ text }),
    "stdout.write": (text) => process.stdout.write(text),
    "stderr.write": (text) => process.stderr.write(text),
    fetch: (text) => fetch(`http://127.0.0.1:9/${text}`).catch(() => {}),
  };
  for (const [name, send] of Object.entries(sends)) {
    const f = fakes({
      stdout: COPY_CANARY,
      rows,
      find: (copied, messages) => {
        send(copied);
        return { ok: false, reason: "no-match" };
      },
    });
    const { calls } = await withSpies(() => runCc(f.deps));
    assert.equal(leaks(calls).length, 1, name);
    assert.equal(leaks(calls)[0]?.hasCanary, true, name);
  }
});

test("privacy: a call is attributed to the plugin by a stack frame under hooks/ or src/core/", () => {
  const root = new URL("..", import.meta.url).pathname;
  assert.equal(
    seenFrom(`Error\n    at go (file://${root}hooks/cc.ts:114:3)`),
    true,
  );
  assert.equal(
    seenFrom(`Error\n    at go (${root}src/core/match.ts:9:1)`),
    true,
  );
  assert.equal(
    seenFrom(`Error\n    at go (file://${root}tests/cc-fakes.ts:5:1)`),
    false,
  );
  assert.equal(
    seenFrom("Error\n    at node:internal/process/task_queues:105:5"),
    false,
  );
});

test("privacy: the spies put every patched function back", async () => {
  const before = [
    console.error,
    process.stdout.write,
    process.stderr.write,
    globalThis.fetch,
  ];
  await withSpies(async () => {});
  assert.deepEqual(
    [
      console.error,
      process.stdout.write,
      process.stderr.write,
      globalThis.fetch,
    ],
    before,
  );
});
