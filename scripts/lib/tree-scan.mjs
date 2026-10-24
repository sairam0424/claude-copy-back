// The privacy guard applied to the plugin's tree on disk: every code file under
// hooks/ and src/core/ is scanned (source-scan.mjs), and the files the hooks
// actually load (the import closure of hooks/register.tsx) must all sit inside
// those two folders, so no file with node: imports or disk writes (src/captures,
// src/replay, src/sim) can be pulled in by an edit to an import. Every file the
// hooks load is scanned whatever its extension (a .mjs beside the .ts files
// gets no pass), and the manifest may name no hooks module but register.tsx.

import fs from "node:fs";
import path from "node:path";
import { relativeImports, scanSource } from "./source-scan.mjs";

export const GUARDED_DIRS = Object.freeze(["hooks", "src/core"]);
export const ENTRY = "hooks/register.tsx";
export const MANIFEST = "hooks/hooks.json";
/** The one hooks module the manifest may name, relative to hooks/. */
export const EXPECTED_MODULES = Object.freeze(["register.tsx"]);
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

/** Every code file under `dir` (relative to `root`), sorted. */
export function listCode(root, dir) {
  const base = path.join(root, dir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { recursive: true, encoding: "utf8" })
    .filter((name) => CODE.test(name))
    .map((name) => path.join(dir, name))
    .sort();
}

const diskIo = {
  read: (file) => fs.readFileSync(file, "utf8"),
  exists: (file) => fs.existsSync(file),
};

/** The files `entry` loads, following relative imports: { files, missing } (paths relative to `root`). `io` is for tests. */
export function closureOf(root, entry = ENTRY, io = diskIo) {
  const files = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length > 0) {
    const rel = queue.pop();
    if (files.has(rel)) continue;
    files.add(rel);
    const text = io.read(path.join(root, rel));
    for (const spec of relativeImports(text)) {
      const target = path.normalize(path.join(path.dirname(rel), spec));
      if (io.exists(path.join(root, target))) queue.push(target);
      else missing.push(`${rel} -> ${spec}`);
    }
  }
  return { files: [...files].sort(), missing };
}

const inGuardedDir = (rel) =>
  GUARDED_DIRS.some((dir) => rel.startsWith(`${dir}/`));

/** The files of `files` that sit outside hooks/ and src/core/. */
export const outsideGuarded = (files) =>
  files.filter((rel) => !inGuardedDir(rel));

/** The hooks modules the manifest names (`modules`), or null when it cannot be read as a list of strings. */
export function manifestModules(root) {
  try {
    const { modules } = JSON.parse(
      fs.readFileSync(path.join(root, MANIFEST), "utf8"),
    );
    return Array.isArray(modules) && modules.every((m) => typeof m === "string")
      ? modules
      : null;
  } catch {
    return null;
  }
}

/** True when the manifest names exactly the expected hooks module and nothing else. */
export const modulesAreExpected = (modules) =>
  Array.isArray(modules) &&
  modules.length === EXPECTED_MODULES.length &&
  modules.every((m, i) => m === EXPECTED_MODULES[i]);

/** Scan the tree under `root`. Findings carry the file; nothing carries source text. */
export function scanTree(root) {
  const closure = closureOf(root);
  const listed = GUARDED_DIRS.flatMap((dir) => listCode(root, dir));
  const files = [...new Set([...listed, ...closure.files])].sort();
  const findings = files.flatMap((file) =>
    scanSource(fs.readFileSync(path.join(root, file), "utf8")).map((f) => ({
      file,
      ...f,
    })),
  );
  return {
    files,
    findings,
    closure: closure.files,
    missing: closure.missing,
    outside: outsideGuarded(closure.files),
    modules: manifestModules(root),
  };
}
