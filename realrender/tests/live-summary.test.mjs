import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { applyLiveRule } from "../lib/live-rule.mjs";
import { applyLiveRule2 } from "../lib/live-rule-2.mjs";
import { buildSummary, buildSummary2, noticeLines, probeSummary } from "../lib/live-summary.mjs";

const pos = (width, i, over = {}) => ({ id: `w${width}-p${i}`, kind: "positive", width, anchor: `c${i % 3}`, valid: true, exact: true, wrongPayload: false, nonAscii: i === 1, verdict: "complete", writeEvents: 2, ...over });
const ref = (width, k, over = {}) => ({ id: `w${width}-r${k}`, kind: "refusal", width, valid: true, exact: null, wrongPayload: false, writeEvents: 0, verdict: "prefix", ...over });
const launch = (width, over = {}) => ({
  width, drawn: true, error: null, planned: 8, expectedAssistant: 40,
  cases: [pos(width, 1), pos(width, 2), pos(width, 3), pos(width, 4), pos(width, 5), pos(width, 6), ref(width, 1), ref(width, 2)],
  stub: { requests: 0, lines: [] }, network: { socketObservations: { external: 0 } }, canaryHits: [], canaryOnScreen: false, noticeHits: [],
  sessionRecords: { total: 80, assistant: 40, user: 40 }, ...over,
});
const controls = { ok: true, failures: [] };
const input = (launches) => ({ launches, controls, clipboardBefore: "h", clipboardAfter: "h", classesRequired: ["c0", "c1", "c2"] });

describe("live summary", () => {
  test("a clean pass over four widths satisfies the rule", () => {
    const s = buildSummary(input([60, 80, 100, 120].map((w) => launch(w))));
    assert.equal(s.validPositives, 24);
    assert.equal(s.exactPositives, 24);
    assert.deepEqual(s.perWidthValid, { 60: 6, 80: 6, 100: 6, 120: 6 });
    assert.equal(s.refusalValid, 8);
    assert.equal(s.plannedCases, 32);
    assert.equal(s.nonAsciiValid, 4);
    assert.equal(applyLiveRule(s).verdict, "LIVE PASS");
  });

  test("non-ASCII coverage is counted per class from the payload of valid exact positives", () => {
    const l = launch(60, {
      cases: [
        pos(60, 1, { nonAscii: true, unicode: ["emdash", "accent"] }),
        pos(60, 2, { nonAscii: true, unicode: ["accent"] }),
        pos(60, 3, { nonAscii: false, unicode: [] }),
        pos(60, 4, { nonAscii: true, unicode: ["cjk"], exact: false }),
        pos(60, 5, { nonAscii: true, unicode: ["zwj"], valid: false }),
      ],
    });
    const s = buildSummary(input([l]));
    assert.deepEqual(s.unicodeCoverage, { emdash: 1, accent: 2 });
    assert.equal(s.nonAsciiValid, 2);
  });

  test("a model request, an added assistant record, an external socket and a canary hit are all counted", () => {
    const bad = launch(60, {
      stub: { requests: 2, lines: ["POST /v1/messages?beta=true", "GET /health"] },
      sessionRecords: { total: 81, assistant: 41, user: 40 },
      network: { socketObservations: { external: 3 } }, canaryHits: ["home/x.log"], canaryOnScreen: true, noticeHits: ["hook was skipped"],
    });
    const s = buildSummary(input([bad]));
    assert.deepEqual([s.stubRequests, s.stubModelRequests, s.assistantRecordsAdded, s.externalSockets, s.canaryLeaks, s.loadNotices], [2, 1, 1, 3, 2, 1]);
  });

  test("wrong payloads count in refusal cases too, and wrong toasts are counted", () => {
    const l = launch(80, { cases: [pos(80, 1), ref(80, 1, { wrongPayload: true, writeEvents: 1 }), pos(80, 2, { verdict: "wrong" })] });
    const s = buildSummary(input([l]));
    assert.equal(s.wrongPayloads, 1);
    assert.equal(s.refusalWithWrites, 1);
    assert.equal(s.wrongToasts, 1);
  });

  test("a launch that did not draw is an engine block", () => {
    const s = buildSummary(input([launch(100, { drawn: false, error: "the session was not drawn", cases: undefined })]));
    assert.match(s.engineBlocked, /width 100/);
    assert.equal(applyLiveRule(s).verdict, "INCONCLUSIVE");
    assert.match(buildSummary(input([])).engineBlocked, /no launch/);
  });

  test("invalid cases are left out of the valid counts but stay in the planned count", () => {
    const l = launch(60, { cases: [pos(60, 1), pos(60, 2, { valid: false, exact: false })] });
    const s = buildSummary(input([l]));
    assert.deepEqual([s.validPositives, s.exactPositives, s.plannedCases, s.validCases], [1, 1, 8, 1]);
  });

  test("noticeLines picks out load and skip notices", () => {
    assert.deepEqual(noticeLines("fine\ncopy-back: hook was skipped: boom\nalso fine"), ["copy-back: hook was skipped: boom"]);
    assert.deepEqual(noticeLines("nothing\n"), []);
  });
});

