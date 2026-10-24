#!/usr/bin/env node
// Sealed render rig: resume a SYNTHETIC session in the installed Claude Code,
// inside tmux on the dedicated socket "cbrender", under `env -i` with an
// isolated HOME and a local stub as the API base, then capture the screen.
//
//   node realrender/rig.mjs --out DIR [--label NAME] [--mode default|fullscreen|classic]
//        [--width 100] [--height 300] [--resize 60,80,120] [--settle-ms 1500]
//        [--idle-ms 10000] [--drop theme,trust,...] [--env KEY=VALUE]... [--keep]
//
// Exit 0 when the conversation was drawn and no non-loopback socket was seen;
// 3 when it was drawn but a non-loopback socket WAS seen (rig not sealed);
// 4 when the conversation was not drawn; 2 on a usage error.

import fs from "node:fs";
import path from "node:path";
import { DROPPABLE, MODES } from "./lib/config.mjs";
import { runRig } from "./lib/run.mjs";

const FLAGS = new Set([
  "out", "label", "mode", "width", "height", "resize", "settle-ms", "idle-ms",
  "startup-ms", "draw-timeout-ms", "sample-ms", "drop", "env", "claude", "keep",
]);

function usage(message) {
  process.stderr.write(`rig: ${message}\n`);
  process.exit(2);
}

/** Parse "--flag value" pairs (and bare --keep) into a plain object; --env may repeat. */
export function parseArgs(argv) {
  const raw = { env: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i].replace(/^--/, "");
    if (!argv[i].startsWith("--") || !FLAGS.has(flag)) throw new Error(`unknown argument ${argv[i]}`);
    if (flag === "keep") raw.keep = true;
    else if (i + 1 >= argv.length) throw new Error(`--${flag} needs a value`);
    else if (flag === "env") raw.env.push(argv[++i]);
    else raw[flag] = argv[++i];
  }
  return raw;
}

const list = (text) => (text ? text.split(",").map((s) => s.trim()).filter(Boolean) : []);

/** Turn parsed flags into the options runRig wants, validating each. */
export function toOptions(raw) {
  const mode = raw.mode ?? "default";
  if (!MODES.includes(mode)) throw new Error(`--mode must be one of ${MODES.join(", ")}`);
  const drop = list(raw.drop);
  const unknown = drop.filter((k) => !DROPPABLE.includes(k));
  if (unknown.length) throw new Error(`--drop: unknown key ${unknown[0]} (known: ${DROPPABLE.join(", ")})`);
  const extraEnv = raw.env.map((pair) => {
    const at = pair.indexOf("=");
    if (at < 1) throw new Error(`--env needs KEY=VALUE, got ${pair}`);
    return [pair.slice(0, at), pair.slice(at + 1)];
  });
  const num = (key, fallback) => (raw[key] === undefined ? fallback : Number(raw[key]));
  return {
    mode, drop, extraEnv, claude: raw.claude, keep: Boolean(raw.keep),
    out: raw.out ? path.resolve(raw.out) : null,
    label: raw.label ?? `${mode}-w${num("width", 100)}`,
    width: num("width", 100), height: num("height", 300),
    resize: list(raw.resize).map(Number),
    settleMs: num("settle-ms", 1500), idleMs: num("idle-ms", 10_000),
    startupMs: num("startup-ms", 30_000), drawTimeoutMs: num("draw-timeout-ms", 60_000),
    sampleMs: num("sample-ms", 200), history: mode === "classic",
  };
}

/** Everything except the bulky per-capture text, for stdout. */
function brief(result) {
  const { captures = [], ...rest } = result;
  return { ...rest, captures: captures.map((c) => ({ tag: c.tag, rows: c.rowCount, sha: c.sha, dialogs: c.dialogs, banner: c.banner, facts: c.facts })) };
}

function exitCode(result) {
  if (!result.drawn) return 4;
  return result.network?.externalRemotes?.length ? 3 : 0;
}

async function main() {
  let options;
  try {
    options = toOptions(parseArgs(process.argv.slice(2)));
  } catch (error) {
    usage(error.message);
  }
  const result = await runRig(options);
  if (result.evidence) {
    fs.writeFileSync(path.join(result.evidence, "summary.json"), `${JSON.stringify(brief(result), null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(brief(result), null, 2)}\n`);
  process.exitCode = exitCode(result);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
