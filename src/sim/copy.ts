// What a terminal puts on the clipboard when a mouse drag covers part of the
// simulated screen. Spans are in `projected` coordinates [from, to).
//
// Model: the first row starts where the drag started (usually mid-line, so no
// margin), middle rows are whole rows with margin and trailing padding, the
// last row ends where the drag ended. Rows join with a hard newline. This is
// an ASSUMPTION about the terminal, to be replaced by real captures.

import { rowBody } from "../core/project.ts";
import type { Projection, RowInfo } from "../core/project.ts";
import { TAB_CELLS } from "../core/wrap.ts";
import { stringWidth } from "../core/width.ts";

export interface CopyOptions {
  width: number;
  /** Keep the trailing space padding on all rows but the last. Default true. */
  pad?: boolean;
  /** When the drag starts at a row's first character, include its margin (and reply bullet). Default false. */
  marginOnFirstRow?: boolean;
  /** Row separator. Default "\n". */
  eol?: "\n" | "\r\n";
  /** Wrap every row in SGR escapes, as colour or reverse-video padding would. Default false. */
  ansi?: boolean;
}

export interface RowsCovered {
  first: number;
  last: number;
  crossesWrap: boolean;
}

function isContent(info: RowInfo): boolean {
  return info.literal === undefined && info.to > info.from;
}

/** Rows touched by the span, and whether it crosses a hard wrap inside one line. */
export function rowsCovered(
  p: Projection,
  from: number,
  to: number,
): RowsCovered {
  let first = -1;
  let last = -1;
  for (let r = 0; r < p.layout.length; r++) {
    const info = p.layout[r] as RowInfo;
    if (info.from >= to && info.to > info.from) break;
    if (!isContent(info)) continue;
    if (first < 0 && info.to > from) first = r;
    if (info.from < to) last = r;
  }
  let crossesWrap = false;
  for (let r = first + 1; first >= 0 && r <= last; r++) {
    if ((p.layout[r] as RowInfo).cont === true) crossesWrap = true;
  }
  return { first, last, crossesWrap };
}

export function copySpan(
  p: Projection,
  from: number,
  to: number,
  opts: CopyOptions,
): string {
  const { first, last } = rowsCovered(p, from, to);
  if (first < 0 || last < first) return "";
  const pad = opts.pad ?? true;
  const rows: string[] = [];
  for (let r = first; r <= last; r++) {
    const info = p.layout[r] as RowInfo;
    const isFirst = r === first;
    const isLast = r === last;
    const full = info.prefix + rowBody(info, p.projected);
    let text = full;
    if (isContent(info)) {
      const a = isFirst ? Math.max(from, info.from) : info.from;
      const b = isLast ? Math.min(to, info.to) : info.to;
      const keepsPrefix =
        !isFirst || (opts.marginOnFirstRow === true && a === info.from);
      const body = p.projected
        .slice(a, b)
        .replace(/\t/g, " ".repeat(TAB_CELLS));
      text = (keepsPrefix ? info.prefix : "") + body;
    }
    if (!isLast && pad)
      text += " ".repeat(Math.max(0, opts.width - stringWidth(full)));
    rows.push(opts.ansi === true ? `\u001b[1m${text}\u001b[0m` : text);
  }
  return rows.join(opts.eol ?? "\n");
}
