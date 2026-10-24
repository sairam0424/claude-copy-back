// The visible text of a message: what the classic renderer draws once the
// markdown is interpreted, with the source index of every character kept.
//
//   projectText(source) -> { projected, map, leadAt, lines }
//     projected  the visible text with wraps joined: markers removed, list
//                bullets as the glyph, links as their label
//     map        for each UTF-16 unit of `projected`, the index in `source` it
//                came from (hidden markers have no entry; they sit between)
//     leadAt     which units are list markers (the matcher's fallback needs it)
//     contentAt  where each source line's own text starts (the paste step needs it)
//     lines      the logical lines (before hard wrapping) that project.ts lays out
//
// The row layout (margin, hard wraps, padding) lives in project.ts.

import { parseDocument } from "./blocks.ts";
import type { Block, Lead, LineView } from "./blocks.ts";
import { inlineMask } from "./inline.ts";
import { TAB_CELLS } from "./wrap.ts";
import type { WrapMode } from "./wrap.ts";
import { stringWidth } from "./width.ts";

/**
 * Glyph drawn for an unordered list item. Claude Code 2.1.309 draws "- " for
 * "-", "*" and "+" items alike (calibration, seed 101).
 */
export const BULLET = "-";

/**
 * Stands for a table in `projected`. It never appears in copied text (the
 * strip step deletes NUL), so no search can cross or land on a table.
 */
export const OPAQUE = "\u0000";

/** One drawn line before wrapping. */
export interface LogicalLine {
  from: number;
  to: number;
  lead: string;
  hang: string;
  mode: WrapMode | "literal";
  literal?: string;
  gap: boolean;
}

export interface ProjectedText {
  projected: string;
  /** Source index of each UTF-16 unit of `projected`. */
  map: Int32Array;
  /** Ascending indices of the units of `projected` that are list markers (bullet glyph or number, not the space after). */
  leadAt: Int32Array;
  /** Ascending source offsets where each content line's own text starts, container prefixes removed (paste.ts). */
  contentAt: Int32Array;
  lines: LogicalLine[];
}

/**
 * Accumulates `projected` as whole runs of text and the `map` as one typed
 * array. Every append records, per UTF-16 unit, the source index it came from.
 */
class Builder {
  private readonly parts: string[] = [];
  private map: Int32Array;
  private count = 0;
  private lastSrc = 0;
  private readonly leadAt: number[] = [];
  private readonly maxSrc: number;

  /** `maxSrc` is the last valid source index: a marker at the very end of the source maps its trailing space there. */
  constructor(capacity: number, maxSrc: number) {
    this.map = new Int32Array(capacity);
    this.maxSrc = maxSrc;
  }

  get length(): number {
    return this.count;
  }

  private reserve(extra: number): void {
    if (this.count + extra <= this.map.length) return;
    const grown = new Int32Array(
      Math.max(this.map.length * 2, this.count + extra),
    );
    grown.set(this.map.subarray(0, this.count));
    this.map = grown;
  }

  /** One unit that maps to source index `src`. */
  unit(ch: string, src: number): void {
    const at = src < this.maxSrc ? src : this.maxSrc;
    this.reserve(1);
    this.parts.push(ch);
    this.map[this.count++] = at;
    this.lastSrc = at;
  }

  /** A run whose units map to consecutive source indices starting at `srcStart`. */
  run(text: string, srcStart: number): void {
    const n = text.length;
    if (n === 0) return;
    this.reserve(n);
    this.parts.push(text);
    for (let k = 0; k < n; k++) this.map[this.count + k] = srcStart + k;
    this.count += n;
    this.lastSrc = srcStart + n - 1;
  }

  /** Flag the unit just pushed as part of a list marker (the glyph or number, not its space). */
  markLead(): void {
    this.leadAt.push(this.count - 1);
  }

  /** Block separators point at the last mapped character before them. */
  separator(count: number): void {
    for (let k = 0; k < count; k++) this.unit("\n", this.lastSrc);
  }

  finish(): { projected: string; map: Int32Array; leadAt: Int32Array } {
    return {
      projected: this.parts.join(""),
      map: this.map.subarray(0, this.count),
      leadAt: Int32Array.from(this.leadAt),
    };
  }
}

function hasBlankBetween(source: string, from: number, to: number): boolean {
  let sawNewline = false;
  for (let i = from; i < to; i++) {
    const c = source.charCodeAt(i);
    if (c === 10) {
      if (sawNewline) return true;
      sawNewline = true;
    } else if (c !== 32 && c !== 9 && c !== 62 && c !== 13) {
      sawNewline = false;
    }
  }
  return false;
}

function pushLeads(out: Builder, leads: readonly Lead[]): void {
  for (const lead of leads) {
    const last = lead.glyph.length - 1;
    for (let k = 0; k <= last; k++) {
      // The drawn marker replaces the typed one: its units map onto the typed
      // marker's characters (the last one stays on the final typed character,
      // so "10." drawn for a typed "1." never points into the item's text); the
      // trailing space points at the character after the typed marker.
      const at = lead.src + (k === last ? lead.srcLen : Math.min(k, lead.srcLen - 1));
      out.unit(lead.glyph[k] as string, at);
      if (k < last) out.markLead();
    }
  }
}

