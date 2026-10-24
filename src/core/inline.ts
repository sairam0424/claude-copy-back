// Inline markdown, reduced to one question: which characters of this paragraph
// does the renderer NOT draw? inlineMask returns one flag per UTF-16 unit:
//   0 drawn as typed
//   1 hidden
//   2 drawn as a space (the "]" of a link: Claude Code draws "label (url)")
// Hidden: emphasis markers that matched, the backticks of a code span (and one
// padding space each side), the brackets, bang, title and angle brackets of
// link and image syntax, autolink brackets, backslash escapes. A link's
// destination stays visible in parentheses. Everything else stays visible,
// unmatched markers included ("2 * 3 * 4" is drawn as typed) and "~~x~~" too:
// the real renderer does not interpret strikethrough (calibration, seed 101).
// The delimiter matching follows CommonMark's flanking and rule-of-3
// behaviour; reference links, HTML and entities are not interpreted.

/**
 * The longest stretch a link destination, its title and the closing paren may
 * span. Real URLs are far shorter; without a bound, every unclosed "](" scans
 * to the end of the paragraph and a long run of them goes quadratic. Past the
 * bound the bracket is just text.
 */
const LINK_SCAN_LIMIT = 1536;

interface Delim {
  ch: string;
  start: number;
  len: number; // original run length
  rem: number; // characters not yet consumed
  canOpen: boolean;
  canClose: boolean;
  dead: boolean;
}

interface Bracket {
  pos: number;
  image: boolean;
  active: boolean;
  delimStart: number;
}

interface LinkTail {
  /** Index after the closing paren. */
  end: number;
  /** Ranges [from, to) of the tail that are not drawn. */
  hides: Array<[number, number]>;
}

const AUTOLINK =
  /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)>/y;
const UNI_PUNCT = /^[\p{P}\p{S}]$/u;
const UNI_SPACE = /^\s$/;

function isAsciiPunctCode(c: number): boolean {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
}

function isSpaceCode(c: number): boolean {
  return c === 32 || (c >= 9 && c <= 13) || (c > 127 && UNI_SPACE.test(String.fromCharCode(c)));
}

function isSpaceAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return true; // text edges count as whitespace
  const c = text.charCodeAt(i);
  if (c < 128) return c === 32 || (c >= 9 && c <= 13);
  return UNI_SPACE.test(text[i] as string);
}

function isPunctAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return false;
  const c = text.charCodeAt(i);
  if (c < 128) return isAsciiPunctCode(c);
  return UNI_PUNCT.test(text[i] as string);
}

/**
 * One left-to-right pass over a paragraph's text. Emphasis delimiters and
 * brackets are collected as the pass goes; emphasis is resolved when a link
 * closes (inside its label) and once more at the end.
 */
class InlineScanner {
  private readonly text: string;
  private readonly n: number;
  private readonly hide: Uint8Array;
  private readonly delims: Delim[] = [];
  private readonly brackets: Bracket[] = [];
  /** Backtick run length -> position after which no closing run exists (stops quadratic rescans). */
  private readonly noCloserFrom = new Map<number, number>();

  constructor(text: string) {
    this.text = text;
    this.n = text.length;
    this.hide = new Uint8Array(text.length);
  }

  scan(): Uint8Array {
    let i = 0;
    while (i < this.n) i = this.step(i);
    this.processEmphasis(0);
    return this.hide;
  }

  /** Handle the character at `i`; returns the index to continue from. */
  private step(i: number): number {
    const c = this.text[i] as string;
    if (c === "\\") return this.escape(i);
    if (c === "`") return this.codeSpan(i);
    if (c === "*" || c === "_") return this.delimiterRun(c, i);
    if (c === "[") return this.openBracket(i, false);
    if (c === "!" && this.text[i + 1] === "[") return this.openBracket(i, true);
    if (c === "]") return this.closeBracket(i);
    if (c === "<") return this.autolink(i);
    return i + 1;
  }

