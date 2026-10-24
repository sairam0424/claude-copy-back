#!/usr/bin/env node
// Source guard: no console, process, globalThis, fetch, timer, eval, require,
// reflection or non-relative import in hooks/ or src/core/ (whatever the file's
// extension), the files the hooks load stay inside those two folders, and the
// manifest names no hooks module but register.tsx.
//
// Usage: node scripts/check-sources.mjs [plugin-dir]   (default: this repo)
// Exit 0 when clean, 1 on any finding (printed as file:line rule token, never
// source text), 2 on misuse.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_MODULES,
  MANIFEST,
  modulesAreExpected,
  scanTree,
} from "./lib/tree-scan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.length > 1 || args[0] === "-h" || args[0] === "--help") {
  process.stdout.write("usage: node scripts/check-sources.mjs [plugin-dir]\n");
  process.exit(args.length > 1 ? 2 : 0);
}
const root = path.resolve(args[0] ?? path.join(here, ".."));
const report = scanTree(root);
const lines = [
  ...report.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.token}`),
  ...report.outside.map(
    (rel) => `${rel}: loaded by the hooks but outside hooks/ and src/core/`,
  ),
  ...report.missing.map((m) => `${m}: import does not resolve`),
  ...(modulesAreExpected(report.modules)
    ? []
    : [
        `${MANIFEST}: modules must be exactly [${EXPECTED_MODULES.join(", ")}]`,
      ]),
];
if (lines.length > 0) {
  process.stderr.write(`check-sources: FAIL\n${lines.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `check-sources: OK: ${report.files.length} files scanned, ${report.closure.length} loaded by the hooks, no finding\n`,
);
