import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { unicodeClasses } from "../lib/unicode-classes.mjs";

const U = (...codes) => String.fromCodePoint(...codes);

describe("unicode classes of a payload", () => {
  test("plain ASCII has none", () => {
    assert.deepEqual(unicodeClasses("plain text, 123, and `code` --"), []);
  });

  test("each class is named by what the text holds", () => {
    assert.deepEqual(unicodeClasses("a — b"), ["emdash"]);
    assert.deepEqual(unicodeClasses(`family ${U(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)}`), ["zwj", "astral"]);
    assert.deepEqual(unicodeClasses("日本語とこんにちは"), ["cjk"]);
    assert.deepEqual(unicodeClasses("café résumé naïve"), ["accent"]);
    assert.deepEqual(unicodeClasses(`flags ${U(0x1f1ee, 0x1f1f3)}`), ["flag", "astral"]);
    assert.deepEqual(unicodeClasses(`e${U(0x301)}`), ["combining"]);
    assert.deepEqual(unicodeClasses(`no${U(0xa0)}break`), ["nbsp"]);
    assert.deepEqual(unicodeClasses("שלום"), ["rtl"]);
    assert.deepEqual(unicodeClasses("rocket 🚀"), ["astral"]);
  });

  test("a check mark or arrow outside the named classes is still non-ASCII, class 'other'", () => {
    assert.deepEqual(unicodeClasses("done ✅ and → next"), ["other"]);
  });

  test("the renderer's quote bar is non-ASCII too but belongs to the screen, so a payload never has it as a class of its own", () => {
    assert.deepEqual(unicodeClasses("▎ quoted"), ["other"]);
  });

  test("several classes come out once each, in a fixed order", () => {
    const text = `Café — 日本語 ${U(0x1f680)} ${U(0x1f468, 0x200d, 0x1f469)}`;
    assert.deepEqual(unicodeClasses(text), ["emdash", "zwj", "cjk", "accent", "astral"]);
  });
});
