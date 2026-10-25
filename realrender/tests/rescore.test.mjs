import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildSet, twinOf } from "../lib/corpus-set.mjs";
import { hardWrap } from "../lib/gen-text.mjs";
import { rescoreRecords, summarizeRescore } from "../lib/rescore.mjs";
import { chooseSpans } from "../lib/spans.mjs";
import { FAMILY_A } from "../lib/templates-a.mjs";

const PARA_ONLY = { ...FAMILY_A, name: "P", classes: ["para"], build: { para: FAMILY_A.build.para }, needsParaBefore: [], needsParaAfter: [] };
const set = buildSet(PARA_ONLY, { seed: 5, count: 10 });
const twins = set.messages.map((_, i) => twinOf(PARA_ONLY, set, i).text);

/** Plumbing-only renderer: reply marker, two-column margin, wrap at spaces. */
function screen(width) {
  const out = [];
  for (const m of set.messages) {
    out.push(`❯ prompt ${m.index}`, "");
    m.text.split("\n").flatMap((l) => (l ? hardWrap(l, width - 3) : [""])).forEach((l, i) => out.push(i === 0 ? `⏺ ${l}` : l ? `  ${l}` : ""));
    out.push("");
  }
  return `${out.join("\n")}\n`;
}

const locatable = new Set(set.messages.flatMap((m) => m.tokens.map((t) => t.id)));
const spans = (width) => chooseSpans({ messages: set.messages, locatable, seed: 3, count: 12, classes: ["para"] }).map((s) => ({ width, ...s }));
const screens = { 80: screen(80), 100: screen(100) };
const records = [...spans(80), ...spans(100)];
const run = (over = {}) => rescoreRecords({ messages: set.messages, twins, screens, records, ...over });

describe("rescoreRecords: a saved set against a matcher", () => {
  test("the real matcher finds every saved span exactly and the controls stay silent", () => {
    const { results, locate } = run();
    const s = summarizeRescore(results);
    assert.equal(s.records, records.length);
    assert.equal(s.exact, records.length);
    assert.equal(s.paddedExact, records.length);
    assert.deepEqual([s.wrongSlice, s.falsePositives, s.offScreen], [0, 0, 0]);
    assert.equal(locate[80].locatable, locate[80].tokens);
    assert.equal(s.savedExact, null, "records with no saved kind have nothing to compare with");
  });

  test("saved kinds are compared: a capture that was exact and no longer is, is listed as lost", () => {
    const saved = records.map((r) => ({ ...r, kind: "exact" }));
    const { results } = run({ records: saved, find: () => ({ ok: false, reason: "no-match" }) });
    const s = summarizeRescore(results);
    assert.equal(s.exact, 0);
    assert.equal(s.savedExact, records.length);
    assert.equal(s.lost.length, records.length);
    assert.equal(s.gained, 0);
    assert.equal(s.refused, records.length);
  });

  test("a capture that was refused and is now exact is counted as gained", () => {
    const saved = records.map((r) => ({ ...r, kind: "no-match" }));
    const s = summarizeRescore(run({ records: saved }).results);
    assert.equal(s.gained, records.length);
    assert.deepEqual(s.lost, []);
  });

  test("a wrong slice and a false positive are counted as such", () => {
    const wrong = () => ({ ok: true, source: "not the text", paste: "not the text", messageIndex: 0 });
    const s = summarizeRescore(run({ find: wrong }).results);
    assert.equal(s.wrongSlice, records.length);
    assert.equal(s.falsePositives, records.length);
  });

  test("a span whose token is not on the saved screen is off-screen, not scored", () => {
    const stray = { ...records[0], startToken: ["nowhere", "0000"].join("") };
    const { results } = run({ records: [stray] });
    assert.equal(results[0].kind, "off-screen");
    assert.equal(summarizeRescore(results).offScreen, 1);
  });

  test("a width with records but no saved screen is not scored", () => {
    const { results } = run({ screens: { 80: screens[80] } });
    assert.equal(results.length, records.filter((r) => r.width === 80).length);
  });
});
