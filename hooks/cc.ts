// The /cc run, with the engine injected: no `$` in this file, so it is tested
// with plain functions (tests/cc-run.test.ts). hooks/run.ts wires the real
// engine calls in; this file only decides.
//
// One run: read the clipboard once, read the session, ask the verified core
// (src/core/match.ts) where in a recent reply the copied text came from, and,
// only on a match, write that reply's own text with the copy dependency.
// Every other end leaves the clipboard untouched. A refusal is a normal end,
// not an error: it is a Decision with a reason, shown as one counts-only line.
//
// PRIVACY: the clipboard text, the message text and every error a dependency
// raises stay inside this file's functions. A raised error is caught where it
// happens and becomes a reason word; its message is never read.

import { findSource, resetMatchCache } from "../src/core/match.ts";
import type { FindResult } from "../src/core/match.ts";
import { classifyClip, selectReplies } from "./input.ts";
import type { ClipRead, RunAnswer } from "./input.ts";
import { COPY_REASONS, toastText } from "./outcome.ts";
import type { CcOutcome, CopyReason, Decision, Refusal } from "./outcome.ts";

export type { RunAnswer };
export type { CcOutcome, Decision, Refusal };

/** What the engine's copy answers (src: UiCopyResult), read defensively. */
export type CopyAnswer =
  { isCopied: true } | { isCopied: false; reason: string };

export type FindFn = (
  copied: string,
  messages: readonly string[],
) => FindResult;

export interface CcDeps {
  /** One read of the clipboard (pbpaste), answered as the engine's process answer. */
  readClipboard(): Promise<RunAnswer>;
  /** The session's rows, oldest first, as the engine returns them. */
  getMessages(): Promise<readonly unknown[]>;
  /** Write the clipboard. Called only with a matched slice. */
  copy(text: string): Promise<CopyAnswer>;
  /** Show one line. May be synchronous; a returned promise is awaited. */
  toast(text: string): void | Promise<void>;
  /** Drop what the matcher cached about the messages. Called last, on every path. */
  forget?(): void;
  /** The matcher; the real one unless a test swaps it. */
  find?: FindFn;
}

function refuse(reason: Refusal, searched = 0): Decision {
  return { copied: false, reason, searched };
}

type Replies = { ok: true; replies: string[] } | { ok: false };

async function readReplies(deps: CcDeps): Promise<Replies> {
  try {
    const rows = await deps.getMessages();
    if (!Array.isArray(rows)) return { ok: false };
    return { ok: true, replies: selectReplies(rows) };
  } catch {
    return { ok: false };
  }
}

function copyReasonOf(answer: Record<string, unknown>): CopyReason {
  const word = COPY_REASONS.find((known) => known === answer.reason);
  return word ?? "refused";
}

/** Read the engine's copy answer: only its yes/no and a word from a fixed list count. */
function readCopyAnswer(
  answer: unknown,
  done: Decision,
  searched: number,
): Decision {
  if (typeof answer !== "object" || answer === null) {
    return refuse("copy-failed", searched);
  }
  const record = answer as Record<string, unknown>;
  if (record.isCopied === true) return done;
  if (record.isCopied !== false) return refuse("copy-failed", searched);
  const copyReason = copyReasonOf(record);
  return { copied: false, reason: "copy-refused", searched, copyReason };
}

async function writeSlice(
  deps: CcDeps,
  found: Extract<FindResult, { ok: true }>,
  searched: number,
): Promise<Decision> {
  if (typeof found.paste !== "string" || found.paste === "") {
    return refuse("no-match", searched);
  }
  const done: Decision = {
    copied: true,
    chars: Array.from(found.paste).length,
    rank: found.messageIndex + 1,
  };
  try {
    return readCopyAnswer(await deps.copy(found.paste), done, searched);
  } catch {
    return refuse("copy-failed", searched);
  }
}

async function decide(deps: CcDeps): Promise<Decision> {
  let clip: ClipRead;
  try {
    clip = classifyClip(await deps.readClipboard());
  } catch {
    return refuse("unreadable");
  }
  if (!clip.ok) return refuse(clip.reason);

  const session = await readReplies(deps);
  if (!session.ok) return refuse("session-unreadable");
  const { replies } = session;

  const found = (deps.find ?? findSource)(clip.text, replies);
  if (!found.ok) return refuse(found.reason, replies.length);
  return writeSlice(deps, found, replies.length);
}

async function announce(deps: CcDeps, decision: Decision): Promise<CcOutcome> {
  try {
    await deps.toast(toastText(decision));
    return { ...decision, toasted: true };
  } catch {
    // A toast that cannot be shown changes nothing about the clipboard; the
    // outcome records it so the caller can tell.
    return { ...decision, toasted: false };
  }
}

/**
 * Run /cc once. Resolves with what happened; never rejects, so the command
 * that calls it can always answer `{}`.
 */
export async function runCc(deps: CcDeps): Promise<CcOutcome> {
  try {
    let decision: Decision;
    try {
      decision = await decide(deps);
    } catch {
      decision = refuse("failed");
    }
    return await announce(deps, decision);
  } finally {
    if (deps.forget) deps.forget();
    else resetMatchCache();
  }
}
