// The tiny shell script tmux runs as the pane command. It records its own pid
// (which becomes Claude Code's pid, because `exec` replaces the shell), moves
// into the working directory and starts Claude Code under `env -i` with the
// explicit environment and nothing else.

/** Single-quote a value for a POSIX shell. */
export function shQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * @param {object} o
 * @param {string} o.pidFile where the shell writes its pid
 * @param {string} o.cwd working directory (real path)
 * @param {Array<[string,string]>} o.env ordered pairs for `env -i`
 * @param {string} o.claude absolute path of the claude executable
 * @param {string[]} o.args arguments after the executable
 */
export function buildLauncher({ pidFile, cwd, env, claude, args }) {
  const pairs = env.map(([key, value]) => `${key}=${shQuote(value)}`);
  const words = [
    "exec /usr/bin/env -i",
    ...pairs,
    shQuote(claude),
    ...args.map(shQuote),
  ];
  return [
    "#!/bin/sh",
    `echo $$ > ${shQuote(pidFile)}`,
    `cd ${shQuote(cwd)} || exit 9`,
    words.join(" \\\n  "),
    "",
  ].join("\n");
}
