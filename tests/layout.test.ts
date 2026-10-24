import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { project } from "../src/core/project.ts";
import { stripDecoration } from "../src/core/strip.ts";
import { stringWidth } from "../src/core/width.ts";

// The screen simulator's rows: hard-wrapped at `width`, left margin, reply
// bullet, trailing space padding. These are ASSUMPTIONS about the classic
// renderer, checked by the sealed live pass; the tests pin the simulator, not
// the engine.

const WIDTHS = [40, 60, 80, 100, 120];
const PROSE =
  "Claude Code draws every reply with a two column margin and hard line breaks at the terminal width, " +
  "so a paragraph that is copied arrives as several rows with spaces at the end of each one.";

const fixtures: Record<string, string> = {
  prose: `${PROSE}\n\n${PROSE} ${PROSE}`,
  list: `- ${PROSE}\n  - nested ${PROSE}\n    - deeper ${PROSE}\n- short\n\n1. ${PROSE}\n2. second`,
  quote: `> ${PROSE}\n> ${PROSE}\n\nafter the quote`,
  code: "intro\n\n```ts\nconst a = 1;\n    const longName = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree);\n```\n\noutro",
  mixed: `# Heading\n\n${PROSE}\n\n- item one ${PROSE}\n- item two\n\n> quoted ${PROSE}\n\n\`\`\`\ncode here\n\`\`\``,
  cjk: "这是一个很长的中文句子，用来检查宽字符不会被拆开。".repeat(6),
  emoji: "ok \u{1F600} ".repeat(40),
};

// Fixtures whose rows can split a token, where re-joining rows adds a space.
const MID_TOKEN_WRAPS = new Set(["cjk", "code"]);
const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();
const skeleton = (s: string): string => s.replace(/\s+/g, "");

describe("rows: invariants for every fixture at every width", () => {
  for (const [name, source] of Object.entries(fixtures)) {
    for (const width of WIDTHS) {
      test(`${name} @ ${width}`, () => {
        const { rows, projected, layout } = project(source, { width });
        assert.equal(rows.length, layout.length);
        for (const row of rows)
          assert.equal(stringWidth(row), width, JSON.stringify(row));
        assert.ok(rows[0]?.startsWith("⏺ "));
        for (const row of rows.slice(1)) {
          assert.ok(
            row.trim() === "" || row.startsWith("  "),
            JSON.stringify(row),
          );
        }
        // strip + whitespace-fold of the screen equals the visible text
        const seen = stripDecoration(rows.join("\n"));
        assert.equal(skeleton(seen), skeleton(projected));
        if (!MID_TOKEN_WRAPS.has(name)) assert.equal(collapse(seen), collapse(projected));
      });
    }
  }
});

