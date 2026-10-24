// Glyph and margin inventory of a captured screen. Works on plain text rows
// (tmux capture-pane -p) so it can be unit-tested without a terminal.

/** "U+23FA" style label for a code point. */
export function codePointLabel(ch) {
  return `U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`;
}

/** Non-ASCII characters on the screen: count and the first row each appears on. */
export function nonAsciiInventory(rows) {
  const found = new Map();
  rows.forEach((row, index) => {
    for (const ch of row) {
      if (ch.codePointAt(0) < 128) continue;
      const entry = found.get(ch) ?? { ch, label: codePointLabel(ch), count: 0, firstRow: index + 1 };
      entry.count += 1;
      found.set(ch, entry);
    }
  });
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/**
 * The decoration in front of each row: everything before the first letter or
 * digit (margin, reply marker, list marker, quote bar, ...). Counts distinct
 * prefixes and keeps one example row each.
 */
export function rowPrefixes(rows) {
  const found = new Map();
  rows.forEach((row, index) => {
    if (!row.trim()) return;
    const m = /^[^\p{L}\p{N}]*/u.exec(row);
    const prefix = m ? m[0] : "";
    const entry = found.get(prefix) ?? { prefix, count: 0, example: row, firstRow: index + 1 };
    entry.count += 1;
    found.set(prefix, entry);
  });
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/** Count of leading spaces of a row. */
export function leadingSpaces(row) {
  return /^ */.exec(row)[0].length;
}

/** Longest row in code points (a cheap stand-in for display width). */
export function longestRow(rows) {
  return rows.reduce((max, row) => Math.max(max, [...row].length), 0);
}

/** Tokens like q0042 found in a row (the rig's unique words). */
export function tokensIn(row) {
  return row.match(/\bq\d{4}\b/g) ?? [];
}

/** Rows (1-based) that contain `token`. */
export function rowsWithToken(rows, token) {
  const hits = [];
  rows.forEach((row, index) => {
    if (row.includes(token)) hits.push(index + 1);
  });
  return hits;
}
