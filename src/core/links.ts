// The tail of an inline link or image: "(dest "title")" after the "]". Pure
// text scanning that reports WHERE each part sits, so inline.ts can say which
// characters the renderer draws and which it does not (see drawing.ts).

/** Every part of a link tail, as ranges [from, to) of the paragraph text unless noted. */
export interface LinkParts {
  /** Index after the closing paren. */
  end: number;
  /** Blanks right after the opening paren. */
  lead: readonly [number, number];
  /** Positions of "<" and ">" around the destination, or null. */
  angle: readonly [number, number] | null;
  /** The destination text itself (inside the angle brackets when there are any). */
  dest: readonly [number, number];
  /** Blanks between the destination and the title (empty without a title). */
  gap: readonly [number, number];
  /** Positions of the title's opening and closing delimiter (a quote, an apostrophe or a paren), or null. */
  title: readonly [number, number] | null;
  /** Blanks before the closing paren. */
  trail: readonly [number, number];
}

/**
 * The longest stretch a link destination, its title and the closing paren may
 * span. Real URLs are far shorter; without a bound, every unclosed "](" scans
 * to the end of the paragraph and a long run of them goes quadratic. Past the
 * bound the bracket is just text.
 */
export const LINK_SCAN_LIMIT = 1536;

const UNI_SPACE = /^\s$/;

export function isSpaceCode(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || (c > 127 && UNI_SPACE.test(String.fromCharCode(c)));
}

/** Where an unbracketed destination starting at `from` stops (balanced parens), or -1 when it runs past `limit`. */
function bareDestinationEnd(text: string, from: number, limit: number): number {
  let p = from;
  let depth = 0;
  while (p < limit) {
    const c = text[p] as string;
    if (isSpaceCode(text.charCodeAt(p))) return p;
    if (c === "\\" && p + 1 < limit) {
      p += 2;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return p;
      depth--;
    }
    p++;
  }
  return p < text.length ? -1 : p;
}

/** The tail whose first character after the opening paren is at `start`; null when this is not a link tail. */
export function parseLinkTail(text: string, start: number): LinkParts | null {
  const end = Math.min(text.length, start + LINK_SCAN_LIMIT);
  let p = start;
  const blanks = (): [number, number] => {
    const from = p;
    while (p < end && isSpaceCode(text.charCodeAt(p))) p++;
    return [from, p];
  };
  const lead = blanks();
  let angle: [number, number] | null = null;
  let dest: [number, number];
  if (text[p] === "<") {
    const open = p;
    while (p < end && text[p] !== ">" && text[p] !== "\n") p++;
    if (p >= end || text[p] !== ">") return null;
    angle = [open, p];
    dest = [open + 1, p];
    p++;
  } else {
    const stop = bareDestinationEnd(text, p, end);
    if (stop < 0) return null;
    dest = [p, stop];
    p = stop;
  }
  const gap = blanks();
  let title: [number, number] | null = null;
  const opener = text[p];
  if (opener === '"' || opener === "'" || opener === "(") {
    if (gap[0] === gap[1]) return null; // a title must be separated from the destination by blanks
    const closer = opener === "(" ? ")" : opener;
    const open = p;
    p++;
    while (p < end && text[p] !== closer) p += text[p] === "\\" ? 2 : 1;
    if (p >= end) return null;
    title = [open, p];
    p++;
  }
  const trail = blanks();
  if (p >= end || text[p] !== ")") return null;
  return { end: p + 1, lead, angle, dest, gap: title === null ? [gap[1], gap[1]] : gap, title, trail: title === null ? [gap[0], trail[1]] : trail };
}
