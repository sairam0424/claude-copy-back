// Reading the plugin's toast off a captured screen, and judging its words.
// The grammar is the plugin's own contract (hooks/outcome.ts) written out as
// literal patterns here, so a test of the live pass does not run the code it
// checks. A toast is counts and fixed words only.
//
// What the real engine does to it (seen in the development runs): it shows the
// toast as "<plugin name>: <text>" on a one-row notification bar, and it cuts
// the row at the pane width with U+2026. The plugin used to write its own
// "copy-back: " too, so the name was on screen twice; the hooks no longer do
// (their lines are shorter, to fit 60 columns), and the reader still strips a
// doubled prefix so that older evidence reads. The patterns below are the
// wording of hooks/outcome.ts and hooks/register.tsx as of 2026-10-24 (the
// screen shows the engine's "copy-back: " in front).

export const PREFIX = "copy-back:";
export const CUT = "…";

/** The toast line the plugin shows for each refusal reason (with the engine's name in front). */
export const REFUSAL_PATTERNS = [
  ["empty", /^copy-back: clipboard is empty, nothing changed$/],
  ["unreadable", /^copy-back: could not read the clipboard, nothing changed$/],
  ["too-large", /^copy-back: clipboard over 200000 chars, nothing changed$/],
  ["session-unreadable", /^copy-back: could not read the session, nothing changed$/],
  ["too-short", /^copy-back: copied text under 12 chars, nothing changed$/],
  ["no-match", /^copy-back: (?:no replies to search|no match in (?:the last reply|last \d+ replies)), nothing changed$/],
  ["ambiguous", /^copy-back: matches more than one place, nothing changed$/],
  ["copy-refused", /^copy-back: clipboard write was refused \((?:no-surface|no-clipboard|refused)\)$/],
  ["copy-failed", /^copy-back: clipboard write failed$/],
  ["failed", /^copy-back: unexpected error, nothing changed$/],
  ["register", /^copy-back: could not register \/cc$/],
];

const COPIED = /^copy-back: copied (\d+) chars from reply (\d+) \(1 = newest\)$/;

/** Judge one COMPLETE toast line: copied (with its two counts), a refusal reason, or other. */
export function classifyToast(text) {
  const copied = COPIED.exec(text);
  if (copied) return { kind: "copied", chars: Number(copied[1]), rank: Number(copied[2]) };
  const hit = REFUSAL_PATTERNS.find(([, re]) => re.test(text));
  return hit ? { kind: "refusal", reason: hit[0] } : { kind: "other" };
}

/** Expected line of a positive case. */
export const copiedLine = (chars, rank) => `${PREFIX} copied ${chars} chars from reply ${rank} (1 = newest)`;

/** Canonical refusal lines of the live pass's refusal kinds (the window holds 40 replies). */
export const REFUSAL_LINES = Object.freeze({
  mutated: `${PREFIX} no match in last 40 replies, nothing changed`,
  canary: `${PREFIX} no match in last 40 replies, nothing changed`,
  short: `${PREFIX} copied text under 12 chars, nothing changed`,
  empty: `${PREFIX} clipboard is empty, nothing changed`,
  blank: `${PREFIX} clipboard is empty, nothing changed`,
  exit1: `${PREFIX} could not read the clipboard, nothing changed`,
  sleep: `${PREFIX} could not read the clipboard, nothing changed`,
  huge: `${PREFIX} clipboard over 200000 chars, nothing changed`,
});

/** Strip the engine's name prefix once and the cut mark; keep whether the row was cut. */
export function readToast(rowText) {
  let text = rowText.trim();
  const truncated = text.endsWith(CUT);
  if (truncated) text = text.slice(0, -CUT.length).trimEnd();
  if (text.startsWith(`${PREFIX} ${PREFIX}`)) text = text.slice(PREFIX.length + 1);
  return { text, truncated };
}

/** Toasts on a screen, in screen order: [{text, truncated}]. */
export function extractToasts(screen) {
  return screen.split("\n").flatMap((row) => {
    const at = row.indexOf(PREFIX);
    return at < 0 ? [] : [readToast(row.slice(at))];
  });
}

/** Is `toast` the expected line (complete), a cut of it (prefix), or something else (wrong)? */
export function judgeToast(toast, expectedLine) {
  if (!toast.truncated) return toast.text === expectedLine ? "complete" : "wrong";
  return toast.text.length >= PREFIX.length && expectedLine.startsWith(toast.text) ? "prefix" : "wrong";
}

/** True when the screen holds a toast row at all. */
export const hasToast = (screen) => screen.includes(PREFIX);
