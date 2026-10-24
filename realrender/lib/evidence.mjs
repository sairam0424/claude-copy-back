// Small observers the rig runs around the sealed process: what it wrote into
// the isolated HOME, what appeared in /tmp, its process tree, dialogs on the
// first screen. Read-only, explicit env, no shell.

import fs from "node:fs";
import path from "node:path";
import { SEAL_PATH } from "./config.mjs";
import { realExec } from "./tmux.mjs";

const PS = "/bin/ps";

/** Phrases of the dialogs a fresh HOME can raise; the first screen is scanned for them. */
export const DIALOG_PHRASES = [
  "Choose the text style",
  "Let's get started",
  "Welcome to Claude Code",
  "Do you trust the files",
  "Is this a project you created",
  "trust this folder",
  "Select login method",
  "Detected a custom API key",
  "Try the new fullscreen renderer",
  "Press Enter to continue",
  "Security notes",
];

/** Which known dialog phrases appear in `text`. */
export function dialogsIn(text) {
  return DIALOG_PHRASES.filter((phrase) => text.includes(phrase));
}

/** Banner version ("Claude Code v2.1.309") read off the screen, or null. */
export function bannerVersion(text) {
  return /Claude Code v(\d+\.\d+\.\d+)/.exec(text)?.[1] ?? null;
}

/** Every file under `root`: relative path and size, sorted. */
export function listTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push({ path: path.relative(root, full), bytes: fs.statSync(full).size });
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Names directly inside /tmp (to show the run left nothing behind). */
export function tmpNames(dir = "/tmp") {
  return new Set(fs.readdirSync(dir));
}

/** Names present in `after` but not in `before`. */
export function addedNames(before, after) {
  return [...after].filter((name) => !before.has(name)).sort();
}

/** `ps` for the pid and its direct children. */
export function processTree(pid, exec = realExec) {
  const env = { PATH: SEAL_PATH };
  const self = exec(PS, ["-o", "pid,ppid,etime,rss,command", "-p", String(pid)], env).stdout;
  const all = exec(PS, ["-axo", "pid,ppid,command"], env).stdout;
  const children = all
    .split("\n")
    .filter((line) => new RegExp(`^\\s*\\d+\\s+${pid}\\s`).test(line))
    .map((line) => line.trim());
  return { self: self.trim(), children };
}

/**
 * What the program wrote to the terminal, from the raw pty bytes: terminal
 * modes it switched on/off (DECSET/DECRST), hyperlink and clipboard escapes,
 * and how many erase-to-end-of-line sequences it used.
 */
export function analyzeRaw(buffer) {
  const text = buffer.toString("latin1");
  const modes = new Map();
  for (const m of text.matchAll(/\x1b\[\?([0-9;]+)([hl])/g)) {
    for (const mode of m[1].split(";")) {
      const key = `${m[2] === "h" ? "set" : "reset"} ${mode}`;
      modes.set(key, (modes.get(key) ?? 0) + 1);
    }
  }
  const count = (re) => (text.match(re) ?? []).length;
  return {
    bytes: buffer.length,
    modes: Object.fromEntries([...modes].sort()),
    osc8Hyperlinks: count(/\x1b\]8;/g),
    osc52Clipboard: count(/\x1b\]52;/g),
    eraseToEndOfLine: count(/\x1b\[0?K/g),
    synchronizedUpdates: count(/\x1b\[\?2026h/g),
  };
}
