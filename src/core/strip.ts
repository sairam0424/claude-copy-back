// stripDecoration: the ONE place that removes known renderer decoration from
// text copied out of the terminal. Written to be tuned by hand.
//
// CONTRACT
//   input   whatever the clipboard held after a terminal copy (any string)
//   output  the same text minus the decoration listed in DECORATION_TABLE
//   it NEVER re-wraps (rows stay rows), NEVER collapses inner whitespace and
//   NEVER invents or reorders characters. Joining wrapped rows is the
//   matcher's job (match.ts folds whitespace on both sides).
//   pure and total: no state, no I/O, never throws.
//
// HOW TO TUNE
//   1. A glyph or control character the real renderer draws that is not here:
//      add it to the matching constant below AND add a row to DECORATION_TABLE
//      (the test suite runs every table row, so the table cannot lie).
//   2. A glyph that is legitimately part of the text (box-drawing trees in a
//      code fence, a quote bar the model typed itself): the matcher searches
//      the copy as typed ({ glyphs: false }) BEFORE the stripped form, so a
//      real glyph at the start of a row is never lost and a wrong guess costs
//      one extra search, not a miss. Use that switch rather than deleting the
//      glyph from the table.
//   3. List bullets ("•", "1.") are NOT decoration by default: the renderer
//      draws them from the markdown list marker, project.ts reproduces them,
//      and the two sides then match literally. The glyph and the numbering
//      style are the least certain guesses in the simulator, so the matcher
//      also has a fallback that treats row-leading list markers as removable
//      ({ markers: true }) and skips the projection's markers to match. If your
//      terminal shows a different bullet, set BULLET in project.ts; the
//      fallback keeps working until you do.
//
// READ-ONLY HELPERS (they only look at a copy, they never change it):
//   listMarkersOf(text)  the list-marker tokens { markers: true } would remove
//   firstRowIndent(text) blanks before the first character (paste.ts restores them)
//   glyphEdges(text)     whether the glyph step took a glyph off the first / last row
//   startsWithMarker / endsWithLoneMarker  the marker fallback's edge cases
//
// NOT HANDLED (by design, v1): box-drawing tables, diffs, tool output.

/** Columns of left margin the classic renderer puts before every reply row. */
export const MARGIN = 2;

export interface StripOptions {
  /** Left margin in columns. Default MARGIN. */
  margin?: number;
  /**
   * Remove the reply bullet and the quote / gutter bars at the start of a row.
   * Default true. The matcher also tries false, because these characters can
   * be real text (a model-drawn tree in a code fence starts rows with "│").
   */
  glyphs?: boolean;
  /**
   * Also remove a list marker at the start of a row: a bullet glyph, "-", "*",
   * "+", "1.", "2)", "a.", "iv.". Default false: markers are real text. Only
   * the matcher's marker-agnostic fallback turns this on.
   */
  markers?: boolean;
}

/** The reply bullet Claude Code draws on the first row of a message. */
const REPLY_BULLETS = ["⏺", "●"];

/** Bars drawn at the start of a row for quotes and tool output. */
const GUTTER_BARS = ["▎", "▏", "▌", "┃", "│", "⎿"];

/** Zero-width characters that carry no meaning. ZWJ/ZWNJ are kept: emoji need them. */
const ZERO_WIDTH = ["\u200b", "\u2060", "\ufeff", "\u00ad"];

export interface DecorationRow {
  name: string;
  /** Where it comes from and why it is safe to remove. */
  why: string;
  /**
   * "always": removed by default. "glyphs": removed unless { glyphs: false }.
   * "markers": removed only with { markers: true }.
   */
  switch: "always" | "glyphs" | "markers";
  /** `clean` is the result with the switch on; `kept` the result with it off. */
  example: { raw: string; clean: string; kept?: string };
}

