// The paste-ready form of a source slice.
//
// findSource returns the EXACT slice of the source (lossless, by contract). A
// slice that comes out of a container carries syntax the user never saw as
// text: code inside a numbered list item has the list indentation on every
// line after the first, code inside a quote has "> " on every line, and a
// selection that started at the beginning of a code row lost the row's own
// indentation on the first line. Pasting that slice as-is breaks the code.
//
//   pasteText(...)  the slice with
//     1. the container prefix (list indentation, "> ", fence indentation)
//        removed from every line after the first, using the parser's own
//        per-line offsets (`contentAt`), and
//     2. the first line's leading blanks put back, as many as the copy carried
//        and the source line really has, never reaching into the container
//        prefix.
//   Lines that start a list item (they hold the marker) are left alone, so a
//   slice that spans items keeps its markers and its nesting. Lines the parser
//   did not consume as text and that hold nothing but blanks and quote markers
//   become empty. Every character of the result is a character of the message
//   from the start of the slice's first line to its end; nothing is invented.

import { firstWithin } from "./sorted.ts";

export interface PasteSource {
  /** The whole message. */
  message: string;
  /** Ascending source offsets where each content line's own text starts. */
  contentAt: Int32Array;
  /** Ascending source offsets of list-marker units (lines holding one are left alone). */
  leadSrc: Int32Array;
}

function lineBounds(message: string, at: number): { from: number; to: number } {
  const from = at <= 0 ? 0 : message.lastIndexOf("\n", at - 1) + 1;
  const nl = message.indexOf("\n", at);
  return { from, to: nl < 0 ? message.length : nl };
}

/** How many blanks to put back before `start`, never past `floor` and never more than the copy carried. */
function restoredBlanks(
  message: string,
  start: number,
  floor: number,
  carried: number,
): number {
  let blanks = 0;
  while (blanks < carried && start - blanks - 1 >= floor) {
    const ch = message[start - blanks - 1];
    if (ch !== " " && ch !== "\t") break;
    blanks++;
  }
  return blanks;
}

function firstLine(
  src: PasteSource,
  start: number,
  end: number,
  carried: number,
): string {
  const { message } = src;
  const line = lineBounds(message, start);
  const content = firstWithin(src.contentAt, line.from, line.to);
  const floor = content !== null && content <= start ? content : line.from;
  const back = restoredBlanks(message, start, floor, carried);
  return message.slice(start - back, Math.min(line.to, end));
}

/** A later line of the slice: [from, to) is its part inside the slice, `full` its whole source line. */
function laterLine(
  src: PasteSource,
  from: number,
  to: number,
  full: { from: number; to: number },
): string {
  const { message } = src;
  if (firstWithin(src.leadSrc, full.from, full.to) !== null)
    return message.slice(from, to);
  const content = firstWithin(src.contentAt, full.from, full.to);
  if (content !== null)
    return content <= to ? message.slice(content, to) : message.slice(from, to);
  const text = message.slice(from, to);
  return /^[ \t>]*(?:\r)?$/.test(text) ? text.replace(/[ \t>]/g, "") : text;
}

/**
 * Paste-ready text for the slice [start, end) of `src.message`.
 * `carried` is how many leading blanks the copy's first row had.
 */
export function pasteText(
  src: PasteSource,
  start: number,
  end: number,
  carried: number,
): string {
  const { message } = src;
  const head = firstLine(src, start, end, carried);
  const firstTo = lineBounds(message, start).to;
  if (firstTo >= end) return head;
  const out = [head];
  let from = firstTo + 1;
  while (from <= end) {
    const full = lineBounds(message, from);
    const to = Math.min(full.to, end);
    out.push(laterLine(src, from, to, full));
    if (full.to >= end) break;
    from = full.to + 1;
  }
  return out.join("\n");
}
