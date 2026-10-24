import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { buildSet, twinOf } from "../lib/corpus-set.mjs";
import { guardHoldout } from "../lib/guard.mjs";
import { scoreRows } from "../lib/runner.mjs";
import { hardWrap } from "../lib/gen-text.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";

// Paragraph-only family: a test-only screen renderer below draws paragraphs, nothing else.
const PARA_ONLY = { ...FAMILY_A, name: "P", classes: ["para"], build: { para: FAMILY_A.build.para }, needsParaBefore: [], needsParaAfter: [] };
const set = buildSet(PARA_ONLY, { seed: 5, count: 12 });
const twins = set.messages.map((_, i) => twinOf(PARA_ONLY, set, i).text);

/** Plumbing-only renderer: reply marker, 2-column margin, wrap at spaces, one blank row between messages. */
function drawScreen(width) {
  const out = [];
  for (const m of set.messages) {
    out.push(`❯ prompt ${m.index}`, "");
    const lines = m.text.split("\n").flatMap((l) => (l ? hardWrap(l, width - 3) : [""]));
    lines.forEach((l, i) => out.push(i === 0 ? `⏺ ${l}` : l ? `  ${l}` : ""));
    out.push("");
  }
  return out;
}

const run = (width, find) => scoreRows({ messages: set.messages, twins, rows: drawScreen(width), width, seed: 7, count: 30, classes: ["para"], find });

describe("scoring one screen end to end (canned rows, the real matcher)", () => {
  for (const width of [60, 100]) {
    test(`width ${width}: every paragraph copy is found and exact, controls stay silent`, () => {
      const { records, locate } = run(width);
      assert.equal(locate.locatable, locate.tokens);
      assert.ok(records.length >= 25, `only ${records.length} records`);
      const bad = records.filter((r) => r.kind !== "exact");
      assert.deepEqual(bad.map((r) => [r.kind, r.expected, r.copied]), []);
      assert.equal(records.filter((r) => r.control.falsePositive).length, 0);
      assert.ok(records.some((r) => r.rowsSpanned > 1), "some copies cross a wrap");
      assert.ok(records.every((r) => r.digits), "every copy holds token digits");
    });
  }

  test("the padded variant is scored too and the copied text differs from the trimmed one", () => {
    const { records } = run(60);
    assert.ok(records.every((r) => ["exact", "no-match", "wrong-slice", "ambiguous", "too-short", "empty"].includes(r.padded.kind)));
    assert.ok(records.some((r) => r.padded.copied !== r.copied));
    assert.equal(records.filter((r) => r.padded.kind === "exact").length, records.filter((r) => r.kind === "exact").length);
  });

  test("a matcher that returns the wrong text is counted as wrong-slice, a refusing one as no-match", () => {
    const wrong = run(100, () => ({ ok: true, source: "not the text", paste: "not the text", messageIndex: 0 }));
    assert.ok(wrong.records.every((r) => r.kind === "wrong-slice"));
    assert.ok(wrong.records.every((r) => r.control.falsePositive), "an always-ok matcher fails the controls");
    const none = run(100, () => ({ ok: false, reason: "no-match" }));
    assert.ok(none.records.every((r) => r.kind === "no-match" && !r.control.falsePositive));
  });

  test("a screen that lacks part of the conversation yields fewer locatable tokens and no span uses a missing one", () => {
    const rows = drawScreen(100).slice(0, 120);
    const r = scoreRows({ messages: set.messages, twins, rows, width: 100, seed: 7, count: 30, classes: ["para"] });
    assert.ok(r.locate.missing > 0);
    const shown = new Set(r.records.flatMap((x) => [x.startToken, x.endToken]));
    const onScreen = rows.join("\n");
    for (const id of shown) assert.ok(onScreen.includes(id));
  });
});

describe("a holdout is scored once", () => {
  const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrender-test-"));
  after(() => fs.rmSync(base, { recursive: true, force: true }));

  test("calibration results can be rewritten freely", () => {
    const file = path.join(base, "results-calibration.json");
    fs.writeFileSync(file, "{}");
    assert.deepEqual(guardHoldout({ role: "calibration", setDir: base, resultsFile: file }), { discarded: 0 });
  });

  test("the first holdout run is allowed, a second one is refused", () => {
    const dir = fs.mkdtempSync(path.join(base, "h-"));
    const file = path.join(dir, "results-holdout.json");
    guardHoldout({ role: "holdout", setDir: dir, resultsFile: file });
    fs.writeFileSync(file, "{}");
    assert.throws(() => guardHoldout({ role: "holdout", setDir: dir, resultsFile: file }), /scored once/);
    assert.equal(fs.existsSync(file), true, "refusing leaves the results alone");
  });

  test("a stated reason moves the old results aside and logs the discard", () => {
    const dir = fs.mkdtempSync(path.join(base, "h-"));
    const file = path.join(dir, "results-holdout.json");
    fs.writeFileSync(file, '{"old":true}');
    assert.deepEqual(guardHoldout({ role: "holdout", setDir: dir, resultsFile: file, discard: "tuned on it" }), { discarded: 1 });
    assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(`${file}.discarded-1`, "utf8"), '{"old":true}');
    const log = JSON.parse(fs.readFileSync(path.join(dir, "holdout-discards.json"), "utf8"));
    assert.equal(log[0].reason, "tuned on it");
  });
});
