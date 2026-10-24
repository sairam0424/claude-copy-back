// Line-by-line reading of a file in chunks, so a transcript of any size can be
// scanned: heavy sessions run to hundreds of megabytes, past what a single
// string can hold. Only complete lines are decoded, so a multi-byte character
// split across two chunks stays whole (a newline byte never occurs inside one).
//
// PRIVACY: nothing here prints. Errors are the file system's, for the caller
// to count and discard.

import fs from "node:fs";

const NEWLINE = 0x0a;
const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Call `visit` with each line of `file` (without its "\n"; a "\r" stays), in
 * order. A final line without a newline is visited too. Throws if the file
 * cannot be opened or read.
 */
export function forEachLine(
  file: string,
  visit: (line: string) => void,
  chunkBytes: number = DEFAULT_CHUNK_BYTES,
): void {
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.allocUnsafe(chunkBytes);
    let carry: Buffer = Buffer.alloc(0);
    for (;;) {
      const n = fs.readSync(fd, chunk, 0, chunkBytes, null);
      if (n === 0) break;
      carry = visitLines(chunk.subarray(0, n), carry, visit);
    }
    if (carry.length > 0) visit(carry.toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}

/** Visit every complete line in carry+view; return the unfinished tail (a copy: the chunk is reused). */
function visitLines(
  view: Buffer,
  carry: Buffer,
  visit: (line: string) => void,
): Buffer {
  let start = 0;
  let held = carry;
  for (;;) {
    const end = view.indexOf(NEWLINE, start);
    if (end < 0) break;
    const piece = view.subarray(start, end);
    visit(
      (held.length > 0 ? Buffer.concat([held, piece]) : piece).toString("utf8"),
    );
    held = Buffer.alloc(0);
    start = end + 1;
  }
  return Buffer.concat([held, view.subarray(start)]);
}
