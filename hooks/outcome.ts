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

/**
 * The most characters a toast line should hold. In sealed live runs on Claude
 * Code 2.1.309 and 2.1.310 the engine put the plugin's name in front of the
 * line ("copy-back: ", so the line must not repeat it) and, at 60 columns,
 * drew the whole row in 58 columns, cutting the rest with an ellipsis: 58 less
 * 2 spaces of indent less 11 of name leaves 45. Not checked on other versions.
 * Every line below fits; the success line fits up to 99,999 characters and
 * keeps its rank in view beyond that (tests/cc-outcome.test.mts checks both).
 */
export const TOAST_MAX_CHARS = 45;

const UNCHANGED = ", nothing changed";

function noMatchLine(searched: number): string {
  if (searched <= 0) return `no replies to search${UNCHANGED}`;
  const what = searched === 1 ? "the last reply" : `last ${searched} replies`;
  return `no match in ${what}${UNCHANGED}`;
}

function refusedLine(copyReason: CopyReason | undefined): string {
  // Re-checked here, not only where the engine's answer is read: this is the
  // last place a word reaches the screen, so only a member of the list can.
  const word = COPY_REASONS.find((known) => known === copyReason) ?? "refused";
  return `clipboard write was refused (${word})`;
}

/** The refusal lines that need nothing but the reason. */
const FIXED_LINES: Record<
  Exclude<Refusal, "no-match" | "copy-refused">,
  string
> = {
  empty: `clipboard is empty${UNCHANGED}`,
  unreadable: `could not read the clipboard${UNCHANGED}`,
  "too-large": `clipboard over ${MAX_CLIPBOARD_CHARS} chars${UNCHANGED}`,
  "session-unreadable": `could not read the session${UNCHANGED}`,
  "too-short": `copied text under ${MIN_COPY_CHARS} chars${UNCHANGED}`,
  ambiguous: `matches more than one place${UNCHANGED}`,
  "copy-failed": "clipboard write failed",
  failed: `unexpected error${UNCHANGED}`,
};

/**
 * The one line that tells the person what happened: counts and fixed words
 * only. It carries no plugin name; Claude Code shows that in front of it.
 */
export function toastText(decision: Decision): string {
  if (decision.copied) {
    const { chars, rank } = decision;
    return `copied ${chars} chars from reply ${rank} (1 = newest)`;
  }
  if (decision.reason === "no-match") return noMatchLine(decision.searched);
  if (decision.reason === "copy-refused") {
    return refusedLine(decision.copyReason);
  }
  // A reason outside the list (only a hand-built Decision can have one) reads
  // as the catch-all line, never as `undefined` or a property of the table.
  return Object.hasOwn(FIXED_LINES, decision.reason)
    ? FIXED_LINES[decision.reason]
    : FIXED_LINES.failed;
}
