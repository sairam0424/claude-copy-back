// A verdict file holds one word (ok, bad or skip) and, optionally, the short
// code that `run --show` printed for that capture. The code ties the verdict to
// what the person was shown (see fingerprint.ts). PRIVACY: nothing here prints.

import { CODE_LENGTH } from "./fingerprint.ts";

export type Verdict = "ok" | "bad" | "skip";

export interface ParsedVerdict {
  verdict: Verdict;
  /** The code written after the word, lower case; null when the file holds the word only. */
  code: string | null;
}

const VERDICT_FILE = new RegExp(
  `^(ok|bad|skip)(?:[ \\t]+([0-9a-f]{${CODE_LENGTH}}))?$`,
);

/** ok, bad or skip, optionally followed by the code (any case, any surrounding blanks); anything else is null. */
export function parseVerdictLine(raw: string): ParsedVerdict | null {
  const match = VERDICT_FILE.exec(raw.trim().toLowerCase());
  if (match === null) return null;
  return { verdict: match[1] as Verdict, code: match[2] ?? null };
}

/** The word of a verdict file, whatever code follows it; null when the file is not a verdict. */
export function parseVerdict(raw: string): Verdict | null {
  return parseVerdictLine(raw)?.verdict ?? null;
}
