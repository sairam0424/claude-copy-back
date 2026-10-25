import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { breakConflict } from "../src/core/fit.ts";
import { findSource } from "../src/core/match.ts";
import { projectText } from "../src/core/project.ts";

// Claude Code ends every row itself, and it draws a line break of the source as a
// row break (a newline inside bold, italic or a link label too; sealed-rig probe,
// 2.1.310). So a copy that spans rows has a newline wherever the source of the
// message it came from has one. Two messages with the same words and different
// line breaks (a twin, wrapped at another place) are told apart by that, which
// the indentation check cannot do for a list item that wraps. A copy with no
// newline at all says nothing about the breaks and is left alone.

describe("breakConflict: a source break the copy does not have", () => {
  test("the copy breaks where the message breaks, and more: no conflict", () => {
    assert.equal(breakConflict("one two\nthree four", "one two\nthree four"), false);
    assert.equal(breakConflict("one\ntwo\nthree four", "one two\nthree four"), false);
  });

  test("the message breaks where the copy runs on: conflict", () => {
    assert.equal(breakConflict("one two three\nfour five", "one two\nthree four five"), true);
  });

  test("a copy with no newline at all says nothing", () => {
    assert.equal(breakConflict("one two three four", "one two\nthree four"), false);
  });

  test("texts that do not split into the same words say nothing", () => {
    assert.equal(breakConflict("a b\nc", "a\nb c d"), false);
  });

  test("indentation after a break is not the question: any newline will do", () => {
    assert.equal(breakConflict("one two\n      three", "one two\nthree"), false);
  });
});

describe("a newline inside an inline code span is drawn as a space; elsewhere it is a break", () => {
  const shown = (s: string) => projectText(s).projected;
  test("code span", () => {
    assert.equal(shown("a `first\nsecond` b"), "a first second b");
    assert.equal(shown("a `first\nsecond\nthird` b"), "a first second third b");
  });
  test("bold, italic and a link label keep the break", () => {
    assert.equal(shown("a **first\nsecond** b"), "a first\nsecond b");
    assert.equal(shown("a *first\nsecond* b"), "a first\nsecond b");
    assert.equal(shown("a [first\nsecond](https://x.y) b"), "a first\nsecond (https://x.y) b");
  });
});

describe("findSource: twins that break their lines at different places", () => {
  const original = "Intro words about nothing in particular.\n\n- alpha beta gamma delta epsilon\n  zeta eta theta iota kappa\n- lambda mu nu xi omicron pi rho";
  const twin = "Intro words about nothing in particular.\n\n* alpha beta gamma delta\n  epsilon zeta eta theta iota kappa\n* lambda mu nu xi omicron pi rho";

  test("a copy with the original's rows is the original's slice, in either order of the window", () => {
    const copy = "alpha beta gamma delta epsilon\n  zeta eta theta iota kappa\n- lambda mu nu xi";
    for (const window of [[original, twin], [twin, original]]) {
      const found = findSource(copy, window);
      assert.ok(found.ok, JSON.stringify(found));
      if (found.ok) assert.equal(window[found.messageIndex], original);
    }
  });

  test("a copy with the twin's rows is the twin's slice", () => {
    const copy = "alpha beta gamma delta\n  epsilon zeta eta theta iota kappa\n- lambda mu nu xi";
    for (const window of [[original, twin], [twin, original]]) {
      const found = findSource(copy, window);
      assert.ok(found.ok, JSON.stringify(found));
      if (found.ok) assert.equal(window[found.messageIndex], twin);
    }
  });

  test("a copy that runs the rows together fits both and is refused as ambiguous", () => {
    const joined = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi";
    assert.deepEqual(findSource(joined, [original, twin]), { ok: false, reason: "ambiguous" });
  });

  test("a copy that fits no row structure of either message is not guessed", () => {
    const wrong = "alpha beta gamma delta epsilon zeta eta\n  theta iota kappa\n- lambda mu nu xi";
    const found = findSource(wrong, [original, twin]);
    assert.equal(found.ok, false);
  });

  test("a single candidate is untouched: its breaks need not all be in the copy", () => {
    const found = findSource("alpha beta gamma delta epsilon zeta eta theta iota kappa", [original]);
    assert.ok(found.ok);
    const rows = findSource("alpha beta gamma delta epsilon\n  zeta eta theta iota", [original]);
    assert.ok(rows.ok);
  });
});
