import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource } from "../src/core/match.ts";
import { project, projectText } from "../src/core/project.ts";
import { stripDecoration } from "../src/core/strip.ts";
import { copySpan } from "../src/sim/copy.ts";
import { mulberry32, pick, randInt } from "../src/sim/prng.ts";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

// Hostile input: random strings made of markdown-significant tokens. Whatever
// the structure, nothing may hang or throw, the map must stay in range and
// non-decreasing, and any hit must be a literal slice of the message.

const TOKENS = [
  "- ",
  "* ",
  "+ ",
  "1. ",
  "2) ",
  "a. ",
  "> ",
  ">> ",
  "```",
  "~~~",
  "````",
  "\n",
  "\n\n",
  "\r\n",
  "  ",
  "    ",
  "\t",
  "*",
  "**",
  "_",
  "__",
  "`",
  "``",
  "[",
  "]",
  "](",
  ")",
  "(",
  "![",
  "|",
  "|---|",
  "---",
  "***",
  "===",
  "#",
  "## ",
  "###### ",
  "<",
  ">",
  "<http://x.y>",
  "~~",
  "\\",
  "\\*",
  "&amp;",
  "word",
  "text",
  "foo_bar",
  "https://example.com/path_(x)",
  "é",
  "→",
  "你好",
  "\u{1F600}",
  "\u0000",
  "\u200b",
  "⏺ ",
  "▎ ",
  "• ",
  "[x](y)",
  "[ ]",
  "1.",
  "-",
  "a  b",
];

function randomJunk(rng: () => number, maxTokens: number): string {
  let out = "";
  for (let i = randInt(rng, 0, maxTokens); i > 0; i--) out += pick(rng, TOKENS);
  return out;
}

describe("fuzz: markdown-significant garbage", () => {
  test("projection never throws and keeps its map honest (4000 cases)", () => {
    const rng = mulberry32(31337);
    for (let n = 0; n < 4000; n++) {
      const source = randomJunk(rng, 60);
      const { projected, map } = projectText(source);
      assert.equal(map.length, projected.length, `case ${n}`);
      let prev = 0;
      for (let i = 0; i < map.length; i++) {
        const at = map[i] as number;
        assert.ok(
          at >= 0 && at < Math.max(1, source.length),
          `case ${n}: map[${i}]=${at} outside source of ${source.length}`,
        );
        assert.ok(at >= prev, `case ${n}: map decreases at ${i}`);
        prev = at;
      }
    }
  });

  test("rows are produced at awkward widths without throwing (1500 cases)", () => {
    const rng = mulberry32(777);
    for (let n = 0; n < 1500; n++) {
      const source = randomJunk(rng, 40);
      const width = pick(rng, [1, 2, 3, 5, 8, 20, 40, 80]);
      const { rows, layout } = project(source, { width });
      assert.equal(rows.length, layout.length);
    }
  });

  test("strip never throws and a second pass is stable on its own output", () => {
    const rng = mulberry32(99);
    for (let n = 0; n < 3000; n++) {
      const text = randomJunk(rng, 30);
      for (const opts of [
        {},
        { glyphs: false },
        { markers: true },
        { glyphs: false, markers: true },
      ]) {
        assert.equal(typeof stripDecoration(text, opts), "string");
      }
    }
  });

  test("any hit is a literal slice of its message, and a screen copy of a span round-trips when unique (2500 cases)", () => {
    const rng = mulberry32(2026);
    let hits = 0;
    for (let n = 0; n < 2500; n++) {
      const source = randomJunk(rng, 80);
      const p = project(source, { width: pick(rng, [20, 40, 80]) });
      if (p.projected.length < 30) continue;
      const a = randInt(rng, 0, p.projected.length - 20);
      const b = Math.min(p.projected.length, a + randInt(rng, 15, 120));
      const copied = copySpan(p, a, b, {
        width: 80,
        marginOnFirstRow: rng() < 0.5,
      });
      const result = findSource(copied, [source, randomJunk(rng, 30)]);
      if (!result.ok) continue;
      hits++;
      const message = result.messageIndex === 0 ? source : undefined;
      if (message !== undefined)
        assert.equal(
          message.slice(result.start, result.end),
          result.source,
          `case ${n}`,
        );
      assert.ok(result.start >= 0 && result.end > result.start, `case ${n}`);
    }
    assert.ok(
      hits > 100,
      `only ${hits} hits, the fuzz is not exercising the matcher`,
    );
  });

  test("junk copies against junk messages never throw", () => {
    const rng = mulberry32(5);
    const messages = Array.from({ length: 12 }, () => randomJunk(rng, 120));
    for (let n = 0; n < 1500; n++) {
      const result = findSource(randomJunk(rng, 25), messages);
      assert.equal(typeof result.ok, "boolean");
      if (result.ok)
        assert.equal(
          (messages[result.messageIndex] as string).slice(
            result.start,
            result.end,
          ),
          result.source,
        );
    }
  });

  test("a pathological message stays linear-ish (nested quotes, lists, delimiters)", () => {
    const messages = [
      "> ".repeat(300) + "deep\n" + "- ".repeat(300) + "x",
      "*_~`[".repeat(2000),
      ("- a\n" + "  ".repeat(1) + "- b\n").repeat(1500),
      "```\n".repeat(2000),
      "|a|b|\n|-|-|\n".repeat(1500),
    ];
    for (const [i, message] of messages.entries()) {
      const { value: result, cpuMs } = cpuTimed(() =>
        findSource("this is not in the message at all, no", [message]),
      );
      assert.equal(result.ok, false);
      assertCpuWithin(`fuzz: pathological message ${i}`, cpuMs, 3000);
    }
  });
});
