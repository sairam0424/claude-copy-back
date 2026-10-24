// Hard wrapping at a cell width, the way the simulator assumes the classic
// renderer does it: prose breaks at spaces (the space at the break is
// consumed) and only splits a word that is longer than the row; code breaks
// exactly at the width, spaces and all. A tab is drawn as four cells.

import { cellWidth } from "./width.ts";

export const TAB_CELLS = 8;

export type WrapMode = "word" | "char";

function unitWidth(cp: number): number {
  return cp === 9 ? TAB_CELLS : cellWidth(cp);
}

/**
 * Split `text` into rows. Returns [start, end) offsets into `text`; the first
 * row has `firstWidth` cells, later rows `restWidth`. Always makes progress,
 * so a width smaller than one character still terminates.
 */
export function wrapSpans(
  text: string,
  firstWidth: number,
  restWidth: number,
  mode: WrapMode,
): Array<[number, number]> {
  const n = text.length;
  if (n === 0) return [[0, 0]];
  const rows: Array<[number, number]> = [];
  let pos = 0;
  let avail = Math.max(1, firstWidth);
  while (pos < n) {
    let used = 0;
    let i = pos;
    let lastSpace = -1;
    while (i < n) {
      const cp = text.codePointAt(i) as number;
      const cw = unitWidth(cp);
      if (used + cw > avail) break;
      if (cp === 32) lastSpace = i;
      used += cw;
      i += cp > 0xffff ? 2 : 1;
    }
    if (i >= n) {
      rows.push([pos, n]);
      break;
    }
    let end = i;
    let next = i;
    if (i === pos) {
      end = pos + ((text.codePointAt(pos) as number) > 0xffff ? 2 : 1);
      next = end;
    } else if (mode === "word") {
      if (text[i] === " ") {
        end = i;
      } else if (lastSpace > pos) {
        end = lastSpace;
        next = lastSpace;
      }
      while (end > pos && text[end - 1] === " ") end--;
      if (text[next] === " ") while (next < n && text[next] === " ") next++;
    }
    rows.push([pos, end]);
    pos = next;
    avail = Math.max(1, restWidth);
  }
  return rows;
}
