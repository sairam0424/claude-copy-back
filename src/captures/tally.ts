// `tally`: read the verdicts, combine each with a fresh run result, and decide
// whether the mod passes K1 on REAL copies. COUNTS AND IDS ONLY, never text.
//
//   verdict ok   tool returned text: the text was right.
//                tool refused:       refusing was right (nothing to find).
//   verdict bad  tool returned text: the text was WRONG. This is DANGEROUS.
//                tool refused:       it should have found the copy (a miss).
//   verdict skip not a fair test; not counted as judged.
//
// PASS (pre-registered, frozen before any real result) needs ALL of:
//   - at least 20 judged (ok plus bad);
//   - ok/judged at least 70%;
//   - at least 10 copies MATCHED AND RIGHT: the tool returned text and the
//     person judged it ok. A refusal judged right counts toward the 70% but
//     never toward these 10, so a tool that refuses everything cannot pass;
//   - zero dangerous results;
//   - nothing unresolved: no invalid verdict file, no capture left unjudged,
//     no verdict that no longer matches what the tool answers, no judged
//     verdict written without its code.
// The checks run in this order, the first that applies decides:
//   dangerous: FAIL (at once, at any count)    unresolved: INCOMPLETE
//   under 20 judged: INSUFFICIENT              ok rate under 70%: FAIL
//   under 10 matched and right: INSUFFICIENT   otherwise: PASS

import { evaluateCaptures } from "./run.ts";
import type { Kind } from "./run.ts";
import { notesFor } from "./tally-notes.ts";
import type { TallyConfig, TallyExtras } from "./tally-notes.ts";
import { listCaptureIds, listVerdictIds, readVerdictFile } from "./store.ts";
import { parseVerdictLine } from "./verdict.ts";
import type { Verdict } from "./verdict.ts";

export { formatTally } from "./tally-format.ts";
export { parseVerdict } from "./verdict.ts";
export type { Verdict } from "./verdict.ts";
export type { TallyConfig, TallyExtras } from "./tally-notes.ts";

/** How a judged verdict relates to what the tool answers now. */
export type Binding =
  /** Its code matches the fresh answer: it was written about this very answer. */
  | "bound"
  /** Its code differs: the tool (or the window, or the capture) changed since it was written. */
  | "stale"
  /** The file holds the word only, so nothing ties it to what the person saw. */
  | "unbound";

export interface TallyEntry {
  id: string;
  /** What the tool answered for this capture just now. */
  kind: Kind;
  /** The person's verdict; "invalid" for a file that holds anything else; null when there is no file. */
  verdict: Verdict | "invalid" | null;
  binding: Binding;
  /** Other main sessions that were active around the copy (the session choice was a guess). */
  rivalSessions: number;
  /** Messages in the window. */
  windowSize: number;
}

export const MIN_JUDGED = 20;
/** ok / judged must be at least PASS_NUMERATOR / PASS_DENOMINATOR (70%), compared in whole numbers. */
const PASS_NUMERATOR = 7;
const PASS_DENOMINATOR = 10;
const THRESHOLD = PASS_NUMERATOR / PASS_DENOMINATOR;
/**
 * A PASS needs at least this many copies matched and judged right (half the
 * bar of judged copies), whatever the ok rate. Refusals judged right never count.
 */
export const MIN_MATCHED_RIGHT = MIN_JUDGED / 2;

export type K1Verdict = "PASS" | "INSUFFICIENT" | "FAIL" | "INCOMPLETE";

