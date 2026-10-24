import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { project } from "../src/core/project.ts";
import { copySpan } from "../src/sim/copy.ts";
import { trueSlice } from "../src/sim/truth.ts";
import { assertHit, WIDTHS } from "../src/sim/testkit.ts";

// The bullet glyph and the numbering style are the simulator's least certain
// guesses. The matcher must still return the exact source slice when the real
// renderer draws a different marker, or none at all.

const LIST =
  "Steps to follow:\n\n" +
  "- alpha bravo charlie delta echo foxtrot golf hotel india juliet\n" +
  "  - nested kilo lima mike november oscar papa quebec romeo sierra\n" +
  "- tango uniform victor whiskey xray yankee zulu apple banana cherry\n" +
  "\nClosing words after the list for good measure.";

/** The renderer drew `bullet`; the matcher only knows its default. */
function copyWithBullet(
  source: string,
  bullet: string,
  width: number,
  fromText: string,
  toText: string,
) {
  const p = project(source, { width, bullet });
  const from = p.projected.indexOf(fromText);
  assert.ok(from >= 0, `anchor ${fromText}`);
  const to = p.projected.indexOf(toText, from) + toText.length;
  return {
    copied: copySpan(p, from, to, { width, marginOnFirstRow: true }),
    expected: trueSlice(source, p, from, to),
  };
}

describe("a different bullet glyph than the simulator's", () => {
  for (const bullet of ["-", "*", "◦", "▪", "–"]) {
    for (const width of WIDTHS) {
      test(`bullet ${bullet} @ ${width}: copy starting inside an item`, () => {
        const made = copyWithBullet(
          LIST,
          bullet,
          width,
          "foxtrot golf",
          "zulu apple",
        );
        assert.ok(
          made.copied.includes(`${bullet} nested`) ||
            made.copied.includes(`${bullet} tango`),
        );
        const result = findSource(made.copied, [LIST]);
        assertHit(result, [LIST]);
        assert.equal(result.source, made.expected);
      });

      test(`bullet ${bullet} @ ${width}: copy starting AT a bullet keeps the source marker`, () => {
        const made = copyWithBullet(
          LIST,
          bullet,
          width,
          `${bullet} nested`,
          "papa quebec",
        );
        assert.ok(made.copied.trimStart().startsWith(bullet));
        const result = findSource(made.copied, [LIST]);
        assertHit(result, [LIST]);
        assert.equal(result.source, made.expected);
        assert.ok(result.source.startsWith("- nested"), result.source);
      });
    }
  }
});

