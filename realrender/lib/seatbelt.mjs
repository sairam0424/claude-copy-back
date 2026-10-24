// The Seatbelt profile the live pass wraps Claude Code in (sandbox-exec -f).
// Pure: builds text, touches nothing. Rules (the last matching rule wins):
//   - everything allowed by default, then
//   - no outbound network except addresses local to this host and unix sockets
//     (the stub on 127.0.0.1 and Claude Code's own sockets);
//   - no mach-lookup of the pasteboard service, so even /usr/bin/pbcopy or
//     /usr/bin/pbpaste called by absolute path cannot reach the real clipboard;
//   - no write anywhere under the real home (the throwaway directory is not
//     under it);
//   - no read of the folders that hold real credentials, settings, transcripts
//     and the user's own captures.

export const PASTEBOARD_SERVICE = "com.apple.pasteboard.1";

const SAFE_PATH = /^\/[A-Za-z0-9._\-/ ]+$/;

function quoted(path) {
  if (!SAFE_PATH.test(path) || path.includes("..")) {
    throw new Error(`path not allowed in a Seatbelt profile: ${path}`);
  }
  return `"${path}"`;
}

const subpaths = (paths) => paths.map((p) => `(subpath ${quoted(p)})`).join(" ");

/**
 * @param {object} o
 * @param {string[]} o.denyWrite directories nothing may be written under
 * @param {string[]} o.denyRead directories nothing may be read from
 * @param {string[]} [o.denyReadLiteral] single files nothing may read
 */
export function buildProfile({ denyWrite, denyRead, denyReadLiteral = [] }) {
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny network-outbound)",
    '(allow network-outbound (remote ip "localhost:*"))',
    "(allow network-outbound (remote unix-socket))",
    `(deny mach-lookup (global-name "${PASTEBOARD_SERVICE}"))`,
  ];
  if (denyWrite.length) lines.push(`(deny file-write* ${subpaths(denyWrite)})`);
  const reads = [
    denyRead.length ? subpaths(denyRead) : "",
    ...denyReadLiteral.map((p) => `(literal ${quoted(p)})`),
  ].filter(Boolean);
  if (reads.length) lines.push(`(deny file-read* ${reads.join(" ")})`);
  return `${lines.join("\n")}\n`;
}

/** The argument list that runs `argv` under the profile. */
export function sandboxArgs(profilePath, argv) {
  return ["-f", profilePath, ...argv];
}

export const SANDBOX_EXEC = "/usr/bin/sandbox-exec";