describe("live summary, rule version 2", () => {
  const probeCase = (i, over = {}) => ({ id: `probe-${i}`, kind: "positive", valid: true, exact: true, wrongPayload: false, verdict: "complete", unicode: [], ...over });
  const control = (over = {}) => ({
    width: 120, drawn: true, error: null, planned: 3,
    cases: [probeCase(1, { unicode: ["emdash", "accent"] }), probeCase(2, { unicode: ["zwj", "astral"] }), probeCase(3)],
    control: { ok: true, detail: "requests after /cc 0, after the ordinary prompt 1 (POST /v1/messages 1)" },
    network: { socketObservations: { external: 0 } }, ...over,
  });
  const clip = { reads: 2, before: "h", after: "h" };
  const input2 = (over = {}) => ({ launches: [60, 80, 100, 120].map((w) => launch(w)), controls, classesRequired: ["c0", "c1", "c2"], controlLaunch: control(), clip, ...over });

  test("the probe is read from the control launch's cases", () => {
    assert.deepEqual(probeSummary(control()), { planned: 3, valid: 3, exact: 3, wrongPayloads: 0, wrongToasts: 0, emDashExact: 1, zwjExact: 1 });
    assert.deepEqual(probeSummary(null), { planned: 0, valid: 0, exact: 0, wrongPayloads: 0, wrongToasts: 0, emDashExact: 0, zwjExact: 0 });
  });

  test("a clean pass with a control launch carries the reads, the control and the probe into the summary", () => {
    const s = buildSummary2(input2());
    assert.equal(s.clipReads, 2);
    assert.equal(s.control.ok, true);
    assert.equal(s.probe.emDashExact, 1);
    assert.equal(s.stubRequests, 0, "the control launch's prompt request is not counted against /cc");
  });

  test("the control launch's sockets count against condition 9 and a launch that did not draw blocks the engine", () => {
    assert.equal(buildSummary2(input2({ controlLaunch: control({ network: { socketObservations: { external: 2 } } }) })).externalSockets, 2);
    assert.match(buildSummary2(input2({ controlLaunch: control({ drawn: false, error: "the session was not drawn" }) })).engineBlocked, /control launch/);
  });

  test("a writer call that no case holds counts as a wrong payload in version 2", () => {
    const l = launch(60, { writes: { shimCalls: 5, attributed: 4, unattributed: 1 } });
    const s = buildSummary2(input2({ launches: [l, launch(80), launch(100), launch(120)], controlLaunch: control({ writes: { shimCalls: 3, attributed: 1, unattributed: 2 } }) }));
    assert.equal(s.unattributedWrites, 3);
    assert.equal(s.wrongPayloadsJudged, 0);
    assert.equal(s.wrongPayloads, 3);
    assert.deepEqual(applyLiveRule2(s).checks.filter((c) => !c.ok).map((c) => c.n).includes(4), true);
  });

  test("the summary feeds rule 2: the probe cases are too few here, so it fails on condition 12 only", () => {
    const v = applyLiveRule2(buildSummary2(input2()));
    assert.deepEqual(v.checks.filter((c) => !c.ok).map((c) => c.n), [12]);
  });
});
