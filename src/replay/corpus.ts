// Reads assistant text blocks out of Claude Code session transcripts (JSONL)
// and samples them deterministically. PRIVACY: the text lives in memory only.
// Nothing here prints, logs or writes it, and no error path ever includes a
// line, a message or an exception message (JSON parse errors quote their
// input). Callers get counts.

import fs from "node:fs";
import path from "node:path";
import { mulberry32, shuffled } from "../sim/prng.ts";

export interface CorpusOptions {
  seed: number;
  /** How many messages to sample. */
  count: number;
  minChars?: number;
  maxChars?: number;
  /** At most this many messages from one transcript, so sessions are spread out. */
  perFile?: number;
  /** Skip transcripts larger than this. */
  maxFileBytes?: number;
  /**
   * Only main-session transcripts: skip anything under a "subagents" folder.
   * Those hold what agents wrote to each other, not what a person saw in a
   * terminal. Default false.
   */
  mainOnly?: boolean;
}

export interface CorpusStats {
  filesListed: number;
  /** Of the listed files, how many were left out by mainOnly. */
  filesSkippedSubagent: number;
  filesRead: number;
  filesUnreadable: number;
  filesTooLarge: number;
  linesParsed: number;
  linesUnparseable: number;
  assistantTextBlocks: number;
  textBlocksOutOfRange: number;
  duplicatesDropped: number;
  messagesSampled: number;
}

export function emptyStats(): CorpusStats {
  return {
    filesListed: 0,
    filesSkippedSubagent: 0,
    filesRead: 0,
    filesUnreadable: 0,
    filesTooLarge: 0,
    linesParsed: 0,
    linesUnparseable: 0,
    assistantTextBlocks: 0,
    textBlocksOutOfRange: 0,
    duplicatesDropped: 0,
    messagesSampled: 0,
  };
}

/** Every *.jsonl under `root`, sorted so a seed means the same thing twice. */
export function listTranscriptFiles(root: string): string[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(root, { recursive: true }) as string[];
  } catch {
    throw new Error("ROOT_UNREADABLE");
  }
  return entries
    .filter((entry) => entry.endsWith(".jsonl"))
    .map((entry) => path.join(root, entry))
    .sort();
}

/** Is this transcript a subagent's (a path segment named "subagents" below the root)? */
export function isSubagentTranscript(root: string, file: string): boolean {
  return path.relative(root, file).split(path.sep).includes("subagents");
}

/** One assistant text block, with what the record around it says about when and where. */
export interface AssistantText {
  text: string;
  /** Epoch ms of the record's timestamp, or null when it has none that parses. */
  time: number | null;
  /** The record is marked as a sidechain (a subagent's work, not what a person saw). */
  sidechain: boolean;
}

/** An ISO 8601 date and time WITH a zone (Z or +hh:mm); anything else is not trusted as a time. */
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * Date.parse alone is far too lenient (a bare "10" is a date in 2001, a stamp
 * with no zone is read as local time), so only ISO times with a zone count.
 */
function timeOf(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_WITH_ZONE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Visit the assistant text blocks of ONE transcript line. The one place that
 * parses transcript lines: counts lines parsed, lines unparseable and text
 * blocks seen in `stats`; a parse failure is counted, never quoted.
 */
export function visitAssistantLine(
  line: string,
  stats: CorpusStats,
  visit: (block: AssistantText) => void,
): void {
  if (line.length < 20 || !line.includes('"assistant"')) return;
  stats.linesParsed++;
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    stats.linesUnparseable++;
    return;
  }
  const entry = record as {
    type?: unknown;
    timestamp?: unknown;
    isSidechain?: unknown;
    message?: { content?: unknown };
  } | null;
  if (entry === null || typeof entry !== "object" || entry.type !== "assistant")
    return;
  const content = entry.message?.content;
  if (!Array.isArray(content)) return;
  const time = timeOf(entry.timestamp);
  const sidechain = entry.isSidechain === true;
  for (const block of content as Array<{ type?: unknown; text?: unknown }>) {
    if (block === null || typeof block !== "object") continue;
    if (block.type !== "text" || typeof block.text !== "string") continue;
    stats.assistantTextBlocks++;
    visit({ text: block.text, time, sidechain });
  }
}

/** Every assistant text block of one transcript's text, in file order. */
export function forEachAssistantText(
  raw: string,
  stats: CorpusStats,
  visit: (block: AssistantText) => void,
): void {
  for (const line of raw.split("\n")) visitAssistantLine(line, stats, visit);
}

/** The qualifying (200 to 20000 character) assistant text blocks of one transcript's text. */
function textBlocksOf(
  raw: string,
  stats: CorpusStats,
  minChars: number,
  maxChars: number,
): string[] {
  const found: string[] = [];
  forEachAssistantText(raw, stats, ({ text }) => {
    if (text.length >= minChars && text.length <= maxChars) found.push(text);
    else stats.textBlocksOutOfRange++;
  });
  return found;
}

/** The text of one transcript, or null (and a count) if it is too large or unreadable. */
function readTranscript(
  file: string,
  maxFileBytes: number,
  stats: CorpusStats,
): string | null {
  try {
    if (fs.statSync(file).size > maxFileBytes) {
      stats.filesTooLarge++;
      return null;
    }
    const raw = fs.readFileSync(file, "utf8");
    stats.filesRead++;
    return raw;
  } catch {
    stats.filesUnreadable++;
    return null;
  }
}

export function sampleCorpus(
  root: string,
  opts: CorpusOptions,
): { messages: string[]; stats: CorpusStats } {
  const minChars = opts.minChars ?? 200;
  const maxChars = opts.maxChars ?? 20_000;
  const perFile = opts.perFile ?? 4;
  const maxFileBytes = opts.maxFileBytes ?? 64 * 1024 * 1024;
  const stats = emptyStats();
  const rng = mulberry32(opts.seed);
  const listed = listTranscriptFiles(root);
  const kept =
    opts.mainOnly === true
      ? listed.filter((file) => !isSubagentTranscript(root, file))
      : listed;
  stats.filesListed = listed.length;
  stats.filesSkippedSubagent = listed.length - kept.length;
  const files = shuffled(rng, kept);
  const messages: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    if (messages.length >= opts.count) break;
    const raw = readTranscript(file, maxFileBytes, stats);
    if (raw === null) continue;
    const picks = shuffled(
      rng,
      textBlocksOf(raw, stats, minChars, maxChars),
    ).slice(0, perFile);
    for (const text of picks) {
      if (messages.length >= opts.count) break;
      if (seen.has(text)) {
        stats.duplicatesDropped++;
        continue;
      }
      seen.add(text);
      messages.push(text);
    }
  }
  stats.messagesSampled = messages.length;
  return { messages, stats };
}
