// Spies on every side channel a hook could use to carry text out without the
// engine: the console, the standard streams, a global fetch. They record a
// call and whether it came from plugin code (a stack frame under hooks/ or
// src/core/) or carried the canary; a call from anywhere else (the test
// runner's own reporting) is passed on untouched, so the runner keeps working.
// A call from plugin code is NOT passed on: a leak under test must not print.

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
  /** The text handed to the call holds the canary. */
  hasCanary: boolean;
}

type Patchable = Record<string, unknown>;

export const seenFrom = (stack: string): boolean =>
  PLUGIN_DIRS.some((dir) => stack.includes(dir));

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
    const fromPlugin = seenFrom(new Error().stack ?? "");
    const hasCanary = holdsCanary(args);
    calls.push({ channel, fromPlugin, hasCanary });
    if (fromPlugin || hasCanary)
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
    return { result: await fn(), calls };
  } finally {
    for (const restore of restores.reverse()) restore();
    Error.stackTraceLimit = stackLimit;
  }
}

/** The calls that matter: made by plugin code, or carrying the canary. */
export const leaks = (calls: SpiedCall[]): SpiedCall[] =>
  calls.filter((c) => c.fromPlugin || c.hasCanary);
