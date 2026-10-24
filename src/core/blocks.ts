// Block structure of a markdown message: just enough CommonMark to know what
// the classic renderer draws as paragraphs, headings, lists (nested), block
// quotes, fenced and indented code, rules and tables. Containers (quote, list
// item) are parsed recursively on de-prefixed line views that keep their
// source offsets, so every character can be traced back to the source.
//
// Containers nest at most MAX_DEPTH deep; what lies deeper is plain paragraph
// text. Real messages nest a handful of levels, and the cap keeps hostile input
// ("> > > > ..." thousands of times) from overflowing the stack or going
// quadratic.
//
// Known simplifications: no HTML blocks, no reference definitions, no
// multi-line table cells, a bullet nested under "1. " with only two spaces
// becomes a sibling list (the visible text is identical, only the drawn
// indentation differs).

import { stringWidth } from "./width.ts";
import {
  atx, dedent, fenceCloses, fenceOpen, HR, indentCols, interruptsParagraph,
  isBlank, listMarker, QUOTE, SETEXT, splitLines, tableAt, trimLine,
} from "./mdlines.ts";
import type { Atx, Fence, LineView, Marker } from "./mdlines.ts";

export type { LineView };

/** A list marker as drawn: `glyph` is the printed text ("- ", "3. "), `src` the typed marker's source index. */
export interface Lead {
  glyph: string;
  src: number;
  /** Length of the typed marker ("1." is 2, "-" is 1); the drawn marker may be longer ("10."). */
  srcLen: number;
}

export type BlockKind = "para" | "heading" | "code" | "hr" | "table";

export interface Block {
  kind: BlockKind;
  lines: LineView[];
  /** Source range of the whole block, markers and fences included. */
  start: number;
  end: number;
  /** Block quote depth. */
  quote: number;
  /** Columns of list indentation for the block's content rows. */
  indent: number;
  /** List markers drawn before the first row's content. */
  leads: Lead[];
  level: number;
}

/** How many quotes / list items may nest before the rest is read as plain text. */
export const MAX_DEPTH = 32;

interface Scope {
  quote: number;
  indent: number;
  /** Containers entered so far (quotes and list items). */
  depth: number;
  bullet: string;
  out: Block[];
  /**
   * Source offset where each consumed line's own text starts, once every
   * container prefix (list indentation, "> ") is removed. The paste step uses
   * it to drop those prefixes. Shared by all scopes of one parse.
   */
  contentAt: number[];
}

function leadingBlankCount(t: string): number {
  let n = 0;
  while (n < t.length && (t[n] === " " || t[n] === "\t")) n++;
  return n;
}

function endOf(line: LineView | undefined, fallback: number): number {
  return line === undefined ? fallback : line.o + line.t.length;
}

/**
 * One pass over the lines of a container (the message, a quote, a list item).
 * `pending` holds the list markers drawn before the NEXT block emitted: only
 * the first block of a list item carries its markers.
 */
class Walker {
  private readonly lines: LineView[];
  private readonly scope: Scope;
  private pending: Lead[];

  constructor(lines: LineView[], scope: Scope, leadsIn: Lead[]) {
    this.lines = lines;
    this.scope = scope;
    this.pending = leadsIn;
  }

  run(): void {
    let i = 0;
    while (i < this.lines.length) i = this.step(i);
    if (this.pending.length > 0) {
      // A list item with no content: an empty paragraph carries its marker.
      const at = (this.pending[0] as Lead).src;
      this.emit("para", [], at, at + 1);
    }
  }

  private emit(
    kind: BlockKind,
    content: LineView[],
    start: number,
    end: number,
    level = 0,
  ): void {
    const first = this.pending[0];
    this.scope.out.push({
      kind,
      lines: content,
      start: first !== undefined ? Math.min(first.src, start) : start,
      end,
      quote: this.scope.quote,
      indent: this.scope.indent,
      leads: this.pending,
      level,
    });
    this.pending = [];
  }

  /** Parse the block that starts at line `i`; returns the index of the line after it. */
  private step(i: number): number {
    const line = this.lines[i] as LineView;
    if (isBlank(line.t)) return i + 1;
    if (indentCols(line.t) >= 4) return this.indentedCode(i);
    const fence = fenceOpen(line.t);
    if (fence !== null) return this.fencedCode(i, fence);
    const heading = atx(line.t);
    if (heading !== null) return this.atxHeading(i, heading);
    if (HR.test(line.t)) {
      this.mark(line);
      this.emit("hr", [line], line.o, endOf(line, line.o));
      return i + 1;
    }
    const nest = this.scope.depth < MAX_DEPTH;
    if (nest && QUOTE.test(line.t))
      return this.takeOver(quoteBlock(this.lines, i, this.scope, this.pending));
    const mk = nest ? listMarker(line.t) : null;
    if (mk !== null)
      return this.takeOver(list(this.lines, i, this.scope, this.pending, mk.ordered));
    if (tableAt(this.lines, i)) return this.table(i);
    return this.paragraph(i);
  }

