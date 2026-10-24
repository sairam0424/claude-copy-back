import type { EngineInterface } from "claude-code";

// The engine seam: every call /cc makes to the engine's `$.<noun>.<fn>` goes
// through one of these four wrappers, except the one-time command declaration
// that register.tsx makes itself. `claude plugin validate` lists each API it
// finds with the functions that call it directly, and cuts a line near 1,000
// characters; one wrapper per API, each with a short unique name, keeps the
// whole access report short, complete and readable. Nothing is hidden: every
// API is still named in the report, and a wrapper only forwards.
//
// Each wrapper asks only for the slice of `$` it calls, so a caller holding
// less than the whole engine still type-checks. Each is a function
// declaration: the engine follows `$` past an import only into a function
// declaration (an arrow bound to a const fails the load), and reads the API
// off the call spelled in the wrapper's body. Names are at most seven
// characters and unique across hooks/ (tests/kit/api.test.tsx pins both).
//
// `pbpaste` is the one wrapper that fixes its arguments: it can start one
// program, pbpaste, with a short timeout and a UTF-8 locale, and nothing else,
// whoever calls it. pbpaste prints the clipboard in the encoding of the
// locale (its manual page), and a bare environment would give ASCII.

/** The slice of `$` a wrapper calls: member `M` of noun `N`. */
type Slice<
  N extends keyof EngineInterface,
  M extends keyof EngineInterface[N],
> = Record<N, Pick<EngineInterface[N], M>>;

/** The arguments the engine's own `N.M` takes: a wrapper takes them as they are. */
type Args<
  N extends keyof EngineInterface,
  M extends keyof EngineInterface[N],
> = EngineInterface[N][M] extends (...args: infer A) => unknown ? A : never;

/** The whole of `$` that a /cc run needs, for the code that wires it up. */
export type Io = Slice<"process", "run"> &
  Slice<"session", "messages"> &
  Slice<"ui", "copy"> &
  Slice<"ui", "toast">;

// process
export function pbpaste($: Slice<"process", "run">) {
  return $.process.run(["pbpaste"], {
    timeoutMs: 2000,
    env: { LC_ALL: "en_US.UTF-8" },
  });
}

// session (the no-argument form: the main conversation's rows)
export function history($: Slice<"session", "messages">) {
  return $.session.messages();
}

// ui
export function toClip($: Slice<"ui", "copy">, ...a: Args<"ui", "copy">) {
  return $.ui.copy(...a);
}
export function notify($: Slice<"ui", "toast">, ...a: Args<"ui", "toast">) {
  return $.ui.toast(...a);
}
