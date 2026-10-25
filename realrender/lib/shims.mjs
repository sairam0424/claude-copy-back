// Stand-ins for the clipboard programs, first on the sealed PATH. They never
// touch the real pasteboard: `pbpaste` prints a fixture file the test chose,
// the writers keep what they were given inside the throwaway directory and log
// one line each (name, argument count, byte count, a short hash). All content
// is synthetic. Builders are pure; `writeShims` and the log readers use files.

import fs from "node:fs";
import path from "node:path";

export const PBPASTE_MODES = ["fixture", "exit1", "sleep", "huge"];
export const WRITER_SHIMS = ["pbcopy", "xclip", "xsel", "wl-copy", "osascript"];
export const SLEEP_SECONDS = 8;
export const HUGE_BYTES = 5 * 1024 * 1024;

const HEADER = ['#!/bin/sh', 'D=$(cd "$(/usr/bin/dirname "$0")" && pwd)'];

/** The `pbpaste` shim: behaves as `pbpaste.mode` says, logs one line per call. */
export function pbpasteScript() {
  return [
    ...HEADER,
    'MODE=$(/bin/cat "$D/pbpaste.mode" 2>/dev/null || echo fixture)',
    'SIZE=$(/usr/bin/wc -c < "$D/pbpaste.fixture" 2>/dev/null | /usr/bin/tr -d " ")',
    'echo "$(/bin/date +%s) pbpaste argc=$# mode=$MODE fixture=${SIZE:-0} lc=${LC_ALL:-unset} path=${PATH:+set}" >> "$D/pbpaste.log"',
    'case "$MODE" in',
    '  fixture) /bin/cat "$D/pbpaste.fixture" ;;',
    "  exit1) exit 1 ;;",
    `  sleep) exec /bin/sleep ${SLEEP_SECONDS} ;;`,
    `  huge) /usr/bin/head -c ${HUGE_BYTES} /dev/zero | /usr/bin/tr '\\000' 'a' ;;`,
    "  *) exit 2 ;;",
    "esac",
    "",
  ].join("\n");
}

/** A writer shim: keeps stdin under captured/, logs name, argc, bytes, hash. Always succeeds. */
export function writerScript(name) {
  return [
    ...HEADER,
    '/bin/mkdir -p "$D/captured"',
    'N=$(/bin/ls "$D/captured" | /usr/bin/wc -l | /usr/bin/tr -d " ")',
    `F="$D/captured/$N-${name}.bin"`,
    '/bin/cat > "$F"',
    'BYTES=$(/usr/bin/wc -c < "$F" | /usr/bin/tr -d " ")',
    'SHA=$(/usr/bin/shasum -a 256 "$F" | /usr/bin/cut -c1-16)',
    `echo "$(/bin/date +%s) ${name} argc=$# bytes=$BYTES sha=$SHA file=$N-${name}.bin" >> "$D/clip.log"`,
    "exit 0",
    "",
  ].join("\n");
}

/** Create the shim directory with every shim executable and empty logs. */
export function writeShims(dir) {
  fs.mkdirSync(path.join(dir, "captured"), { recursive: true, mode: 0o700 });
  const put = (name, text) => fs.writeFileSync(path.join(dir, name), text, { mode: 0o700 });
  put("pbpaste", pbpasteScript());
  for (const name of WRITER_SHIMS) put(name, writerScript(name));
  fs.writeFileSync(path.join(dir, "pbpaste.mode"), "fixture\n");
  fs.writeFileSync(path.join(dir, "pbpaste.fixture"), "");
  fs.writeFileSync(path.join(dir, "pbpaste.log"), "");
  fs.writeFileSync(path.join(dir, "clip.log"), "");
}

/** Choose what the next `pbpaste` call does: its mode and, for "fixture", the exact text it prints. */
export function setPbpaste(dir, { mode = "fixture", text = "" }) {
  if (!PBPASTE_MODES.includes(mode)) throw new Error(`unknown pbpaste mode ${mode}`);
  fs.writeFileSync(path.join(dir, "pbpaste.fixture"), text);
  fs.writeFileSync(path.join(dir, "pbpaste.mode"), `${mode}\n`);
}

const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

/** Number of lines now in a shim log (a case's start mark). */
export function logLength(dir, which) {
  return lines(path.join(dir, which === "pbpaste" ? "pbpaste.log" : "clip.log")).length;
}

function fields(line) {
  const [epoch, name, ...rest] = line.split(" ");
  const kv = Object.fromEntries(rest.map((p) => p.split("=")).filter((p) => p.length === 2));
  return { epoch: Number(epoch), name, ...kv };
}

/** pbpaste calls logged after line `from`. */
export function pbpasteCallsSince(dir, from) {
  return lines(path.join(dir, "pbpaste.log")).slice(from).map(fields);
}

/** Writer-shim calls after line `from`, each with the bytes it received read back as strict UTF-8 text (or null). */
export function writerCallsSince(dir, from) {
  return lines(path.join(dir, "clip.log")).slice(from).map((line) => {
    const f = fields(line);
    const buf = fs.readFileSync(path.join(dir, "captured", f.file));
    return { name: f.name, argc: Number(f.argc), bytes: Number(f.bytes), sha: f.sha, text: strictUtf8(buf) };
  });
}

/**
 * The capture files against the writers' log lines. Every writer call must leave
 * both: the file under captured/ (the bytes it received) and one line in clip.log
 * naming it. A file with no line is a write that no case window can attribute; a
 * line with no file is a lost capture; two lines naming one file mean one write
 * overwrote another (the file number is taken from the directory listing).
 */
export function captureAccounting(dir) {
  const folder = path.join(dir, "captured");
  const files = fs.existsSync(folder) ? fs.readdirSync(folder).filter((f) => f.endsWith(".bin")).sort() : [];
  const logged = lines(path.join(dir, "clip.log")).map((line) => fields(line).file).filter(Boolean);
  const unlogged = files.filter((f) => !logged.includes(f));
  const missing = [...new Set(logged.filter((f) => !files.includes(f)))];
  const duplicated = [...new Set(logged.filter((f, i) => logged.indexOf(f) !== i))];
  return { files: files.length, loggedLines: logged.length, unlogged, missing, duplicated, ok: unlogged.length + missing.length + duplicated.length === 0 };
}

/** Decode strictly; null when the bytes are not valid UTF-8. */
export function strictUtf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}
