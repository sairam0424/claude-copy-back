// Whitespace folding for the search. Both the copied text and the projected
// message are folded the same way, so hard wraps, padding and indentation
// differences cannot matter.
//   "fold"      runs of whitespace become one space (word boundaries survive)
//   "skeleton"  whitespace is removed (survives a row split inside a token)

export type Mode = "fold" | "skeleton";

export function isSpace(c: number): boolean {
  if (c > 32 && c < 0xa0) return false;
  return (
    c === 32 ||
    (c >= 9 && c <= 13) ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000 ||
    c === 0xfeff
  );
}

// JavaScript's \s is exactly isSpace's set (ASCII whitespace, NBSP, the Unicode
// space separators, line and paragraph separators, BOM), and the regex engine
// scans it natively, several times faster than a character loop.
const SPACE_RUN = /\s+/g;

export function foldText(source: string, mode: Mode): string {
  return source.replace(SPACE_RUN, mode === "fold" ? " " : "");
}

/** Index in `text` of the character at index `target` of its folded form. */
export function unfold(text: string, mode: Mode, target: number): number {
  const n = text.length;
  let folded = 0;
  let i = 0;
  while (i < n) {
    if (isSpace(text.charCodeAt(i))) {
      if (mode === "fold") {
        if (folded === target) return i;
        folded++;
      }
      while (i < n && isSpace(text.charCodeAt(i))) i++;
    } else {
      if (folded === target) return i;
      folded++;
      i++;
    }
  }
  return n - 1;
}
