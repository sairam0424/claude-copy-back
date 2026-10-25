// The only place the live pass touches the REAL clipboard, and only to hash it.
//
// The rule allows exactly two reads: one hash before the first launch and one
// after the last, to show that nothing in the pass put text on the real
// clipboard. This module enforces that in code: every attempt is logged first,
// a third attempt is refused before anything runs, and what is stored and
// printed is the SHA-256 and a label, never a byte of the clipboard. `pbpaste`
// is piped straight into `shasum` by the shell, so the text never reaches this
// process. Tests use a fake `exec`; the real call is only made by
// `node realrender/live.mjs clip`.

import { execFileSync } from "node:child_process";
import fs from "node:fs";

export const MAX_REAL_READS = 2;
const LABELS = ["before", "after"];
const HASH = /^[0-9a-f]{64}/;

/** The only program the real read starts. */
export const PBPASTE_SOURCE = "pbpaste";

/**
 * Run `<source> | shasum -a 256` under `set -o pipefail` and return its output (hash and a dash). With
 * pipefail a source that fails (a pbpaste that could not read the pasteboard) fails the pipe, instead of
 * hashing nothing and reporting the hash of empty input with exit 0. `source` is a constant of this module
 * or a stand-in program in the tests, never input. Never throws text of the clipboard.
 */
export function runHashPipe(source) {
  return execFileSync("/bin/bash", ["-c", `set -o pipefail; ${source} | shasum -a 256`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/** The real read: `pbpaste | shasum -a 256`. */
export function realExec() {
  return runHashPipe(PBPASTE_SOURCE);
}

/** The lines of the log, parsed. */
export function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

/** { reads, before, after, failed } from a log. */
export function summarizeReads(lines) {
  const attempts = lines.filter((l) => l.event === "attempt");
  const results = lines.filter((l) => l.event === "hash");
  const hashOf = (label) => results.find((l) => l.label === label)?.sha256 ?? null;
  return { reads: attempts.length, before: hashOf("before"), after: hashOf("after"), failed: lines.filter((l) => l.event === "failed").length };
}

function append(file, record) {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * Take one hash of the real clipboard, labelled "before" (first) or "after"
 * (second). Throws before reading if the allowance is used up or the label is
 * out of order. Returns the hash. `profile`, when given, is written on every
 * logged event so the log says which terminal profile the pass ran under.
 */
export function takeHash({ file, label, exec = realExec, now = () => new Date(), profile }) {
  const tag = profile === undefined ? {} : { profile };
  if (!LABELS.includes(label)) throw new Error(`label must be one of ${LABELS.join(", ")}`);
  const state = summarizeReads(readLog(file));
  if (state.reads >= MAX_REAL_READS) throw new Error(`${MAX_REAL_READS} reads of the real clipboard already taken; refusing another`);
  if (state.reads !== LABELS.indexOf(label)) throw new Error(`the next read is "${LABELS[state.reads]}", not "${label}", or it was already taken`);
  append(file, { event: "attempt", label, ...tag, at: now().toISOString() });
  let output;
  try {
    output = exec();
  } catch {
    append(file, { event: "failed", label, ...tag, at: now().toISOString() });
    throw new Error("pbpaste | shasum failed; the attempt counts as a read");
  }
  const match = HASH.exec(String(output));
  if (!match) {
    append(file, { event: "failed", label, ...tag, at: now().toISOString() });
    throw new Error("pbpaste | shasum printed no hash; the attempt counts as a read");
  }
  append(file, { event: "hash", label, ...tag, at: now().toISOString(), sha256: match[0] });
  return match[0];
}
