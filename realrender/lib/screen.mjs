// From pane text to "what a terminal selection yields". Works on plain rows
// (tmux capture-pane output), knows nothing about the matcher or the
// simulator, and makes no assumption about the renderer's glyphs: a token is
// found by its own letters and digits, and a selection is a column range.

const TOKEN_RE = /(?<![A-Za-z0-9])[a-z]+\d{4}(?![A-Za-z0-9])/g;

/** Drop SGR and other CSI escape sequences (tmux -e output) so styled rows compare to plain ones. */
export function stripEscapes(text) {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g, "");
}

/** Rows of a capture, without the final empty element a trailing newline makes. */
export function rowsOf(text) {
  const rows = text.split("\n");
  if (rows.at(-1) === "") rows.pop();
  return rows;
}

/** Display width of a string in terminal cells (wide, combining and emoji aware, approximate). */
export function displayWidth(text) {
  let width = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (/\p{M}/u.test(ch) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) continue;
    const wide = (cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Whole tokens: id -> list of segments {row, from, to} (one segment per occurrence). */
function wholeTokens(rows) {
  const found = new Map();
  rows.forEach((row, r) => {
    for (const m of row.matchAll(TOKEN_RE)) {
      const list = found.get(m[0]) ?? [];
      list.push([{ row: r, from: m.index, to: m.index + m[0].length }]);
      found.set(m[0], list);
    }
  });
  return found;
}

/** Tokens cut by a row wrap: end of one row + start of the next (after indentation). */
function splitTokens(rows, ids, found) {
  const pending = ids.filter((id) => !found.has(id));
  for (let r = 0; r + 1 < rows.length && pending.length; r += 1) {
    const tail = /[a-z0-9]+$/.exec(rows[r].trimEnd());
    const lead = /^ *([a-z0-9]+)/.exec(rows[r + 1]);
    if (!tail || !lead) continue;
    const rowEnd = rows[r].trimEnd().length;
    const nextFrom = lead[0].length - lead[1].length;
    for (const id of pending) {
      const s = splitAt(id, tail[0], lead[1]);
      if (s === 0) continue;
      found.set(id, [[{ row: r, from: rowEnd - s, to: rowEnd }, { row: r + 1, from: nextFrom, to: nextFrom + id.length - s }]]);
    }
  }
}

function splitAt(id, tail, head) {
  for (let s = 1; s < id.length; s += 1) {
    if (tail.endsWith(id.slice(0, s)) && head.startsWith(id.slice(s))) return s;
  }
  return 0;
}

/**
 * Where each token sits on the screen.
 * @returns {{where: Map<string, object[]>, locatable: Set<string>, missing: string[], repeated: string[]}}
 *   `where` id -> segments (1 whole, or 2 for a token cut by a wrap);
 *   `locatable` ids seen exactly once; `missing` not seen at all; `repeated` seen more than once.
 */
export function locateOnScreen(rows, ids) {
  const found = wholeTokens(rows);
  splitTokens(rows, ids, found);
  const where = new Map();
  const missing = [];
  const repeated = [];
  for (const id of ids) {
    const hits = found.get(id) ?? [];
    if (hits.length === 1) where.set(id, hits[0]);
    else (hits.length === 0 ? missing : repeated).push(id);
  }
  return { where, locatable: new Set(where.keys()), missing, repeated };
}

/** Row and column of character `k` (0-based) of a located token. */
export function charPos(segments, k) {
  let left = k;
  for (const seg of segments) {
    const len = seg.to - seg.from;
    if (left < len) return { row: seg.row, col: seg.from + left };
    left -= len;
  }
  throw new Error("offset beyond the token");
}

/** Row and column just after character `e - 1` of a located token (the selection end). */
export function endPos(segments, e) {
  const p = charPos(segments, e - 1);
  return { row: p.row, col: p.col + 1 };
}

/**
 * The text a terminal selection yields from `a` to `b` (row, col): the first
 * row from its start column, whole rows between, the last row up to its end
 * column, joined with a hard newline. Rows are right-trimmed (tmux plain
 * output already is); with `pad`, every row but the last keeps blanks up to
 * `width` cells, as a terminal that copies the whole cell row would.
 */
export function selectionText(rows, a, b, { pad = false, width = 0 } = {}) {
  const parts = [];
  for (let r = a.row; r <= b.row; r += 1) {
    const from = r === a.row ? a.col : 0;
    const to = r === b.row ? b.col : rows[r].length;
    let part = rows[r].slice(from, to);
    if (r !== b.row) {
      part = pad ? padTo(part, width - displayWidth(rows[r].slice(0, from))) : part.trimEnd();
    }
    parts.push(part);
  }
  return parts.join("\n");
}

function padTo(text, cells) {
  const missing = cells - displayWidth(text);
  return missing > 0 ? text + " ".repeat(missing) : text;
}

/** Both variants for a span of one message. Returns null when an endpoint is not on the screen. */
export function copiesFor(rows, where, span, width) {
  const first = where.get(span.startToken);
  const last = where.get(span.endToken);
  if (!first || !last) return null;
  const a = charPos(first, span.startOffset);
  const lastLen = span.endToken.length;
  const b = endPos(last, lastLen - span.endCut);
  if (b.row < a.row || (b.row === a.row && b.col <= a.col)) return null;
  return {
    trimmed: selectionText(rows, a, b),
    padded: selectionText(rows, a, b, { pad: true, width }),
    rowsSpanned: b.row - a.row + 1,
    from: a,
    to: b,
  };
}