export interface TallyReport {
  tool: "copy-back captures tally";
  captures: number;
  judged: number;
  ok: number;
  bad: number;
  skip: number;
  invalid: number;
  invalidIds: string[];
  unjudged: number;
  unjudgedIds: string[];
  /** Judged verdicts whose code no longer matches the tool's answer. */
  staleIds: string[];
  /** Judged verdicts written without a code. */
  unboundIds: string[];
  orphanVerdicts: number;
  /** Verdict bad where the tool returned text: it would have put the wrong text on the clipboard. */
  dangerous: number;
  dangerousIds: string[];
  refusals: { judgedOkToRefuse: number; missedMatch: number };
  /** Of the missed matches, those with another active session or a tiny window: the session choice is suspect. */
  suspectMisses: number;
  matches: { judgedRight: number };
  okRate: number | null;
  matchedRightRate: number | null;
  config: TallyConfig | null;
  notes: string[];
  k1: {
    verdict: K1Verdict;
    minJudged: number;
    threshold: number;
    moreNeeded: number;
    /** A PASS needs this many copies where the tool returned text and the person judged it ok. */
    minMatchedRight: number;
    /** How many more matched-and-right copies a PASS needs (each also counts as judged). */
    moreMatchedRightNeeded: number;
    /** A FAIL decided by a dangerous result before the bar of 20 judged. */
    early: boolean;
  };
}

const rate = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number((part / whole).toFixed(4));

const idsOf = (
  entries: readonly TallyEntry[],
  pick: (e: TallyEntry) => boolean,
): string[] => entries.filter(pick).map((e) => e.id);

const isJudged = (e: TallyEntry): boolean =>
  e.verdict === "ok" || e.verdict === "bad";

/** A window shorter than this is a sign the wrong (a fresh, short) session was chosen. */
export const TINY_WINDOW = 10;

const isSuspectSession = (e: TallyEntry): boolean =>
  e.rivalSessions > 0 || e.windowSize < TINY_WINDOW || e.kind === "no-window";

interface Counts {
  judged: number;
  ok: number;
  dangerous: number;
  unresolved: number;
  judgedRight: number;
}

function decide(c: Counts): K1Verdict {
  if (c.dangerous > 0) return "FAIL";
  if (c.unresolved > 0) return "INCOMPLETE";
  if (c.judged < MIN_JUDGED) return "INSUFFICIENT";
  if (c.ok * PASS_DENOMINATOR < c.judged * PASS_NUMERATOR) return "FAIL";
  return c.judgedRight < MIN_MATCHED_RIGHT ? "INSUFFICIENT" : "PASS";
}

interface Classified {
  dangerousIds: string[];
  judgedRight: number;
  okToRefuse: number;
  missed: TallyEntry[];
  staleIds: string[];
  unboundIds: string[];
}

/** Judged verdicts split by what they mean. A stale verdict means nothing about today's answer. */
function classify(entries: readonly TallyEntry[]): Classified {
  const live = entries.filter((e) => isJudged(e) && e.binding !== "stale");
  const returned = (e: TallyEntry): boolean => e.kind === "ok";
  return {
    dangerousIds: idsOf(live, (e) => e.verdict === "bad" && returned(e)),
    judgedRight: live.filter((e) => e.verdict === "ok" && returned(e)).length,
    okToRefuse: live.filter((e) => e.verdict === "ok" && !returned(e)).length,
    missed: live.filter((e) => e.verdict === "bad" && !returned(e)),
    staleIds: idsOf(entries, (e) => isJudged(e) && e.binding === "stale"),
    unboundIds: idsOf(entries, (e) => isJudged(e) && e.binding === "unbound"),
  };
}

interface Tallied {
  counts: Counts;
  ok: number;
  bad: number;
  skip: number;
  invalidIds: string[];
  unjudgedIds: string[];
}

function tallied(entries: readonly TallyEntry[], c: Classified): Tallied {
  const count = (verdict: TallyEntry["verdict"]): number =>
    entries.filter((e) => e.verdict === verdict).length;
  const [ok, bad] = [count("ok"), count("bad")];
  const invalidIds = idsOf(entries, (e) => e.verdict === "invalid");
  const unjudgedIds = idsOf(entries, (e) => e.verdict === null);
  const unresolved =
    invalidIds.length +
    unjudgedIds.length +
    c.staleIds.length +
    c.unboundIds.length;
  return {
    counts: {
      judged: ok + bad,
      ok,
      dangerous: c.dangerousIds.length,
      unresolved,
      judgedRight: c.judgedRight,
    },
    ok,
    bad,
    skip: count("skip"),
    invalidIds,
    unjudgedIds,
  };
}

