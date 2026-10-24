import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { findSource, resetMatchCache } from "../src/core/match.ts";
import { projectText } from "../src/core/visible.ts";
import { stripDecoration } from "../src/core/strip.ts";

// F6 (never throws) and F7 (no super-linear time) on pathological input.
// Nothing here is realistic text; the point is that a hostile or accidental
// message cannot crash or stall the matcher. Time is main-thread CPU time so a
// busy machine cannot inflate it; the bounds are generous (the fixes bring
// every case to a few milliseconds, the old code took seconds to minutes).

const cpuMs = (): number => {
  const { user, system } = process.threadCpuUsage();
  return (user + system) / 1000;
};

const NEEDLE = "a sentence that appears in none of the pathological messages";

function timedFind(message: string): { ms: number; reason: string } {
  resetMatchCache();
  const t0 = cpuMs();
  const result = findSource(NEEDLE, [message]);
  return { ms: cpuMs() - t0, reason: result.ok ? "hit" : result.reason };
}

describe("F6: stripDecoration is total", () => {
  test("125,000 indented rows do not overflow the stack", () => {
    const rows = Array.from({ length: 125_000 }, () => "  ab").join("\n");
    assert.doesNotThrow(() => stripDecoration(rows));
    assert.equal(stripDecoration(rows).split("\n").length, 125_000);
  });

  test("a million blank-ish rows are fine too", () => {
    const rows = " \n".repeat(300_000) + "  end";
    assert.doesNotThrow(() => stripDecoration(rows));
  });
});

describe("F6: deeply nested containers do not overflow the stack", () => {
  const deep: Array<[string, string]> = [
    ["quote markers on one line", ">".repeat(5000) + " x"],
    ["bullet markers on one line", "- ".repeat(5000) + "x"],
    ["ordered markers on one line", "1. ".repeat(5000) + "x"],
    ["quote and bullet pairs", "> - ".repeat(2500) + "x"],
  ];
  for (const [name, message] of deep) {
    test(`${name}: findSource and projectText return`, () => {
      assert.doesNotThrow(() => projectText(message));
      const result = findSource(NEEDLE, [message]);
      assert.deepEqual(result, { ok: false, reason: "no-match" });
    });
  }

  test("nesting beyond the cap still shows its text", () => {
    const message =
      ">".repeat(200) + " the visible words at the bottom of the stack";
    const result = findSource("visible words at the bottom", [message]);
    assert.equal(result.ok, true);
  });

  test("ordinary nesting (a few levels) is untouched by the cap", () => {
    const message =
      "- one\n  - two\n    - three\n      - four words that are long enough to find\n";
    const result = findSource("four words that are long", [message]);
    assert.equal(result.ok, true);
  });
});

describe("F7: time stays linear on pathological input", () => {
  const BOUND_MS = 1000;

  test("200 KB of unclosed link destinations", () => {
    const { ms, reason } = timedFind("[a](b".repeat(40_000));
    assert.equal(reason, "no-match");
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("200 KB of unclosed link destinations with an angle bracket", () => {
    const { ms } = timedFind("[a](<b".repeat(33_000));
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("200 KB of unclosed link titles", () => {
    const { ms } = timedFind('[a](b "c'.repeat(25_000));
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("200 KB of closers that have no opener", () => {
    const { ms, reason } = timedFind("x* ".repeat(70_000));
    assert.equal(reason, "no-match");
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("200 KB of underscore closers with no opener", () => {
    const { ms } = timedFind("x_ ".repeat(70_000));
    assert.ok(ms < BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("a nested list 2000 levels deep (a 4 MB message)", () => {
    let message = "";
    for (let level = 0; level < 2000; level++) message += `${" ".repeat(2 * level)}- x\n`;
    const { ms } = timedFind(message);
    assert.ok(ms < 6 * BOUND_MS, `${ms.toFixed(0)} ms`);
  });

  test("a legitimate long destination is still read as a link (label, space, destination in parentheses)", () => {
    const url = "https://example.com/" + "p".repeat(900);
    const message = `See [the label text](${url}) for the long explanation of it all.`;
    const result = findSource(`the label text (${url}) for the long explanation`, [
      message,
    ]);
    assert.equal(result.ok, true);
    if (result.ok)
      assert.ok(
        result.source.includes("](https://"),
        result.source.slice(0, 40),
      );
  });
});
