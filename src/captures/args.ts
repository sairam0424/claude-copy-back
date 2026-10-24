// Command line parsing for the captures tool. Every failure is a CapturesError
// with a fixed code; the offending argument is never part of the message
// (only an option NAME that looks like one may be echoed, see errors.ts).

import path from "node:path";
import { CapturesError } from "./errors.ts";

export type Command = "add" | "run" | "tally" | "help";

export interface Parsed {
  command: Command;
  dir: string;
  root: string;
  messages: number;
  /** run: print the copied text and the returned paste text (user-run only). */
  show: boolean;
  /** run --show: also print when stdout is not a terminal (the person redirects to a file they will read). */
  allowRedirect: boolean;
  /** run, tally: only transcript folders whose name contains this text; null for all. */
  project: string | null;
  /** --root was given (the tally says so in words; it never prints the path). */
  rootGiven: boolean;
  /** tally: print one JSON document instead of plain words. */
  json: boolean;
}

export const DEFAULT_MESSAGES = 40;
const MAX_MESSAGES = 500;

const COMMANDS = ["add", "run", "tally"] as const;

/** Which options each command takes. Valued options first, then switches. */
const VALUED: Record<(typeof COMMANDS)[number], readonly string[]> = {
  add: ["--dir"],
  run: ["--dir", "--root", "--messages", "--project"],
  tally: ["--dir", "--root", "--messages", "--project"],
};
const SWITCHES: Record<(typeof COMMANDS)[number], readonly string[]> = {
  add: [],
  run: ["--show", "--allow-redirect"],
  tally: ["--json"],
};

function isCommand(
  word: string | undefined,
): word is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(word as string);
}

/** ~ and ~/x mean the home directory; a relative path is taken from `cwd`. */
function resolvePath(value: string, home: string, cwd: string): string {
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return path.resolve(cwd, value);
}

function messageCount(value: string): number {
  const n = /^\d{1,3}$/.test(value) ? Number(value) : 0;
  if (n < 1 || n > MAX_MESSAGES)
    throw new CapturesError("BAD_VALUE", "--messages");
  return n;
}

/** Split "--name=value" into its two halves; a plain word has no value. */
function splitOption(word: string): [name: string, value: string | null] {
  const eq = word.indexOf("=");
  return eq < 0 ? [word, null] : [word.slice(0, eq), word.slice(eq + 1)];
}

/** Options whose value is a path or a name: blank means "forgot the value", never "here". */
const NEEDS_TEXT = ["--dir", "--root", "--project"];

function applyValued(
  out: Parsed,
  name: string,
  value: string,
  where: { home: string; cwd: string },
): void {
  if (NEEDS_TEXT.includes(name) && value.trim() === "")
    throw new CapturesError("MISSING_VALUE", name);
  if (name === "--dir") out.dir = resolvePath(value, where.home, where.cwd);
  else if (name === "--root") {
    out.root = resolvePath(value, where.home, where.cwd);
    out.rootGiven = true;
  } else if (name === "--project") out.project = value;
  else out.messages = messageCount(value);
}

function applySwitch(out: Parsed, name: string): void {
  if (name === "--show") out.show = true;
  else if (name === "--allow-redirect") out.allowRedirect = true;
  else out.json = true;
}

export function parseArgs(
  argv: readonly string[],
  home: string,
  cwd: string = process.cwd(),
): Parsed {
  const out: Parsed = {
    command: "help",
    dir: path.join(home, "copy-back-captures"),
    root: path.join(home, ".claude", "projects"),
    messages: DEFAULT_MESSAGES,
    show: false,
    allowRedirect: false,
    project: null,
    rootGiven: false,
    json: false,
  };
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h"))
    return out;
  const command = argv[0];
  if (!isCommand(command)) throw new CapturesError("BAD_COMMAND");
  out.command = command;
  for (let i = 1; i < argv.length; i++) {
    const word = argv[i] as string;
    if (!word.startsWith("-")) throw new CapturesError("UNEXPECTED_ARGUMENT");
    const [name, inline] = splitOption(word);
    if (SWITCHES[command].includes(name) && inline === null) {
      applySwitch(out, name);
    } else if (VALUED[command].includes(name)) {
      const value = inline ?? argv[++i];
      if (value === undefined || (inline === null && value.startsWith("--")))
        throw new CapturesError("MISSING_VALUE", name);
      applyValued(out, name, value, { home, cwd });
    } else throw new CapturesError("BAD_OPTION", name);
  }
  return out;
}
