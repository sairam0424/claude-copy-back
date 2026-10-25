#!/usr/bin/env node
// Write or check a freeze record: the hashes of the rule files, the generator,
// the matcher and the plugin tree a measurement is about to be taken against,
// with the recipe of every digest inside the file (lib/freeze.mjs).
//
//   node realrender/freeze.mjs --out FILE [--profile default|warp] [--rule PATH]... [--parts src,hooks,...] [--claude-version V] [--note TEXT]
//   node realrender/freeze.mjs --verify FILE
//
// --rule paths are relative to the repository root. --parts names the folders that make
// the tree digest (default: the plugin as the live pass loads it, .claude-plugin,hooks,src;
// a screen-proxy holdout needs only src). --verify recomputes every digest from the
// repository and prints what differs (exit 1), or "freeze ok".

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATOR_FILES } from "./capture.mjs";
import { buildFreeze, verifyFreeze } from "./lib/freeze.mjs";
import { parseProfile } from "./lib/profile.mjs";
import { PLUGIN_PARTS } from "./lib/live-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALUED = new Set(["out", "profile", "rule", "parts", "claude-version", "note", "verify"]);

/** Parse the flags; --rule may repeat. Exported for the tests. */
export function parseFreezeArgs(argv) {
  const o = { rule: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = (argv[i] ?? "").replace(/^--/, "");
    if (!VALUED.has(key) || argv[i + 1] === undefined) throw new Error(`bad flag ${argv[i]}`);
    if (key === "rule") o.rule.push(argv[i + 1]);
    else o[key] = argv[i + 1];
  }
  if (!o.out && !o.verify) throw new Error("need --out FILE or --verify FILE");
  o.profile = parseProfile(o.profile);
  o.parts = o.parts === undefined ? undefined : o.parts.split(",").filter(Boolean);
  return o;
}

function main() {
  const o = parseFreezeArgs(process.argv.slice(2));
  if (o.verify) {
    const result = verifyFreeze(JSON.parse(fs.readFileSync(o.verify, "utf8")), ROOT);
    process.stdout.write(result.ok ? "freeze ok\n" : `${result.mismatches.join("\n")}\n`);
    process.exitCode = result.ok ? 0 : 1;
    return;
  }
  const freeze = buildFreeze({
    root: ROOT, parts: o.parts ?? PLUGIN_PARTS, ruleFiles: o.rule, generatorFiles: GENERATOR_FILES.map((n) => `realrender/lib/${n}.mjs`),
    profile: o.profile, claudeVersion: o["claude-version"], note: o.note,
  });
  fs.mkdirSync(path.dirname(path.resolve(o.out)), { recursive: true });
  fs.writeFileSync(o.out, `${JSON.stringify(freeze, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify({ out: o.out, frozenAt: freeze.frozenAt, treeSha256: freeze.pluginTree.treeSha256, matcherSha256: freeze.matcher.sha256, rule: freeze.rule.files.map((f) => `${f.path} ${f.sha256}`) }, null, 1)}\n`);
}

if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
