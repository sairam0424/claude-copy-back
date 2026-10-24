import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { CANARY, interleave, mutate, pickSample, planWidth, positiveCase, refusalCases } from "../lib/live-cases.mjs";
import { LIVE_RULE } from "../lib/live-rule.mjs";

const rec = (i, copied) => ({ width: 80, message: i, anchor: "para", covers: ["para"], pasteForms: [` ${copied} `, "alt form"], copied });
const records = Array.from({ length: 13 }, (_, i) => rec(i * 3, `gadget${1000 + i} and pillar${2000 + i} walk over the bridge today`));

describe("live case planning", () => {
  test("a positive carries the accepted forms (trimmed), the rank and the non-ASCII flag", () => {
    const p = positiveCase(rec(7, "héllo wörld 1234"), "héllo wörld 1234", 3);
    assert.equal(p.id, "w80-p03");
    assert.equal(p.rank, 33);
    assert.equal(p.nonAscii, true);
    assert.deepEqual(p.accepted, ["héllo wörld 1234", "alt form"]);
    assert.equal(positiveCase(rec(7, "x"), null, 1).nonAscii, false);
  });

  test("the non-ASCII flag follows the PAYLOAD, not the screen copy: a quote bar the renderer draws is not coverage", () => {
    const quoted = { ...rec(9, "ignored"), pasteForms: ["a quoted sentence about gadgets 1234"] };
    const p = positiveCase(quoted, "  ▎ a quoted sentence about gadgets 1234", 1);
    assert.equal(p.nonAscii, false);
    assert.deepEqual(p.unicode, []);
    assert.equal(p.screenOnlyNonAscii, true);
  });

  test("a payload with an em dash and an emoji names its classes", () => {
    const wide = { ...rec(9, "x"), pasteForms: ["Café — résumé 🚀 here"] };
    const p = positiveCase(wide, "  Café — résumé 🚀 here", 2);
    assert.equal(p.nonAscii, true);
    assert.deepEqual(p.unicode, ["emdash", "accent", "astral"]);
    assert.equal(p.screenOnlyNonAscii, false);
  });

  test("a null live copy still describes the payload", () => {
    const p = positiveCase(rec(7, "héllo"), null, 1);
    assert.equal(p.nonAscii, true, "the payload is non-ASCII even when the screen could not give a copy");
    assert.equal(p.fixture, null);
  });

  test("mutate changes exactly one digit of the first four-digit run", () => {
    assert.equal(mutate("see gadget0412 and pillar0999"), "see gadget0413 and pillar0999");
    assert.equal(mutate("pillar0009 x"), "pillar0000 x");
    assert.equal(mutate("no digits at all"), "no digits at all");
  });

  test("eight refusal kinds, each with a canonical toast line, in the registered order", () => {
    const cases = refusalCases(100, "gadget0412 pillar0413 plus more words to make it long enough");
    assert.deepEqual(cases.map((c) => c.refusal), LIVE_RULE.refusalKinds);
    assert.ok(cases.every((c) => c.kind === "refusal" && c.expectedLine.startsWith("copy-back: ")));
    const by = Object.fromEntries(cases.map((c) => [c.refusal, c]));
    assert.equal(by.exit1.mode, "exit1");
    assert.equal(by.sleep.mode, "sleep");
    assert.equal(by.huge.mode, "huge");
    assert.equal(by.short.fixture.length, 10);
    assert.equal(by.empty.fixture, "");
    assert.equal(by.blank.fixture.trim(), "");
    assert.ok(by.canary.fixture.includes(CANARY) && by.canary.fixture.length >= 12);
    assert.notEqual(by.mutated.fixture, "gadget0412 pillar0413 plus more words to make it long enough");
  });

  test("a refusal follows every sixth positive and the rest come last", () => {
    const pos = Array.from({ length: 13 }, (_, i) => ({ id: `p${i}`, kind: "positive" }));
    const ref = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, kind: "refusal" }));
    const ids = interleave(pos, ref).map((c) => c.id);
    assert.equal(ids.length, 21);
    assert.equal(ids[6], "r0");
    assert.equal(ids[13], "r1");
    assert.deepEqual(ids.slice(-6), ["r2", "r3", "r4", "r5", "r6", "r7"].slice(0, 6));
  });

  test("planWidth skips records the live screen could not give and keeps file order", () => {
    const copies = records.map((r, i) => (i === 4 ? null : r.copied));
    const plan = planWidth({ width: 80, records, copies });
    const positives = plan.filter((c) => c.kind === "positive");
    assert.equal(positives.length, 12);
    assert.deepEqual(positives.map((c) => c.id).slice(0, 5), ["w80-p01", "w80-p02", "w80-p03", "w80-p04", "w80-p06"]);
    assert.equal(plan.filter((c) => c.kind === "refusal").length, 8);
  });

  test("pickSample needs a long copy with a digit run", () => {
    assert.throws(() => pickSample([{ fixture: "short 1234" }]), /no copy long enough/);
    assert.equal(pickSample([{ fixture: null }, { fixture: "x".repeat(40) + "1234" }]).length, 44);
  });
});
