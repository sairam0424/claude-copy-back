// Inline markdown, reduced to one question: which characters of this paragraph
// does the renderer NOT draw? inlineMask returns one flag per UTF-16 unit:
//   0 drawn as typed
//   1 hidden
//   2 drawn as a space (the "]" of a link: Claude Code draws "label (url)")
//   3 drawn as ") (" (the blanks between a link's destination and its title)
//   4 drawn as a double quote (the delimiter of a link's title, whichever it was typed as)
// Hidden: emphasis markers that matched, the backticks of a code span (and one
// padding space each side), the brackets and bang of link and image syntax,
// autolink brackets, backslash escapes. A link is drawn "label (dest)" and, with
// a title, "label (dest) ("title")"; a terminal with hyperlinks draws a link with
// no title as its label alone, and one with a strikethrough attribute draws the
// two tildes of "~~x~~" not at all (drawing.ts). Everything else stays visible,
// unmatched markers included ("2 * 3 * 4", "~x~", "~~ x ~~" are drawn as typed).
// The delimiter matching follows CommonMark's flanking and rule-of-3
// behaviour; reference links, HTML and entities are not interpreted.

import { DEFAULT_DRAWING } from "./drawing.ts";
import type { Drawing } from "./drawing.ts";
import { isSpaceCode, parseLinkTail } from "./links.ts";
import type { LinkParts } from "./links.ts";

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

const AUTOLINK =
  /<(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*|[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)>/y;
const UNI_PUNCT = /^[\p{P}\p{S}]$/u;
const UNI_SPACE = /^\s$/;

function isAsciiPunctCode(c: number): boolean {
  return (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);
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

  /** End of the strikethrough pair being scanned: no new pair opens inside it. */
  private delUntil = 0;
  /** A search for a strikethrough closer from here on found none (stops quadratic rescans). */
  private noDelFrom = Infinity;
  private readonly drawing: Drawing;

  constructor(text: string, drawing: Drawing) {
    this.text = text;
    this.n = text.length;
    this.hide = new Uint8Array(text.length);
    this.drawing = drawing;
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
    if (c === "~") return this.tildes(i);
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
        for (let i = at + k; i < j; i++) if (text[i] === "\n") this.hide[i] = 2; // drawn as a space
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
    const tail = parseLinkTail(this.text, at + 2);
    if (tail === null) return at + 1;
    hide[opener.pos] = 1;
    if (opener.image) hide[opener.pos + 1] = 1;
    this.drawTail(opener, at, tail);
    this.processEmphasis(opener.delimStart);
    for (let k = opener.delimStart; k < delims.length; k++)
      (delims[k] as Delim).dead = true;
    if (!opener.image) for (const b of brackets) if (!b.image) b.active = false;
    return tail.end;
  }

  /**
   * Which characters of "](dest "title")" are drawn (drawing.ts). Hidden always: blanks
   * around the destination and its angle brackets, and the "mailto:" of an address.
   * An image shows its title as typed inside the parentheses.
   */
  private drawTail(opener: Bracket, close: number, t: LinkParts): void {
    const { text, hide } = this;
    const dest = text.slice(t.dest[0], t.dest[1]);
    const mailto = /^mailto:/i.test(dest);
    const label = text.slice(opener.pos + (opener.image ? 2 : 1), close);
    const repeated = !opener.image && label === dest;
    const hyperlink = !opener.image && !mailto && t.title === null && this.drawing.links === "label";
    if (repeated || hyperlink) {
      this.hideRange(close, t.end);
      return;
    }
    hide[close] = 2; // "]" is drawn as the space before "(": "label (url)"
    this.hideRange(t.lead[0], t.lead[1]);
    if (t.angle !== null) {
      hide[t.angle[0]] = 1;
      hide[t.angle[1]] = 1;
    }
    if (mailto) this.hideRange(t.dest[0], t.dest[0] + 7);
    if (t.title === null) this.hideRange(t.trail[0], t.trail[1]);
    else if (!opener.image) this.drawTitle(t.gap, t.title, t.trail);
  }

  /** `) ("title")`: the blanks close the destination and open the title, whose delimiters become double quotes. */
  private drawTitle(gap: readonly [number, number], title: readonly [number, number], trail: readonly [number, number]): void {
    this.hide[gap[0]] = 3;
    this.hideRange(gap[0] + 1, gap[1]);
    this.hide[title[0]] = 4;
    this.hide[title[1]] = 4;
    this.hideRange(trail[0], trail[1]);
  }

  /**
   * A run of tildes. Only when the terminal draws struck text with an attribute does a pair
   * of double tildes mean anything (the tildes are then not drawn): marked's rule, which reads
   * a pair as strikethrough when the opener is followed by a non-blank and the closer follows
   * a non-blank, and not for one or three tildes (probe, Claude Code 2.1.310).
   */
  private tildes(i: number): number {
    const { text } = this;
    let run = 1;
    while (text[i + run] === "~") run++;
    if (this.drawing.strike !== "plain" || run !== 2 || i < this.delUntil) return i + run;
    const next = text.charCodeAt(i + 2);
    if (Number.isNaN(next) || isSpaceCode(next)) return i + run;
    const close = this.delCloser(i);
    if (close < 0) return i + run;
    this.hideRange(i, i + 2);
    this.hideRange(close, close + 2);
    this.delUntil = close + 2;
    return i + 2; // the words between are scanned as usual (emphasis, code, links)
  }

  /** The first double tilde after the opener at `open` that can close it, or -1. */
  private delCloser(open: number): number {
    const { text, n } = this;
    if (open + 3 >= this.noDelFrom) return -1;
    for (let q = open + 3; q + 1 < n; q++) {
      if (text[q] !== "~" || text[q + 1] !== "~" || text[q + 2] === "~") continue;
      const prev = text.charCodeAt(q - 1);
      const escaped = text[q - 2] === "\\" && q - 2 >= open + 2;
      if (escaped || (!isSpaceCode(prev) && prev !== 126 && prev !== 92)) return q;
    }
    this.noDelFrom = open + 3;
    return -1;
  }
}

export function inlineMask(text: string, drawing: Drawing = DEFAULT_DRAWING): Uint8Array {
  return new InlineScanner(text, drawing).scan();
}
