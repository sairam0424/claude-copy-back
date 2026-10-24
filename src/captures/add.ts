// `add`: save the clipboard as the next NN.txt. The file holds exactly the
// clipboard text and nothing else. The folder is created 0700 and files 0600.
// PRIVACY: the only thing that ever leaves this module is the id and the
// character count; the text and any reader error are not passed on.

import fs from "node:fs";
import path from "node:path";
import { MAX_CLIPBOARD_BYTES } from "./clipboard.ts";
import { CapturesError } from "./errors.ts";
import { assertPrivateFolder } from "./folder-guard.ts";
import { MAX_CAPTURES } from "./store.ts";

export interface Added {
  id: string;
  characters: number;
}

const NUMBERED = /^(\d{2})\.txt$/;
const MAX_TRIES = 5;

/** The numbers of the NN.txt files in `dir` (empty when the folder is not there yet). */
export function listNumbers(dir: string): number[] {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => NUMBERED.exec(name)?.[1])
      .filter((digits): digits is string => digits !== undefined)
      .map(Number);
  } catch {
    return [];
  }
}

const idOf = (n: number): string => String(n).padStart(2, "0");

function createFile(file: string, text: string): boolean {
  try {
    fs.writeFileSync(file, text, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return true;
  } catch (err) {
    if ((err as { code?: unknown }).code === "EEXIST") return false;
    throw new CapturesError("DIR_NOT_WRITABLE");
  }
}

/**
 * Write `text` as the highest number plus one. The file is created exclusively,
 * so two adds at once never overwrite each other: a taken number is retried.
 * `numbers` is injectable so a test can serve a stale listing.
 */
export function saveNextCapture(
  dir: string,
  text: string,
  numbers: (dir: string) => number[] = listNumbers,
): string {
  for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
    const next = Math.max(0, ...numbers(dir)) + 1;
    if (next > MAX_CAPTURES) throw new CapturesError("CAPTURES_FULL");
    if (createFile(path.join(dir, `${idOf(next)}.txt`), text))
      return idOf(next);
  }
  throw new CapturesError("DIR_NOT_WRITABLE");
}

function ensureFolder(dir: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch {
    throw new CapturesError("DIR_NOT_WRITABLE");
  }
}

function readTheClipboard(readClipboard: () => string): string {
  let text: string;
  try {
    text = readClipboard();
  } catch (err) {
    if (err instanceof CapturesError) throw err;
    throw new CapturesError("CLIPBOARD_UNREADABLE");
  }
  if (text.trim() === "") throw new CapturesError("CLIPBOARD_EMPTY");
  if (Buffer.byteLength(text, "utf8") > MAX_CLIPBOARD_BYTES)
    throw new CapturesError("CLIPBOARD_TOO_LARGE");
  return text;
}

function countCharacters(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

/**
 * Save the clipboard as the next capture. The folder is checked first (never
 * inside a git repository or the project), so a refused folder reads nothing.
 */
export function addCapture(
  dir: string,
  readClipboard: () => string,
  projectRoot?: string,
): Added {
  assertPrivateFolder(dir, projectRoot);
  const text = readTheClipboard(readClipboard);
  ensureFolder(dir);
  const id = saveNextCapture(dir, text);
  return { id, characters: countCharacters(text) };
}
