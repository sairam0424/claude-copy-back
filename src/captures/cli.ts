// The captures command line: add, run, tally. Output goes through the two
// functions in `deps`, so a test can watch every byte. The clipboard reader is
// REQUIRED in `deps`: nothing in here reaches a real clipboard by itself.
//
// PRIVACY: add, run and tally print counts and ids only. `run --show` is the
// single path that prints text; it refuses unless stdout is a terminal (or
// --allow-redirect is given) and prints SHOW_BANNER on stderr first. Every
// failure prints one line built from fixed words (errors.ts).

import { addCapture } from "./add.ts";
import { parseArgs } from "./args.ts";
import type { Parsed } from "./args.ts";
import { CapturesError, describeError } from "./errors.ts";
import { HELP_TEXT } from "./help.ts";
import { buildRunReport, evaluateCaptures } from "./run.ts";
import { SHOW_BANNER, renderShow } from "./show.ts";
import { formatTally, tallyDirectory } from "./tally.ts";

export interface CliDeps {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Is stdout a terminal? `run --show` refuses to print text anywhere else. */
  stdoutIsTTY: boolean;
  readClipboard: () => string;
  home: string;
  cwd?: string;
  /** The folder the captures must stay out of; defaults to this project. */
  projectRoot?: string;
}

const EXIT_OK = 0;
const EXIT_FAILED = 2;

function doAdd(parsed: Parsed, deps: CliDeps): number {
  const { id, characters } = addCapture(
    parsed.dir,
    deps.readClipboard,
    deps.projectRoot,
  );
  deps.stdout(`saved ${id} (${characters} characters)\n`);
  return EXIT_OK;
}

/** run --show prints the person's own text: only to a terminal, unless they ask for a file. */
function checkShowAllowed(parsed: Parsed, deps: CliDeps): void {
  if (parsed.show && !deps.stdoutIsTTY && !parsed.allowRedirect)
    throw new CapturesError("SHOW_NEEDS_TERMINAL");
}

function doRun(parsed: Parsed, deps: CliDeps): number {
  checkShowAllowed(parsed, deps);
  if (parsed.show) deps.stderr(SHOW_BANNER);
  const evaluation = evaluateCaptures({
    dir: parsed.dir,
    root: parsed.root,
    messages: parsed.messages,
    project: parsed.project,
    keepText: parsed.show,
  });
  if (parsed.show) deps.stdout(renderShow(evaluation.shown, parsed.dir));
  deps.stdout(
    JSON.stringify(buildRunReport(evaluation, parsed.messages)) + "\n",
  );
  return EXIT_OK;
}

function doTally(parsed: Parsed, deps: CliDeps): number {
  const report = tallyDirectory({
    dir: parsed.dir,
    root: parsed.root,
    messages: parsed.messages,
    project: parsed.project,
    customRoot: parsed.rootGiven,
  });
  deps.stdout(
    parsed.json ? JSON.stringify(report) + "\n" : formatTally(report),
  );
  return EXIT_OK;
}

function dispatch(argv: readonly string[], deps: CliDeps): number {
  const parsed = parseArgs(argv, deps.home, deps.cwd);
  switch (parsed.command) {
    case "add":
      return doAdd(parsed, deps);
    case "run":
      return doRun(parsed, deps);
    case "tally":
      return doTally(parsed, deps);
    default:
      deps.stdout(HELP_TEXT);
      return EXIT_OK;
  }
}

/** Run one command. Returns the exit code: 0 done, 2 failed (one line on stderr). */
export function runCli(argv: readonly string[], deps: CliDeps): number {
  try {
    return dispatch(argv, deps);
  } catch (err) {
    deps.stderr(`${describeError(err)}\n`);
    return EXIT_FAILED;
  }
}
