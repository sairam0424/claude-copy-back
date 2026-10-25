import { test } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { runCc } from "../hooks/cc.ts";
import { fakes } from "./cc-fakes.ts";
import {
  COPY_INDENTED,
  COPY_PROSE,
  COPY_QUOTE,
  PASTE_INDENTED,
  PASTE_PROSE,
  PASTE_QUOTE,
  REPLY_CONTAINERS,
  REPLY_MAIN,
  SOURCE_INDENTED,
  SOURCE_QUOTE,
  row,
} from "./cc-fixtures.ts";

// /cc writes the matcher's `paste`, never its `source`. The two are equal for
// a single line and for prose, which is all most fixtures hold, so a run that
// wrote `source` passed every earlier test. These use selections where they
// differ: later lines of a blockquote and of indented code.

const rows = [row("assistant", REPLY_CONTAINERS)];

test("the fixtures really are a case where source and paste differ", () => {
  for (const [copy, source, paste] of [
    [COPY_QUOTE, SOURCE_QUOTE, PASTE_QUOTE],
    [COPY_INDENTED, SOURCE_INDENTED, PASTE_INDENTED],
  ] as const) {
    const found = findSource(copy, [REPLY_CONTAINERS]);
    assert.equal(found.ok, true);
    assert.equal(found.ok && found.source, source);
    assert.equal(found.ok && found.paste, paste);
    assert.notEqual(source, paste);
  }
});

test("a two-line blockquote is written without the quote marker on the later line", async () => {
  const f = fakes({ stdout: COPY_QUOTE, rows });
  await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_QUOTE]);
  assert.notEqual(f.copies[0], SOURCE_QUOTE);
  assert.equal(f.copies[0]?.includes("\n> "), false);
});

test("two lines of indented code are written without the later line's indentation", async () => {
  const f = fakes({ stdout: COPY_INDENTED, rows });
  await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_INDENTED]);
  assert.notEqual(f.copies[0], SOURCE_INDENTED);
  assert.equal(f.copies[0]?.includes("\n "), false);
});

test("the toast counts the characters written, which are the paste's, not the source's", async () => {
  for (const [copy, paste, source] of [
    [COPY_QUOTE, PASTE_QUOTE, SOURCE_QUOTE],
    [COPY_INDENTED, PASTE_INDENTED, SOURCE_INDENTED],
  ] as const) {
    const f = fakes({ stdout: copy, rows });
    const out = await runCc(f.deps);
    assert.equal(out.copied && out.chars, Array.from(paste).length);
    assert.notEqual(Array.from(paste).length, Array.from(source).length);
    assert.match(
      f.toasts[0] ?? "",
      new RegExp(`copied ${paste.length} chars `),
    );
  }
});

test("a single line and prose are written as before (source and paste agree there)", async () => {
  const f = fakes({ stdout: COPY_PROSE, rows: [row("assistant", REPLY_MAIN)] });
  await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_PROSE]);
});

test("a matcher answer with an empty or missing paste is never written", async () => {
  const answers = [
    {
      ok: true,
      source: "kept",
      paste: "",
      messageIndex: 0,
      start: 0,
      end: 4,
      projectedChars: 4,
      candidates: 1,
    },
    {
      ok: true,
      source: "kept",
      messageIndex: 0,
      start: 0,
      end: 4,
      projectedChars: 4,
      candidates: 1,
    },
    {
      ok: true,
      source: "kept",
      paste: 7,
      messageIndex: 0,
      start: 0,
      end: 4,
      projectedChars: 4,
      candidates: 1,
    },
  ];
  for (const answer of answers) {
    const f = fakes({ stdout: COPY_PROSE, rows, find: () => answer as never });
    const out = await runCc(f.deps);
    assert.deepEqual(f.copies, []);
    assert.equal(!out.copied && out.reason, "no-match");
  }
});

test("only a copy answer of exactly isCopied: true counts as written", async () => {
  for (const isCopied of ["yes", 1, "true", {}, null, undefined]) {
    const f = fakes({ stdout: COPY_QUOTE, rows, copy: { isCopied } });
    const out = await runCc(f.deps);
    assert.equal(out.copied, false, String(isCopied));
    assert.match(f.toasts[0] ?? "", /write failed/);
  }
});
