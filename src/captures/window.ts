// The window of messages a capture would have seen on screen.
//
//   * Only MAIN-session transcripts count: nothing under a "subagents" path,
//     and no record marked as a sidechain.
//   * For a capture made at time T, every main transcript has an ANCHOR: the
//     time of its latest assistant text message at or before T. The chosen
//     session is the one whose anchor is closest to T.
//   * The window is that session's newest N assistant text messages at or
//     before T, newest first.
//   * Other main sessions that spoke shortly before T (ACTIVE_MS) or shortly
//     before the chosen anchor (RIVAL_MS) are counted as rivals: the choice
//     between them is a guess, and the count tells the person when it was one.
//   * --project keeps only transcript folders whose name contains some text.
//
// Speed: a transcript cannot hold a message newer than its own file time, so
// files are visited newest-file-first and the search stops once no remaining
// file could beat the best anchor or count as a rival.
//
// PRIVACY: message text lives in memory only and is handed to the matcher.
// Nothing here prints, logs or throws a message.

import fs from "node:fs";
import path from "node:path";
import {
  emptyStats,
  isSubagentTranscript,
  listTranscriptFiles,
  visitAssistantLine,
} from "../replay/corpus.ts";
import type { CorpusStats } from "../replay/corpus.ts";
import { CapturesError } from "./errors.ts";
import { forEachLine } from "./lines.ts";

/** Sessions with a message this close before the chosen one's are reported as rivals. */
export const RIVAL_MS = 5 * 60_000;
/** Sessions that spoke this recently before the copy are rivals too: the person may have been reading any of them. */
export const ACTIVE_MS = 30 * 60_000;
/** A message is stamped just before its file is written; allow for rounding. */
const SLACK_MS = 1_000;
/** Sessions whose message texts stay in memory at once. */
const TEXT_CACHE_SIZE = 2;
/** Transcripts are read line by line, so size is no limit for memory; this only stops a runaway file. */
const DEFAULT_MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024;

export interface CaptureWindow {
  /** The newest messages at or before the capture time, newest first. */
  messages: string[];
  /** Time of the newest message in the window. */
  anchorMs: number;
  /** Capture time minus anchor. */
  ageMs: number;
  /** Other main sessions active just before the copy or just before the anchor (the choice was a guess between them). */
  rivalSessions: number;
}

export interface IndexOptions {
  maxFileBytes?: number;
  /** Only transcript folders whose name contains this text (case blind); null or absent for all. */
  project?: string | null;
}

interface Timed {
  time: number;
  text: string;
}

interface FileInfo {
  file: string;
  mtimeMs: number;
}

interface Scored {
  file: string;
  anchor: number;
}

/** How many of the ascending `times` are at or before `limit`. */
function countAtOrBefore(times: readonly number[], limit: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] as number) <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Is this file in a project folder (the first folder under the root) whose name contains `project`? */
function inProject(root: string, file: string, project: string | null): boolean {
  if (project === null) return true;
  const parts = path.relative(root, file).split(path.sep);
  return (
    parts.length > 1 &&
    (parts[0] as string).toLowerCase().includes(project.toLowerCase())
  );
}

function mainFiles(
  root: string,
  stats: CorpusStats,
  project: string | null,
): { files: FileInfo[]; skippedByProject: number } {
  let listed: string[];
  try {
    listed = listTranscriptFiles(root);
  } catch {
    throw new CapturesError("ROOT_UNREADABLE");
  }
  stats.filesListed = listed.length;
  const out: FileInfo[] = [];
  let skippedByProject = 0;
  for (const file of listed) {
    if (isSubagentTranscript(root, file)) {
      stats.filesSkippedSubagent++;
      continue;
    }
    if (!inProject(root, file, project)) {
      skippedByProject++;
      continue;
    }
    try {
      out.push({ file, mtimeMs: fs.statSync(file).mtimeMs });
    } catch {
      stats.filesUnreadable++;
    }
  }
  // Newest file first; equal times keep path order, so ties resolve the same way every run.
  return { files: out.sort((a, b) => b.mtimeMs - a.mtimeMs), skippedByProject };
}

/** Sessions with a message at or after this time are rivals of a chosen session with anchor `bestAnchor`. */
function rivalFloor(bestAnchor: number, captureMs: number): number {
  return Math.min(bestAnchor - RIVAL_MS, captureMs - ACTIVE_MS);
}

