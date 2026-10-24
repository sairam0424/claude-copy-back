// Reading what /cc works from: the clipboard answer and the session rows.
// Both functions are pure and total: whatever the engine hands them, they
// return a value; they never throw and never keep what they were given.

import { MAX_CLIPBOARD_CHARS, MAX_REPLIES } from "./outcome.ts";

/** The part of the engine's process answer that /cc reads (the rest is ignored). */
export interface RunAnswer {
  exitCode: number;
  stdout: string;
  stderr?: string;
  isStdoutTruncated: boolean;
  isStderrTruncated?: boolean;
}

export type ClipRead =
  | { ok: true; text: string }
  | { ok: false; reason: "empty" | "unreadable" | "too-large" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Turn the answer of the clipboard read into the copied text or a refusal.
 * A read that failed, was cut short, or is over the bound is never used in
 * part: a half-read clipboard could match the wrong thing.
 */
export function classifyClip(run: unknown): ClipRead {
  if (!isRecord(run)) return { ok: false, reason: "unreadable" };
  if (run.exitCode !== 0 || typeof run.stdout !== "string") {
    return { ok: false, reason: "unreadable" };
  }
  if (run.isStdoutTruncated === true) return { ok: false, reason: "too-large" };
  if (run.stdout.length > MAX_CLIPBOARD_CHARS) {
    return { ok: false, reason: "too-large" };
  }
  if (run.stdout.trim() === "") return { ok: false, reason: "empty" };
  return { ok: true, text: run.stdout };
}

/** The text of one row if it is an assistant reply with something in it. */
function replyText(row: unknown): string[] {
  if (!isRecord(row) || row.role !== "assistant") return [];
  if (typeof row.text !== "string" || row.text.trim() === "") return [];
  return [row.text];
}

/**
 * The newest assistant replies that have text, newest first, at most `max`.
 * Rows are in conversation order; user rows, tool-only turns and anything
 * malformed are skipped.
 */
export function selectReplies(
  rows: readonly unknown[],
  max: number = MAX_REPLIES,
): string[] {
  if (max <= 0) return [];
  return rows.flatMap(replyText).slice(-max).toReversed();
}