function k1Of(c: Counts): TallyReport["k1"] {
  const verdict = decide(c);
  return {
    verdict,
    minJudged: MIN_JUDGED,
    threshold: THRESHOLD,
    moreNeeded: Math.max(0, MIN_JUDGED - c.judged),
    minMatchedRight: MIN_MATCHED_RIGHT,
    moreMatchedRightNeeded: Math.max(0, MIN_MATCHED_RIGHT - c.judgedRight),
    early: verdict === "FAIL" && c.judged < MIN_JUDGED,
  };
}

export function summarize(
  entries: readonly TallyEntry[],
  extras: TallyExtras = {},
): TallyReport {
  const c = classify(entries);
  const t = tallied(entries, c);
  const suspectMisses = c.missed.filter(isSuspectSession).length;
  return {
    tool: "copy-back captures tally",
    captures: entries.length,
    judged: t.counts.judged,
    ok: t.ok,
    bad: t.bad,
    skip: t.skip,
    invalid: t.invalidIds.length,
    invalidIds: t.invalidIds,
    unjudged: t.unjudgedIds.length,
    unjudgedIds: t.unjudgedIds,
    staleIds: c.staleIds,
    unboundIds: c.unboundIds,
    orphanVerdicts: extras.orphanVerdicts ?? 0,
    dangerous: t.counts.dangerous,
    dangerousIds: c.dangerousIds,
    refusals: { judgedOkToRefuse: c.okToRefuse, missedMatch: c.missed.length },
    suspectMisses,
    matches: { judgedRight: c.judgedRight },
    okRate: rate(t.ok, t.counts.judged),
    matchedRightRate: rate(c.judgedRight, t.counts.judged),
    config: extras.config ?? null,
    notes: notesFor(
      {
        noWindow: entries.filter((e) => e.kind === "no-window").length,
        okToRefuse: c.okToRefuse,
        judgedRight: c.judgedRight,
        missed: c.missed.length,
        suspectMisses,
      },
      extras,
    ),
    k1: k1Of(t.counts),
  };
}

export interface TallyOptions {
  dir: string;
  root: string;
  messages: number;
  project?: string | null;
  /** Whether --root was given (printed as a word, never as a path). */
  customRoot?: boolean;
}

function bindingOf(code: string | null, fresh: string): Binding {
  if (code === null) return "unbound";
  return code === fresh ? "bound" : "stale";
}

/** Run every saved copy again, read the verdict files, and summarise. */
export function tallyDirectory(opts: TallyOptions): TallyReport {
  const project = opts.project ?? null;
  const { rows, corpus, codes } = evaluateCaptures({
    dir: opts.dir,
    root: opts.root,
    messages: opts.messages,
    project,
    keepText: false,
  });
  const entries: TallyEntry[] = rows.map((row) => {
    const raw = readVerdictFile(opts.dir, row.id);
    const parsed = raw === null ? null : parseVerdictLine(raw);
    return {
      id: row.id,
      kind: row.kind,
      verdict: raw === null ? null : (parsed?.verdict ?? "invalid"),
      binding: bindingOf(parsed?.code ?? null, codes[row.id] as string),
      rivalSessions: row.rivalSessions,
      windowSize: row.windowSize,
    };
  });
  const captured = new Set(listCaptureIds(opts.dir));
  const orphans = listVerdictIds(opts.dir).filter((id) => !captured.has(id));
  return summarize(entries, {
    orphanVerdicts: orphans.length,
    transcriptsNotRead: corpus.filesTooLarge + corpus.filesUnreadable,
    messagesWithoutTime: corpus.messagesWithoutTime,
    sidechainMessages: corpus.sidechainMessages,
    projectMatchedNothing: project !== null && corpus.mainTranscripts === 0,
    config: {
      messages: opts.messages,
      customRoot: opts.customRoot ?? false,
      projectFilter: project !== null,
    },
  });
}