/** Everything stripDecoration knows. Each example is executed by the tests. */
export const DECORATION_TABLE: readonly DecorationRow[] = [
  {
    name: "left margin",
    why: "The renderer indents every reply row by two columns; the same margin is on every row after the first.",
    switch: "always",
    example: { raw: "  hello\n  world", clean: "hello\nworld" },
  },
  {
    name: "trailing padding",
    why: "Rows are painted to the full terminal width, so copied rows end in spaces.",
    switch: "always",
    example: { raw: "hello      \nworld   ", clean: "hello\nworld" },
  },
  {
    name: "ANSI escapes",
    why: "Colour, reverse-video padding, erase-to-end and OSC 8 hyperlinks can ride along with a copy.",
    switch: "always",
    example: {
      raw: "\u001b[1mhi\u001b[0m \u001b]8;;http://x\u0007link\u001b]8;;\u0007",
      clean: "hi link",
    },
  },
  {
    name: "carriage returns",
    why: "Some terminals and clipboards hand back CRLF.",
    switch: "always",
    example: { raw: "a\r\nb", clean: "a\nb" },
  },
  {
    name: "invisible characters",
    why: "NBSP stands in for a space; zero-width characters and control bytes have no visible meaning.",
    switch: "always",
    example: { raw: "a\u00a0b\u200bc\u0007", clean: "a bc" },
  },
  {
    name: "reply bullet",
    why: "The first row of a reply starts with the reply bullet, which is not in the markdown source.",
    switch: "glyphs",
    example: {
      raw: "⏺ Hello\n  world",
      clean: "Hello\nworld",
      kept: "⏺ Hello\nworld",
    },
  },
  {
    name: "quote and gutter bars",
    why: "Block quotes and tool output draw a bar at the start of each row; the markdown source has only '>'.",
    switch: "glyphs",
    example: {
      raw: "  ▎ quoted\n  ▎ more",
      clean: "quoted\nmore",
      kept: "▎ quoted\n▎ more",
    },
  },
  {
    name: "list markers (fallback)",
    why: "The bullet glyph and numbering style are the least certain renderer guess, so the matcher's fallback tier drops row-leading markers and matches the text after them.",
    switch: "markers",
    example: {
      raw: "  • one\n  1. two",
      clean: "one\ntwo",
      kept: "• one\n1. two",
    },
  },
];

// ---- steps (each is small, pure and independent) ---------------------------

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CSI_8BIT = /\u009b[0-?]*[ -/]*[@-~]/g;
const ESC_PAIR = /\u001b[@-Z\\-_]/g;
// Every C0 control except tab and newline (CR is turned into a newline first).
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

function removeAnsi(text: string): string {
  return text
    .replace(OSC, "")
    .replace(CSI, "")
    .replace(CSI_8BIT, "")
    .replace(ESC_PAIR, "");
}

function normalizeLineEnds(text: string): string {
  return text.replace(/\r\n|\r/g, "\n");
}

function normalizeInvisibles(text: string): string {
  let out = text.replace(/\u00a0/g, " ");
  for (const ch of ZERO_WIDTH) out = out.split(ch).join("");
  return out.replace(CONTROLS, "");
}

function trimTrailingBlanks(row: string): string {
  let end = row.length;
  while (end > 0 && (row[end - 1] === " " || row[end - 1] === "\t")) end--;
  return row.slice(0, end);
}

function startsWithAny(text: string, chars: readonly string[]): boolean {
  return chars.some((ch) => text.startsWith(ch));
}

/** Leading blanks, then optionally a reply bullet and any run of gutter bars. */
function stripRowGlyphs(row: string): string {
  const lead = leadingBlanks(row);
  let rest = row.slice(lead);
  if (
    startsWithAny(rest, REPLY_BULLETS) &&
    (rest.length === 1 || rest[1] === " ")
  ) {
    rest = rest.slice(2);
  }
  while (startsWithAny(rest, GUTTER_BARS)) {
    rest = rest.slice(1);
    if (rest.startsWith(" ")) rest = rest.slice(1);
  }
  return row.slice(0, lead) + rest;
}

// A list marker at the start of a row: a bullet glyph or sign, a number, a
// letter, or a short roman numeral ("-flag" and "3.14" are text). It only counts
// as a marker when text follows it on the same row; a marker alone on a row is
// recognised on the LAST row only (a selection that ends on the next item's
// bullet). A lone token elsewhere ("e." closing a sentence) is text.
const MARKER_TOKEN = String.raw`(?:[•◦▪▫‣⁃∙·○●*+–-]|\d{1,3}[.)]|[a-zA-Z][.)]|[ivxlcdmIVXLCDM]{2,6}[.)])`;
const MARKER_BEFORE_TEXT = new RegExp(
  String.raw`^([ \t]*)(${MARKER_TOKEN})[ \t]+(?=\S)`,
);
const MARKER_ALONE = new RegExp(String.raw`^([ \t]*)(${MARKER_TOKEN})[ \t]*$`);

function lastFilledRow(rows: readonly string[]): number {
  let i = rows.length - 1;
  while (i >= 0 && isBlankRow(rows[i] as string)) i--;
  return i;
}

function stripMarkers(rows: string[]): string[] {
  const last = lastFilledRow(rows);
  return rows.map((row, i) => {
    if (MARKER_BEFORE_TEXT.test(row))
      return row.replace(MARKER_BEFORE_TEXT, "$1");
    if (i === last && MARKER_ALONE.test(row))
      return row.replace(MARKER_ALONE, "$1");
    return row;
  });
}

