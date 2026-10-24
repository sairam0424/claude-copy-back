// Command line for the replay harness. Output is ONE JSON document of counts
// on stdout. Errors go to stderr as {"error": CODE}: only fixed codes or an
// exception's class name, never a message (messages can quote transcript text).

import os from "node:os";
import path from "node:path";
import { sampleCorpus } from "./corpus.ts";
import type { CorpusStats } from "./corpus.ts";
import { runTrials } from "./trials.ts";
import type { Bucket, TrialReport } from "./trials.ts";

export interface CliOptions {
  root: string;
  seed: number;
  messages: number;
  widths: number[];
  spans: number;
  windowSize: number;
  /** Sensitivity: the simulated screen draws bullets with this glyph. */
  bullet?: string;
  /** Sample only main-session transcripts (no subagent transcripts). */
  mainOnly: boolean;
  /** Match with newestWinsOnConflict (what recency alone would do). */
  newestWins: boolean;
  pretty: boolean;
  selftest: boolean;
}

export const K1_THRESHOLD = 0.7;
/** K1 also demands fewer wrong slices than this share of all trials (and no negative-control false positive at all). */
export const K1_MAX_WRONG_SLICE_RATE = 0.01;

export function defaultRoot(): string {
  return path.join(os.homedir(), ".claude", "projects");
}

function integer(value: string | undefined, flag: string, min: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < min)
    throw new Error(`BAD_ARGS_${flag.toUpperCase()}`);
  return n;
}

/** Apply one `--flag value` pair. Errors carry a fixed code, never the argument (it could be a path). */
function applyValued(
  opts: CliOptions,
  flag: string | undefined,
  value: string | undefined,
): void {
  switch (flag) {
    case "--root":
      if (value === undefined) throw new Error("BAD_ARGS_ROOT");
      opts.root = value;
      break;
    case "--seed":
      opts.seed = integer(value, "seed", 0);
      break;
    case "--messages":
      opts.messages = integer(value, "messages", 1);
      break;
    case "--spans":
      opts.spans = integer(value, "spans", 1);
      break;
    case "--widths":
      opts.widths = (value ?? "")
        .split(",")
        .map((w) => integer(w, "widths", 6));
      break;
    case "--bullet":
      if (value === undefined) throw new Error("BAD_ARGS_BULLET");
      opts.bullet = value;
      break;
    default:
      throw new Error("BAD_ARGS_UNKNOWN_FLAG");
  }
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const opts: CliOptions = {
    root: defaultRoot(),
    seed: 1,
    messages: 250,
    widths: [60, 80, 100, 120],
    spans: 2,
    windowSize: 40,
    mainOnly: false,
    newestWins: false,
    pretty: false,
    selftest: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--pretty") opts.pretty = true;
    else if (flag === "--main-only") opts.mainOnly = true;
    else if (flag === "--newest-wins") opts.newestWins = true;
    else if (flag === "--selftest") opts.selftest = true;
    else applyValued(opts, flag, argv[++i]);
  }
  return opts;
}

export interface ReplayReport {
  tool: "copy-back replay";
  config: {
    seed: number;
    messages: number;
    widths: number[];
    spansPerMessage: number;
    windowSize: number;
    simBullet: string | null;
    mainOnly: boolean;
    newestWins: boolean;
  };
  corpus: CorpusStats & TrialReport["content"];
  spansSkipped: number;
  perWidth: Record<string, Bucket & { exactRate: number }>;
  total: Bucket & { exactRate: number };
  bySpanKind: Record<string, Bucket & { exactRate: number }>;
  byConstruct: Record<string, Bucket & { messages: number; exactRate: number }>;
  failureFacts: TrialReport["failureFacts"];
  k1: {
    threshold: number;
    exactRate: number;
    worstWidthRate: number;
    /** wrong slices / trials (must stay under maxWrongSliceRate). */
    wrongSliceRate: number;
    maxWrongSliceRate: number;
    /** negative-control false positives (must be zero). */
    controlFalsePositives: number;
    /** trials whose paste form held a character the exact slice does not (must be zero). */
    pasteInvented: number;
    /** exact rate >= threshold on EVERY width, wrong-slice rate under the cap, zero false positives, nothing invented. */
    pass: boolean;
  };
}

function withRate<T extends Bucket>(bucket: T): T & { exactRate: number } {
  return {
    ...bucket,
    exactRate:
      bucket.trials === 0
        ? 0
        : Number((bucket.exact / bucket.trials).toFixed(4)),
  };
}

function mapValues<T, U>(
  input: Record<string, T>,
  fn: (v: T) => U,
): Record<string, U> {
  return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, fn(v)]));
}

export function runReplay(
  root: string,
  opts: Omit<CliOptions, "root" | "pretty" | "selftest" | "mainOnly" | "newestWins"> & {
    mainOnly?: boolean;
    newestWins?: boolean;
  },
): ReplayReport {
  const { messages, stats } = sampleCorpus(root, {
    seed: opts.seed,
    count: opts.messages,
    mainOnly: opts.mainOnly === true,
  });
  const trials = runTrials(messages, {
    seed: opts.seed,
    widths: opts.widths,
    spansPerMessage: opts.spans,
    windowSize: opts.windowSize,
    ...(opts.bullet === undefined ? {} : { simBullet: opts.bullet }),
    ...(opts.newestWins === true ? { newestWins: true } : {}),
  });
  const total = withRate(trials.total);
  const perWidth = mapValues(trials.perWidth, withRate);
  const worst = Math.min(...Object.values(perWidth).map((b) => b.exactRate));
  return {
    tool: "copy-back replay",
    config: {
      seed: opts.seed,
      messages: opts.messages,
      widths: opts.widths,
      spansPerMessage: opts.spans,
      windowSize: opts.windowSize,
      simBullet: opts.bullet ?? null,
      mainOnly: opts.mainOnly === true,
      newestWins: opts.newestWins === true,
    },
    corpus: { ...stats, ...trials.content },
    spansSkipped: trials.spansSkipped,
    perWidth,
    total,
    bySpanKind: mapValues(trials.bySpanKind, withRate),
    byConstruct: mapValues(trials.byConstruct, withRate),
    failureFacts: trials.failureFacts,
    k1: k1Verdict(total, worst),
  };
}

function k1Verdict(
  total: Bucket & { exactRate: number },
  worstWidth: number,
): ReplayReport["k1"] {
  const worstWidthRate = Number.isFinite(worstWidth) ? worstWidth : 0;
  const wrongSliceRate =
    total.trials === 0 ? 0 : Number((total.wrongSlice / total.trials).toFixed(4));
  const controlFalsePositives = total.negativeControl.falsePositives;
  const pasteInvented = total.paste.invented;
  return {
    threshold: K1_THRESHOLD,
    exactRate: total.exactRate,
    worstWidthRate,
    wrongSliceRate,
    maxWrongSliceRate: K1_MAX_WRONG_SLICE_RATE,
    controlFalsePositives,
    pasteInvented,
    pass:
      worstWidthRate >= K1_THRESHOLD &&
      wrongSliceRate < K1_MAX_WRONG_SLICE_RATE &&
      controlFalsePositives === 0 &&
      pasteInvented === 0,
  };
}

/** A safe label for an exception: a fixed code of ours, else the class name. */
export function safeErrorName(err: unknown): string {
  if (err instanceof Error) {
    if (/^[A-Z][A-Z0-9_]{2,60}$/.test(err.message)) return err.message;
    return /^[A-Za-z0-9_]{1,40}$/.test(err.name) ? err.name : "Error";
  }
  return "Error";
}
