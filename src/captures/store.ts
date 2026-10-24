// The captures folder: NN.txt (exactly what was copied) and NN.verdict (what
// the person judged). Reads and lists only; add.ts is the one writer.
// PRIVACY: nothing here prints. Failures are CapturesErrors with a fixed code
// and, at most, the two-digit id.

import fs from "node:fs";
import path from "node:path";
import { CapturesError } from "./errors.ts";

/** Most a capture may hold. The clipboard reader enforces the same cap. */
export const MAX_CAPTURE_BYTES = 4 * 1024 * 1024;
/** NN runs 01 to 99. */
export const MAX_CAPTURES = 99;
/** A verdict is one short word; anything longer is not one. */
const MAX_VERDICT_BYTES = 64;

const CAPTURE_FILE = /^(\d{2})\.txt$/;
const VERDICT_FILE = /^(\d{2})\.verdict$/;

function entriesOf(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch (err) {
    const missing = (err as { code?: unknown }).code === "ENOENT";
    throw new CapturesError(missing ? "DIR_MISSING" : "DIR_UNREADABLE");
  }
}

function idsMatching(dir: string, pattern: RegExp): string[] {
  return entriesOf(dir)
    .map((name) => pattern.exec(name)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort();
}

/** The ids ("01", "02", ...) that have a NN.txt, ascending. */
export function listCaptureIds(dir: string): string[] {
  return idsMatching(dir, CAPTURE_FILE);
}

/** The ids that have a NN.verdict file, ascending. */
export function listVerdictIds(dir: string): string[] {
  return idsMatching(dir, VERDICT_FILE);
}

export interface StoredCapture {
  /** Exactly the text that was saved. Never print it outside run --show. */
  text: string;
  /** When the file was written: the moment of the copy. */
  mtimeMs: number;
}

export function readCapture(dir: string, id: string): StoredCapture {
  const file = path.join(dir, `${id}.txt`);
  try {
    const stat = fs.statSync(file);
    if (stat.size > MAX_CAPTURE_BYTES)
      throw new CapturesError("CAPTURE_TOO_LARGE", id);
    return {
      text: fs.readFileSync(file, "utf8"),
      mtimeMs: Math.round(stat.mtimeMs),
    };
  } catch (err) {
    if (err instanceof CapturesError) throw err;
    throw new CapturesError("CAPTURE_UNREADABLE", id);
  }
}

/**
 * The raw text of NN.verdict, null when there is no such file, and "" when it
 * exists but cannot be used (unreadable or far too long): that reads as invalid.
 */
export function readVerdictFile(dir: string, id: string): string | null {
  const file = path.join(dir, `${id}.verdict`);
  try {
    if (fs.statSync(file).size > MAX_VERDICT_BYTES) return "";
    return fs.readFileSync(file, "utf8");
  } catch (err) {
    return (err as { code?: unknown }).code === "ENOENT" ? null : "";
  }
}
