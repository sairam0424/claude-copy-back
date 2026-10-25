// Everything the live pass writes into one throwaway directory: the isolated
// HOME and synthetic session (as the earlier rig), the shim directory, a
// byte-identical COPY of the plugin tree (the engine writes type declarations
// into a plugin folder it loads, so it never gets the real source folder), the
// Seatbelt profile, and the launcher that runs Claude Code under it.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildClaudeJson, buildSettings, sealedEnv } from "./config.mjs";
import { buildLauncher } from "./launcher.mjs";
import { profileEnv } from "./profile.mjs";
import { SANDBOX_EXEC, buildProfile, sandboxArgs } from "./seatbelt.mjs";
import { writeShims } from "./shims.mjs";
import { buildSession, mangleCwd } from "./session.mjs";
import { TMUX_CONF } from "./tmux.mjs";

/** The parts of the repository that make up the plugin. */
export const PLUGIN_PARTS = [".claude-plugin", "hooks", "src"];

/** The sealed environment (plus the terminal profile's variables) with the shim directory first on PATH. */
export function liveEnv({ home, port, tmpdir, shimDir, profile = "default" }) {
  return sealedEnv({ home, port, tmpdir, extra: profileEnv(profile) }).map(([key, value]) =>
    key === "PATH" ? [key, `${shimDir}:${value}`] : [key, value],
  );
}

/** Paths the profile protects, derived from the real home directory. */
export function protectedPaths(realHome) {
  return {
    denyWrite: [realHome],
    denyRead: ["/.claude", "/.aws", "/.ssh", "/copy-back-captures"].map((p) => `${realHome}${p}`),
    denyReadLiteral: [`${realHome}/.claude.json`],
  };
}

/** sha256 of every file under `root`, keyed by relative path. */
export function hashTree(root) {
  const out = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out[path.relative(root, full)] = createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out;
}

/** Files whose hash differs between two trees, are missing from the copy, or are extra in it. */
export function diffHashes(from, to, prefix = "") {
  const missing = Object.entries(from).filter(([rel, sha]) => to[rel] !== sha).map(([rel]) => `${prefix}${rel}`);
  const extra = Object.keys(to).filter((rel) => !(rel in from)).map((rel) => `${prefix}${rel} (extra)`);
  return [...missing, ...extra];
}

/** Copy the plugin parts of `repo` into `target`; returns the file count and every mismatch against the source. */
export function copyPlugin(repo, target, parts = PLUGIN_PARTS) {
  const mismatches = [];
  let files = 0;
  for (const part of parts) {
    fs.cpSync(path.join(repo, part), path.join(target, part), { recursive: true });
    const from = hashTree(path.join(repo, part));
    files += Object.keys(from).length;
    mismatches.push(...diffHashes(from, hashTree(path.join(target, part)), `${part}/`));
  }
  return { files, mismatches };
}

function write(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
}

/**
 * @param {object} o
 * @param {ReturnType<import("./sandbox.mjs").makeSandbox>} o.sandbox
 * @param {number} o.port stub port
 * @param {string} o.claude absolute path of claude
 * @param {string} o.version
 * @param {string} o.sessionId
 * @param {Array<{role:string,text:string}>} o.turns
 * @param {string} o.repo the folder the plugin is copied from (the copy-back repository root)
 * @param {string[]} [o.parts] the sub-folders to copy (default: the plugin parts)
 * @param {string} [o.profile] terminal profile (profile.mjs), default "default"
 * @param {string} [o.realHome]
 */
export function writeLiveFixtures(o) {
  const s = o.sandbox;
  const shimDir = path.join(s.dir, "shims");
  const pluginDir = path.join(s.dir, "plugin");
  const profilePath = path.join(s.dir, "seatbelt.sb");
  write(path.join(s.home, ".claude.json"), buildClaudeJson({ cwd: s.work }));
  write(path.join(s.claudeDir, "settings.json"), buildSettings("classic"));
  const projectDir = path.join(s.claudeDir, "projects", mangleCwd(s.work));
  const sessionFile = path.join(projectDir, `${o.sessionId}.jsonl`);
  write(sessionFile, buildSession({ sessionId: o.sessionId, cwd: s.work, version: o.version, startMs: Date.UTC(2026, 9, 23, 12, 0, 0), turns: o.turns }));
  write(s.tmuxConf, TMUX_CONF);
  writeShims(shimDir);
  const plugin = copyPlugin(o.repo, pluginDir, o.parts);
  write(profilePath, buildProfile(protectedPaths(o.realHome ?? os.homedir())));
  const env = liveEnv({ home: s.home, port: o.port, tmpdir: s.tmp, shimDir, profile: o.profile });
  const script = buildLauncher({
    pidFile: s.pidFile, cwd: s.work, env, claude: SANDBOX_EXEC,
    args: sandboxArgs(profilePath, [o.claude, "--resume", o.sessionId, "--plugin-dir", pluginDir]),
  });
  write(s.launcher, script, 0o700);
  return { env, shimDir, pluginDir, profilePath, sessionFile, plugin };
}
