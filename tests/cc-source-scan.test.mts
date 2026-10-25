import { test } from "node:test";
import assert from "node:assert/strict";
import { scanSource } from "../scripts/lib/source-scan.mjs";
import { assertCpuWithin, cpuTimed } from "./timing.ts";

// The scanner behind the privacy guard (tests/cc-source-guard.test.mts and
// scripts/check-sources.mjs). It reads TypeScript as tokens, so a word inside a
// comment, a string or a regular expression is not code, and a banned name in
// code is found wherever it stands. These tests pin both halves: the shapes
// that must be refused (including the ways round a plain regex search) and the
// shapes that must pass.

const rules = (source: string): string[] =>
  scanSource(source).map((violation) => violation.rule);

const REFUSED: Record<string, string> = {
  "a console call": "console.error(clip.text);",
  "a console call through brackets": 'console["error"](clip.text);',
  "a console alias": "const c = console; c.log(1);",
  "the global object": "const g = globalThis;",
  "the global object, name built at run time":
    'globalThis["con" + "sole"].log(1);',
  "the environment through the global object":
    "const h = globalThis.process?.env?.HOME;",
  "process by name": "process.stderr.write(clip.text);",
  "a fetch of the global kind": 'fetch("https://example.invalid/" + t);',
  "a web socket": 'new WebSocket("wss://example.invalid");',
  "a timer": "setTimeout(() => {}, 1);",
  "an interval": "setInterval(go, 5);",
  "indirect eval": '(0, eval)("1");',
  "new Function": 'new Function("return this")();',
  "Function as a value": "const F = Function;",
  require: 'const fs = require("node:fs");',
  "a dynamic import": 'await import("node:fs");',
  "import.meta": "const u = import.meta.url;",
  "a node: import": 'import { readFileSync } from "node:fs";',
  "a bare side-effect import": 'import "node:fs";',
  "a star re-export from a package": 'export * from "left-pad";',
  "a package import": 'import pad from "left-pad";',
  "a value import from claude-code": 'import { h } from "claude-code";',
  "a type import from another package": 'import type { A } from "other";',
  ".constructor, the way back to Function":
    'x.constructor.constructor("return this")();',
  "?.constructor": "const k = a?.constructor;",
  "constructor through brackets": 'const k = a["constructor"];',
  "the prototype of an async function":
    "Object.getPrototypeOf(async () => {}).constructor;",
  Reflect: 'Reflect.get(a, "b");',
  "a banned name in a template expression": "`line ${console.log(1)}`;",
  "a banned name in a nested template": "`a ${`b ${console}`}`;",
  "a banned name after a regex literal":
    "const ok = /x/.test(s); console.log(ok);",
  "a banned name after a division": "const r = a / b / c; console.log(r);",
  "a banned property key": "const o = { process: 1 };",
  "a banned name as a property of an object": "const e = x.process.env;",
  "a bracket access by a banned string": 'const e = x["process"];',
  "a bracket access by a banned template": "const e = x[`fetch`];",
  "the stack-trace hook": "Error.prepareStackTrace = go;",
  "a banned name after a regex literal that holds a backtick, after a block":
    "if (a) { b(); }\n/`/.test(s);\nconsole.log(secret);\nconst q = `x`;\n",
  "a banned name after a regex literal that holds a backtick, after a condition":
    "if (ok) /`/.test(s);\nconsole.log(secret);\nconst q = `x`;\n",
  "a banned name after a regex literal that holds two escaped slashes":
    "if (ok) /a\\/\\//.test(s); console.log(secret);",
  "a banned name after a regex literal in a while body":
    "while (ok) /`/.exec(s);\nfetch(secret);\nconst q = `x`;\n",
  "a node: import after a regex literal that holds a backtick":
    'if (ok) /`/.test(s);\nimport "node:fs";\nconst q = `x`;\n',
  "a banned name after a postfix decrement and a regex literal that holds a backtick":
    "y = z-- / 2;\nif (a) /`/.test(s);\nconsole.log(1);\nconst q = `x`;\n",
  "a banned name after a division and a regex literal that holds a quote, on one line":
    'y = z++ / 2; if (a) /"/.test(s); console.log(1);',
  "a banned name after a call division and a regex literal that holds a quote, on one line":
    "k = f(x) / 2; while (a) /'/.exec(s); fetch(secret);",
  "a banned name after an index division and a regex literal after a for header":
    'v = xs[0] / 2; for (;;) /"/.test(s); console.log(1);',
  "a banned name after a block and a regex literal that holds a quote, on one line":
    '{ b(); } /"/.test(s); console.log(1);',
  "a banned name after an else and a regex literal that holds a backtick":
    "if (a) b(); else /`/.test(s);\nconsole.log(1);\nconst q = `x`;\n",
  "a banned name written with a unicode escape": "\\u0063onsole.log(1);",
  "a banned name with an escape in brackets": 'x["con\\u0073ole"].log(1);',
  "a banned name with a code point escape": "\\u{63}onsole.log(1);",
  "a banned name in an optional bracket": 'const e = x?.["process"];',
  "a descriptor read": "const d = Object.getOwnPropertyDescriptor(o, k);",
  "descriptors read in bulk": "const d = Object.getOwnPropertyDescriptors(o);",
  "own property names": "const n = Object.getOwnPropertyNames(o);",
  "own property symbols": "const n = Object.getOwnPropertySymbols(o);",
  "defineProperty on a built-in":
    'Object.defineProperty(Array.prototype, "x", { value: 1 });',
  defineProperties: "Object.defineProperties(o, {});",
  "the legacy getter hooks": "o.__defineGetter__(k, f); o.__lookupGetter__(k);",
  "the legacy setter hooks": "o.__defineSetter__(k, f); o.__lookupSetter__(k);",
  ".prototype of a built-in": "Array.prototype.cbLast = clip.text;",
  "?.prototype": "const p = a?.prototype;",
  'the string "__proto__" outside brackets': 'const k = "__proto__";',
  'the string "constructor" outside brackets': 'const k = "constructor";',
  'the string "prototype" outside brackets': "const k = 'prototype';",
  'the template "constructor" outside brackets': "const k = `constructor`;",
  'the string "constructor" written with an escape':
    'const k = "\\u0063onstructor";',
  "a name built from two strings in brackets":
    'const F = (() => 0)["con" + "structor"]; F("return this")();',
  "a name built from a template in brackets":
    'const F = (() => 0)[`con${"structor"}`];',
  "a name built from strings after an optional chain":
    'const c = realm?.["con" + "sole"];',
  "a name built from a call on a string":
    'const c = realm["CON".toLowerCase()];',
  "a name built from strings inside a nested index":
    'const c = realm[names[0] + "sole"];',
  // The typed bypass found in the 0.1.1 safety review (mutant M2b): Function is
  // reached through the descriptor of __proto__ and "constructor", the global
  // object through Function("return this"), the console through a built name,
  // and the encoded clipboard is printed from a promise job.
  "the descriptor route to Function and the console (review mutant M2b)": [
    "const desc: (o: object, k: string) => { value?: unknown; get?: () => unknown } | undefined = Object.getOwnPropertyDescriptor;",
    'const fnProto = desc(Object.prototype, "__proto__")?.get?.call(() => 0) as object;',
    'const make = desc(fnProto, "constructor")?.value as (src: string) => () => Record<string, { log: (...a: unknown[]) => void }>;',
    'const realm = make("return this")();',
    'const printer = realm["con" + "sole"];',
    'const encoded = Array.from(clip.text).map((c) => c.codePointAt(0)).join(",");',
    "Promise.resolve().then(printer.log.bind(printer, encoded));",
  ].join("\n"),
  // Routes that need neither a dot before the name nor one string that holds it.
  "constructor taken by destructuring": "const { constructor: F } = () => 0;",
  "constructor taken by shorthand destructuring": "const { constructor } = fn;",
  "prototype taken by destructuring": "const { prototype: P } = Array; P.cbLast = clip.text;",
  "a name built from strings as an object-pattern key":
    'const { ["con" + "sole"]: c } = realm;',
  "a name built from a template as an object-pattern key":
    "const { [`con${s}`]: c } = realm;",
  "a built key after a comma in an object pattern":
    'const { a, ["con" + "sole"]: c } = realm;',
  "a built-in stash through defineProperty (review mutant M1b)":
    'Object.defineProperty(Array.prototype, "cbLast", { value: clip.text, configurable: true, writable: true });',
};

