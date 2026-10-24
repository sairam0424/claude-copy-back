// Small helpers shared by the rig modules.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** sha1 hex of a string (short, for comparing captures). */
export function hash(text) {
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

/** First executable `name` in `dirs`, as an absolute path; throws when absent. */
export function findTool(name, dirs) {
  for (const dir of dirs) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // not here, keep looking
    }
  }
  throw new Error(`${name} not found`);
}
