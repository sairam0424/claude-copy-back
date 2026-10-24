// Test scaffolding for the captures tool (not production code; same role as
// src/sim/testkit.ts). Everything here is SYNTHETIC: transcripts, captures and
// the clipboard are made up by the tests. Nothing reads the real clipboard.

import fs from "node:fs";
import path from "node:path";
import { removeScratch, tmpBase } from "../replay/selftest.ts";
import { runCli } from "./cli.ts";
import type { TallyEntry } from "./tally.ts";

export { CANARY } from "../replay/selftest.ts";

/** A fixed clock for transcripts: 2026-10-23 10:00:00 UTC. */
export const T0 = Date.parse("2026-10-23T10:00:00.000Z");
export const MINUTE = 60_000;

/** Scratch directories for one test file; `cleanup` removes every one made. */
export function scratch(): {
  make: (label?: string) => string;
  cleanup: () => void;
} {
  const made: string[] = [];
  return {
    make: (label = "cap") => {
      const dir = fs.mkdtempSync(path.join(tmpBase(), `copy-back-${label}-`));
      made.push(dir);
      return dir;
    },
    cleanup: () => made.forEach(removeScratch),
  };
}

export interface SessionRecord {
  /** Epoch ms written into the record's timestamp. */
  at: number;
  /** One assistant text block. */
  text?: string;
  /** Explicit content blocks instead of `text`. */
  blocks?: unknown[];
  /** "user" writes a user turn (default "assistant"). */
  kind?: "assistant" | "user";
  sidechain?: boolean;
  noTimestamp?: boolean;
  badTimestamp?: boolean;
}

export function recordLine(r: SessionRecord): string {
  const assistant = r.kind !== "user";
  const content = r.blocks ?? [{ type: "text", text: r.text ?? "" }];
  return JSON.stringify({
    type: assistant ? "assistant" : "user",
    ...(r.sidechain === true ? { isSidechain: true } : {}),
    ...(r.noTimestamp === true
      ? {}
      : {
          timestamp:
            r.badTimestamp === true
              ? "not a time"
              : new Date(r.at).toISOString(),
        }),
    message: assistant
      ? { role: "assistant", content }
      : { role: "user", content: r.text ?? "" },
  });
}

/**
 * Write one transcript (JSONL) under `root`. Its file mtime is `mtime`, else
 * the time of its latest record, as a live transcript's would be. Extra raw
 * lines (malformed JSON, say) go in `raw`, after the records.
 */
export function writeSession(
  root: string,
  rel: string,
  records: readonly SessionRecord[],
  opts: { mtime?: number; raw?: readonly string[] } = {},
): string {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = [...records.map(recordLine), ...(opts.raw ?? []), ""];
  fs.writeFileSync(file, lines.join("\n"));
  const latest = Math.max(0, ...records.map((r) => r.at));
  const when = new Date(opts.mtime ?? latest);
  fs.utimesSync(file, when, when);
  return file;
}

