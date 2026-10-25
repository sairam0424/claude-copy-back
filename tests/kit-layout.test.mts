import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// `claude plugin test .` runs every *.test.ts and *.test.tsx under the folder,
// each file in a child of the engine, and the engine's kit cannot import
// node:test. So the layout is a contract:
//   - a file named *.test.ts or *.test.tsx is a kit test: it imports its kit
//     from "claude-code/testing" (the tests in tests/kit);
//   - a node:test file is named *.test.mts and sits directly in tests/, where
//     the glob in package.json ("tests/*.test.mts") finds it.
// A file that breaks the contract would either fail `claude plugin test .` at
// the root or never run under `npm test`; this test says so by name.

const ROOT = new URL("..", import.meta.url).pathname;
const SKIPPED_FOLDERS = new Set([".git", "node_modules"]);
const KIT_NAME = /\.test\.tsx?$/;
const NODE_NAME = /\.test\.mts$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_FOLDERS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(ROOT).map((path) => relative(ROOT, path));
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const IMPORTS_KIT = /from\s+["']claude-code\/testing["']/;
const IMPORTS_NODE_TEST = /from\s+["']node:test["']/;

test("every *.test.ts and *.test.tsx file is a kit test (it imports claude-code/testing, not node:test)", () => {
  const named = files.filter((f) => KIT_NAME.test(f));
  assert.ok(named.length >= 6, `${named.length} kit test files found`);
  const offenders = named.filter(
    (f) => !IMPORTS_KIT.test(read(f)) || IMPORTS_NODE_TEST.test(read(f)),
  );
  assert.deepEqual(
    offenders,
    [],
    "rename a node:test file to *.test.mts: the engine's kit loads *.test.ts and *.test.tsx and cannot import node:test",
  );
});

test("the kit tests live in tests/kit, where kit-test.sh runs them one file at a time", () => {
  const named = files.filter((f) => KIT_NAME.test(f));
  assert.deepEqual(
    named.filter((f) => !f.startsWith("tests/kit/")),
    [],
  );
});

test("every *.test.mts file is a node:test file directly in tests/, so `npm test` runs it", () => {
  const named = files.filter((f) => NODE_NAME.test(f));
  assert.ok(named.length >= 40, `${named.length} node:test files found`);
  const outside = named.filter(
    (f) => f.split("/").length !== 2 || !f.startsWith("tests/"),
  );
  assert.deepEqual(
    outside,
    [],
    "move it to tests/, the glob does not look deeper",
  );
  const notNodeTests = named.filter((f) => !IMPORTS_NODE_TEST.test(read(f)));
  assert.deepEqual(notNodeTests, []);
});
