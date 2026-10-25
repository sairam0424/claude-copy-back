#!/usr/bin/env node
// Capture step of the real-render proxy: build a synthetic window of 40
// assistant messages (ground truth included), then show it in the REAL Claude
// Code through the sealed rig, once per terminal width, and keep the screens.
//
//   node realrender/capture.mjs --family A|B|C --seed N --out DIR
//        [--widths 60,80,100,120] [--mode classic|default] [--height 50]
//        [--resize 60,80,120] [--idle-ms 4000] [--profile default|warp]
//
// --resize is applied to the FIRST width's launch only: it records the screens
// after a live resize so they can be compared with fresh launches.
// Writes DIR/corpus.json, DIR/w<W>/ (the rig's evidence for each launch) and
// DIR/capture-summary.json. One launch per width takes about 20 seconds.
// --profile names the terminal the rig pretends to run in (lib/profile.mjs); it
// is recorded in capture-summary.json and in each launch's summary.json.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentinelOf, sessionTurns, buildSet } from "./lib/corpus-set.mjs";
import { FAMILY_A } from "./lib/templates-a.mjs";
import { FAMILY_B } from "./lib/templates-b.mjs";
import { FAMILY_C } from "./lib/templates-c.mjs";
import { parseProfile, profileRecord } from "./lib/profile.mjs";
import { runRig } from "./lib/run.mjs";

const FAMILIES = { A: FAMILY_A, B: FAMILY_B, C: FAMILY_C };
export const GENERATOR_FILES = ["gen-core", "gen-text", "prng", "corpus-set", "templates-a", "templates-b", "templates-c", "templates-c-inline", "spans"];

const FLAGS = ["family", "seed", "out", "widths", "mode", "height", "resize", "idle", "profile"];

/** Parse the command line (exported for the tests). */
export function parse(argv) {
  const o = { widths: "60,80,100,120", mode: "classic", height: "50", resize: "", idle: "4000" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "").replace(/-ms$/, "");
    if (!FLAGS.includes(key) || argv[i + 1] === undefined) throw new Error(`bad flag ${argv[i]}`);
    o[key] = argv[i + 1];
  }
  if (!FAMILIES[o.family] || !o.seed || !o.out) throw new Error("need --family A|B|C --seed N --out DIR");
  o.profile = parseProfile(o.profile);
  return o;
}

const numbers = (text) => (text ? text.split(",").map(Number) : []);

function generatorSha() {
  const hash = createHash("sha256");
  for (const name of GENERATOR_FILES) hash.update(fs.readFileSync(new URL(`./lib/${name}.mjs`, import.meta.url)));
  return hash.digest("hex");
}

/** The options of one launch (exported for the tests). */
export function rigOptions(o, set, width, first) {
  return {
    mode: o.mode, drop: [], extraEnv: [], keep: false, profile: o.profile,
    out: path.resolve(o.out), label: `w${width}`, width, height: Number(o.height),
    resize: first ? numbers(o.resize) : [],
    settleMs: 1500, idleMs: Number(o.idle), startupMs: 30_000, drawTimeoutMs: 240_000, sampleMs: 200,
    history: o.mode === "classic",
    survey: { turns: sessionTurns(set), sentinel: sentinelOf(set) },
  };
}

function brief(result) {
  const { captures = [], ...rest } = result;
  return { ...rest, captures: captures.map((c) => ({ tag: c.tag, rows: c.rowCount, sha: c.sha, dialogs: c.dialogs, banner: c.banner, facts: c.facts })) };
}

async function main() {
  const o = parse(process.argv.slice(2));
  const set = buildSet(FAMILIES[o.family], { seed: Number(o.seed) });
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, "corpus.json"), JSON.stringify({ ...set, generatorSha: generatorSha() }));
  const summary = { family: o.family, seed: Number(o.seed), mode: o.mode, ...profileRecord(o.profile), generatorSha: generatorSha(), launches: [] };
  const widths = numbers(o.widths);
  for (const [i, width] of widths.entries()) {
    const result = await runRig(rigOptions(o, set, width, i === 0));
    const sealed = !(result.network?.externalRemotes?.length) && (result.stub?.requests ?? 0) === 0;
    summary.launches.push({ width, profile: o.profile, drawn: Boolean(result.drawn), drawnAfterMs: result.drawnAfterMs, error: result.error, sealed, samples: result.network?.samples, socketObservations: result.network?.socketObservations, distinctRemotes: result.network?.distinctRemotes, stubRequests: result.stub?.requests, teardown: result.teardown });
    if (result.evidence) fs.writeFileSync(path.join(result.evidence, "summary.json"), `${JSON.stringify(brief(result), null, 2)}\n`);
    process.stderr.write(`w${width}: drawn=${Boolean(result.drawn)} sealed=${sealed} ${result.error ?? ""}\n`);
  }
  fs.writeFileSync(path.join(o.out, "capture-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.launches.every((l) => l.drawn && l.sealed) ? 0 : 4;
}

if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) await main();
