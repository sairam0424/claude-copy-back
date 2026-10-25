import { expect, test } from "claude-code/testing";
import { COPY_UNICODE, REPLY_UNICODE, row } from "../cc-fixtures.ts";
import { kit, press, start } from "./engine.ts";

// K3, first half: text with accents, a dash, an arrow, CJK and emoji goes in
// through the clipboard read and comes out of ui.copy character for character.
// The kit moves strings, not bytes, so this proves the mod does not alter,
// split or re-encode a character; the byte-level half (pbpaste's locale,
// the engine's clipboard write) is the live pass.

function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function codePoints(text: string): number[] {
  return Array.from(text, (ch) => ch.codePointAt(0) ?? -1);
}

test("non-ASCII round trip: accents, dash, arrow, CJK and emoji arrive exactly", async ($, on) => {
  const k = kit(on, {
    stdout: COPY_UNICODE,
    rows: [row("assistant", REPLY_UNICODE)],
  });
  await start($);
  await press($);
  expect(k.copies).toHaveLength(1);
  const sent = k.copies[0]?.text ?? "";
  expect(sent).toBe(REPLY_UNICODE);
  expect(codePoints(sent)).toEqual(codePoints(REPLY_UNICODE));
  expect(utf8Length(sent)).toBe(utf8Length(REPLY_UNICODE));
  expect(utf8Length(sent)).toBeGreaterThan(sent.length);
});

test("the toast counts characters, not UTF-16 units: an emoji is one", async ($, on) => {
  const k = kit(on, {
    stdout: COPY_UNICODE,
    rows: [row("assistant", REPLY_UNICODE)],
  });
  await start($);
  await press($);
  const characters = Array.from(REPLY_UNICODE).length;
  expect(characters).toBeLessThan(REPLY_UNICODE.length);
  expect(k.toasts).toEqual([
    `copied ${characters} chars from reply 1 (1 = newest)`,
  ]);
});

const SPECIMENS: Record<string, string> = {
  "a flag, a family and a skin tone (joined sequences)":
    "Sent from 🇮🇳 with 👨‍👩‍👧 and a wave 👋🏽 at the end of this sentence today.",
  "combining marks kept as written (e plus U+0301)":
    "The cafe\u0301 on the corner serves re\u0301sume\u0301 review sessions every morning.",
  "wide CJK with no spaces at all":
    "これは日本語の長い文章で、スペースがまったくありません。それでも正確に戻ります。",
  "a right-to-left phrase inside English":
    "The word שלום means peace in Hebrew and is written right to left on the page.",
  "arrows, dashes, quotes and a non-breaking space":
    "Step one \u2192 step two \u2014 \u201cquoted\u201d text with a\u00a0fixed space and \u2026 dots.",
};

for (const [name, source] of Object.entries(SPECIMENS)) {
  test(`round trip: ${name}`, async ($, on) => {
    const k = kit(on, {
      stdout: `  ${source}`,
      rows: [row("assistant", source)],
    });
    await start($);
    await press($);
    expect(k.copies).toHaveLength(1);
    expect(codePoints(k.copies[0]?.text ?? "")).toEqual(codePoints(source));
  });
}
