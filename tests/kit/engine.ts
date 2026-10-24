import type { On } from "claude-code";
import type { Engine } from "claude-code/testing";

// The stub engine under /cc for the kit tests (`claude plugin test`): the four
// calls the mod makes are answered from memory and recorded; every call it
// must NEVER make is trapped, recorded and refused, so a test can assert that
// nothing else happened. Synthetic data only.

export interface KitOptions {
  /** What pbpaste prints. */
  stdout?: string;
  exitCode?: number;
  stderr?: string;
  isStdoutTruncated?: boolean;
  /** process.run rejects with this (cannot start, or the timeout). */
  runDeny?: string;
  /** The process.run stub itself throws (a crash in a lower hook). */
  runThrow?: string;
  /** The rows session.messages gives, oldest first. */
  rows?: readonly unknown[];
  rowsDeny?: string;
  /** What ui.copy answers; the default is a success. */
  copyValue?: unknown;
  copyDeny?: string;
  /** ui.toast throws. */
  toastThrow?: string;
  /** command.register refuses. */
  registerDeny?: string;
}

export interface Kit {
  /** Every process.run: the argument vector and the options. */
  runs: { argv: readonly string[]; init: unknown }[];
  /** What each session.messages call asked for, as JSON (which conversation, which form). */
  messageAsks: string[];
  /** Every ui.copy: the text and the surface asked for. */
  copies: { text: string; surface?: string }[];
  toasts: string[];
  specs: { name: string; description: string; immediate?: true }[];
  /** Calls to anything /cc must never use, as `op` and the input as JSON. */
  trapped: { op: string; input: string }[];
  /** Every call the stub answered or trapped, in order. */
  order: string[];
}

/**
 * Ops /cc has no business with: a model, the prompt, the files, storage, the
 * network. (process.spawn is not trapped here: the kit takes only an async
 * generator for a streaming op. The validator's access report is what shows
 * the mod does not use it.)
 */
export const NEVER = [
  "model.complete",
  "prompt.submit",
  "prompt.fill",
  "prompt.read",
  "session.send",
  "session.append",
  "ui.log",
  "ui.notify",
  "store.get",
  "store.set",
  "store.delete",
  "store.keys",
  "fs.read",
  "fs.write",
  "fs.list",
  "fs.exists",
  "http.fetch",
  "env.get",
  "env.set",
] as const;

function emptyKit(): Kit {
  return {
    runs: [],
    messageAsks: [],
    copies: [],
    toasts: [],
    specs: [],
    trapped: [],
    order: [],
  };
}

function answerCommand(on: On, opts: KitOptions, k: Kit): void {
  on("session.start", ($, e) => ({ cwd: e.cwd }));
  on("command.register", ($, e) => {
    k.order.push("command.register");
    k.specs.push({
      name: e.name,
      description: e.description,
      ...(e.immediate === true ? { immediate: true as const } : {}),
    });
    if (opts.registerDeny !== undefined) return { deny: opts.registerDeny };
    return { value: { command: e.name } };
  });
}

function answerProcess(on: On, opts: KitOptions, k: Kit): void {
  on("process.run", ($, e) => {
    k.order.push("process.run");
    k.runs.push({ argv: e.argv, init: e.init });
    if (opts.runThrow !== undefined) throw new Error(opts.runThrow);
    if (opts.runDeny !== undefined) return { deny: opts.runDeny };
    return {
      value: {
        exitCode: opts.exitCode ?? 0,
        stdout: opts.stdout ?? "",
        stderr: opts.stderr ?? "",
        isStdoutTruncated: opts.isStdoutTruncated ?? false,
        isStderrTruncated: false,
      },
    };
  });
}

function answerSession(on: On, opts: KitOptions, k: Kit): void {
  on("session.messages", ($, e) => {
    k.order.push("session.messages");
    k.messageAsks.push(JSON.stringify(e));
    if (opts.rowsDeny !== undefined) return { deny: opts.rowsDeny };
    return { value: (opts.rows ?? []) as never };
  });
}

function answerUi(on: On, opts: KitOptions, k: Kit): void {
  on("ui.copy", ($, e) => {
    k.order.push("ui.copy");
    k.copies.push({
      text: e.text,
      ...(e.surface ? { surface: e.surface } : {}),
    });
    if (opts.copyDeny !== undefined) return { deny: opts.copyDeny };
    return { value: (opts.copyValue ?? { isCopied: true }) as never };
  });
  on("ui.toast", ($, e) => {
    k.order.push("ui.toast");
    k.toasts.push(e.text);
    if (opts.toastThrow !== undefined) throw new Error(opts.toastThrow);
    return { value: undefined };
  });
}

type Bottom = (name: string, hook: (...a: never[]) => unknown) => void;

function trapNever(on: On, k: Kit): void {
  for (const op of NEVER) {
    (on as unknown as Bottom)(op, ((_: unknown, e: unknown) => {
      k.order.push(op);
      k.trapped.push({ op, input: JSON.stringify(e) });
      return { deny: `/cc must never call ${op}` };
    }) as never);
  }
}

export function kit(on: On, opts: KitOptions = {}): Kit {
  const k = emptyKit();
  answerCommand(on, opts, k);
  answerProcess(on, opts, k);
  answerSession(on, opts, k);
  answerUi(on, opts, k);
  trapNever(on, k);
  return k;
}

/** Start the session the way the engine does, so the command gets declared. */
export async function start($: Engine): Promise<void> {
  await $.session.start({
    cwd: "/work/proj",
    surface: "terminal",
    isInteractive: true,
  } as never);
}

/** `/cc` through the registered command; the whole result. */
export function press($: Engine): Promise<unknown> {
  return $.command.run({ command: "cc", args: "" } as never);
}

/**
 * True for an answer that says nothing: the kit hands back a hook's `{}` as
 * `{ text: undefined, ref: undefined }`, so strict equality with `{}` fails
 * while no field holds anything. A `text` or a `context` would be a line in
 * the transcript that the model reads.
 */
export function isEmptyAnswer(result: unknown): boolean {
  if (typeof result !== "object" || result === null) return false;
  const allowed = ["text", "ref"];
  return Object.entries(result).every(
    ([key, value]) => value === undefined && allowed.includes(key),
  );
}