/** Write NN.txt exactly as given (mode 0600) with the file time `mtime`. */
export function writeCapture(
  dir: string,
  id: string,
  text: string,
  mtime: number,
): string {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${id}.txt`);
  fs.writeFileSync(file, text, { mode: 0o600 });
  const when = new Date(mtime);
  fs.utimesSync(file, when, when);
  return file;
}

export function writeVerdict(dir: string, id: string, text: string): void {
  fs.writeFileSync(path.join(dir, `${id}.verdict`), text);
}

/** "path:size:mtime:mode" for every file under `dir`: changes if anything is written, touched or chmod-ed. */
export function snapshot(dir: string): string {
  if (!fs.existsSync(dir)) return "";
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { recursive: true }) as string[]) {
    const stat = fs.statSync(path.join(dir, entry));
    out.push(`${entry}:${stat.size}:${stat.mtimeMs}:${stat.mode}`);
  }
  return out.sort().join("|");
}

export interface CliRun {
  code: number;
  out: string;
  err: string;
}

export interface CliOptions {
  /** Is stdout a terminal? Default true: the tests play a person at a terminal unless they say otherwise. */
  terminal?: boolean;
  /** The folder relative paths are taken from. */
  cwd?: string;
  /** The project folder the captures folder must stay out of. */
  projectRoot?: string;
}

/**
 * The CLI in-process with a spy on both output streams. The clipboard reader
 * defaults to one that throws, so no test reaches a real clipboard by accident.
 */
export function makeCli(
  home: string,
  readClipboard: () => string = () => {
    throw new Error("the clipboard must not be read in this test");
  },
  options: CliOptions = {},
): (argv: readonly string[]) => CliRun {
  return (argv) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = runCli(argv, {
      stdout: (s) => void out.push(s),
      stderr: (s) => void err.push(s),
      stdoutIsTTY: options.terminal ?? true,
      readClipboard,
      home,
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      ...(options.projectRoot === undefined
        ? {}
        : { projectRoot: options.projectRoot }),
    });
    return { code, out: out.join(""), err: err.join("") };
  };
}

/**
 * The codes `run --show` prints under each capture, by id: what a person
 * copies into a verdict file ("ok 1a2b3c4d"). Synthetic worlds only.
 */
export function shownCodes(
  cli: (argv: readonly string[]) => CliRun,
  dir: string,
  root: string,
): Record<string, string> {
  const out = cli(["run", "--dir", dir, "--root", root, "--show"]).out;
  const found: Record<string, string> = {};
  for (const m of out.matchAll(
    /Judge (\d{2}): [^\n]*echo ok ([0-9a-f]{8}) > /g,
  ))
    found[m[1] as string] = m[2] as string;
  return found;
}

type EntryShape = Pick<TallyEntry, "kind" | "verdict" | "binding">;

/** Letters for `tallyWorld`: what the tool answered, what the person judged. */
const WORLD_LETTERS: Record<string, EntryShape> = {
  /** Tool returned text, judged ok: matched and right. */
  R: { kind: "ok", verdict: "ok", binding: "bound" },
  /** Tool refused, judged ok: refusing was right. */
  F: { kind: "no-match", verdict: "ok", binding: "bound" },
  /** Tool refused, judged bad: a missed match, not dangerous. */
  M: { kind: "no-match", verdict: "bad", binding: "bound" },
  /** Tool returned text, judged bad: dangerous. */
  W: { kind: "ok", verdict: "bad", binding: "bound" },
  /** Tool returned text, skipped. */
  S: { kind: "ok", verdict: "skip", binding: "bound" },
  /** No verdict file. */
  U: { kind: "ok", verdict: null, binding: "bound" },
  /** A verdict file that holds anything else. */
  I: { kind: "ok", verdict: "invalid", binding: "bound" },
  /** Matched and right, but the code no longer matches (stale). */
  T: { kind: "ok", verdict: "ok", binding: "stale" },
  /** Matched and right, written without the code (unbound). */
  B: { kind: "ok", verdict: "ok", binding: "unbound" },
};

/**
 * Synthetic tally entries from a compact spec: "10R 4F 6M" is ten copies of
 * letter R, four of F, six of M, with sequential ids. Letters: see
 * WORLD_LETTERS. An empty string is no captures at all.
 */
export function tallyWorld(spec: string): TallyEntry[] {
  const out: TallyEntry[] = [];
  for (const part of spec.split(/\s+/).filter((p) => p !== "")) {
    const m = /^(\d+)([A-Z])$/.exec(part);
    const shape = m === null ? undefined : WORLD_LETTERS[m[2] as string];
    if (m === null || shape === undefined)
      throw new Error(`bad world part ${part}`);
    for (let i = 0; i < Number(m[1]); i++)
      out.push({
        id: String(out.length + 1).padStart(2, "0"),
        rivalSessions: 0,
        windowSize: 40,
        ...shape,
      });
  }
  return out;
}

/** Message number n for the end-to-end worlds: distinct words, so each copy has exactly one home. */
export function worldMessage(n: number): string {
  const word = [
    "amber",
    "birch",
    "cedar",
    "dune",
    "ember",
    "fjord",
    "gale",
    "heath",
    "iris",
    "jade",
    "kelp",
    "larch",
    "moss",
    "nacre",
    "onyx",
    "pearl",
    "quartz",
    "reef",
    "slate",
    "tundra",
    "umber",
    "vale",
    "willow",
    "xenon",
    "yarrow",
    "zinc",
  ][n % 26] as string;
  return `Message number ${n}: the ${word} falcon circles above the quiet harbour while lanterns glow softly tonight.`;
}

/** A hard-wrapped, margin-indented copy of the middle of worldMessage(n), as a terminal would hand it over. */
export function worldCopy(n: number): string {
  const text = worldMessage(n);
  const from = text.indexOf("the ");
  const middle = text.slice(from, from + 54);
  const cut = middle.indexOf(" above");
  return `${middle.slice(0, cut)}\n  ${middle.slice(cut + 1)}`;
}
