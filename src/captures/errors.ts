// Errors of the captures tool. PRIVACY: a CapturesError carries a fixed code
// and, at most, one short token that is safe to print (an option name or a
// two-digit capture id). Its message is built from fixed words only, never from
// a capture, a transcript, the clipboard, a path or an argument value.

import { safeErrorName } from "../replay/cli.ts";

export type ErrorCode =
  | "BAD_COMMAND"
  | "BAD_OPTION"
  | "MISSING_VALUE"
  | "BAD_VALUE"
  | "UNEXPECTED_ARGUMENT"
  | "CLIPBOARD_EMPTY"
  | "CLIPBOARD_UNREADABLE"
  | "CLIPBOARD_TOO_LARGE"
  | "DIR_MISSING"
  | "DIR_UNREADABLE"
  | "DIR_NOT_WRITABLE"
  | "DIR_NOT_PRIVATE"
  | "SHOW_NEEDS_TERMINAL"
  | "CAPTURES_FULL"
  | "CAPTURE_UNREADABLE"
  | "CAPTURE_TOO_LARGE"
  | "ROOT_UNREADABLE";

/** A printable detail: an option name like --dir, or a two-digit id like 07. Nothing else gets through. */
const SAFE_DETAIL = /^(--?[a-z][a-z-]{0,30}|\d{2})$/;

const at = (detail: string | null): string =>
  detail === null ? "" : ` ${detail}`;

const WORDS: Record<ErrorCode, (detail: string | null) => string> = {
  BAD_COMMAND: () =>
    "unknown command (use add, run or tally; --help explains them)",
  BAD_OPTION: (d) =>
    `unknown option${at(d)} for this command (--help lists the options)`,
  MISSING_VALUE: (d) => `option${at(d)} needs a value after it`,
  BAD_VALUE: (d) => `option${at(d)} needs a whole number from 1 to 500`,
  UNEXPECTED_ARGUMENT: () =>
    "unexpected extra argument (the commands take options only; --help explains them)",
  CLIPBOARD_EMPTY: () =>
    "the clipboard is empty or only blanks: copy a region first, then run add again. Nothing was saved",
  CLIPBOARD_UNREADABLE: () =>
    "the clipboard could not be read (pbpaste failed). Nothing was saved",
  CLIPBOARD_TOO_LARGE: () =>
    "the clipboard holds more than 4 MiB: copy a smaller region. Nothing was saved",
  DIR_MISSING: () =>
    "the captures folder does not exist (run add first, or pass --dir)",
  DIR_UNREADABLE: () => "the captures folder cannot be read",
  DIR_NOT_WRITABLE: () => "the captures folder cannot be created or written to",
  DIR_NOT_PRIVATE: () =>
    "the captures folder is inside a git repository or inside the copy-back project, where your copies could end up in a commit: pick a folder outside every repository with --dir (for example ~/copy-back-captures). Nothing was read or saved",
  SHOW_NEEDS_TERMINAL: () =>
    "run --show prints your own text, so it only runs when its output is a terminal: open your own terminal window and run it there. Never run it inside Claude Code, never type it with !, never from a script. To write it to a file only you will read, add --allow-redirect",
  CAPTURES_FULL: () => "the captures folder already holds 99 captures",
  CAPTURE_UNREADABLE: (d) =>
    `capture${at(d)} cannot be read (check its file permissions)`,
  CAPTURE_TOO_LARGE: (d) => `capture${at(d)} is larger than 4 MiB`,
  ROOT_UNREADABLE: () =>
    "the transcript folder cannot be read (pass the right one with --root)",
};

export class CapturesError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;

  constructor(code: ErrorCode, detail?: string) {
    const safe =
      detail !== undefined && SAFE_DETAIL.test(detail) ? detail : null;
    super(WORDS[code](safe));
    this.name = "CapturesError";
    this.code = code;
    this.detail = safe;
  }
}

/** One printable line for any thrown value. Unknown exceptions show their class name only. */
export function describeError(err: unknown): string {
  if (err instanceof CapturesError)
    return `copy-back: ${err.message} [${err.code}]`;
  return `copy-back: unexpected error (${safeErrorName(err)}); nothing from your files is shown on purpose`;
}