function leadUnits(leads: readonly Lead[]): number {
  let total = 0;
  for (const lead of leads) total += lead.glyph.length;
  return total;
}

interface Prefixes {
  first: string;
  hang: string;
}

function prefixesFor(block: Block): Prefixes {
  const bars = "▎ ".repeat(block.quote);
  const leadWidth = block.leads.reduce(
    (sum, lead) => sum + stringWidth(lead.glyph),
    0,
  );
  return {
    first: bars + " ".repeat(Math.max(0, block.indent - leadWidth)),
    hang: bars + " ".repeat(block.indent),
  };
}

/** A paragraph or heading: markers the inline parser hides are left out. */
function emitText(
  out: Builder,
  block: Block,
  lines: LogicalLine[],
  prefixes: Prefixes,
  gap: boolean,
): void {
  const hidden = inlineMask(block.lines.map((line) => line.t).join("\n"));
  pushLeads(out, block.leads);
  let from = out.length - leadUnits(block.leads);
  let first = true;
  const close = (): void => {
    lines.push({
      from,
      to: out.length,
      lead: first ? prefixes.first : prefixes.hang,
      hang: prefixes.hang,
      mode: "word",
      gap: first && gap,
    });
    first = false;
  };
  let textStart = 0;
  block.lines.forEach((line: LineView, li: number) => {
    if (li > 0) {
      const prev = block.lines[li - 1] as LineView;
      close();
      out.unit("\n", prev.o + prev.t.length);
      from = out.length;
    }
    const end = textStart + line.t.length;
    let runStart = textStart;
    for (let k = textStart; k <= end; k++) {
      const flag = k === end ? 1 : (hidden[k] as number);
      if (flag === 0) continue;
      if (k > runStart)
        out.run(
          line.t.slice(runStart - textStart, k - textStart),
          line.o + (runStart - textStart),
        );
      // flag 2: the typed "]" of a link is drawn as a space
      if (flag === 2) out.unit(" ", line.o + (k - textStart));
      runStart = k + 1;
    }
    textStart = end + 1;
  });
  close();
}

function emitCode(
  out: Builder,
  block: Block,
  lines: LogicalLine[],
  prefixes: Prefixes,
  gap: boolean,
): void {
  pushLeads(out, block.leads);
  let from = out.length - leadUnits(block.leads);
  block.lines.forEach((line: LineView, li: number) => {
    if (li > 0) {
      const prev = block.lines[li - 1] as LineView;
      out.unit("\n", prev.o + prev.t.length);
      from = out.length;
    }
    out.run(line.t, line.o);
    lines.push({
      from,
      to: out.length,
      lead: li === 0 ? prefixes.first : prefixes.hang,
      hang: prefixes.hang,
      mode: "char",
      gap: li === 0 && gap,
    });
  });
  if (block.lines.length === 0) {
    lines.push({
      from,
      to: out.length,
      lead: prefixes.first,
      hang: prefixes.hang,
      mode: "char",
      gap,
    });
  }
}

function emitRule(
  out: Builder,
  block: Block,
  lines: LogicalLine[],
  prefixes: Prefixes,
  gap: boolean,
): void {
  pushLeads(out, block.leads);
  const from = out.length - leadUnits(block.leads);
  const at = (block.lines[0] as LineView).o;
  for (let k = 0; k < 3; k++) out.unit("-", at);
  lines.push({
    from,
    to: out.length,
    lead: prefixes.first,
    hang: prefixes.hang,
    mode: "char",
    gap,
  });
}

/** A table is one opaque unit in `projected`; its rows are drawn raw. */
function emitTable(
  out: Builder,
  block: Block,
  lines: LogicalLine[],
  prefixes: Prefixes,
  gap: boolean,
): void {
  pushLeads(out, block.leads);
  const at = out.length;
  out.unit(OPAQUE, (block.lines[0] as LineView).o);
  block.lines.forEach((line: LineView, li: number) => {
    lines.push({
      from: at,
      to: at,
      lead: prefixes.first,
      hang: prefixes.hang,
      mode: "literal",
      literal: line.t.replace(/\t/g, " ".repeat(TAB_CELLS)),
      gap: li === 0 && gap,
    });
  });
}

/** The visible text of a message and the source index of each of its units. */
export function projectText(
  source: string,
  bullet: string = BULLET,
): ProjectedText {
  const { blocks, contentAt } = parseDocument(source, bullet);
  const out = new Builder(source.length + 4 * blocks.length + 16, Math.max(0, source.length - 1));
  const lines: LogicalLine[] = [];
  let prev: Block | undefined;
  for (const block of blocks) {
    const gap =
      prev !== undefined && hasBlankBetween(source, prev.end, block.start);
    if (prev !== undefined) out.separator(gap ? 2 : 1);
    const prefixes = prefixesFor(block);
    if (block.kind === "para" || block.kind === "heading")
      emitText(out, block, lines, prefixes, gap);
    else if (block.kind === "code") emitCode(out, block, lines, prefixes, gap);
    else if (block.kind === "hr") emitRule(out, block, lines, prefixes, gap);
    else emitTable(out, block, lines, prefixes, gap);
    prev = block;
  }
  return { ...out.finish(), contentAt, lines };
}
