// From the per-width results of the live pass to the rule's input. Pure.

import { LIVE_RULE } from "./live-rule.mjs";

const NOTICE = /(hook was skipped|module did not load|failed to load|did not load|was skipped)/i;

const seen = (c) => c.verdict === "complete" || c.verdict === "prefix";

function tally(cases) {
  const positives = cases.filter((c) => c.kind === "positive");
  const refusals = cases.filter((c) => c.kind === "refusal");
  const validPos = positives.filter((c) => c.valid);
  const validRef = refusals.filter((c) => c.valid);
  const perWidthValid = Object.fromEntries(LIVE_RULE.widths.map((w) => [w, validPos.filter((c) => c.width === w).length]));
  return { positives, refusals, validPos, validRef, perWidthValid };
}

/** How many valid, exact positives hold each class of non-ASCII text in their payload. */
export function unicodeCoverage(cases) {
  const counts = {};
  for (const c of cases.filter((x) => x.kind === "positive" && x.valid && x.exact)) {
    for (const name of c.unicode ?? []) counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** Totals over every launch: stub requests, sockets, records, canary, notices. */
function launchTotals(launches) {
  const sum = (pick) => launches.reduce((n, l) => n + pick(l), 0);
  const stubLines = launches.flatMap((l) => l.stub?.lines ?? []);
  return {
    stubRequests: stubLines.length,
    stubModelRequests: stubLines.filter((x) => x.includes("/v1/messages")).length,
    assistantRecordsAdded: sum((l) => Math.max(0, (l.sessionRecords?.assistant ?? 0) - (l.expectedAssistant ?? 0))),
    externalSockets: sum((l) => l.network?.socketObservations?.external ?? 0),
    unattributedWrites: sum((l) => l.writes?.unattributed ?? 0),
    canaryLeaks: sum((l) => (l.canaryHits?.length ?? 0) + (l.canaryOnScreen ? 1 : 0)),
    loadNotices: sum((l) => (l.noticeHits?.length ?? 0)),
  };
}

/**
 * @param {object} o
 * @param {object[]} o.launches the results.json of each width
 * @param {{ok:boolean, failures:string[]}} o.controls
 * @param {string} o.clipboardBefore
 * @param {string} o.clipboardAfter
 * @param {string[]} o.classesRequired
 */
export function buildSummary({ launches, controls, clipboardBefore, clipboardAfter, classesRequired }) {
  const cases = launches.flatMap((l) => l.cases ?? []);
  const t = tally(cases);
  const blocked = launches.find((l) => l.error || !l.drawn);
  return {
    engineBlocked: blocked ? `launch at width ${blocked.width}: ${blocked.error ?? "not drawn"}` : launches.length === 0 ? "no launch ran" : null,
    plannedCases: launches.reduce((n, l) => n + (l.planned ?? 0), 0),
    validCases: cases.filter((c) => c.valid).length,
    validPositives: t.validPos.length,
    exactPositives: t.validPos.filter((c) => c.exact).length,
    perWidthValid: t.perWidthValid,
    classesPresent: [...new Set(t.validPos.filter((c) => c.exact).map((c) => c.anchor))],
    classesRequired,
    nonAsciiValid: t.validPos.filter((c) => c.nonAscii && c.exact).length,
    unicodeCoverage: unicodeCoverage(cases),
    wrongPayloads: cases.filter((c) => c.wrongPayload).length,
    refusalValid: t.validRef.length,
    refusalWithWrites: t.validRef.filter((c) => c.writeEvents > 0).length,
    refusalToastSeen: t.validRef.filter(seen).length,
    wrongToasts: cases.filter((c) => c.verdict === "wrong").length,
    toastSeenCases: cases.filter(seen).length,
    controlsHold: controls.ok,
    controlFailures: controls.failures,
    clipboardBefore,
    clipboardAfter,
    ...launchTotals(launches),
  };
}

/** Does any text in `screenText` look like a module-load or hook-skipped notice? */
export function noticeLines(screenText) {
  return screenText.split("\n").filter((row) => NOTICE.test(row)).map((row) => row.trim().slice(0, 160));
}

/** The unicode probe of the control launch, as the rule's condition 12 reads it. */
export function probeSummary(controlLaunch) {
  const cases = controlLaunch?.cases ?? [];
  const exact = cases.filter((c) => c.valid && c.exact);
  return {
    planned: controlLaunch?.planned ?? 0,
    valid: cases.filter((c) => c.valid).length,
    exact: exact.length,
    wrongPayloads: cases.filter((c) => c.wrongPayload).length,
    wrongToasts: cases.filter((c) => c.verdict === "wrong").length,
    emDashExact: exact.filter((c) => (c.unicode ?? []).includes("emdash")).length,
    zwjExact: exact.filter((c) => (c.unicode ?? []).includes("zwj")).length,
  };
}

/**
 * The summary for rule version 2: version 1's, plus the real-clipboard read
 * count, the positive control and the unicode probe of the control launch.
 * @param {object} o buildSummary's input plus
 * @param {object|null} o.controlLaunch results.json of the control launch
 * @param {{reads:number}} o.clip the counted real-clipboard reads (clipboard-hash.mjs), with before/after hashes
 */
export function buildSummary2({ controlLaunch, clip, ...rest }) {
  const base = buildSummary({ ...rest, clipboardBefore: clip.before, clipboardAfter: clip.after });
  const blocked = controlLaunch && (controlLaunch.error || !controlLaunch.drawn);
  const unattributedWrites = base.unattributedWrites + (controlLaunch?.writes?.unattributed ?? 0);
  return {
    ...base,
    // A writer call no case was given was made where nobody judged it: it counts as a wrong payload.
    wrongPayloadsJudged: base.wrongPayloads,
    unattributedWrites,
    wrongPayloads: base.wrongPayloads + unattributedWrites,
    engineBlocked: base.engineBlocked ?? (blocked ? `control launch: ${controlLaunch.error ?? "not drawn"}` : null),
    externalSockets: base.externalSockets + (controlLaunch?.network?.socketObservations?.external ?? 0),
    clipReads: clip.reads,
    control: controlLaunch?.control ?? null,
    probe: controlLaunch ? probeSummary(controlLaunch) : null,
  };
}
