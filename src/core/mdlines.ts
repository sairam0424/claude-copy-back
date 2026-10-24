// Line-level markdown recognition shared by the block parser: line views that
// keep their source offsets, indentation arithmetic (tab stops of four), and
// the patterns for fences, ATX headings, rules, quotes, list markers and
// tables. Pure functions over one line of text.

/** A line with its container prefix removed; `o` is the source offset of t[0]. */
export interface LineView {
  t: string;
  o: number;
}

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
export const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
export const SETEXT = /^ {0,3}(=+|-{2,})[ \t]*$/;
export const QUOTE = /^ {0,3}> ?/;
const BULLET_RE = /^( {0,3})([-+*])([ \t]+|$)/;
const ORDERED_RE = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/;
const TABLE_DELIM =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function isBlank(t: string): boolean {
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c !== 32 && c !== 9) return false;
  }
  return true;
}

export function indentCols(t: string): number {
  let col = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4 - (col % 4);
    else break;
  }
  return col;
}

/** Remove up to `cols` columns of leading blanks. */
export function dedent(line: LineView, cols: number): LineView {
  let col = 0;
  let i = 0;
  while (i < line.t.length && col < cols) {
    const c = line.t.charCodeAt(i);
    if (c === 32) col++;
    else if (c === 9) col += 4 - (col % 4);
    else break;
    i++;
  }
  return { t: line.t.slice(i), o: line.o + i };
}

export function trimLine(line: LineView): LineView {
  let s = 0;
  let e = line.t.length;
  while (s < e && (line.t[s] === " " || line.t[s] === "\t")) s++;
  while (e > s && (line.t[e - 1] === " " || line.t[e - 1] === "\t")) e--;
  return { t: line.t.slice(s, e), o: line.o + s };
}

export function splitLines(src: string): LineView[] {
  const out: LineView[] = [];
  let pos = 0;
  while (pos <= src.length) {
    let nl = src.indexOf("\n", pos);
    if (nl < 0) nl = src.length;
    let end = nl;
    if (end > pos && src.charCodeAt(end - 1) === 13) end--;
    out.push({ t: src.slice(pos, end), o: pos });
    pos = nl + 1;
  }
  return out;
}

export interface Fence {
  indent: number;
  ch: string;
  len: number;
}

export function fenceOpen(t: string): Fence | null {
  const m = FENCE.exec(t);
  if (m === null) return null;
  const run = m[2] as string;
  if (run[0] === "`" && (m[3] as string).includes("`")) return null;
  return {
    indent: (m[1] as string).length,
    ch: run[0] as string,
    len: run.length,
  };
}

export function fenceCloses(t: string, fence: Fence): boolean {
  let i = 0;
  while (i < 3 && t[i] === " ") i++;
  let run = 0;
  while (t[i + run] === fence.ch) run++;
  return run >= fence.len && isBlank(t.slice(i + run));
}

export interface Atx {
  level: number;
  from: number;
  to: number;
}

export function atx(t: string): Atx | null {
  let i = 0;
  while (i < 3 && t[i] === " ") i++;
  let h = 0;
  while (t[i + h] === "#") h++;
  if (h < 1 || h > 6) return null;
  const after = i + h;
  if (after < t.length && t[after] !== " " && t[after] !== "\t") return null;
  let from = after;
  while (from < t.length && (t[from] === " " || t[from] === "\t")) from++;
  let to = t.length;
  while (to > from && (t[to - 1] === " " || t[to - 1] === "\t")) to--;
  let hashes = to;
  while (hashes > from && t[hashes - 1] === "#") hashes--;
  if (
    hashes < to &&
    (hashes === from || t[hashes - 1] === " " || t[hashes - 1] === "\t")
  ) {
    to = hashes;
    while (to > from && (t[to - 1] === " " || t[to - 1] === "\t")) to--;
  }
  return { level: h, from, to };
}

export interface Marker {
  ordered: boolean;
  text: string;
  at: number;
  contentCol: number;
  /** Columns a continuation line must be indented to belong to the item. */
  width: number;
  num: number;
  empty: boolean;
}

export function listMarker(t: string): Marker | null {
  const b = BULLET_RE.exec(t);
  if (b !== null) {
    return marker(
      false,
      b[2] as string,
      (b[1] as string).length,
      (b[3] as string).length,
      0,
    );
  }
  const o = ORDERED_RE.exec(t);
  if (o !== null) {
    const text = (o[2] as string) + (o[3] as string);
    return marker(
      true,
      text,
      (o[1] as string).length,
      (o[4] as string).length,
      parseInt(o[2] as string, 10),
    );
  }
  return null;
}

function marker(
  ordered: boolean,
  text: string,
  at: number,
  spaces: number,
  num: number,
): Marker {
  const end = at + text.length;
  const empty = spaces === 0;
  const keepsSpaces = spaces >= 1 && spaces <= 4;
  return {
    ordered,
    text,
    at,
    contentCol: keepsSpaces ? end + spaces : empty ? end : end + 1,
    width: keepsSpaces ? end + spaces : end + 1,
    num,
    empty,
  };
}

/** Does this line start a block that may interrupt a paragraph? */
export function interruptsParagraph(t: string): boolean {
  if (fenceOpen(t) !== null || atx(t) !== null || HR.test(t) || QUOTE.test(t))
    return true;
  const mk = listMarker(t);
  return mk !== null && !mk.empty && (!mk.ordered || mk.num === 1);
}

function cellCount(t: string): number {
  let s = t.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).length;
}

export function tableAt(lines: LineView[], i: number): boolean {
  const head = lines[i];
  const delim = lines[i + 1];
  if (head === undefined || delim === undefined) return false;
  if (
    !head.t.includes("|") ||
    !delim.t.includes("|") ||
    !TABLE_DELIM.test(delim.t)
  )
    return false;
  return cellCount(head.t) === cellCount(delim.t);
}
