// The number or letter Claude Code draws before an ordered list item, by how
// deep the list is nested (counting every enclosing list item, bullets too, but
// not block quotes), read from sealed-rig screens of Claude Code 2.1.310:
//
//   depth 0     1.  2.  3.  ...
//   depth 1     a.  b.  ...  z.  aa.  ab.  ...   (bijective base 26: 27 is aa, 53 is ba)
//   depth 2     i.  ii.  iii.  iv.  ...           (lowercase roman numerals)
//   depth 3+    1.  2.  3.  ...                   (numerals again)
//
// The number itself is the list's start plus the item's index (blocks.ts).

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"],
  [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"],
];

/** 1 is a, 26 is z, 27 is aa. */
function letters(n: number): string {
  let rest = n;
  let out = "";
  while (rest > 0) {
    rest -= 1;
    out = String.fromCharCode(97 + (rest % 26)) + out;
    rest = Math.floor(rest / 26);
  }
  return out;
}

function roman(n: number): string {
  let rest = n;
  let out = "";
  for (const [value, text] of ROMAN) {
    while (rest >= value) {
      out += text;
      rest -= value;
    }
  }
  return out;
}

/** The marker text (without its dot) for item number `n` of a list nested `depth` list items deep. */
export function ordinalOf(depth: number, n: number): string {
  if (!Number.isInteger(n) || n < 1) return String(n);
  if (depth === 1) return letters(n);
  if (depth === 2) return n < 4000 ? roman(n) : String(n);
  return String(n);
}
