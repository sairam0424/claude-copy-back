import { expect, test } from "claude-code/testing";
import {
  COPY_PROSE,
  COPY_TWICE,
  REPLY_MAIN,
  REPLY_TWICE,
  row,
} from "../cc-fixtures.ts";
import { isEmptyAnswer, kit, press, start } from "./engine.ts";
import type { KitOptions } from "./engine.ts";

// Every way /cc can end without writing the clipboard. For each: ui.copy is
// never called, one counts-only line is shown, nothing forbidden is touched,
// and the command still answers nothing.

const rows = [row("user", "how?"), row("assistant", REPLY_MAIN)];
const UNCHANGED = ", nothing changed";

type Case = { opts: KitOptions; toast: string };

const REFUSALS: Record<string, Case> = {
  "copied text too short": {
    opts: { stdout: "short", rows },
    toast: `copied text under 12 chars${UNCHANGED}`,
  },
  "no match in any reply": {
    opts: { stdout: "text from another application entirely", rows },
    toast: `no match in the last reply${UNCHANGED}`,
  },
  "ambiguous between two places": {
    opts: {
      stdout: COPY_TWICE,
      rows: [row("assistant", REPLY_TWICE)],
    },
    toast: `matches more than one place${UNCHANGED}`,
  },
  "empty pbpaste output": {
    opts: { stdout: "", rows },
    toast: `clipboard is empty${UNCHANGED}`,
  },
  "whitespace-only pbpaste output": {
    opts: { stdout: " \n\t ", rows },
    toast: `clipboard is empty${UNCHANGED}`,
  },
  "pbpaste exit code non-zero": {
    opts: { stdout: COPY_PROSE, exitCode: 1, rows },
    toast: `could not read the clipboard${UNCHANGED}`,
  },
  "pbpaste cannot start (the call rejects)": {
    opts: { runDeny: "spawn pbpaste ENOENT", rows },
    toast: `could not read the clipboard${UNCHANGED}`,
  },
  "pbpaste times out (the call rejects)": {
    opts: { runDeny: "timed out after 2000 ms", rows },
    toast: `could not read the clipboard${UNCHANGED}`,
  },
  "the process stub itself crashes": {
    opts: { runThrow: "a lower hook crashed", rows },
    toast: `could not read the clipboard${UNCHANGED}`,
  },
  "pbpaste output over the bound": {
    opts: { stdout: "a".repeat(200_001), rows },
    toast: `clipboard over 200000 chars${UNCHANGED}`,
  },
  "pbpaste output cut by the engine's own cap": {
    opts: { stdout: COPY_PROSE, isStdoutTruncated: true, rows },
    toast: `clipboard over 200000 chars${UNCHANGED}`,
  },
  "session.messages is empty": {
    opts: { stdout: COPY_PROSE, rows: [] },
    toast: `no replies to search${UNCHANGED}`,
  },
  "session.messages rejects": {
    opts: { stdout: COPY_PROSE, rowsDeny: "no transcript" },
    toast: `could not read the session${UNCHANGED}`,
  },
  "only non-text rows": {
    opts: {
      stdout: COPY_PROSE,
      rows: [
        row("assistant", "", [{ name: "Bash", text: COPY_PROSE }]),
        { role: "user", text: "", toolUses: [], toolResults: [{ text: "x" }] },
      ],
    },
    toast: `no replies to search${UNCHANGED}`,
  },
};

for (const [name, c] of Object.entries(REFUSALS)) {
  test(`refusal: ${name}`, async ($, on) => {
    const k = kit(on, c.opts);
    await start($);
    const result = await press($);
    expect(isEmptyAnswer(result)).toBe(true);
    expect(k.copies).toEqual([]);
    expect(k.order).not.toContain("ui.copy");
    expect(k.toasts).toEqual([c.toast]);
    expect(k.trapped).toEqual([]);
  });
}

test("refusal: a clipboard that cannot be read leaves the session unread", async ($, on) => {
  const k = kit(on, { runDeny: "cannot start", rows });
  await start($);
  await press($);
  expect(k.order).not.toContain("session.messages");
});

test("refusal: an empty clipboard leaves the session unread", async ($, on) => {
  const k = kit(on, { stdout: "", rows });
  await start($);
  await press($);
  expect(k.order).not.toContain("session.messages");
});

// The copy was asked for and the engine said no: the write is attempted once,
// the toast says why in the engine's own closed word, and nothing is retried.

const WRITE_ANSWERS = ["no-surface", "no-clipboard", "refused"] as const;

for (const reason of WRITE_ANSWERS) {
  test(`ui.copy answers not copied (${reason}): one attempt, the reason word shown`, async ($, on) => {
    const k = kit(on, {
      stdout: COPY_PROSE,
      rows,
      copyValue: { isCopied: false, reason },
    });
    await start($);
    const result = await press($);
    expect(isEmptyAnswer(result)).toBe(true);
    expect(k.copies).toHaveLength(1);
    expect(k.toasts).toEqual([`clipboard write was refused (${reason})`]);
  });
}

test("ui.copy rejects: one attempt, a failed-write line, nothing retried", async ($, on) => {
  const k = kit(on, {
    stdout: COPY_PROSE,
    rows,
    copyDeny: "a hook above said no",
  });
  await start($);
  const result = await press($);
  expect(isEmptyAnswer(result)).toBe(true);
  expect(k.copies).toHaveLength(1);
  expect(k.toasts).toEqual(["clipboard write failed"]);
});

test("a toast that throws does not undo the write or change the answer", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows, toastThrow: "no surface" });
  await start($);
  const result = await press($);
  expect(isEmptyAnswer(result)).toBe(true);
  expect(k.copies).toHaveLength(1);
});
