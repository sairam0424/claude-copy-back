#!/usr/bin/env node
// Glyph and margin survey of one captured screen (plain tmux capture).
//
//   node realrender/survey.mjs <capture-plain.txt> [--rows N]
//
// Prints (as JSON): every non-ASCII character with its code point, count and
// first row; the distinct row prefixes (margin + marker) with counts and an
// example row; the longest row; and the rows holding the survey's key tokens.

import fs from "node:fs";
import { longestRow, nonAsciiInventory, rowPrefixes, rowsWithToken } from "./lib/glyphs.mjs";

/** Trim trailing blank rows. */
export function trimTrailingBlank(rows) {
  const out = [...rows];
  while (out.length && !out.at(-1).trim()) out.pop();
  return out;
}

/** Build the survey object for the rows of one capture. */
export function survey(rows) {
  const body = trimTrailingBlank(rows);
  return {
    rows: body.length,
    longestRow: longestRow(body),
    nonAscii: nonAsciiInventory(body).map(({ ch, label, count, firstRow }) => ({ ch, label, count, firstRow })),
    prefixes: rowPrefixes(body).map(({ prefix, count, example, firstRow }) => ({ prefix, count, firstRow, example: example.slice(0, 70) })),
  };
}

/** Rows (1-based) where each token appears, for tokens given on the command line. */
export function tokenRows(rows, tokens) {
  return Object.fromEntries(tokens.map((t) => [t, rowsWithToken(rows, t)]));
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    process.stderr.write("usage: node realrender/survey.mjs <capture-plain.txt>\n");
    process.exit(2);
  }
  const rows = fs.readFileSync(file, "utf8").split("\n");
  process.stdout.write(`${JSON.stringify(survey(rows), null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