/**
 * The list-marker tokens that `{ markers: true }` would remove from `text`, in
 * order ("•", "-", "12.", "b)"). The matcher compares their numbers with the
 * source's, so a renderer that draws digits must draw the SAME digits.
 */
export function listMarkersOf(text: string): string[] {
  const rows = text.split("\n");
  const last = lastFilledRow(rows);
  const out: string[] = [];
  rows.forEach((row, i) => {
    const m =
      MARKER_BEFORE_TEXT.exec(row) ?? (i === last ? MARKER_ALONE.exec(row) : null);
    if (m !== null) out.push(m[2] as string);
  });
  return out;
}

function isGlyphLead(rest: string): boolean {
  return (
    startsWithAny(rest, GUTTER_BARS) ||
    (startsWithAny(rest, REPLY_BULLETS) && (rest.length === 1 || rest[1] === " "))
  );
}

/**
 * What the glyph step would take off the EDGES of `kept` (a copy stripped of
 * everything but glyphs). head: its first non-blank row starts with a reply
 * bullet or bar. tail: its last non-blank row is nothing but one (a selection
 * that ended on the next item's bullet). When the renderer draws list bullets
 * with the same glyph, that "decoration" is really a list marker, and the
 * matcher uses these flags to take the marker back into the slice.
 */
export function glyphEdges(kept: string): { head: boolean; tail: boolean } {
  const rows = kept.split("\n").filter((r) => !isBlankRow(r));
  const first = rows[0];
  const last = rows[rows.length - 1];
  return {
    head: first !== undefined && isGlyphLead(first.slice(leadingBlanks(first))),
    tail:
      last !== undefined &&
      isGlyphLead(last.slice(leadingBlanks(last))) &&
      stripRowGlyphs(last).trim() === "",
  };
}

/** Leading blanks of the first non-blank row of `text`: what the copy carried before its first character. */
export function firstRowIndent(text: string): number {
  const row = text.split("\n").find((r) => !isBlankRow(r));
  return row === undefined ? 0 : leadingBlanks(row);
}

/** Does the last non-blank row of `text` consist of nothing but a list marker? */
export function endsWithLoneMarker(text: string): boolean {
  const rows = text.split("\n");
  const row = rows[lastFilledRow(rows)];
  return row !== undefined && MARKER_ALONE.test(row);
}

/** Does the first non-blank row of `text` start with a list marker followed by text? */
export function startsWithMarker(text: string): boolean {
  const row = text.split("\n").find((r) => !isBlankRow(r));
  return row !== undefined && MARKER_BEFORE_TEXT.test(row);
}

function leadingBlanks(row: string): number {
  let i = 0;
  while (i < row.length && (row[i] === " " || row[i] === "\t")) i++;
  return i;
}

function isBlankRow(row: string): boolean {
  return leadingBlanks(row) === row.length;
}

/**
 * The margin is the renderer's left margin (MARGIN columns), but only on rows
 * that actually carry it: it is capped by the shallowest row after the first,
 * so a copy that does not carry the margin loses nothing. The first row of a
 * selection usually starts mid-line and has no margin, so it only loses blanks
 * when it has at least as many as the margin. Deeper indentation (code) is
 * never touched, only the margin is peeled off. A single non-blank row loses
 * all its leading blanks. The matcher is whitespace-insensitive, so this step
 * is tidiness, not correctness.
 */
function removeUniformMargin(rows: string[], margin: number): string[] {
  const first = rows[0];
  // A loop, not Math.min(...rows): spreading a huge array overflows the stack.
  let width = margin;
  let sawRest = false;
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as string;
    if (isBlankRow(row)) continue;
    sawRest = true;
    width = Math.min(width, leadingBlanks(row));
  }
  if (!sawRest && first !== undefined && !isBlankRow(first))
    width = leadingBlanks(first);
  return rows.map((row) => {
    if (isBlankRow(row)) return "";
    return leadingBlanks(row) >= width ? row.slice(width) : row;
  });
}

export function stripDecoration(
  copied: string,
  opts: StripOptions = {},
): string {
  const glyphs = opts.glyphs ?? true;
  const text = normalizeInvisibles(normalizeLineEnds(removeAnsi(copied)));
  let rows = text.split("\n").map(trimTrailingBlanks);
  if (glyphs) rows = rows.map(stripRowGlyphs);
  if (opts.markers === true) rows = stripMarkers(rows);
  return removeUniformMargin(rows, opts.margin ?? MARGIN).join("\n");
}
