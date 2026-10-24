// What a /cc run decided, and the one line that tells the person.
//
// PRIVACY BY CONSTRUCTION: a Decision holds numbers and words from closed
// lists, never a piece of the clipboard or of a message. toastText can only
// print what a Decision holds, so no text can reach the toast. Keep it so: add
// a field here only if it is a count or a member of a fixed list.

/** Longest clipboard (in characters) a run will look at. */
export const MAX_CLIPBOARD_CHARS = 200_000;
/** How many of the newest assistant replies a run searches. */
export const MAX_REPLIES = 40;
/** The matcher's own floor (src/core/match.ts), repeated for the toast only. */
export const MIN_COPY_CHARS = 12;

/** The words ui.copy gives when it did not copy; anything else reads "refused". */
export const COPY_REASONS = ["no-surface", "no-clipboard", "refused"] as const;
export type CopyReason = (typeof COPY_REASONS)[number];

/** Every way a run can end without writing the clipboard. */
export const REFUSALS = [
  "empty",
  "unreadable",
  "too-large",
  "session-unreadable",
  "too-short",
  "no-match",
  "ambiguous",
  "copy-refused",
  "copy-failed",
  "failed",
] as const;
export type Refusal = (typeof REFUSALS)[number];

export type Decision =
  | { copied: true; chars: number; rank: number }
  | {
      copied: false;
      reason: Refusal;
      /** How many replies the matcher looked through (0 if it never ran). */
      searched: number;
      copyReason?: CopyReason;
    };

/** A Decision plus whether the toast could be shown. */
export type CcOutcome = Decision & { toasted: boolean };

const PREFIX = "copy-back: ";
const UNCHANGED = ", nothing changed";

function noMatchLine(searched: number): string {
  if (searched <= 0) return `no replies to search${UNCHANGED}`;
  const what =
    searched === 1 ? "the last reply" : `the last ${searched} replies`;
  return `no match in ${what}${UNCHANGED}`;
}

/** The refusal lines that need nothing but the reason. */
const FIXED_LINES: Record<Refusal, string> = {
  empty: `clipboard is empty${UNCHANGED}`,
  unreadable: `could not read the clipboard${UNCHANGED}`,
  "too-large": `clipboard is over ${MAX_CLIPBOARD_CHARS} characters${UNCHANGED}`,
  "session-unreadable": `could not read the session${UNCHANGED}`,
  "too-short": `copied text is under ${MIN_COPY_CHARS} characters${UNCHANGED}`,
  "no-match": noMatchLine(0),
  ambiguous: `matches more than one place${UNCHANGED}`,
  "copy-refused": "the clipboard write was refused (refused)",
  "copy-failed": "the clipboard write failed",
  failed: `stopped on an unexpected error${UNCHANGED}`,
};

export function toastText(decision: Decision): string {
  if (decision.copied) {
    const { chars, rank } = decision;
    return `${PREFIX}copied ${chars} characters from reply ${rank} (1 = newest)`;
  }
  if (decision.reason === "no-match") {
    return PREFIX + noMatchLine(decision.searched);
  }
  if (decision.reason === "copy-refused") {
    const word = decision.copyReason ?? "refused";
    return `${PREFIX}the clipboard write was refused (${word})`;
  }
  return PREFIX + FIXED_LINES[decision.reason];
}
