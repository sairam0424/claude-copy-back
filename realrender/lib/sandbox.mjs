// The throwaway directory and everything the rig writes into it: isolated
// HOME (.claude.json, optional settings.json, the synthetic session), the tmux
// config and the launcher script. Nothing is read from the real HOME.

import fs from "node:fs";
import path from "node:path";
import { buildClaudeJson, buildSettings, sealedEnv } from "./config.mjs";
import { buildLauncher } from "./launcher.mjs";
import { buildSession, mangleCwd } from "./session.mjs";
import { TMUX_CONF } from "./tmux.mjs";

/** Make /tmp/cbrender.XXXXXX (real path) with its sub-directories. */
export function makeSandbox(root = "/tmp") {
  const made = fs.mkdtempSync(path.join(root, "cbrender."));
  const dir = fs.realpathSync(made);
  const paths = {
    dir,
    home: path.join(dir, "home"),
    claudeDir: path.join(dir, "home", ".claude"),
    work: path.join(dir, "work"),
    tmp: path.join(dir, "tmp"),
    out: path.join(dir, "out"),
    tmuxConf: path.join(dir, "tmux.conf"),
    launcher: path.join(dir, "run-claude.sh"),
    pidFile: path.join(dir, "claude.pid"),
  };
  for (const key of ["claudeDir", "work", "tmp", "out"]) {
    fs.mkdirSync(paths[key], { recursive: true, mode: 0o700 });
  }
  return paths;
}

function write(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, { mode });
}

/**
 * Write every fixture. Returns what the run needs to know about them.
 * @param {object} o
 * @param {ReturnType<typeof makeSandbox>} o.sandbox
 * @param {number} o.port the stub's port
 * @param {string} o.claude absolute path of claude
 * @param {string} o.version version string written into the session
 * @param {string} o.sessionId
 * @param {Array<{role:string,text:string}>} o.turns
 * @param {string} o.mode renderer mode (see config.MODES)
 * @param {string[]} [o.drop] .claude.json keys to leave out (ablation)
 * @param {Array<[string,string]>} [o.extraEnv] more env pairs (experiments)
 */
export function writeFixtures(o) {
  const { sandbox: s } = o;
  write(path.join(s.home, ".claude.json"), buildClaudeJson({ cwd: s.work, drop: o.drop }));
  const settings = buildSettings(o.mode);
  if (settings) write(path.join(s.claudeDir, "settings.json"), settings);
  const projectDir = path.join(s.claudeDir, "projects", mangleCwd(s.work));
  const session = buildSession({
    sessionId: o.sessionId,
    cwd: s.work,
    version: o.version,
    startMs: Date.UTC(2026, 9, 23, 12, 0, 0),
    turns: o.turns,
  });
  write(path.join(projectDir, `${o.sessionId}.jsonl`), session);
  write(s.tmuxConf, TMUX_CONF);
  const env = sealedEnv({ home: s.home, port: o.port, tmpdir: s.tmp, extra: o.extraEnv });
  const script = buildLauncher({
    pidFile: s.pidFile,
    cwd: s.work,
    env,
    claude: o.claude,
    args: ["--resume", o.sessionId],
  });
  write(s.launcher, script, 0o700);
  return { env, projectDir, sessionFile: path.join(projectDir, `${o.sessionId}.jsonl`) };
}
