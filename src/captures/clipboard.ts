// The production clipboard reader: macOS pbpaste, started directly (no shell),
// utf8, at most 4 MiB. Tests inject a fake `exec`, so the real clipboard is
// never read except when the person runs `add`.
// PRIVACY: a failure becomes a fixed error code; the child's own error, which
// can carry output, is dropped.

import { execFileSync } from "node:child_process";
import { CapturesError } from "./errors.ts";

export const MAX_CLIPBOARD_BYTES = 4 * 1024 * 1024;

/** The slice of execFileSync this module uses (so a test can stand in for it). */
export type ExecFile = (
  file: string,
  args: readonly string[],
  options: {
    encoding: "utf8";
    maxBuffer: number;
    env: NodeJS.ProcessEnv;
    stdio: ["ignore", "pipe", "ignore"];
  },
) => string;

// pbpaste encodes by the locale and falls back to a legacy Mac encoding when
// none is set; we decode as UTF-8, so say so for the child only.
const UTF8_LOCALE = "en_US.UTF-8";

export function pbpasteReader(
  exec: ExecFile = execFileSync as unknown as ExecFile,
): () => string {
  return () => {
    try {
      return exec("pbpaste", [], {
        encoding: "utf8",
        maxBuffer: MAX_CLIPBOARD_BYTES,
        env: { ...process.env, LANG: UTF8_LOCALE, LC_ALL: UTF8_LOCALE },
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch (err) {
      const tooBig = (err as { code?: unknown }).code === "ENOBUFS";
      throw new CapturesError(
        tooBig ? "CLIPBOARD_TOO_LARGE" : "CLIPBOARD_UNREADABLE",
      );
    }
  };
}
