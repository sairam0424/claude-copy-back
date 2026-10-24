import { expect, test } from "claude-code/testing";
import type { EngineInterface } from "claude-code";
import * as api from "../../hooks/api.ts";
import { history, notify, pbpaste, toClip } from "../../hooks/api.ts";

// hooks/api.ts is the one place /cc calls the engine's `$.<noun>.<fn>`, through
// one short forwarding wrapper per API. A wrapper only forwards: it calls the
// intended engine method alone, hands over the arguments as given, and returns,
// or rejects with, whatever the engine did. `pbpaste` is the one that fixes its
// arguments; the tests pin exactly what it fixes. They run against a recording
// `$`, not the kit stub, so a wrapper that reached for a sibling method,
// reordered or dropped an argument, or wrapped its answer shows here.

type Call = { method: string; args: readonly unknown[] };

const COPY = { text: "pasted words", surface: "terminal" } as const;
const TOAST_OPTIONS = { timeoutMs: 2500 } as const;

type Row = {
  wrapper: string;
  method: string;
  /** What the engine must receive, after `$`. */
  reaches: readonly unknown[];
  run: ($: EngineInterface) => unknown;
};

const ROWS: readonly Row[] = [
  {
    wrapper: "pbpaste",
    method: "process.run",
    reaches: [["pbpaste"], { timeoutMs: 2000, env: { LC_ALL: "en_US.UTF-8" } }],
    run: ($) => pbpaste($),
  },
  {
    wrapper: "history",
    method: "session.messages",
    reaches: [],
    run: ($) => history($),
  },
  {
    wrapper: "toClip",
    method: "ui.copy",
    reaches: [COPY],
    run: ($) => toClip($, COPY),
  },
  {
    wrapper: "toClip",
    method: "ui.copy",
    reaches: [{ text: "no surface named" }],
    run: ($) => toClip($, { text: "no surface named" }),
  },
  {
    wrapper: "notify",
    method: "ui.toast",
    reaches: ["copy-back: done", TOAST_OPTIONS],
    run: ($) => notify($, "copy-back: done", TOAST_OPTIONS),
  },
  {
    wrapper: "notify",
    method: "ui.toast",
    reaches: ["copy-back: done"],
    run: ($) => notify($, "copy-back: done"),
  },
];

const METHODS = [...new Set(ROWS.map((r) => r.method))];

function recorder(
  behave: (method: string, answer: unknown) => unknown = (_, answer) => answer,
) {
  const calls: Call[] = [];
  const answers: Record<string, unknown> = {};
  const nouns: Record<
    string,
    Record<string, (...args: unknown[]) => unknown>
  > = {};
  for (const method of METHODS) {
    const [noun = "", fn = ""] = method.split(".");
    answers[method] = { answerOf: method };
    nouns[noun] = {
      ...nouns[noun],
      [fn]: (...args: unknown[]) => {
        calls.push({ method, args });
        return behave(method, answers[method]);
      },
    };
  }
  return { $: nouns as unknown as EngineInterface, calls, answers };
}

for (const r of ROWS) {
  const label = `${r.wrapper}(${r.reaches.length} engine args) -> $.${r.method}`;

  test(`${label} calls that method alone, with the arguments it should`, () => {
    const rec = recorder();
    r.run(rec.$);
    expect(rec.calls.map((c) => c.method)).toEqual([r.method]);
    expect(rec.calls[0]?.args).toEqual(r.reaches);
  });

  test(`${label} returns the engine's own answer untouched`, () => {
    const rec = recorder();
    expect(r.run(rec.$)).toBe(rec.answers[r.method]);
  });
}

test("a forwarding wrapper hands over the very objects it was given", () => {
  const rec = recorder();
  toClip(rec.$, COPY);
  expect(rec.calls[0]?.args[0]).toBe(COPY);
  notify(rec.$, "x", TOAST_OPTIONS);
  expect(rec.calls[1]?.args[1]).toBe(TOAST_OPTIONS);
});

test("pbpaste starts exactly one program, pbpaste, with no shell and no input", () => {
  const rec = recorder();
  pbpaste(rec.$);
  const [argv, init] = rec.calls[0]?.args ?? [];
  expect(argv).toEqual(["pbpaste"]);
  expect(init).not.toHaveProperty("stdin");
  expect(init).not.toHaveProperty("cwd");
  expect(Object.keys(init as object).sort()).toEqual(["env", "timeoutMs"]);
  const timeout = (init as { timeoutMs: number }).timeoutMs;
  expect(timeout).toBeGreaterThanOrEqual(500);
  expect(timeout).toBeLessThanOrEqual(5000);
});

test("a rejection comes back through the wrapper, and so does a throw", async () => {
  const rec = recorder((method, answer) =>
    method === "process.run"
      ? Promise.reject(new Error("cannot start"))
      : answer,
  );
  await expect(pbpaste(rec.$)).rejects.toThrow("cannot start");

  const thrower = recorder((method, answer) => {
    if (method === "ui.toast") throw new Error("no surface to draw on");
    return answer;
  });
  expect(() => notify(thrower.$, "x")).toThrow("no surface to draw on");
});

test("a wrapper calls its method on the noun, so the engine keeps its `this`", () => {
  const seen: unknown[] = [];
  const session = {
    messages(this: unknown) {
      seen.push(this);
      return Promise.resolve([]);
    },
  };
  void history({ session } as unknown as EngineInterface);
  expect(seen[0]).toBe(session);
});

test("the table covers every wrapper hooks/api.ts exports, and no other", () => {
  const exported = Object.keys(api).sort();
  const tabled = [...new Set(ROWS.map((r) => r.wrapper))].sort();
  expect(exported).toEqual(tabled);
});

// The validator prints `via <name>` for every function that reaches an API
// directly; a long wrapper name pushes its `calls` line back toward the cap.
test("every wrapper name stays short enough to keep the label short", () => {
  for (const name of Object.keys(api)) {
    expect(name.length).toBeLessThanOrEqual(7);
  }
});
