// `run`: for each saved copy, rebuild the window of messages that real use
// would have seen and ask findSource for the answer.
//
// PRIVACY: the report holds COUNTS AND IDS ONLY (ids, result kinds, numbers,
// booleans). The copied text and the returned text exist in `shown`, and only
// when the caller asks for it (run --show); otherwise they never leave
// evaluateCaptures.

import { findSource } from "../core/match.ts";
import type { FindResult } from "../core/match.ts";
import { fingerprintOf } from "./fingerprint.ts";
import { listCaptureIds, readCapture } from "./store.ts";
import { TranscriptIndex } from "./window.ts";
import type { CaptureWindow } from "./window.ts";

export type Kind =
  "ok" | "ambiguous" | "no-match" | "too-short" | "empty" | "no-window";

export const KINDS: readonly Kind[] = [
  "ok",
  "ambiguous",
  "no-match",
  "too-short",
  "empty",
  "no-window",
];

export interface CaptureRow {
  id: string;
  kind: Kind;
  /** Characters of the matched text (after the terminal's decoration is stripped); null for a refusal. */
  projectedChars: number | null;
  /** Places the copy was found in the winning message; 0 for a refusal. */
  candidates: number;
  /** Messages in the window (0 when no session had spoken yet). */
  windowSize: number;
  /** Where the matched message sat in the window, 0 = newest; null for a refusal. */
  matchedMessageRank: number | null;
  /** The paste text differs from the exact source slice (container prefixes dropped); null for a refusal. */
  pasteDiffersFromExact: boolean | null;
  /** Seconds between the window's newest message and the copy; null with no window. */
  windowAgeSeconds: number | null;
  /** Other main sessions that spoke within 5 minutes before the chosen one (the session choice was a guess). */
  rivalSessions: number;
}

/** What --show prints. Present only when asked for. */
export interface Shown {
  id: string;
  kind: Kind;
  copied: string;
  /** The text /cc would put on the clipboard; null for a refusal. */
  paste: string | null;
  differsFromExact: boolean | null;
  /** The short code the person writes after their verdict (see fingerprint.ts). */
  code: string;
}

export type Totals = Record<Kind, number> & { captures: number };

export interface Evaluation {
  rows: CaptureRow[];
  shown: Shown[];
  /** The code of each capture's answer, by id. Never printed by run or tally. */
  codes: Record<string, string>;
  totals: Totals;
  corpus: CorpusCounts;
}

/** How many transcripts were looked at and how many could not be used. Counts only. */
export interface CorpusCounts {
  mainTranscripts: number;
  filesListed: number;
  filesSkippedSubagent: number;
  filesRead: number;
  filesUnreadable: number;
  filesTooLarge: number;
  linesUnparseable: number;
  /** Transcripts left out because --project did not match their folder. */
  filesSkippedProject: number;
  /** Assistant messages dropped: no timestamp, or not an ISO time with a zone. */
  messagesWithoutTime: number;
  /** Assistant messages dropped: the record is marked as a sidechain. */
  sidechainMessages: number;
}

function corpusCounts(index: TranscriptIndex): CorpusCounts {
  const s = index.stats;
  return {
    mainTranscripts: index.mainTranscripts,
    filesListed: s.filesListed,
    filesSkippedSubagent: s.filesSkippedSubagent,
    filesRead: s.filesRead,
    filesUnreadable: s.filesUnreadable,
    filesTooLarge: s.filesTooLarge,
    linesUnparseable: s.linesUnparseable,
    filesSkippedProject: index.filesSkippedProject,
    messagesWithoutTime: index.messagesWithoutTime,
    sidechainMessages: index.sidechainMessages,
  };
}

export interface EvaluateOptions {
  dir: string;
  root: string;
  /** Window size: the newest N messages of the chosen session. */
  messages: number;
  /** Only transcript folders whose name contains this text (case blind); null for all. */
  project?: string | null;
  /** Keep the copied and returned text in `shown` (run --show). */
  keepText: boolean;
}

function kindOf(result: FindResult, window: CaptureWindow | null): Kind {
  if (result.ok) return "ok";
  return result.reason === "no-match" && window === null
    ? "no-window"
    : result.reason;
}

function rowOf(
  id: string,
  kind: Kind,
  result: FindResult,
  window: CaptureWindow | null,
): CaptureRow {
  return {
    id,
    kind,
    projectedChars: result.ok ? result.projectedChars : null,
    candidates: result.ok ? result.candidates : 0,
    windowSize: window === null ? 0 : window.messages.length,
    matchedMessageRank: result.ok ? result.messageIndex : null,
    pasteDiffersFromExact: result.ok ? result.paste !== result.source : null,
    windowAgeSeconds: window === null ? null : Math.round(window.ageMs / 1000),
    rivalSessions: window === null ? 0 : window.rivalSessions,
  };
}

function tallyKinds(rows: readonly CaptureRow[]): Totals {
  const totals = { captures: rows.length } as Totals;
  for (const kind of KINDS) totals[kind] = 0;
  for (const row of rows) totals[row.kind]++;
  return totals;
}

function shownOf(
  row: CaptureRow,
  copied: string,
  result: FindResult,
  code: string,
): Shown {
  return {
    id: row.id,
    kind: row.kind,
    copied,
    paste: result.ok ? result.paste : null,
    differsFromExact: row.pasteDiffersFromExact,
    code,
  };
}

export function evaluateCaptures(opts: EvaluateOptions): Evaluation {
  const ids = listCaptureIds(opts.dir);
  const index = new TranscriptIndex(opts.root, { project: opts.project });
  const rows: CaptureRow[] = [];
  const shown: Shown[] = [];
  const codes: Record<string, string> = {};
  for (const id of ids) {
    const stored = readCapture(opts.dir, id);
    const window = index.windowAt(stored.mtimeMs, opts.messages);
    const result = findSource(stored.text, window?.messages ?? [], {
      maxMessages: opts.messages,
    });
    const row = rowOf(id, kindOf(result, window), result, window);
    rows.push(row);
    const code = fingerprintOf(
      row.kind,
      stored.text,
      result.ok ? result.paste : null,
    );
    codes[id] = code;
    if (opts.keepText) shown.push(shownOf(row, stored.text, result, code));
  }
  return {
    rows,
    shown,
    codes,
    totals: tallyKinds(rows),
    corpus: corpusCounts(index),
  };
}

export interface RunReport {
  tool: "copy-back captures run";
  config: { windowMessages: number };
  corpus: Evaluation["corpus"];
  captures: CaptureRow[];
  totals: Totals;
}

export function buildRunReport(e: Evaluation, messages: number): RunReport {
  return {
    tool: "copy-back captures run",
    config: { windowMessages: messages },
    corpus: e.corpus,
    captures: e.rows,
    totals: e.totals,
  };
}
