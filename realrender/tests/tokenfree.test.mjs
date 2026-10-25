import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";
import { findSource } from "../../src/core/match.ts";
import { buildSet } from "../lib/corpus-set.mjs";
import { hardWrap } from "../lib/gen-text.mjs";
import { GATE, contestedOf, gapCases, gateVerdict, judgeGap, summarizeGaps, tokenFreeRun } from "../lib/tokenfree.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";

const PARA_ONLY = { ...FAMILY_A, name: "P", classes: ["para"], build: { para: FAMILY_A.build.para }, needsParaBefore: [], needsParaAfter: [] };
const set = buildSet(PARA_ONLY, { seed: 11, count: 8 });

/** Plumbing-only renderer: prompt row, reply marker, two-column margin, wrap at spaces. */
function screenRows(messages, width) {
  const out = [];
  for (const m of messages) {
    out.push(`❯ prompt ${m.index}`, "");
    m.text.split("\n").flatMap((l) => (l ? hardWrap(l, width - 3) : [""])).forEach((l, i) => out.push(i === 0 ? `⏺ ${l}` : l ? `  ${l}` : ""));
    out.push("");
  }
  return out;
}

const rows = screenRows(set.messages, 80);

describe("gapCases: the words between two tokens, copied from the real screen", () => {
  const cases = gapCases({ messages: set.messages, rows, width: 80 });

  test("there are many, none holds a token, each is at least 12 folded characters", () => {
    assert.ok(cases.length > 30, `${cases.length} cases`);
    for (const c of cases) {
      assert.doesNotMatch(c.copied, /[a-z]+\d{4}/);
      assert.ok(c.copied.replace(/\s+/g, " ").trim().length >= 12);
    }
  });

  test("each case names its message and the source range the words can come from", () => {
    for (const c of cases) {
      const m = set.messages[c.message];
      assert.ok(c.lo >= 0 && c.hi <= m.text.length && c.lo < c.hi);
      const words = m.text.slice(c.lo, c.hi).replace(/\s+/g, " ").trim();
      assert.equal(words.split(" ").slice(0, 1)[0].length > 0, true);
    }
  });

  test("the occurrences list the messages whose screen text holds the copy; the true message is among them", () => {
    for (const c of cases) assert.ok(c.occurrences.includes(c.message), `msg ${c.message} not in ${c.occurrences}`);
  });

  test("the same words in two messages (tokens differ) show up as two occurrences", () => {
    const shift = (id) => `${id.slice(0, -4)}${String(Number(id.slice(-4)) + 5000).padStart(4, "0")}`;
    const original = set.messages[2];
    const twin = { ...original, index: 3, text: original.text.replace(/[a-z]+\d{4}/g, shift), tokens: original.tokens.map((t) => ({ ...t, id: shift(t.id) })) };
    const pair = [...set.messages.slice(0, 3), twin, ...set.messages.slice(4)];
    const found = gapCases({ messages: pair, rows: screenRows(pair, 80), width: 80 }).filter((c) => c.message === 2 || c.message === 3);
    assert.ok(found.length > 3);
    assert.ok(found.every((c) => c.occurrences.includes(2) && c.occurrences.includes(3)), "every gap of the pair is in both");
  });
});

