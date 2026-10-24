// The code that ties a verdict to what the person was shown: a short hash of
// the result kind, the copied text and the text /cc would paste. If the matcher,
// the window or the capture changes, the code changes, and `tally` knows the
// verdict was written about a different answer.
//
// PRIVACY: the code is a one-way hash cut to 8 hex characters. It is printed
// only by `run --show` (which prints the text itself anyway). `tally` compares
// codes and prints ids only; default `run` never prints one.

import { createHash } from "node:crypto";

/** Hex characters in a code. */
export const CODE_LENGTH = 8;

export function fingerprintOf(
  kind: string,
  copied: string,
  paste: string | null,
): string {
  return createHash("sha256")
    .update(kind)
    .update("\0")
    .update(copied)
    .update("\0")
    .update(paste === null ? "refused" : `pasted\0${paste}`)
    .digest("hex")
    .slice(0, CODE_LENGTH);
}