export class TranscriptIndex {
  readonly stats: CorpusStats = emptyStats();
  /** Main-session transcripts found under the root (after --project). */
  readonly mainTranscripts: number;
  /** Main-session transcripts left out because --project did not match their folder. */
  readonly filesSkippedProject: number;
  private noTime = 0;
  private sidechain = 0;
  private readonly files: FileInfo[];
  private readonly maxFileBytes: number;
  private readonly timesCache = new Map<string, number[] | null>();
  private readonly textCache = new Map<string, Timed[]>();

  constructor(root: string, opts: IndexOptions = {}) {
    const found = mainFiles(root, this.stats, opts.project ?? null);
    this.files = found.files;
    this.filesSkippedProject = found.skippedByProject;
    this.mainTranscripts = this.files.length;
    this.maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  }

  /** Assistant messages dropped so far because their timestamp is missing or not an ISO time with a zone. */
  get messagesWithoutTime(): number {
    return this.noTime;
  }

  /** Assistant messages dropped so far because their record is marked as a sidechain. */
  get sidechainMessages(): number {
    return this.sidechain;
  }

  /** The window for a capture made at `captureMs`, or null when no main session had said anything yet. */
  windowAt(captureMs: number, count: number): CaptureWindow | null {
    const scored: Scored[] = [];
    let best: Scored | null = null;
    for (const info of this.files) {
      const bound = Math.min(captureMs, info.mtimeMs + SLACK_MS);
      if (best !== null && bound < rivalFloor(best.anchor, captureMs)) break;
      const anchor = this.anchorOf(info.file, captureMs);
      if (anchor === null) continue;
      const entry = { file: info.file, anchor };
      scored.push(entry);
      if (best === null || anchor > best.anchor) best = entry;
    }
    if (best === null) return null;
    const chosen = best;
    return {
      messages: this.newest(chosen.file, captureMs, count),
      anchorMs: chosen.anchor,
      ageMs: captureMs - chosen.anchor,
      rivalSessions: scored.filter(
        (s) =>
          s.file !== chosen.file &&
          s.anchor >= rivalFloor(chosen.anchor, captureMs),
      ).length,
    };
  }

  /** The time of the file's latest message at or before `limit`, or null. */
  private anchorOf(file: string, limit: number): number | null {
    const times = this.timesOf(file);
    if (times === null) return null;
    const n = countAtOrBefore(times, limit);
    return n === 0 ? null : (times[n - 1] as number);
  }

  private timesOf(file: string): number[] | null {
    if (!this.timesCache.has(file)) this.load(file);
    return this.timesCache.get(file) ?? null;
  }

  /** The newest `count` message texts at or before `limit`, newest first. */
  private newest(file: string, limit: number, count: number): string[] {
    const timed = this.load(file) ?? [];
    const upTo = countAtOrBefore(this.timesOf(file) ?? [], limit);
    return timed
      .slice(Math.max(0, upTo - count), upTo)
      .reverse()
      .map((m) => m.text);
  }

  /**
   * One transcript's messages. The times of every file read are kept; the
   * texts of only the last few, so a long run over many files stays small.
   */
  private load(file: string): Timed[] | null {
    const cached = this.textCache.get(file);
    if (cached !== undefined) return cached;
    const timed = this.parse(file);
    this.timesCache.set(file, timed === null ? null : timed.map((m) => m.time));
    if (timed === null) return null;
    this.textCache.set(file, timed);
    if (this.textCache.size > TEXT_CACHE_SIZE) {
      const oldest = this.textCache.keys().next().value as string;
      this.textCache.delete(oldest);
    }
    return timed;
  }

  /**
   * The main-session assistant text messages of one transcript, oldest first;
   * null when it cannot be read. What is counted (files, lines, dropped
   * messages) is counted the first time a file is read, not again when it is
   * read once more after leaving the text cache.
   */
  private parse(file: string): Timed[] | null {
    const first = !this.timesCache.has(file);
    const stats = first ? this.stats : emptyStats();
    const dropped = { noTime: 0, sidechain: 0 };
    try {
      if (fs.statSync(file).size > this.maxFileBytes) {
        stats.filesTooLarge++;
        return null;
      }
      const out: Timed[] = [];
      forEachLine(file, (line) =>
        visitAssistantLine(line, stats, ({ text, time, sidechain }) => {
          if (text.trim() === "") return;
          if (sidechain) dropped.sidechain++;
          else if (time === null) dropped.noTime++;
          else out.push({ time, text });
        }),
      );
      stats.filesRead++;
      if (first) {
        this.noTime += dropped.noTime;
        this.sidechain += dropped.sidechain;
      }
      return out.sort((a, b) => a.time - b.time);
    } catch {
      stats.filesUnreadable++;
      return null;
    }
  }
}
