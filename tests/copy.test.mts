import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { project } from "../src/core/project.ts";
import { copySpan, rowsCovered } from "../src/sim/copy.ts";

// copySpan models a mouse selection over the simulated screen: the first row
// starts where the drag started (usually mid-line, so no margin), middle rows
// are whole rows with margin and padding, the last row ends where the drag
// ended. Spans are in `projected` coordinates.

function span(projected: string, needle: string): [number, number] {
  const at = projected.indexOf(needle);
  assert.ok(at >= 0, `needle ${needle} not found`);
  return [at, at + needle.length];
}

describe("copySpan", () => {
  const source = "aaaa bbbb cccc dddd eeee ffff";
  const base = { width: 14, replyBullet: null } as const;

  test("one row, mid-word: exactly the selected characters", () => {
    const p = project(source, { width: 40, replyBullet: null });
    const [a, b] = span(p.projected, "bb cc");
    assert.equal(copySpan(p, a, b, { width: 40 }), "bb cc");
  });

  test("several rows: first row padded, middle whole, last cut", () => {
    const p = project(source, base);
    // rows: "  aaaa bbbb", "  cccc dddd", "  eeee ffff"
    const [a, b] = span(p.projected, "bb cccc dddd ee");
    assert.equal(
      copySpan(p, a, b, { width: 14 }),
      "bb   \n  cccc dddd   \n  ee",
    );
  });

  test("selection that starts at a row start can include the margin", () => {
    const p = project(source, base);
    const [a, b] = span(p.projected, "cccc dddd");
    assert.equal(
      copySpan(p, a, b, { width: 14, marginOnFirstRow: true }),
      "  cccc dddd",
    );
    assert.equal(copySpan(p, a, b, { width: 14 }), "cccc dddd");
  });

  test("the reply bullet rides along when the margin does, on row 0 only", () => {
    const p = project(source, { width: 14 });
    const [a, b] = span(p.projected, "aaaa bbbb cc");
    assert.equal(
      copySpan(p, a, b, { width: 14, marginOnFirstRow: true }),
      "⏺ aaaa bbbb   \n  cc",
    );
  });

  test("padding can be switched off", () => {
    const p = project(source, base);
    const [a, b] = span(p.projected, "bb cccc dd");
    assert.equal(copySpan(p, a, b, { width: 14, pad: false }), "bb\n  cccc dd");
  });

  test("CRLF and ANSI variants", () => {
    const p = project(source, base);
    const [a, b] = span(p.projected, "bb cc");
    const crlf = copySpan(p, a, b, { width: 14, eol: "\r\n" });
    assert.ok(crlf.includes("\r\n"));
    const ansi = copySpan(p, a, b, { width: 14, ansi: true });
    assert.ok(ansi.includes("\u001b["));
  });

  test("blank rows between paragraphs are part of a multi-paragraph copy", () => {
    const p = project("first para\n\nsecond para", {
      width: 30,
      replyBullet: null,
    });
    const [a, b] = span(p.projected, "para\n\nsecond");
    assert.equal(
      copySpan(p, a, b, { width: 30 }),
      "para" + " ".repeat(18) + "\n" + " ".repeat(30) + "\n  second",
    );
  });

  test("a code line keeps its indentation inside the selection", () => {
    const p = project("```\nif (x) {\n    return 1;\n}\n```", {
      width: 30,
      replyBullet: null,
    });
    const [a, b] = span(p.projected, "x) {\n    return");
    assert.equal(
      copySpan(p, a, b, { width: 30 }),
      "x) {" + " ".repeat(20) + "\n      return",
    );
  });

  test("tabs are copied as eight spaces (Claude Code expands a tab to 8 columns)", () => {
    const p = project("```\n\tx\n```", { width: 20, replyBullet: null });
    assert.equal(
      copySpan(p, 0, 2, { width: 20, marginOnFirstRow: true }),
      "          x",
    );
  });

  test("a selection starting on a consumed wrap space begins on the next row", () => {
    const p = project(source, base);
    const spaceAt = p.projected.indexOf(" cccc");
    assert.equal(copySpan(p, spaceAt, spaceAt + 5, { width: 14 }), "cccc");
  });
});

describe("rowsCovered", () => {
  test("reports the rows and whether a hard wrap was crossed", () => {
    const p = project("aaaa bbbb cccc dddd\n\nnext para here", {
      width: 14,
      replyBullet: null,
    });
    const within = span(p.projected, "aaaa bbbb");
    assert.deepEqual(rowsCovered(p, within[0], within[1]), {
      first: 0,
      last: 0,
      crossesWrap: false,
    });
    const across = span(p.projected, "bbbb cccc");
    assert.equal(rowsCovered(p, across[0], across[1]).crossesWrap, true);
    const paragraphs = span(p.projected, "dddd\n\nnext");
    const covered = rowsCovered(p, paragraphs[0], paragraphs[1]);
    assert.equal(covered.crossesWrap, false);
    assert.ok(covered.last - covered.first >= 2);
  });
});