  private escape(i: number): number {
    const next = this.text[i + 1];
    if (next !== undefined && isAsciiPunctCode(next.charCodeAt(0))) {
      this.hide[i] = 1;
      return i + 2;
    }
    if (next === "\n") this.hide[i] = 1;
    return i + 1;
  }

  private autolink(i: number): number {
    AUTOLINK.lastIndex = i;
    const m = AUTOLINK.exec(this.text);
    if (m === null) return i + 1;
    this.hide[i] = 1;
    this.hide[i + m[0].length - 1] = 1;
    return i + m[0].length;
  }

  private openBracket(i: number, image: boolean): number {
    this.brackets.push({
      pos: i,
      image,
      active: true,
      delimStart: this.delims.length,
    });
    return image ? i + 2 : i + 1;
  }

  private delimiterRun(ch: string, start: number): number {
    let len = 1;
    while (this.text[start + len] === ch) len++;
    this.pushRun(ch, start, len);
    return start + len;
  }

  private hideRange(from: number, to: number): void {
    for (let i = from; i < to; i++) this.hide[i] = 1;
  }

  private pushRun(ch: string, start: number, len: number): void {
    const { text } = this;
    const prev = start - 1;
    const next = start + len;
    const spaceBefore = isSpaceAt(text, prev);
    const spaceAfter = isSpaceAt(text, next);
    const punctBefore = isPunctAt(text, prev);
    const punctAfter = isPunctAt(text, next);
    const left = !spaceAfter && (!punctAfter || spaceBefore || punctBefore);
    const right = !spaceBefore && (!punctBefore || spaceAfter || punctAfter);
    let canOpen = left;
    let canClose = right;
    if (ch === "_") {
      canOpen = left && (!right || punctBefore);
      canClose = right && (!left || punctAfter);
    }
    this.delims.push({ ch, start, len, rem: len, canOpen, canClose, dead: false });
  }

  private codeSpan(at: number): number {
    const { text, n } = this;
    let k = 0;
    while (text[at + k] === "`") k++;
    if ((this.noCloserFrom.get(k) ?? n + 1) <= at) return at + k;
    let j = at + k;
    while (j < n) {
      if (text[j] !== "`") {
        j++;
        continue;
      }
      let m = 0;
      while (text[j + m] === "`") m++;
      if (m === k) {
        this.hideRange(at, at + k);
        this.hideRange(j, j + k);
        this.trimCodePadding(at + k, j);
        return j + k;
      }
      j += m;
    }
    this.noCloserFrom.set(k, at);
    return at + k;
  }

  /** A code span drops one padding space each side, unless it is all spaces. */
  private trimCodePadding(from: number, to: number): void {
    const { text } = this;
    if (to - from < 2) return;
    const pad = (c: string | undefined): boolean => c === " " || c === "\n";
    if (!pad(text[from]) || !pad(text[to - 1])) return;
    for (let i = from; i < to; i++) {
      if (text[i] !== " " && text[i] !== "\n") {
        this.hide[from] = 1;
        this.hide[to - 1] = 1;
        return;
      }
    }
  }

  /**
   * The tail "(dest "title")" starting after the opening paren at `start`:
   * where the link ends and which ranges are NOT drawn (blanks around the
   * destination, the angle brackets of "<dest>", the title). The destination
   * and both parens are drawn. Null when this is not a link tail.
   */
  private linkTail(start: number): LinkTail | null {
    const { text } = this;
    const end = Math.min(this.n, start + LINK_SCAN_LIMIT);
    const hides: Array<[number, number]> = [];
    let p = start;
    const skipSpace = (): void => {
      const from = p;
      while (p < end && isSpaceCode(text.charCodeAt(p))) p++;
      if (p > from) hides.push([from, p]);
    };
    skipSpace();
    if (text[p] === "<") {
      const open = p;
      while (p < end && text[p] !== ">" && text[p] !== "\n") p++;
      if (p >= end || text[p] !== ">") return null;
      hides.push([open, open + 1], [p, p + 1]);
      p++;
    } else {
      p = this.bareDestinationEnd(p, end);
      if (p < 0) return null;
    }
    skipSpace();
    const opener = text[p];
    if (opener === '"' || opener === "'" || opener === "(") {
      const closer = opener === "(" ? ")" : opener;
      const open = p;
      p++;
      while (p < end && text[p] !== closer) p += text[p] === "\\" ? 2 : 1;
      if (p >= end) return null;
      p++;
      hides.push([open, p]);
      skipSpace();
    }
    return p < end && text[p] === ")" ? { end: p + 1, hides } : null;
  }

