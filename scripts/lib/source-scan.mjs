// The privacy guard for the plugin's source. It reads the code of hooks/ and
// src/core/ as tokens (js-tokens.mjs) and refuses what could carry a clipboard
// or message text out of a hook, or reach the host by a side door:
//
//   banned-name      a global that prints, sends, times, reflects or runs code:
//                    console, process (except the engine noun `$.process`),
//                    globalThis, self, fetch, setTimeout, eval, Function, require...
//   reflection       ways back to those names without spelling them:
//                    `.constructor`, `__proto__`, Reflect, getPrototypeOf...
//   bracket-name     the same names reached with a string: x["process"]
//   dynamic-import   import(...) and import.meta
//   import-spec      an import that is not a relative file (or a type-only one
//                    from "claude-code")
//   outside-closure  a file the hooks load that is not under hooks/ or src/core/
//
// A comment, a string and a regular expression are not code, so a word there
// is not a finding. This is a tripwire, not a sandbox: it is the first of
// several layers (the engine's own checks, the TypeScript name check in
// scripts/typecheck.sh, and the console and stream spies in the unit tests).
// A finding names a rule, a line and a token, never the surrounding text.
//
// Known limit: without a parser a `/` after `)`, `]`, `}`, `++` or `--` is
// divided or a regular expression by guesswork (js-tokens.mjs decides from the
// surrounding group and also scans the other reading, so a finding in either
// counts). Against the TypeScript parser, 30,000 random slash-heavy programs
// gave no miss, but hostile input can still desync a lexer that does not parse.

import { tokenize } from "./js-tokens.mjs";

/** The two ways to read a `/` after `)`, `]`, `}`, `++` or `--` (js-tokens.mjs). A finding in either reading is a finding. */
const READINGS = Object.freeze(["usual", "other"]);

export const BANNED_NAMES = Object.freeze(
  new Set([
    "console",
    "process",
    "globalThis",
    "global",
    "self",
    "window",
    "document",
    "navigator",
    "Function",
    "eval",
    "require",
    "fetch",
    "XMLHttpRequest",
    "WebSocket",
    "EventSource",
    "Worker",
    "SharedWorker",
    "MessageChannel",
    "BroadcastChannel",
    "setTimeout",
    "setInterval",
    "setImmediate",
    "clearTimeout",
    "clearInterval",
    "clearImmediate",
    "queueMicrotask",
    "Buffer",
    "performance",
    "structuredClone",
    "crypto",
    "Atomics",
    "SharedArrayBuffer",
    "Deno",
    "Bun",
    "importScripts",
    "postMessage",
  ]),
);

const REFLECTION = new Set([
  "__proto__",
  "getPrototypeOf",
  "setPrototypeOf",
  "prepareStackTrace",
  "captureStackTrace",
  "Reflect",
  "Proxy",
  "WebAssembly",
]);

const isDot = (tok) =>
  tok !== undefined && tok.t === "p" && (tok.v === "." || tok.v === "?.");

/** `$.process`: the engine's own noun, the one place the word `process` is code. */
function isEngineNoun(toks, k) {
  return (
    toks[k].v === "process" && isDot(toks[k - 1]) && toks[k - 2]?.v === "$"
  );
}

function identifierFinding(toks, k) {
  const { v } = toks[k];
  if (BANNED_NAMES.has(v) && !isEngineNoun(toks, k)) return "banned-name";
  if (REFLECTION.has(v)) return "reflection";
  if (v === "constructor" && isDot(toks[k - 1])) return "reflection";
  if (v === "import" && ["(", "."].includes(toks[k + 1]?.v ?? ""))
    return "dynamic-import";
  return null;
}

/** `x["name"]` or x[`name`]: a member reached with a literal string. */
function bracketFinding(toks, k) {
  const before = toks[k - 2];
  const memberAccess =
    before !== undefined &&
    (before.t === "id" ||
      before.t === "str" ||
      before.t === "tpl" ||
      [")", "]"].includes(before.v));
  const inBrackets = toks[k - 1]?.v === "[" && toks[k + 1]?.v === "]";
  if (!memberAccess || !inBrackets) return null;
  const { v } = toks[k];
  return BANNED_NAMES.has(v) || REFLECTION.has(v) || v === "constructor"
    ? "bracket-name"
    : null;
}

/** The statement keyword (`import` or `export`) a `from` belongs to, and whether it is `import type` / `export type`. */
function statementOf(toks, k) {
  for (let j = k - 1; j >= 0; j -= 1) {
    if (
      toks[j].t === "id" &&
      (toks[j].v === "import" || toks[j].v === "export")
    ) {
      return {
        keyword: toks[j].v,
        typeOnly: toks[j + 1]?.v === "type" && toks[j + 2]?.v !== "from",
      };
    }
    if (toks[j].t === "p" && toks[j].v === ";") break;
  }
  return { keyword: null, typeOnly: false };
}

/** Every module specifier in a token list: `from "x"` and `import "x"`. */
export function specifiersOf(toks) {
  const found = [];
  toks.forEach((tok, k) => {
    const next = toks[k + 1];
    if (tok.t !== "id" || next?.t !== "str") return;
    if (tok.v === "from") {
      const { keyword, typeOnly } = statementOf(toks, k);
      if (keyword !== null)
        found.push({ spec: next.v, typeOnly, line: next.line });
    } else if (tok.v === "import")
      found.push({ spec: next.v, typeOnly: false, line: next.line });
  });
  return found;
}

export const isRelative = (spec) =>
  spec.startsWith("./") || spec.startsWith("../");

function specFindings(toks) {
  return specifiersOf(toks)
    .filter(
      ({ spec, typeOnly }) =>
        !(isRelative(spec) || (spec === "claude-code" && typeOnly)),
    )
    .map(({ spec, line }) => ({ rule: "import-spec", line, token: spec }));
}

function findingsOf(toks) {
  const found = toks.flatMap((tok, k) => {
    const rule =
      tok.t === "id"
        ? identifierFinding(toks, k)
        : tok.t === "str" || tok.t === "tpl"
          ? bracketFinding(toks, k)
          : null;
    return rule === null ? [] : [{ rule, line: tok.line, token: tok.v }];
  });
  return [...found, ...specFindings(toks)];
}

/** Findings of one source text: [{rule, line, token}], in source order, each once. */
export function scanSource(text) {
  const seen = new Set();
  return READINGS.flatMap((reading) => findingsOf(tokenize(text, reading)))
    .filter((f) => {
      const key = `${f.line}:${f.rule}:${f.token}`;
      return seen.has(key) ? false : (seen.add(key), true);
    })
    .sort((a, b) => a.line - b.line);
}

/** The relative files `text` imports (`from` and bare imports) in either reading, as specifiers, each once. */
export function relativeImports(text) {
  const specs = READINGS.flatMap((reading) =>
    specifiersOf(tokenize(text, reading))
      .filter(({ spec }) => isRelative(spec))
      .map(({ spec }) => spec),
  );
  return [...new Set(specs)];
}
