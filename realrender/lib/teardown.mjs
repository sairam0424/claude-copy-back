// Teardown: stop exactly what the rig started (by pid and by the dedicated
// socket, never by pattern) and move the throwaway directory to the Trash with
// `mv` (never rm).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Is `pid` alive? (signal 0 only checks) */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

/** TERM an exact pid, wait, then KILL the same pid if it is still there. */
export async function stopPid(pid, graceMs = 3000) {
  if (!isAlive(pid)) return "already-gone";
  process.kill(pid, "SIGTERM");
  const end = Date.now() + graceMs;
  while (Date.now() < end && isAlive(pid)) await sleep(100);
  if (!isAlive(pid)) return "terminated";
  process.kill(pid, "SIGKILL");
  await sleep(200);
  return isAlive(pid) ? "survived-kill" : "killed";
}

/** Target path inside the Trash for a throwaway directory. */
export function trashTarget(dir, trashRoot = path.join(os.homedir(), ".Trash"), now = Date.now()) {
  return path.join(trashRoot, `${path.basename(dir)}-${now}`);
}

/** Move `dir` into the Trash with `mv`. Returns the new path. */
export function moveToTrash(dir, trashRoot) {
  const target = trashTarget(dir, trashRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const r = spawnSync("/bin/mv", [dir, target], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`mv to Trash failed: ${r.stderr.trim()}`);
  return target;
}
