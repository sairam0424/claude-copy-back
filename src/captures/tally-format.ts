// The tally in plain words. COUNTS AND IDS ONLY, never a capture or a message.

import type { TallyReport } from "./tally.ts";

const percent = (value: number | null): string =>
  value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;

const list = (ids: readonly string[]): string =>
  ids.length === 0 ? "none" : ids.join(", ");

const withIds = (count: number, ids: readonly string[]): string =>
  count === 0 ? "0" : `${count} (ids ${ids.join(", ")})`;

/** Everything that keeps a PASS from being printed, one sentence each. */
function blockers(r: TallyReport): string[] {
  const out: string[] = [];
  if (r.invalidIds.length > 0)
    out.push(
      `invalid verdict files ${list(r.invalidIds)}: each must hold ok, bad or skip (and the code, if you write it)`,
    );
  if (r.unjudgedIds.length > 0)
    out.push(
      `not judged yet ${list(r.unjudgedIds)}: judge each one; write skip if you cannot tell`,
    );
  if (r.staleIds.length > 0)
    out.push(
      `${list(r.staleIds)}: the tool answers differently now than when you judged (the code no longer matches): run run --show again and judge these again`,
    );
  if (r.unboundIds.length > 0)
    out.push(
      `${list(r.unboundIds)}: judged without the code that run --show prints, so nothing ties the verdict to what you saw: write it again with the code`,
    );
  return out;
}

/** What is still missing when the verdict is INSUFFICIENT: judged copies, matched-and-right copies, or both. */
function missing(r: TallyReport): string[] {
  const out: string[] = [];
  if (r.k1.moreNeeded > 0)
    out.push(`${r.k1.moreNeeded} more to judge (${r.k1.minJudged} are needed)`);
  const more = r.k1.moreMatchedRightNeeded;
  if (more > 0)
    out.push(
      `${more} more matched and right copies are needed: only ${r.matches.judgedRight} so far where the tool returned text and you judged it ok, and a PASS needs ${r.k1.minMatchedRight}. Refusals judged right do not count here. Copy ${more} more regions the tool should be able to find (normal prose, lists, code blocks; not tables or command output), then add, run --show and judge them. Each one also counts toward the judged total.`,
    );
  return out;
}

function reasons(r: TallyReport): string[] {
  const out: string[] = [];
  if (r.dangerous > 0)
    out.push(
      `${r.dangerous} dangerous (the tool returned text you judged bad); a PASS is impossible${r.k1.early ? ", so this is already a FAIL however many more you judge" : ""}`,
    );
  if (r.k1.verdict === "INCOMPLETE")
    out.push(
      "nothing is decided until every item below is resolved",
      ...blockers(r),
    );
  if (r.k1.verdict === "INSUFFICIENT") out.push(...missing(r));
  if (
    r.k1.verdict === "FAIL" &&
    (r.okRate ?? 0) < r.k1.threshold &&
    !r.k1.early
  )
    out.push(
      `ok rate ${percent(r.okRate)} is below ${percent(r.k1.threshold)}`,
    );
  if (r.k1.verdict === "PASS")
    out.push(
      `${r.judged} judged, ok rate ${percent(r.okRate)}, ${r.matches.judgedRight} matched and judged right, no capture was judged dangerous`,
    );
  return out;
}

function settings(r: TallyReport): string[] {
  if (r.config === null) return [];
  const c = r.config;
  return [
    `  settings: window of the newest ${c.messages} replies; transcript folder ${c.customRoot ? "given with --root" : "default"}; project filter: ${c.projectFilter ? "on" : "off"}`,
  ];
}

const CLOSING = [
  "A pass here is the real stop-loss evidence for the mod; a fail means stop or rethink the mod.",
  "These captures are test data: do not tune the matcher on these captures before you have read the verdict, or a pass means nothing.",
];

/** Plain words for the person; counts and ids only. */
export function formatTally(r: TallyReport): string {
  const lines = [
    "copy-back tally (counts only, no text)",
    "",
    `  captures saved: ${r.captures}`,
    `  judged: ${r.judged} (ok ${r.ok}, bad ${r.bad})`,
    `  ok rate: ${percent(r.okRate)} (the bar is ${percent(r.k1.threshold)})`,
    `  dangerous: ${withIds(r.dangerous, r.dangerousIds)}  [bad although the tool returned text: wrong text on your clipboard; must be 0]`,
    `  matched and judged right: ${r.matches.judgedRight} of ${r.judged} (${percent(r.matchedRightRate)}; a PASS needs at least ${r.k1.minMatchedRight})`,
    `  refusals judged right to refuse: ${r.refusals.judgedOkToRefuse}`,
    `  refusals that missed a match: ${r.refusals.missedMatch}`,
    `  skipped: ${r.skip} (not counted as judged)`,
    `  not judged yet: ${withIds(r.unjudged, r.unjudgedIds)}`,
    `  invalid verdict files: ${r.invalid === 0 ? "none" : `${list(r.invalidIds)} (a verdict file must hold ok, bad or skip)`}`,
    `  verdicts that no longer match what the tool answers: ${list(r.staleIds)}`,
    `  judged verdicts written without the code: ${list(r.unboundIds)}`,
    `  verdict files with no capture: ${r.orphanVerdicts}`,
    ...settings(r),
    "",
    `K1 on real copies: ${r.k1.verdict}`,
    ...reasons(r).map((line) => `  ${line}`),
    ...r.notes.map((n) => `  Note: ${n}`),
    "",
    ...CLOSING,
    "",
  ];
  return lines.join("\n");
}
