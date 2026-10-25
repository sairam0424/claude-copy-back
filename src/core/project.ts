// The screen simulator for the classic renderer.
//
//   project(source, {width}) -> { rows, projected, map, layout }
//     rows       what the terminal shows: margin, hard wraps at `width`, bullet
//                glyphs, quote bars, trailing space padding
//     projected  the visible text with wraps joined: markers removed, list
//                bullets as the glyph, links as their label
//     map        for each UTF-16 unit of `projected`, the index in `source` it
//                came from (hidden markers have no entry; they sit between)
//     layout     per row: the projected range it shows (used by copy.ts)
//
// The renderer, as read from sealed-rig screens of Claude Code 2.1.309 and
// 2.1.310 (tests/real-render.test.mts, tests/drawings.test.mts): two-column
// margin; reply bullet "⏺" on the first row; list items "- " and "1. " (letters
// and roman numerals when nested, ordinals.ts) with the text hanging under the
// first word; quote rows start with "▎ "; code verbatim, wrapped by characters;
// links and struck text as the terminal draws them (drawing.ts); soft line
// breaks drawn as line breaks; tables NOT modelled (one opaque region).
// The visible text itself is built in visible.ts; this file lays it out.

import { DEFAULT_DRAWING } from "./drawing.ts";
import type { Drawing } from "./drawing.ts";
import { BULLET, OPAQUE, projectText } from "./visible.ts";
import type { LogicalLine, ProjectedText } from "./visible.ts";
import { wrapSpans, TAB_CELLS } from "./wrap.ts";
import { stringWidth } from "./width.ts";

export { BULLET, OPAQUE, projectText };
export type { LogicalLine, ProjectedText };

export interface ProjectOptions {
  width: number;
  /** Left margin in columns. Default 2. */
  margin?: number;
  /** Unordered list glyph. Default BULLET. */
  bullet?: string;
  /** Drawn in place of the first margin on the first row; null for none. Default "⏺". */
  replyBullet?: string | null;
  /** How links and struck text are drawn (drawing.ts). Default DEFAULT_DRAWING. */
  drawing?: Drawing;
}

export interface RowInfo {
  /** Everything before the content on this row: margin, bars, indentation. */
  prefix: string;
  /** Projected range [from, to) the row shows. */
  from: number;
  to: number;
  /** Raw text of an opaque (table) row. */
  literal?: string;
  /** True for a row that continues the previous row's line (a hard wrap). */
  cont?: boolean;
}

export interface Projection {
  rows: string[];
  projected: string;
  map: number[];
  layout: RowInfo[];
}

function layoutRows(
  projected: string,
  lines: readonly LogicalLine[],
  opts: Required<Omit<ProjectOptions, "bullet" | "drawing">>,
): RowInfo[] {
  const margin = " ".repeat(opts.margin);
  const rows: RowInfo[] = [];
  for (const line of lines) {
    if (line.gap) rows.push({ prefix: "", from: line.from, to: line.from });
    const firstPrefix = margin + line.lead;
    const restPrefix = margin + line.hang;
    const firstWidth = opts.width - stringWidth(firstPrefix);
    const restWidth = opts.width - stringWidth(restPrefix);
    if (line.mode === "literal") {
      const text = line.literal ?? "";
      wrapSpans(text, firstWidth, restWidth, "char").forEach(([a, b], i) => {
        rows.push({
          prefix: i === 0 ? firstPrefix : restPrefix,
          from: line.from,
          to: line.to,
          literal: text.slice(a, b),
          cont: i > 0,
        });
      });
      continue;
    }
    const text = projected.slice(line.from, line.to);
    wrapSpans(text, firstWidth, restWidth, line.mode).forEach(([a, b], i) => {
      rows.push({
        prefix: i === 0 ? firstPrefix : restPrefix,
        from: line.from + a,
        to: line.from + b,
        cont: i > 0,
      });
    });
  }
  return withReplyBullet(rows, opts.replyBullet, opts.margin);
}

/** The first row draws the reply bullet in place of the first two columns of its margin. */
function withReplyBullet(
  rows: RowInfo[],
  bullet: string | null,
  margin: number,
): RowInfo[] {
  const head = rows[0];
  if (bullet === null || head === undefined || margin < 2) return rows;
  const prefix =
    bullet + " " + " ".repeat(margin - 2) + head.prefix.slice(margin);
  return [{ ...head, prefix }, ...rows.slice(1)];
}

/** What a row draws after its prefix: tabs become four spaces. */
export function rowBody(info: RowInfo, projected: string): string {
  return (
    info.literal ??
    projected.slice(info.from, info.to).replace(/\t/g, " ".repeat(TAB_CELLS))
  );
}

function renderRow(info: RowInfo, projected: string, width: number): string {
  const text = info.prefix + rowBody(info, projected);
  const used = stringWidth(text);
  return used >= width ? text : text + " ".repeat(width - used);
}

export function project(source: string, opts: ProjectOptions): Projection {
  const { projected, map, lines } = projectText(source, opts.bullet ?? BULLET, opts.drawing ?? DEFAULT_DRAWING);
  const layout = layoutRows(projected, lines, {
    width: opts.width,
    margin: opts.margin ?? 2,
    replyBullet: opts.replyBullet === undefined ? "⏺" : opts.replyBullet,
  });
  return {
    rows: layout.map((info) => renderRow(info, projected, opts.width)),
    projected,
    map: Array.from(map),
    layout,
  };
}