describe("judgeGap: right, refused, picked-right, wrong and picked-wrong", () => {
  const gap = "gap words here";
  const texts = Array.from({ length: 8 }, (_, i) => (i === 3 || i === 4 ? `${"x".repeat(100)}${gap}${"y".repeat(80)}` : `${"z".repeat(300)}`));
  const unique = { message: 3, lo: 100, hi: 100 + gap.length, occurrences: [3] };
  const shared = { ...unique, occurrences: [3, 4] };
  const newest = (index) => texts.length - 1 - index;
  const hit = (mi, start, end, source = gap) => ({ ok: true, messageIndex: newest(mi), start, end, source, paste: source });

  test("a copy found in one message: the right place is exact, a refusal is refused, anything else is wrong", () => {
    assert.equal(judgeGap(unique, hit(3, 98, 120), texts).outcome, "exact");
    assert.equal(judgeGap(unique, { ok: false, reason: "no-match" }, texts).outcome, "refused");
    assert.equal(judgeGap(unique, hit(5, 98, 120, "other text"), texts).outcome, "wrong");
    assert.equal(judgeGap(unique, hit(3, 200, 230, "other text"), texts).outcome, "wrong");
  });

  test("a copy found in two messages: a refusal is right, a pick is a guess, and a wrong pick is the dangerous one", () => {
    assert.equal(judgeGap(shared, { ok: false, reason: "ambiguous" }, texts).outcome, "refused-right");
    assert.equal(judgeGap(shared, hit(3, 98, 120), texts).outcome, "picked-right");
    assert.equal(judgeGap(shared, hit(5, 98, 120, "other text"), texts).outcome, "picked-wrong");
  });

  test("the same text taken from the other message is not a wrong answer: the slice is the same", () => {
    assert.equal(judgeGap(shared, hit(4, 100, 114), texts).outcome, "picked-right");
  });

  test("the slack allows for the markup the matcher leaves out at the edges", () => {
    assert.equal(judgeGap(unique, hit(3, 100 - 6, 114 + 6, "x gap words here yy"), texts).outcome, "exact");
    assert.equal(judgeGap(unique, hit(3, 100 - 40, 114, "other text"), texts).outcome, "wrong");
  });

  test("summarizeGaps counts every outcome and lists the dangerous ones", () => {
    const rowsIn = [{ outcome: "exact" }, { outcome: "exact" }, { outcome: "wrong", key: "a" }, { outcome: "picked-wrong", key: "b" }, { outcome: "refused-right" }, { outcome: "refused" }];
    const s = summarizeGaps(rowsIn);
    assert.deepEqual([s.total, s.exact, s.wrong, s.pickedWrong, s.refusedRight, s.refused, s.dangerous], [6, 2, 1, 1, 1, 1, 2]);
    assert.deepEqual(s.dangerousKeys, ["a", "b"]);
  });
});

describe("tokenFreeRun: the real matcher on these copies", () => {
  test("no wrong answer on a plain window, whatever the width", () => {
    const run = tokenFreeRun({ messages: set.messages, screens: { 60: screenRows(set.messages, 60).join("\n"), 100: screenRows(set.messages, 100).join("\n") } });
    assert.ok(run.summary.total > 60);
    assert.equal(run.summary.dangerous, 0);
    assert.ok(run.summary.exact > run.summary.total / 2, JSON.stringify(run.summary));
  });
});

describe("tokenfree.mjs command line", () => {
  test("--set is required, the widths default to the four and flags need values", async () => {
    const { parseTokenFreeArgs } = await import("../tokenfree.mjs");
    assert.deepEqual(parseTokenFreeArgs(["--set", "d"]).widths, [60, 80, 100, 120]);
    assert.deepEqual(parseTokenFreeArgs(["--set", "d", "--widths", "80"]).widths, [80]);
    assert.throws(() => parseTokenFreeArgs([]), /need --set/);
    assert.throws(() => parseTokenFreeArgs(["--set"]), /bad flag/);
    assert.throws(() => parseTokenFreeArgs(["--nope", "1"]), /bad flag/);
  });
});

// The never-guess gate. Rule 3 cannot see a matcher that guesses: every capture of it holds a unique token, so no
// capture can be ambiguous, and a matcher that never refuses an ambiguity passed it 240 of 240 in the 0.1.1 review.
// These copies can see it, so the gate (zero wrong and zero picked-wrong, over enough cases with a competitor) is
// a release condition, and it is tested here against a matcher that guesses.
const TOKEN_RE = /[a-z]+\d{4}/g;
const tokensOf = (text) => [...text.matchAll(TOKEN_RE)].map((m) => ({ id: m[0], start: m.index, end: m.index + m[0].length }));

/** Pairs of messages that DRAW the same words: the second marks "brown fox" as bold, so the sources differ. */
function lookalikePairs(pairs) {
  const messages = [];
  for (let k = 0; k < pairs; k += 1) {
    const [a, b, c, d] = [0, 1, 2, 3].map((j) => `${"abcdefghij"[j + 2 * (k % 3)]}${"klm"[k % 3]}${1000 + 4 * k + j}`);
    for (const text of [`${a} the quick brown fox jumps over the lazy dog ${b}`, `${c} the quick **brown fox** jumps over the lazy dog ${d}`]) {
      messages.push({ index: messages.length, text, tokens: tokensOf(text) });
    }
  }
  return messages;
}

const drawnWindow = (messages) => messages.flatMap((m) => [`❯ prompt ${m.index}`, "", `⏺ ${m.text.replaceAll("**", "")}`, ""]).join("\n");

