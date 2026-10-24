import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PROBE_MARKER, PROBE_MESSAGES, judgeControl, probeCases, probeTurns } from "../lib/live-control.mjs";
import { unicodeClasses } from "../lib/unicode-classes.mjs";

describe("the control launch: unicode probe", () => {
  test("six assistant replies, each after a user turn, the marker only in the last", () => {
    const turns = probeTurns();
    assert.equal(turns.length, 12);
    assert.deepEqual(turns.map((t) => t.role), Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? "user" : "assistant")));
    const withMarker = turns.filter((t) => t.text.includes(PROBE_MARKER));
    assert.equal(withMarker.length, 1);
    assert.equal(turns.at(-1), withMarker[0]);
  });

  test("every probe case expects text that is really inside its reply, and ranks count from the newest", () => {
    const cases = probeCases(120);
    assert.ok(cases.length >= 10);
    for (const c of cases) {
      assert.equal(c.kind, "positive");
      assert.equal(c.accepted.length, 1);
      assert.ok(PROBE_MESSAGES[c.message].includes(c.accepted[0]), c.id);
      assert.equal(c.rank, PROBE_MESSAGES.length - c.message);
      assert.ok(c.fixture.includes(c.accepted[0]), "the copy holds the payload");
      assert.equal(c.mode, "fixture");
    }
  });

  test("a full-line copy carries the terminal's two-space margin; a partial copy does not", () => {
    const cases = probeCases(120);
    const full = cases.filter((c) => c.covers[0] === "line");
    const partial = cases.filter((c) => c.covers[0] === "part");
    assert.ok(full.length >= 6 && partial.length >= 4);
    assert.ok(full.every((c) => c.fixture === `  ${c.accepted[0]}`));
    assert.ok(partial.every((c) => c.fixture === c.accepted[0]));
  });

  test("the probe covers the classes the generator never produces: em dash, joined emoji, flags, combining, no-break space, right-to-left", () => {
    const seen = new Set(probeCases(120).flatMap((c) => unicodeClasses(c.accepted[0])));
    for (const name of ["emdash", "zwj", "flag", "combining", "nbsp", "rtl", "cjk", "accent", "astral"]) {
      assert.ok(seen.has(name), name);
    }
    for (const c of probeCases(120)) assert.equal(c.nonAscii, unicodeClasses(c.accepted[0]).length > 0, c.id);
  });

  test("every case is at least 12 characters, the matcher's floor", () => {
    for (const c of probeCases(120)) assert.ok(Array.from(c.accepted[0]).length >= 12, c.id);
  });
});

describe("the control launch: positive control for 'no model turn'", () => {
  test("holds only when /cc caused no request and an ordinary prompt caused at least one POST to /v1/messages", () => {
    assert.equal(judgeControl({ afterCc: [], afterPrompt: ["POST /v1/messages?beta=true"] }).ok, true);
    assert.equal(judgeControl({ afterCc: [], afterPrompt: ["POST /v1/messages", "POST /v1/messages"] }).ok, true);
  });

  test("fails when /cc already made a request, or the prompt made none, or only a non-message request", () => {
    assert.equal(judgeControl({ afterCc: ["POST /v1/messages"], afterPrompt: ["POST /v1/messages"] }).ok, false);
    assert.equal(judgeControl({ afterCc: [], afterPrompt: [] }).ok, false);
    assert.equal(judgeControl({ afterCc: [], afterPrompt: ["GET /health"] }).ok, false);
  });

  test("reports the counts, so a failure says which half failed", () => {
    const j = judgeControl({ afterCc: ["GET /x"], afterPrompt: ["GET /x", "POST /v1/messages"] });
    assert.deepEqual([j.requestsAfterCc, j.requestsAfterPrompt, j.messageRequestsAfterPrompt], [1, 2, 1]);
    assert.match(j.detail, /after \/cc 1/);
  });
});
