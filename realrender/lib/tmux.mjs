// Thin wrapper over tmux. EVERY command goes to the dedicated socket "cbrender"
// with a private config; the default tmux server is never addressed. tmux is
// started with a minimal environment of its own, so the server does not hold
// the operator's variables either.

import { spawnSync } from "node:child_process";
import { shQuote } from "./launcher.mjs";

export const SOCKET = "cbrender";
export const SESSION = "rig";

/** The capture variants the rig takes of the screen. */
export const CAPTURE_FLAGS = {
  plain: ["-p"],
  joined: ["-p", "-J"],
  styled: ["-p", "-e"],
  styledJoined: ["-p", "-e", "-J"],
  // -N keeps the trailing spaces of each row: shows what was really written.
  padded: ["-p", "-N"],
};

export const TMUX_CONF = [
  "set -g default-shell /bin/sh",
  "set -g status off",
  "set -g history-limit 100000",
  "set -g escape-time 0",
  "set -g remain-on-exit on",
  "",
].join("\n");

/** Default executor: run the binary with an explicit env, return text. */
export function realExec(bin, args, env) {
  const r = spawnSync(bin, args, { env, encoding: "utf8", maxBuffer: 1 << 28 });
  return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export class Tmux {
  /**
   * @param {object} o
   * @param {string} o.bin absolute path of tmux
   * @param {string} o.conf path of the private config file
   * @param {Record<string,string>} o.env minimal environment for tmux itself
   * @param {Function} [o.exec] injectable executor (tests)
   */
  constructor({ bin, conf, env, exec = realExec }) {
    this.bin = bin;
    this.conf = conf;
    this.env = env;
    this.exec = exec;
  }

  /** Run one tmux command on the dedicated socket. */
  run(args) {
    return this.exec(this.bin, ["-L", SOCKET, "-f", this.conf, ...args], this.env);
  }

  /** Is a server alive on the dedicated socket? */
  hasServer() {
    return this.run(["list-sessions"]).status === 0;
  }

  newSession({ width, height, cwd, command }) {
    const r = this.run([
      "new-session", "-d", "-s", SESSION,
      "-x", String(width), "-y", String(height), "-c", cwd, command,
    ]);
    if (r.status !== 0) throw new Error(`tmux new-session failed: ${r.stderr.trim()}`);
  }

  resize(width, height) {
    const args = ["resize-window", "-t", SESSION, "-x", String(width)];
    if (height) args.push("-y", String(height));
    return this.run(args);
  }

  capture(kind, { history = false } = {}) {
    const flags = CAPTURE_FLAGS[kind];
    if (!flags) throw new Error(`unknown capture kind ${kind}`);
    const range = history ? ["-S", "-", "-E", "-"] : [];
    return this.run(["capture-pane", ...flags, ...range, "-t", SESSION]).stdout;
  }

  /** One-line facts about the pane: size, alt screen, mouse flags, history. */
  paneFacts() {
    const fmt = [
      "pid=#{pane_pid}", "dead=#{pane_dead}", "w=#{pane_width}", "h=#{pane_height}",
      "alt=#{alternate_on}", "mouseAny=#{mouse_any_flag}", "mouseAll=#{mouse_all_flag}",
      "mouseSgr=#{mouse_sgr_flag}", "history=#{history_size}",
    ].join(" ");
    const out = this.run(["display-message", "-p", "-t", SESSION, fmt]).stdout.trim();
    return Object.fromEntries(out.split(" ").map((kv) => kv.split("=")));
  }

  /** Append everything the pane's program writes (raw bytes) to `file`. */
  pipeTo(file) {
    return this.run(["pipe-pane", "-t", SESSION, `cat >> ${shQuote(file)}`]);
  }

  sendKeys(...keys) {
    return this.run(["send-keys", "-t", SESSION, ...keys]);
  }

  killServer() {
    return this.run(["kill-server"]);
  }
}