  /** A quote or list consumed the pending markers (it drew them on its first block). */
  private takeOver(next: number): number {
    this.pending = [];
    return next;
  }

  /** Remember where this line's own text starts (leading blanks skipped). */
  private mark(line: LineView): void {
    this.scope.contentAt.push(line.o + leadingBlankCount(line.t));
  }

  private indentedCode(i: number): number {
    const { lines } = this;
    const n = lines.length;
    let j = i;
    while (
      j < n &&
      (isBlank((lines[j] as LineView).t) ||
        indentCols((lines[j] as LineView).t) >= 4)
    )
      j++;
    while (j > i && isBlank((lines[j - 1] as LineView).t)) j--;
    const code = lines.slice(i, j).map((l) => dedent(l, 4));
    for (const line of code) this.scope.contentAt.push(line.o);
    const first = lines[i] as LineView;
    this.emit("code", code, first.o, endOf(lines[j - 1], first.o));
    return j;
  }

  private fencedCode(i: number, fence: Fence): number {
    const { lines } = this;
    const open = lines[i] as LineView;
    let j = i + 1;
    const code: LineView[] = [];
    this.mark(open);
    while (j < lines.length && !fenceCloses((lines[j] as LineView).t, fence)) {
      const line = dedent(lines[j] as LineView, fence.indent);
      this.scope.contentAt.push(line.o);
      code.push(line);
      j++;
    }
    const closing = lines[j];
    if (closing !== undefined) this.mark(closing);
    // Unclosed fences run to the end of the container.
    const end =
      closing !== undefined ? endOf(closing, open.o) : endOf(lines[j - 1], open.o);
    this.emit("code", code, open.o, end);
    return closing !== undefined ? j + 1 : j;
  }

  private atxHeading(i: number, heading: Atx): number {
    const line = this.lines[i] as LineView;
    const text = { t: line.t.slice(heading.from, heading.to), o: line.o + heading.from };
    this.mark(line);
    this.emit("heading", [text], line.o, endOf(line, line.o), heading.level);
    return i + 1;
  }

  private table(i: number): number {
    const { lines } = this;
    const first = lines[i] as LineView;
    let j = i + 2;
    while (
      j < lines.length &&
      !isBlank((lines[j] as LineView).t) &&
      (lines[j] as LineView).t.includes("|")
    )
      j++;
    for (let k = i; k < j; k++) this.mark(lines[k] as LineView);
    this.emit("table", lines.slice(i, j), first.o, endOf(lines[j - 1], first.o));
    return j;
  }

  /** Does this line end the paragraph being read (below the depth cap, containers can interrupt it)? */
  private breaksParagraph(t: string, at: number): boolean {
    if (tableAt(this.lines, at)) return true;
    if (this.scope.depth < MAX_DEPTH) return interruptsParagraph(t);
    return fenceOpen(t) !== null || atx(t) !== null || HR.test(t);
  }

  /** A paragraph, or a setext heading when an underline follows its text. */
  private paragraph(i: number): number {
    const { lines } = this;
    const n = lines.length;
    const first = lines[i] as LineView;
    const para: LineView[] = [trimLine(first)];
    let j = i + 1;
    let level = 0;
    let underlineEnd = 0;
    while (j < n) {
      const next = lines[j] as LineView;
      if (isBlank(next.t)) break;
      const setext = SETEXT.exec(next.t);
      if (setext !== null) {
        level = (setext[1] as string).startsWith("=") ? 1 : 2;
        underlineEnd = endOf(next, 0);
        this.mark(next);
        j++;
        break;
      }
      if (this.breaksParagraph(next.t, j)) break;
      para.push(trimLine(next));
      j++;
    }
    for (const line of para) this.scope.contentAt.push(line.o);
    const last = para[para.length - 1] as LineView;
    if (level > 0) this.emit("heading", para, first.o, underlineEnd, level);
    else this.emit("para", para, first.o, last.o + last.t.length);
    return j;
  }
}

function walk(lines: LineView[], scope: Scope, leadsIn: Lead[]): void {
  new Walker(lines, scope, leadsIn).run();
}

