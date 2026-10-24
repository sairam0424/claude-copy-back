import { expect, test } from "claude-code/testing";
import {
  COPY_CODE,
  COPY_INDENTED,
  COPY_PROSE,
  COPY_QUOTE,
  PASTE_CODE,
  PASTE_INDENTED,
  PASTE_PROSE,
  PASTE_QUOTE,
  REPLY_CONTAINERS,
  REPLY_MAIN,
  REPLY_OLDER,
  SOURCE_INDENTED,
  SOURCE_QUOTE,
  row,
} from "../cc-fixtures.ts";
import { kit, press, start } from "./engine.ts";

const conversation = [
  row("user", "how do I fix the rollout?"),
  row("assistant", REPLY_OLDER),
  row("user", "and now?"),
  row("assistant", REPLY_MAIN),
];

test("happy path: the paste is what reaches ui.copy, on the first surface", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows: conversation });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_PROSE }]);
});

test("the clipboard is read once, by pbpaste alone, with a short timeout and a UTF-8 locale", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows: conversation });
  await start($);
  await press($);
  expect(k.runs).toHaveLength(1);
  expect(k.runs[0]?.argv).toEqual(["pbpaste"]);
  expect(k.runs[0]?.init).toEqual({
    timeoutMs: 2000,
    env: { LC_ALL: "en_US.UTF-8" },
  });
});

test("the session is read once, for the main conversation, in its plain row form", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows: conversation });
  await start($);
  await press($);
  expect(k.messageAsks).toHaveLength(1);
  const ask = JSON.parse(k.messageAsks[0] ?? "null") as Record<string, unknown>;
  expect(ask.agentId).toBeUndefined();
  expect(ask.as).toBeUndefined();
});

test("a code line comes back without the terminal's margin", async ($, on) => {
  const k = kit(on, { stdout: COPY_CODE, rows: conversation });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_CODE }]);
});

test("a match in an older reply names its rank, and rank 1 is the newest", async ($, on) => {
  const stdout =
    "An older reply about something else entirely, with different words";
  const k = kit(on, { stdout, rows: conversation });
  await start($);
  await press($);
  expect(k.toasts).toHaveLength(1);
  expect(k.toasts[0]).toMatch(/from reply 2 \(1 = newest\)$/);
});

test("the same paragraph in two replies comes from the newest", async ($, on) => {
  const rows = [row("assistant", REPLY_MAIN), row("assistant", REPLY_MAIN)];
  const k = kit(on, { stdout: COPY_PROSE, rows });
  await start($);
  await press($);
  expect(k.toasts[0]).toMatch(/from reply 1 \(1 = newest\)$/);
});

test("only the 40 newest replies are searched", async ($, on) => {
  const filler = Array.from({ length: 40 }, (_, i) =>
    row("assistant", `filler reply number ${i} about nothing in particular`),
  );
  const k = kit(on, {
    stdout: COPY_PROSE,
    rows: [row("assistant", REPLY_MAIN), ...filler],
  });
  await start($);
  await press($);
  expect(k.copies).toHaveLength(0);
  expect(k.toasts).toEqual([
    "copy-back: no match in the last 40 replies, nothing changed",
  ]);
});

test("rows that are not replies are skipped: user rows, tool-only turns, tool results", async ($, on) => {
  const rows = [
    row("assistant", REPLY_MAIN),
    row("assistant", "", [{ name: "Bash" }]),
    {
      role: "user",
      text: "",
      toolUses: [],
      toolResults: [{ text: COPY_PROSE }],
    },
  ];
  const k = kit(on, { stdout: COPY_PROSE, rows });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_PROSE }]);
  expect(k.toasts[0]).toMatch(/from reply 1 /);
});

test("calls happen in order: clipboard, session, write, toast", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows: conversation });
  await start($);
  await press($);
  expect(k.order.slice(1)).toEqual([
    "process.run",
    "session.messages",
    "ui.copy",
    "ui.toast",
  ]);
});

test("running /cc twice gives the same answer both times", async ($, on) => {
  const k = kit(on, { stdout: COPY_PROSE, rows: conversation });
  await start($);
  await press($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_PROSE }, { text: PASTE_PROSE }]);
  expect(k.runs).toHaveLength(2);
});

// ui.copy gets the matcher's paste form, not its exact source slice: they
// differ on the later lines of a blockquote and of indented code.
const containers = [row("assistant", REPLY_CONTAINERS)];

test("a two-line blockquote reaches ui.copy without the quote marker on the later line", async ($, on) => {
  const k = kit(on, { stdout: COPY_QUOTE, rows: containers });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_QUOTE }]);
  expect(k.copies[0]?.text).not.toBe(SOURCE_QUOTE);
  expect(k.copies[0]?.text).not.toContain("\n> ");
});

test("two lines of indented code reach ui.copy without the later line's indentation", async ($, on) => {
  const k = kit(on, { stdout: COPY_INDENTED, rows: containers });
  await start($);
  await press($);
  expect(k.copies).toEqual([{ text: PASTE_INDENTED }]);
  expect(k.copies[0]?.text).not.toBe(SOURCE_INDENTED);
  expect(k.copies[0]?.text).not.toContain("\n ");
});

test("the toast counts the characters of the paste form", async ($, on) => {
  const k = kit(on, { stdout: COPY_QUOTE, rows: containers });
  await start($);
  await press($);
  expect(k.toasts).toEqual([
    `copy-back: copied ${Array.from(PASTE_QUOTE).length} characters from reply 1 (1 = newest)`,
  ]);
});