  /** Where an unbracketed destination starting at `from` stops, or -1 when it runs past `limit`. */
  private bareDestinationEnd(from: number, limit: number): number {
    const { text } = this;
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
    return p < this.n ? -1 : p;
  }

  /** The nearest opener below `closerIndex` that can pair with it, or -1. */
  private findOpener(closerIndex: number, bottom: number): number {
    const { delims } = this;
    const closer = delims[closerIndex] as Delim;
    for (let o = closerIndex - 1; o >= bottom; o--) {
      const op = delims[o] as Delim;
      if (op.dead || op.ch !== closer.ch || !op.canOpen || op.rem === 0)
        continue;
      const oddMatch =
        (op.canClose || closer.canOpen) &&
        (op.len + closer.len) % 3 === 0 &&
        !(op.len % 3 === 0 && closer.len % 3 === 0);
      if (oddMatch) continue;
      return o;
    }
    return -1;
  }

  private processEmphasis(bottom: number): void {
    const { delims } = this;
    // CommonMark's "openers_bottom": once no opener below a closer can pair
    // with closers of its kind, later closers of that kind need not look below
    // it again. Without this, a long run of unmatched closers is quadratic.
    const openersBottom = new Map<string, number>();
    let ci = bottom;
    while (ci < delims.length) {
      const closer = delims[ci] as Delim;
      if (closer.dead || !closer.canClose || closer.rem === 0) {
        ci++;
        continue;
      }
      const kind = `${closer.ch}${closer.canOpen ? 1 : 0}${closer.len % 3}`;
      const oi = this.findOpener(ci, Math.max(bottom, openersBottom.get(kind) ?? bottom));
      if (oi < 0) {
        openersBottom.set(kind, ci);
        if (!closer.canOpen) closer.dead = true;
        ci++;
        continue;
      }
      const op = delims[oi] as Delim;
      const use = op.rem >= 2 && closer.rem >= 2 ? 2 : 1;
      this.hideRange(op.start + op.rem - use, op.start + op.rem);
      const used = closer.start + (closer.len - closer.rem);
      this.hideRange(used, used + use);
      op.rem -= use;
      closer.rem -= use;
      for (let k = oi + 1; k < ci; k++) (delims[k] as Delim).dead = true;
      if (op.rem === 0) op.dead = true;
      if (closer.rem === 0) ci++;
    }
  }

  private closeBracket(at: number): number {
    const { brackets, delims, hide } = this;
    const opener = brackets.pop();
    if (opener === undefined || !opener.active || this.text[at + 1] !== "(")
      return at + 1;
    const tail = this.linkTail(at + 2);
    if (tail === null) return at + 1;
    hide[opener.pos] = 1;
    if (opener.image) hide[opener.pos + 1] = 1;
    hide[at] = 2; // "]" is drawn as the space before "(": "label (url)"
    for (const [from, to] of tail.hides) this.hideRange(from, to);
    this.processEmphasis(opener.delimStart);
    for (let k = opener.delimStart; k < delims.length; k++)
      (delims[k] as Delim).dead = true;
    if (!opener.image) for (const b of brackets) if (!b.image) b.active = false;
    return tail.end;
  }
}

export function inlineMask(text: string): Uint8Array {
  return new InlineScanner(text).scan();
}