for (const [name, source] of Object.entries(REFUSED)) {
  test(`refused: ${name}`, () => {
    assert.ok(rules(source).length > 0, source);
  });
}

test("the new routes are named by their own rules", () => {
  assert.deepEqual(rules("Object.getOwnPropertyDescriptor(o, k);"), [
    "reflection",
  ]);
  assert.deepEqual(rules("const p = A.prototype;"), ["reflection"]);
  assert.deepEqual(rules('const k = "prototype";'), ["reflection-string"]);
  assert.deepEqual(rules('const F = f["con" + "structor"];'), [
    "computed-name",
  ]);
  assert.deepEqual(rules('const F = f["constructor"];'), ["bracket-name"]);
});

test("a computed-name finding is on the bracket's line and names the bracket, not the text", () => {
  const found = scanSource('const a = 1;\nconst F = f[\n  "con" + "structor"];\n');
  assert.deepEqual(found, [{ rule: "computed-name", line: 2, token: "[" }]);
});

test("the optional-bracket and nested-bracket scans stay linear on a hostile source", () => {
  const nested = `x${"[y".repeat(40_000)}${"]".repeat(40_000)};`;
  const unclosed = `x${"[y".repeat(40_000)};`;
  const { cpuMs } = cpuTimed(() => {
    scanSource(nested);
    scanSource(unclosed);
  });
  assertCpuWithin("cc-source-scan: 40,000 nested brackets", cpuMs, 5000);
});