/** A matcher that never refuses an ambiguity: the newest message that holds the words wins (review mutant "guess"). */
function guessing(copied, newestFirst) {
  for (let i = 0; i < newestFirst.length; i += 1) {
    const one = findSource(copied, [newestFirst[i]]);
    if (one.ok) return { ...one, messageIndex: i };
  }
  return findSource(copied, newestFirst);
}

describe("the never-guess gate", () => {
  const messages = lookalikePairs(6);
  const screens = { 80: drawnWindow(messages) };
  const small = { minTotal: 5, minContested: 5 };

  test("the real matcher refuses the lookalikes: no wrong, no picked-wrong, and the cases are contested", () => {
    const { summary } = tokenFreeRun({ messages, screens });
    assert.equal(summary.dangerous, 0, JSON.stringify(summary));
    assert.ok(summary.refusedRight >= 6, JSON.stringify(summary));
    assert.deepEqual(gateVerdict(summary, small), { pass: true, failures: [] });
  });

  test("a matcher that guesses is caught: picked-wrong cases appear and the gate fails", () => {
    const { summary } = tokenFreeRun({ messages, screens, find: guessing });
    assert.ok(summary.pickedWrong >= 6, JSON.stringify(summary));
    const verdict = gateVerdict(summary, small);
    assert.equal(verdict.pass, false);
    assert.match(verdict.failures.join("; "), /\d+ picked-wrong/);
  });
});

describe("gateVerdict", () => {
  const good = { total: 3576, exact: 2296, refused: 12, wrong: 0, refusedRight: 651, pickedRight: 617, pickedWrong: 0 };

  test("a set like the family C calibration sets passes at the default floors", () => {
    assert.deepEqual(gateVerdict(good), { pass: true, failures: [] });
    assert.equal(contestedOf(good), 1268);
  });

  test("one wrong answer or one picked-wrong answer fails, and the count is named", () => {
    assert.deepEqual(gateVerdict({ ...good, wrong: 1 }).failures, ["1 wrong"]);
    assert.deepEqual(gateVerdict({ ...good, pickedWrong: 3 }).failures, ["3 picked-wrong"]);
  });

  test("an empty or too small set cannot pass by having nothing to get wrong", () => {
    const empty = { total: 0, exact: 0, refused: 0, wrong: 0, refusedRight: 0, pickedRight: 0, pickedWrong: 0 };
    assert.equal(gateVerdict(empty).pass, false);
    assert.equal(gateVerdict({ ...good, total: GATE.minTotal - 1 }).pass, false);
    assert.equal(gateVerdict({ ...good, refusedRight: 0, pickedRight: GATE.minContested - 1 }).pass, false);
  });

  test("the floors sit far below what a calibration set has", () => {
    assert.ok(GATE.minTotal <= 1000 && GATE.minContested <= 100);
  });
});

describe("tokenfree.mjs --gate", () => {
  const entry = new URL("../tokenfree.mjs", import.meta.url).pathname;

  test("--gate takes yes and nothing else", async () => {
    const { parseTokenFreeArgs } = await import("../tokenfree.mjs");
    assert.equal(parseTokenFreeArgs(["--set", "d", "--gate", "yes"]).gate, "yes");
    assert.throws(() => parseTokenFreeArgs(["--set", "d", "--gate", "no"]), /--gate takes yes/);
  });

  test("the exit status is 1 when the gate fails (here: a window far below the floors) and 0 without --gate", () => {
    const messages = lookalikePairs(4);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cb-tokenfree-"));
    try {
      fs.mkdirSync(path.join(dir, "w80"));
      fs.writeFileSync(path.join(dir, "corpus.json"), JSON.stringify({ seed: 3, family: "T", messages }));
      fs.writeFileSync(path.join(dir, "w80", "cap-w80-history.txt"), drawnWindow(messages));
      const run = (extra) => spawnSync(process.execPath, [entry, "--set", dir, "--widths", "80", ...extra], { encoding: "utf8" });
      const plain = run([]);
      assert.equal(plain.status, 0, plain.stderr);
      const gated = run(["--gate", "yes"]);
      assert.equal(gated.status, 1);
      assert.match(gated.stderr, /gate: FAIL: only \d+ cases/);
      assert.equal(JSON.parse(gated.stdout.trim()).summary.dangerous, 0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