// Some renderers draw list bullets with the same glyph as the reply bullet
// ("●", "⏺"). A copy that starts at such a bullet, or ends on one, must keep
// the source marker: stripping the glyph as a reply bullet must not silently
// shorten the answer.
describe("a list bullet that looks like the reply bullet", () => {
  for (const bullet of ["●", "⏺"]) {
    for (const width of WIDTHS) {
      test(`${bullet} @ ${width}: a copy starting AT the bullet keeps the source marker`, () => {
        const made = copyWithBullet(LIST, bullet, width, `${bullet} nested`, "papa quebec");
        assert.ok(made.copied.trimStart().startsWith(bullet));
        const result = findSource(made.copied, [LIST]);
        assertHit(result, [LIST]);
        assert.equal(result.source, made.expected);
        assert.ok(result.source.startsWith("- nested"), result.source);
      });

      test(`${bullet} @ ${width}: a copy ending ON the next bullet keeps the source marker`, () => {
        const p = project(LIST, { width, bullet });
        const from = p.projected.indexOf("romeo sierra");
        const to = p.projected.indexOf(bullet, from) + 1;
        const copied = copySpan(p, from, to, { width, marginOnFirstRow: true });
        assert.ok(copied.trimEnd().endsWith(bullet), JSON.stringify(copied));
        const result = findSource(copied, [LIST]);
        assertHit(result, [LIST]);
        assert.equal(result.source, trueSlice(LIST, p, from, to));
        assert.ok(result.source.endsWith("-"), result.source);
      });
    }
  }

  for (const bullet of ["●", "⏺"]) {
    for (const width of WIDTHS) {
      test(`${bullet} @ ${width}: a marker inside the copy and another bullet at its end`, () => {
        const p = project(LIST, { width, bullet });
        const from = p.projected.indexOf("india juliet");
        const tango = p.projected.indexOf(`${bullet} tango`);
        const copied = copySpan(p, from, tango + 1, { width, marginOnFirstRow: true });
        assert.ok(copied.includes(`${bullet} nested`), JSON.stringify(copied));
        assert.ok(copied.trimEnd().endsWith(bullet), JSON.stringify(copied));
        const result = findSource(copied, [LIST]);
        assertHit(result, [LIST]);
        assert.equal(result.source, trueSlice(LIST, p, from, tango + 1));
        assert.ok(result.source.endsWith("-"), result.source);
      });
    }
  }

  test("a genuine reply bullet before ordinary text is still dropped", () => {
    const source = "Plain paragraph that starts the reply and goes on for a while.";
    const result = findSource("  ⏺ Plain paragraph that starts the reply", [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "Plain paragraph that starts the reply");
  });

  test("a bullet-like glyph right before the text of a list item is taken as that item's marker", () => {
    // Indistinguishable from a reply bullet, so the rule is: if a real list
    // marker sits right there, the glyph was the marker.
    const source = "- alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const result = findSource("  ● alpha bravo charlie delta echo foxtrot", [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "- alpha bravo charlie delta echo foxtrot");
  });

  test("with no list marker there, the glyph is plain decoration", () => {
    const source = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    const result = findSource("  ● alpha bravo charlie delta echo foxtrot", [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "alpha bravo charlie delta echo foxtrot");
  });
});

describe("another numbering style", () => {
  const source =
    "1. alpha bravo charlie delta\n2. echo foxtrot golf hotel\n3. india juliet kilo lima";

  test("letters instead of numbers", () => {
    const result = findSource(
      "  a. alpha bravo charlie delta\n  b. echo foxtrot golf hotel",
      [source],
    );
    assertHit(result, [source]);
    assert.equal(
      result.source,
      "1. alpha bravo charlie delta\n2. echo foxtrot golf hotel",
    );
  });

  test("parenthesis and roman numerals", () => {
    const result = findSource(
      "  i) alpha bravo charlie delta\n  ii) echo foxtrot golf hotel",
      [source],
    );
    assertHit(result, [source]);
    assert.equal(
      result.source,
      "1. alpha bravo charlie delta\n2. echo foxtrot golf hotel",
    );
  });

  test("a copy that starts after the first marker does not reach back for it", () => {
    const result = findSource("charlie delta\n  b. echo foxtrot golf", [
      source,
    ]);
    assertHit(result, [source]);
    assert.equal(result.source, "charlie delta\n2. echo foxtrot golf");
  });
});

describe("a renderer that draws no marker at all", () => {
  test("the slice still carries the source markers inside it", () => {
    const result = findSource(
      "  alpha bravo charlie delta echo foxtrot\n  golf hotel india juliet",
      [LIST],
    );
    assertHit(result, [LIST]);
    assert.equal(
      result.source,
      "alpha bravo charlie delta echo foxtrot golf hotel india juliet",
    );
  });

  test("across two items", () => {
    const result = findSource(
      "  romeo sierra\n  tango uniform victor whiskey xray",
      [LIST],
    );
    assertHit(result, [LIST]);
    assert.equal(
      result.source,
      "romeo sierra\n- tango uniform victor whiskey xray",
    );
  });
});

describe("a stray token before a real marker", () => {
  test("a tail like 'r.' on the first row is kept as text, not mistaken for a marker", () => {
    const source = "- first item ends with a short letter.\n- second item continues with several words here";
    const p = project(source, { width: 60, bullet: "◦" });
    const from = p.projected.indexOf("r.\n◦ second");
    assert.ok(from >= 0);
    const to = p.projected.indexOf("several words", from) + "several words".length;
    const copied = copySpan(p, from, to, { width: 60 });
    assert.ok(copied.includes("◦ second"));
    const result = findSource(copied, [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "r.\n- second item continues with several words");
  });
});

describe("a copy that ends on the next item's marker", () => {
  test("the marker is taken into the slice", () => {
    const copied = "  - nested kilo lima mike november oscar papa quebec romeo sierra\n  -";
    const result = findSource(copied, [LIST]);
    assertHit(result, [LIST]);
    assert.equal(result.source, "- nested kilo lima mike november oscar papa quebec romeo sierra\n-");
  });

  test("a trailing marker-like token that is not a list marker is refused", () => {
    const source = "Some prose that has a dash at the end of a line\nand then continues on.";
    const copied = "  Some prose that has a dash at the end of a line\n  -";
    assert.deepEqual(findSource(copied, [source]), { ok: false, reason: "no-match" });
  });
});

describe("the fallback never beats a literal match", () => {
  test("code that really starts rows with dashes matches verbatim", () => {
    const source =
      "Config:\n\n```yaml\nitems:\n- name: first-one\n- name: second-one\n```";
    const result = findSource("items:\n- name: first-one\n- name: second-one", [
      source,
    ]);
    assertHit(result, [source]);
    assert.equal(
      result.source,
      "items:\n- name: first-one\n- name: second-one",
    );
  });

  test("a leading dash that is not a source list marker is refused, never silently dropped", () => {
    const source = "Plain paragraph: some words that are long enough to search for.";
    assert.deepEqual(findSource("- some words that are long enough", [source]), { ok: false, reason: "no-match" });
  });

  test("a text row that merely looks like a marker is refused rather than truncated", () => {
    const source = "Intro line that is plain.\n2. not a list because it cannot interrupt a paragraph, just text words";
    const copied = "  2. not a list because it cannot interrupt a paragraph, just text words";
    const result = findSource(copied, [source]);
    assertHit(result, [source]);
    assert.equal(result.source, "2. not a list because it cannot interrupt a paragraph, just text words");
  });

  test("an ambiguous marker-free match is still ambiguous", () => {
    const source =
      "- repeat this phrase exactly\n- repeat **this** phrase exactly";
    assert.deepEqual(findSource("repeat this phrase exactly", [source]), {
      ok: false,
      reason: "ambiguous",
    });
  });

  test("text from outside the session still does not match", () => {
    assert.deepEqual(
      findSource(
        "  - a completely different bullet list item\n  - and another one here",
        [LIST],
      ),
      { ok: false, reason: "no-match" },
    );
  });
});