const ALLOWED: Record<string, string> = {
  "a line comment": "// console.error(x); process.env; fetch()\nconst a = 1;",
  "a block comment": "/* globalThis, eval and\n   Function */ const a = 1;",
  "a doc comment":
    "/** The engine's process answer, not a console. */ const a = 1;",
  "a string": 'const s = "console" + \'process\' + "fetch";',
  "a string with an escaped quote": 'const s = "a\\"console";',
  "a template of words": "const s = `the console and the process`;",
  "a template with an expression": "const s = `n=${n + 1}`;",
  "a regex with banned words": "const ok = /console|process|fetch/.test(s);",
  "a regex with a slash in a class": "const ok = /[/]console/.test(s);",
  "a division": "const r = a / b / c;",
  "a division after a call": "const r = f(x) / 2;",
  "a chain of divisions after a call": "const r = f(x) / 2 / 3;",
  "a division and a trailing comment":
    "const h = (a + b) / 2; // half\nconst a = 1;",
  "a division after an index": "const r = xs[0] / 2 + ys[1] / 3;",
  "a division after a postfix increment":
    "const r = i++ / 2; const s = j-- / 4;",
  "a unary plus before a regex test": "const n = a + +/x/.test(b);",
  "a division after an object literal":
    'const h = { a: 1 }.a / 2; const s = "x / y";',
  "a division after a call and a string with a slash":
    'const r = f(x) / 2; const s = "a / b";',
  "a division after a method call and a regex on the next line":
    "const r = a.b(c) / 2;\nconst ok = /x/.test(s);",
  "a division and a template": "const s = `${(a + b) / 2} and ${c}`;",
  "the engine's own noun": 'return $.process.run(["pbpaste"]);',
  "a type argument that names the noun":
    'type S = Slice<"process", "run">; const n = 1;',
  "a relative import": 'import { findSource } from "../src/core/match.ts";',
  "a same-folder import": 'import { x } from "./input.ts";',
  "a type import from claude-code":
    'import type { Register } from "claude-code";',
  "a type re-export": "export type { RunAnswer };",
  "a relative re-export": 'export { x } from "./y.ts";',
  "a class constructor": "class A { constructor(a: string) { this.a = a; } }",
  "names that only contain a banned word":
    "const consoleLike = processed + selfie + fetchAll + evaluate + Functions;",
  "ordinary text work": 'const out = text.replaceAll("a", "b").split("\\n");',
  "a property named text": "const t = row.text;",
  "a JSX-free arrow": "const f = (a: number) => a * 2;",
  "an array literal of built strings": 'return ["a" + b, "c" + d];',
  "an array literal after a keyword": 'const x = typeof y === "a" ? ["b" + c] : [];',
  "an array of strings passed to a call": 'run(["pbpaste"], { timeoutMs: 2000 });',
  "an array destructuring": "const [first, second] = pair;",
  "an index by arithmetic": "const v = rows[i + 1] + rows[i - 1];",
  "an index by a variable": "const line = FIXED_LINES[reason];",
  "a lone string index that names nothing banned": 'const v = table["text"];',
  "words around the reflection words in a longer string":
    'const s = "the constructor and the prototype of __proto__ routes";',
  "names that only contain a reflection word":
    "const own = getOwnPropertyDescriptorLike + definePropertyCount + prototypeOf;",
  "an object literal with a key held in a variable": "const o = { [key]: 1, b: 2 };",
  "an object literal with a plain key and an array of built strings":
    'const o = { a: ["x" + y], b: 1 };',
  "a class with a constructor and a method": "class A { constructor() {} go() {} }",
  "the word constructor in a comment before a destructuring":
    "/* constructor */ const { a, b } = c;",
  "a method called on a property named like a built-in's":
    "const n = items.names.length + ids.descriptor;",
};

for (const [name, source] of Object.entries(ALLOWED)) {
  test(`allowed: ${name}`, () => {
    assert.deepEqual(scanSource(source), [], source);
  });
}

test("a violation names its rule, its line and the token, and never the surrounding text", () => {
  const found = scanSource("const a = 1;\n\nconsole.error(secretLooking);\n");
  assert.equal(found.length, 1);
  assert.equal(found[0]?.rule, "banned-name");
  assert.equal(found[0]?.line, 3);
  assert.equal(found[0]?.token, "console");
  assert.deepEqual(Object.keys(found[0] ?? {}).sort(), [
    "line",
    "rule",
    "token",
  ]);
});

test("every violation of one source is listed, in order", () => {
  const found = scanSource("console.log(1);\nfetch(u);\nglobalThis.x = 1;\n");
  assert.deepEqual(
    found.map((v) => `${v.line}:${v.token}`),
    ["1:console", "2:fetch", "3:globalThis"],
  );
});

test("an unterminated string or template does not hang or throw", () => {
  assert.doesNotThrow(() =>
    scanSource('const s = "never closed;\nconst a = 1;'),
  );
  assert.doesNotThrow(() => scanSource("const s = `never closed ${"));
  assert.doesNotThrow(() => scanSource("const r = /never closed"));
});

test("a million-character source is scanned, with nothing found, in bounded time", () => {
  const source = "const a = b / c;\n".repeat(60_000);
  const { value: found, cpuMs } = cpuTimed(() => scanSource(source));
  assert.deepEqual(found, []);
  assertCpuWithin("cc-source-scan: a million characters", cpuMs, 5000);
});
