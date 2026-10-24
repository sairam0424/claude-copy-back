// Injected stand-ins for the engine, for the node:test unit tests of
// hooks/cc.ts. Each fake records what it was asked, in order, so a test can
// say "the clipboard was read once, then the messages, then one copy".

import type { CcDeps, CopyAnswer, RunAnswer } from "../hooks/cc.ts";
import { row } from "./cc-fixtures.ts";
import type { Row } from "./cc-fixtures.ts";

export interface FakeOptions {
  /** What pbpaste printed; the default is a clean run with this text. */
  stdout?: string;
  /** Replace the whole answer of the clipboard read (malformed shapes). */
  run?: unknown;
  /** The clipboard read rejects with this. */
  runError?: Error;
  rows?: readonly Row[];
  /** Replace the whole answer of the message read. */
  messages?: unknown;
  messagesError?: Error;
  /** What the copy answers; the default is a success. */
  copy?: unknown;
  copyError?: Error;
  toastError?: Error;
  /** The toast returns a promise that rejects with this. */
  toastReject?: Error;
  find?: CcDeps["find"];
}

export interface Fakes {
  deps: CcDeps;
  /** Every dependency call, in order: "read", "messages", "copy", "toast", "forget". */
  log: string[];
  copies: string[];
  toasts: string[];
  /** How many times each dependency ran. */
  count: (name: string) => number;
}

export function cleanRun(stdout: string): RunAnswer {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    isStdoutTruncated: false,
    isStderrTruncated: false,
  };
}

export function fakes(opts: FakeOptions = {}): Fakes {
  const log: string[] = [];
  const copies: string[] = [];
  const toasts: string[] = [];
  const rows = opts.rows ?? [row("assistant", "a reply that is not used")];
  const deps: CcDeps = {
    readClipboard: async () => {
      log.push("read");
      if (opts.runError) throw opts.runError;
      return (
        Object.hasOwn(opts, "run") ? opts.run : cleanRun(opts.stdout ?? "")
      ) as RunAnswer;
    },
    getMessages: async () => {
      log.push("messages");
      if (opts.messagesError) throw opts.messagesError;
      return (
        Object.hasOwn(opts, "messages") ? opts.messages : rows
      ) as readonly Row[];
    },
    copy: async (text) => {
      log.push("copy");
      copies.push(text);
      if (opts.copyError) throw opts.copyError;
      return (
        Object.hasOwn(opts, "copy") ? opts.copy : { isCopied: true }
      ) as CopyAnswer;
    },
    toast: (text) => {
      log.push("toast");
      toasts.push(text);
      if (opts.toastError) throw opts.toastError;
      if (opts.toastReject) return Promise.reject(opts.toastReject);
    },
    forget: () => {
      log.push("forget");
    },
    ...(opts.find ? { find: opts.find } : {}),
  };
  return {
    deps,
    log,
    copies,
    toasts,
    count: (n) => log.filter((x) => x === n).length,
  };
}
