import { expect, test } from "claude-code/testing";
import { COPY_PROSE, PASTE_PROSE, REPLY_MAIN, row } from "../cc-fixtures.ts";
import { isEmptyAnswer, kit, press, start } from "./engine.ts";
import type { KitOptions } from "./engine.ts";

const rows = [row("user", "how?"), row("assistant", REPLY_MAIN)];

test("session.start declares /cc: immediate, with a description, once", async ($, on) => {
  const k = kit(on);
  await start($);
  expect(k.specs).toHaveLength(1);
  expect(k.specs[0]?.name).toBe("cc");
  expect(k.specs[0]?.immediate).toBe(true);
  expect(k.specs[0]?.description).toMatch(/copied/);
  expect(k.runs).toHaveLength(0);
  expect(k.toasts).toHaveLength(0);
});

test("a refused declaration does not break the session start", async ($, on) => {
  const k = kit(on, { registerDeny: "name taken" });
  await expect(start($)).resolves.toBeUndefined();
  expect(k.toasts).toEqual(["copy-back: could not register /cc"]);
  expect(k.trapped).toHaveLength(0);
});

test("/cc returns exactly {} on a copy, so no line reaches the transcript or the model", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows });
  await start($);
  const result = await press($);
  expect(result).toEqual({});
  expect(isEmptyAnswer(result)).toBe(true);
  expect(k.copies).toHaveLength(1);
});

const REFUSED_CASES: Record<string, KitOptions> = {
  "too short": { stdout: "short", rows },
  "no match": { stdout: "no such text in any reply at all", rows },
  "empty clipboard": { stdout: "" },
  "pbpaste cannot start": { runDeny: "cannot start" },
  "pbpaste stub crashes": { runThrow: "crashed" },
  "session unreadable": { stdout: COPY_PROSE, rowsDeny: "nope" },
  "copy refused": { stdout: COPY_PROSE, rows, copyDeny: "refused by a hook" },
  "toast fails": { stdout: COPY_PROSE, rows, toastThrow: "no ui" },
};

for (const [name, opts] of Object.entries(REFUSED_CASES)) {
  test(`/cc returns exactly {} when ${name}`, async ($, on) => {
    kit(on, opts);
    await start($);
    const result = await press($);
    expect(result).toEqual({});
    expect(isEmptyAnswer(result)).toBe(true);
  });
}

test("/cc makes no model call, no prompt, no session write, no log, no storage, no file, no network", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows });
  await start($);
  await press($);
  expect(k.trapped).toEqual([]);
  expect(k.order).toEqual([
    "command.register",
    "process.run",
    "session.messages",
    "ui.copy",
    "ui.toast",
  ]);
});

test("the copy is the exact paste and the toast reports counts only", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_PROSE }]);
  expect(k.toasts).toEqual([
    `copy-back: copied ${PASTE_PROSE.length} characters from reply 1 (1 = newest)`,
  ]);
});
