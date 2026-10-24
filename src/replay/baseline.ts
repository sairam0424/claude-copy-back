// The comparator: a heuristic cleaner in the style of claude-clean-copy
// (https://github.com/kbrianps/claude-clean-copy), which is MIT licensed:
// Copyright (c) 2026 Brian Pravato.
// It strips the margin and padding and joins rows by line length, with NO lookup
// of the source. This is a re-implementation of that style, not that project's
// code, but it reuses its thresholds (MIN_WRAP 60, MAX_WRAP 240) and the shape
// of its block-start pattern (lists, headings, code fences, table rows), so it
// is credited here. Lists and headings are left alone.
// It is deliberately the STRONGER of the two obvious margin rules: every row
// loses up to MARGIN leading blanks (and the reply bullet), so a copy that
// starts mid-line, whose first row has no margin, is still cleaned.

export const MIN_WRAP = 60;
export const MAX_WRAP = 240;
const MARGIN = 2;

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
// Rows that start something new: never glued to the row above.
const STARTS_BLOCK = /^(?:[-*+•] |\d+[.)] |#{1,6} |▎|```|~~~|\|)/;

/** One row without the reply bullet and without up to MARGIN leading blanks. */
function stripMargin(row: string): string {
  return row.replace(/^[⏺●] /, " ".repeat(MARGIN)).replace(/^ {1,2}/, "");
}

/** Strip the margin and padding, then join rows whose length says they wrapped. */
export function baselineClean(copied: string): string {
  const bare = copied
    .replace(ANSI, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((row) => stripMargin(row.replace(/[ \t]+$/, "")));
  const out: string[] = [];
  for (let i = 0; i < bare.length; i++) {
    const row = bare[i] as string;
    const next = bare[i + 1];
    out.push(row);
    const wrapped =
      next !== undefined &&
      next !== "" &&
      row.length >= MIN_WRAP &&
      row.length <= MAX_WRAP &&
      !STARTS_BLOCK.test(next.trimStart());
    out.push(wrapped ? " " : "\n");
  }
  out.pop();
  return out.join("").trim();
}
