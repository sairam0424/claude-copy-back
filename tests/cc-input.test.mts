import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyClip, selectReplies } from "../hooks/input.ts";
import { MAX_CLIPBOARD_CHARS, MAX_REPLIES } from "../hooks/outcome.ts";
import { row } from "./cc-fixtures.ts";

const ok = (stdout: string) => ({
  exitCode: 0,
  stdout,
  stderr: "",
  isStdoutTruncated: false,
  isStderrTruncated: false,
});

test("classifyClip: a clean run gives the text, untouched", () => {
  const text = "  two spaces\n  and a wrap  \n";
  assert.deepEqual(classifyClip(ok(text)), { ok: true, text });
});

test("classifyClip: an empty or blank clipboard is empty", () => {
  for (const blank of ["", " ", "\n", " \t\r\n "]) {
    assert.deepEqual(classifyClip(ok(blank)), { ok: false, reason: "empty" });
  }
});

test("classifyClip: a non-zero exit code is unreadable, even with output", () => {
  const run = { ...ok("some text that is here"), exitCode: 1 };
  assert.deepEqual(classifyClip(run), { ok: false, reason: "unreadable" });
});

test("classifyClip: a truncated read is too large, never a partial text", () => {
  const run = { ...ok("partial"), isStdoutTruncated: true };
  assert.deepEqual(classifyClip(run), { ok: false, reason: "too-large" });
});

test("classifyClip: the character bound is inclusive, one over is too large", () => {
  const atBound = "a".repeat(MAX_CLIPBOARD_CHARS);
  assert.equal(classifyClip(ok(atBound)).ok, true);
  const over = "a".repeat(MAX_CLIPBOARD_CHARS + 1);
  assert.deepEqual(classifyClip(ok(over)), { ok: false, reason: "too-large" });
});

test("classifyClip: the bound counts characters, not UTF-16 units (an emoji is one)", () => {
  const emoji = "\u{1F600}";
  assert.equal(emoji.length, 2);
  const atBound = emoji.repeat(MAX_CLIPBOARD_CHARS);
  assert.equal(atBound.length, 2 * MAX_CLIPBOARD_CHARS);
  assert.equal(classifyClip(ok(atBound)).ok, true);
  const over = emoji.repeat(MAX_CLIPBOARD_CHARS + 1);
  assert.deepEqual(classifyClip(ok(over)), { ok: false, reason: "too-large" });
});

test("classifyClip: the character bound holds for text that mixes one- and two-unit characters", () => {
  const mixed = (astral: number, plain: number) =>
    "\u{1F600}".repeat(astral) + "x".repeat(plain);
  const half = MAX_CLIPBOARD_CHARS / 2;
  assert.equal(classifyClip(ok(mixed(half, half))).ok, true);
  assert.deepEqual(classifyClip(ok(mixed(half, half + 1))), {
    ok: false,
    reason: "too-large",
  });
  assert.deepEqual(classifyClip(ok(mixed(half + 1, half))), {
    ok: false,
    reason: "too-large",
  });
});

test("classifyClip: a text of more than twice the bound in units is too large without counting it", () => {
  const huge = "a".repeat(2 * MAX_CLIPBOARD_CHARS + 1);
  assert.deepEqual(classifyClip(ok(huge)), { ok: false, reason: "too-large" });
});

test("classifyClip: a malformed answer is unreadable, not a crash", () => {
  const malformed: unknown[] = [
    undefined,
    null,
    "text",
    42,
    [],
    {},
    { exitCode: 0 },
    { exitCode: 0, stdout: 5 },
    { exitCode: "0", stdout: "text here" },
    { stdout: "text here" },
  ];
  for (const run of malformed) {
    assert.deepEqual(classifyClip(run), { ok: false, reason: "unreadable" });
  }
});

test("selectReplies: assistant text only, newest first", () => {
  const rows = [
    row("assistant", "first"),
    row("user", "a question"),
    row("assistant", "second"),
    row("assistant", "third"),
  ];
  assert.deepEqual(selectReplies(rows), ["third", "second", "first"]);
});

test("selectReplies: rows without text are skipped (tool-only turns)", () => {
  const rows = [
    row("assistant", "kept one"),
    row("assistant", "", [{ name: "Bash" }]),
    row("assistant", "   \n"),
    row("assistant", "kept two"),
  ];
  assert.deepEqual(selectReplies(rows), ["kept two", "kept one"]);
});

test("selectReplies: keeps the newest MAX_REPLIES and no more", () => {
  const rows = Array.from({ length: MAX_REPLIES + 10 }, (_, i) =>
    row("assistant", `reply number ${i}`),
  );
  const picked = selectReplies(rows);
  assert.equal(picked.length, MAX_REPLIES);
  assert.equal(picked[0], `reply number ${MAX_REPLIES + 9}`);
  assert.equal(picked[MAX_REPLIES - 1], "reply number 10");
});

test("selectReplies: malformed rows are skipped, never thrown on", () => {
  const rows: unknown[] = [
    null,
    undefined,
    7,
    "text",
    {},
    { role: "assistant" },
    { role: "assistant", text: 5 },
    { role: "assistant", text: null },
    { role: "user", text: "from the user" },
    { role: "assistant", text: "the only reply" },
  ];
  assert.deepEqual(selectReplies(rows), ["the only reply"]);
});

test("selectReplies: does not change its input", () => {
  const rows = [row("assistant", "one"), row("assistant", "two")];
  const before = JSON.stringify(rows);
  selectReplies(rows);
  assert.equal(JSON.stringify(rows), before);
});

test("selectReplies: an empty list stays empty", () => {
  assert.deepEqual(selectReplies([]), []);
});