function quoteBlock(
  lines: LineView[],
  from: number,
  scope: Scope,
  pending: Lead[],
): number {
  const inner: LineView[] = [];
  let j = from;
  let prevText = false;
  while (j < lines.length) {
    const line = lines[j] as LineView;
    const m = QUOTE.exec(line.t);
    if (m !== null) {
      const rest: LineView = {
        t: line.t.slice(m[0].length),
        o: line.o + m[0].length,
      };
      inner.push(rest);
      prevText = !isBlank(rest.t);
    } else if (prevText && !isBlank(line.t) && !interruptsParagraph(line.t)) {
      inner.push(trimLine(line));
    } else {
      break;
    }
    j++;
  }
  walk(inner, { ...scope, quote: scope.quote + 1, depth: scope.depth + 1 }, pending);
  return j;
}

/**
 * The lines of the list item whose marker is on line `from`: the marker line
 * (marker removed), then every following line that belongs to the item.
 * Returns the item's lines and the index of the first line after them.
 */
function gatherItem(
  lines: LineView[],
  from: number,
  mk: Marker,
): { item: LineView[]; next: number } {
  const first = lines[from] as LineView;
  const item: LineView[] = [
    { t: first.t.slice(mk.contentCol), o: first.o + mk.contentCol },
  ];
  let j = from + 1;
  while (j < lines.length) {
    const next = lines[j] as LineView;
    if (isBlank(next.t)) {
      item.push({ t: "", o: next.o });
      j++;
      continue;
    }
    const prev = item[item.length - 1] as LineView;
    if (indentCols(next.t) >= mk.width) {
      item.push(dedent(next, mk.width));
    } else if (
      !isBlank(prev.t) &&
      fenceOpen(prev.t) === null &&
      !interruptsParagraph(next.t) &&
      listMarker(next.t) === null
    ) {
      item.push(trimLine(next)); // lazy continuation of a paragraph
    } else {
      break;
    }
    j++;
  }
  return { item, next: j };
}

function list(
  lines: LineView[],
  from: number,
  scope: Scope,
  pendingIn: Lead[],
  ordered: boolean,
): number {
  let pending = pendingIn;
  const n = lines.length;
  let i = from;
  const firstMarker = listMarker((lines[from] as LineView).t) as Marker;
  const delimiter = firstMarker.text.slice(-1);
  let index = 0; // Claude Code numbers an ordered list start + index and draws "." (calibration, seed 101)
  const sameList = (m: Marker | null): m is Marker =>
    m !== null && m.ordered === ordered && (!ordered || m.text.slice(-1) === delimiter);
  while (i < n) {
    const line = lines[i] as LineView;
    const mk = listMarker(line.t);
    if (!sameList(mk) || HR.test(line.t)) break;
    const { item, next } = gatherItem(lines, i, mk);
    // The marker line is never a trailing blank: only continuation lines
    // after it may be handed back to the outer loop.
    let keep = item.length;
    while (keep > 1 && isBlank((item[keep - 1] as LineView).t)) keep--;
    const glyph = ordered ? `${firstMarker.num + index++}. ` : `${scope.bullet} `;
    const lead: Lead = { glyph, src: line.o + mk.at, srcLen: mk.text.length };
    const inner: Scope = {
      ...scope,
      indent: scope.indent + stringWidth(glyph),
      depth: scope.depth + 1,
    };
    walk(item.slice(0, keep), inner, [...pending, lead]);
    pending = [];
    i = next - (item.length - keep);
    let k = i;
    while (k < n && isBlank((lines[k] as LineView).t)) k++;
    i = k;
    if (k >= n || !sameList(listMarker((lines[k] as LineView).t)) || HR.test((lines[k] as LineView).t)) break;
  }
  return i;
}

export interface Document {
  blocks: Block[];
  /** Ascending source offsets where each content line's own text starts (see Scope.contentAt). */
  contentAt: Int32Array;
}

/** `bullet` is the glyph drawn for unordered items; ordered items are numbered start + index. */
export function parseDocument(source: string, bullet: string): Document {
  const blocks: Block[] = [];
  const contentAt: number[] = [];
  walk(
    splitLines(source),
    { quote: 0, indent: 0, depth: 0, bullet, out: blocks, contentAt },
    [],
  );
  return { blocks, contentAt: Int32Array.from(contentAt).sort() };
}

export function parseBlocks(source: string, bullet: string): Block[] {
  return parseDocument(source, bullet).blocks;
}
