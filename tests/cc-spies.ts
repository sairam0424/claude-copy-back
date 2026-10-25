// Spies on every side channel a hook could use to carry text out without the
// engine: the console, the standard streams, a global fetch. They record each
// call and judge it by default-deny: a call is innocent only when its stack
// positively shows Node's own streams or test runner (the runner reporting its
// results), and then it is passed on untouched, so the runner keeps working.
// Every other call is a leak: a stack frame under hooks/ or src/core/, the
// canary in an argument, and also a call with no such frame at all (a promise
// job, a timer), which the first version of these spies let through. A leak
// is NOT passed on: a leak under test must not print.

import { sep } from "node:path";
import { CANARY } from "./cc-fixtures.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const PLUGIN_DIRS = ["hooks", "src/core"].map((d) =>
  `${ROOT}${d}/`.split("/").join(sep),
);

export interface SpiedCall {
  channel: string;
  /** A stack frame of the call is in hooks/ or src/core/. */
  fromPlugin: boolean;
  /** The stack shows Node's streams or test runner and no plugin frame: the runner's own reporting. */
  fromRunner: boolean;
  /** The text handed to the call holds the canary. */
  hasCanary: boolean;
}

type Patchable = Record<string, unknown>;

export const seenFrom = (stack: string): boolean =>
  PLUGIN_DIRS.some((dir) => stack.includes(dir));

/** A frame only Node's own stream and test-runner code produces. */
const RUNNER_FRAME = /node:internal\/(?:streams|test_runner)\//;

/** Default-deny: a stack is suspect unless it shows the runner and no plugin frame. */
export const isSuspect = (stack: string): boolean =>
  seenFrom(stack) || !RUNNER_FRAME.test(stack);

/** How long the spies stay in place after the code under test returns, for a call it left in a promise job or a short timer. */
const SETTLE_MS = 5;

const settle = (): Promise<void> =>
  new Promise((done) => setTimeout(done, SETTLE_MS));

function holdsCanary(args: unknown[]): boolean {
  try {
    return args.some(
      (a) => String(a).includes(CANARY) || JSON.stringify(a)?.includes(CANARY),
    );
  } catch {
    return true; // an argument that cannot be read is treated as a hit
  }
}

function spyOn(
  target: Patchable,
  key: string,
  channel: string,
  calls: SpiedCall[],
): () => void {
  const original = target[key] as (...a: unknown[]) => unknown;
  target[key] = function (this: unknown, ...args: unknown[]) {
    const stack = new Error().stack ?? "";
    const call: SpiedCall = {
      channel,
      fromPlugin: seenFrom(stack),
      fromRunner: !isSuspect(stack),
      hasCanary: holdsCanary(args),
    };
    calls.push(call);
    if (isLeak(call))
      return key === "fetch" ? Promise.reject(new Error("blocked")) : true;
    return original.apply(this, args);
  };
  return () => {
    target[key] = original;
  };
}

/** Run `fn` with the spies in place; returns what it returned and every spied call made meanwhile. */
export async function withSpies<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; calls: SpiedCall[] }> {
  const calls: SpiedCall[] = [];
  const restores: (() => void)[] = [];
  const stackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 100;
  const consoleKeys = Object.keys(console).filter(
    (k) => typeof (console as unknown as Patchable)[k] === "function",
  );
  for (const key of consoleKeys)
    restores.push(
      spyOn(console as unknown as Patchable, key, `console.${key}`, calls),
    );
  restores.push(
    spyOn(
      process.stdout as unknown as Patchable,
      "write",
      "stdout.write",
      calls,
    ),
  );
  restores.push(
    spyOn(
      process.stderr as unknown as Patchable,
      "write",
      "stderr.write",
      calls,
    ),
  );
  if (typeof globalThis.fetch === "function")
    restores.push(
      spyOn(globalThis as unknown as Patchable, "fetch", "fetch", calls),
    );
  try {
    const result = await fn();
    await settle();
    return { result, calls };
  } finally {
    for (const restore of restores.reverse()) restore();
    Error.stackTraceLimit = stackLimit;
  }
}

/** A call that is not the runner's own: from plugin code, carrying the canary, or of unknown origin. */
const isLeak = (c: SpiedCall): boolean =>
  c.fromPlugin || c.hasCanary || !c.fromRunner;

/** The calls that matter: everything but the runner's own reporting. */
export const leaks = (calls: SpiedCall[]): SpiedCall[] => calls.filter(isLeak);
