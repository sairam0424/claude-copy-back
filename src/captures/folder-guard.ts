// Where the captures may live. `add` writes the person's own copies, so it
// refuses a folder that could end up in a commit: one inside a git repository
// (a .git in the folder or in any parent) or inside this project. Symlinks are
// followed first, so a link into a repository does not get around it.
//
// PRIVACY: the refusal is a CapturesError with a fixed code; no path is echoed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapturesError } from "./errors.ts";

/** The copy-back project folder (two levels above src/captures). */
export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

/** `p` with every symlink resolved in the part that exists; the rest is kept as written. */
function realOf(p: string): string {
  try {
    return fs.realpathSync(p);
  } catch {
    const parent = path.dirname(p);
    return parent === p ? p : path.join(realOf(parent), path.basename(p));
  }
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

function hasGit(dir: string): boolean {
  try {
    fs.lstatSync(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

function insideRepository(target: string): boolean {
  for (let p = target; ; p = path.dirname(p)) {
    if (hasGit(p)) return true;
    if (path.dirname(p) === p) return false;
  }
}

/**
 * Throws DIR_NOT_PRIVATE when `dir` is inside a git repository or inside the
 * project. Reads the file system only; creates nothing.
 */
export function assertPrivateFolder(
  dir: string,
  projectRoot: string = PROJECT_ROOT,
): void {
  const target = realOf(path.resolve(dir));
  const project = realOf(path.resolve(projectRoot));
  if (isInside(target, project) || insideRepository(target))
    throw new CapturesError("DIR_NOT_PRIVATE");
}