describe("rows: wrapping rules", () => {
  const plain = (rows: string[]): string[] => rows.map((r) => r.trimEnd());

  test("words wrap at spaces; the space at the break is consumed", () => {
    const { rows, layout, projected } = project("aaaa bbbb cccc", {
      width: 14,
      replyBullet: null,
    });
    assert.deepEqual(plain(rows), ["  aaaa bbbb", "  cccc"]);
    const first = layout[0] as { to: number };
    const second = layout[1] as { from: number };
    assert.equal(projected[first.to], " ");
    assert.equal(second.from, first.to + 1);
  });

  test("a token longer than the row is split at the row width", () => {
    const { rows } = project("x".repeat(50), { width: 22, replyBullet: null });
    assert.deepEqual(plain(rows), [
      "  " + "x".repeat(20),
      "  " + "x".repeat(20),
      "  " + "x".repeat(10),
    ]);
  });

  test("code is wrapped by characters, spaces included, indentation kept", () => {
    const { rows } = project("```\n    0123456789 0123456789\n```", {
      width: 22,
      replyBullet: null,
    });
    assert.deepEqual(plain(rows), ["      0123456789 01234", "  56789"]);
  });

  test("wide characters are never split across rows", () => {
    const { rows } = project("你好".repeat(20), {
      width: 22,
      replyBullet: null,
    });
    for (const row of rows) assert.ok(stringWidth(row) === 22);
    assert.equal(plain(rows)[0]?.trim().length, 10);
  });

  test("bullet items hang under their text", () => {
    const { rows } = project("- " + "word ".repeat(8), {
      width: 20,
      replyBullet: null,
    });
    assert.equal(plain(rows)[0]?.startsWith("  - word"), true);
    assert.equal(plain(rows)[1]?.startsWith("    word"), true);
  });

  test("numbered items hang three columns", () => {
    const { rows } = project("1. " + "word ".repeat(8), {
      width: 20,
      replyBullet: null,
    });
    assert.equal(plain(rows)[1]?.startsWith("     word"), true);
  });

  test("nested items indent by the parent's marker width", () => {
    const { rows } = project("- a\n  - b", { width: 20, replyBullet: null });
    assert.deepEqual(plain(rows), ["  - a", "    - b"]);
  });

  test("quote rows carry a bar after the margin", () => {
    const { rows } = project("> hello", { width: 20, replyBullet: null });
    assert.deepEqual(plain(rows), ["  ▎ hello"]);
  });

  test("blank line between blocks is a blank row; tight list has none", () => {
    assert.deepEqual(
      plain(project("a\n\nb", { width: 20, replyBullet: null }).rows),
      ["  a", "", "  b"],
    );
    assert.deepEqual(
      plain(project("- a\n- b", { width: 20, replyBullet: null }).rows),
      ["  - a", "  - b"],
    );
  });

  test("tabs are drawn as eight spaces; the visible text keeps the tab", () => {
    const { rows, projected } = project("```\n\tx\n```", {
      width: 20,
      replyBullet: null,
    });
    assert.equal(plain(rows)[0], "          x");
    assert.equal(projected, "\tx");
  });

  test("a table is drawn as its raw lines (opaque to the matcher)", () => {
    const { rows } = project("| a | b |\n|---|---|\n| 1 | 2 |", {
      width: 30,
      replyBullet: null,
    });
    assert.deepEqual(plain(rows), [
      "  | a | b |",
      "  |---|---|",
      "  | 1 | 2 |",
    ]);
  });
});

describe("rows: options", () => {
  test("reply bullet replaces the first margin; null removes it", () => {
    assert.ok(project("hi", { width: 20 }).rows[0]?.startsWith("⏺ hi"));
    assert.ok(
      project("hi", { width: 20, replyBullet: "●" }).rows[0]?.startsWith(
        "● hi",
      ),
    );
    assert.ok(
      project("hi", { width: 20, replyBullet: null }).rows[0]?.startsWith(
        "  hi",
      ),
    );
  });

  test("custom margin", () => {
    const { rows } = project("hi\n\nthere", {
      width: 20,
      margin: 4,
      replyBullet: null,
    });
    assert.equal(rows[2]?.startsWith("    there"), true);
  });

  test("layout slices line up with the rows", () => {
    const { rows, layout, projected } = project(fixtures["mixed"] as string, {
      width: 60,
    });
    layout.forEach((info, i) => {
      if (info.literal !== undefined) return;
      assert.ok(
        (rows[i] as string).startsWith(
          info.prefix + projected.slice(info.from, info.to),
        ),
      );
    });
  });

  test("tiny widths still terminate with bounded rows", () => {
    for (const width of [3, 4, 6, 10]) {
      const { rows } = project(`${PROSE}\n\n- ${PROSE}`, { width });
      assert.ok(rows.length > 10);
      for (const row of rows)
        assert.ok(stringWidth(row) >= width || row.length > 0);
    }
  });

  test("empty source has no rows", () => {
    const empty = project("", { width: 40 });
    assert.deepEqual(empty.rows, []);
    assert.equal(empty.projected, "");
    assert.deepEqual(empty.map, []);
  });

  test("deterministic", () => {
    const a = project(fixtures["mixed"] as string, { width: 80 });
    const b = project(fixtures["mixed"] as string, { width: 80 });
    assert.deepEqual(a, b);
  });
});
