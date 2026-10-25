#!/usr/bin/env node
// The sealed live pass of /cc, in three stages (each its own invocation, so a
// long stage can run in the background and be polled):
//
//   node realrender/live.mjs controls --out DIR
//        Seatbelt positive and negative controls -> DIR/controls.json
//   node realrender/live.mjs width --width 60 --out DIR --holdout DIR [--results FILE] [--limit N] [--repo PLUGIN_SOURCE] [--profile default|warp]
//        one sealed launch, every planned case -> DIR/w<W>/results.json
//   node realrender/live.mjs summary --out DIR --clip-before HASH --clip-after HASH
//        applies the pre-registered rule (version 1) -> DIR/summary.json, prints the verdict
//
// Rule version 2 adds three stages:
//
//   node realrender/live.mjs clip --out DIR --label before|after
//        the ONLY read of the real clipboard: pbpaste piped into shasum, the hash
//        is logged and printed, nothing else. Exactly two are allowed (clipboard-hash.mjs).
//   node realrender/live.mjs turn --out DIR [--repo PLUGIN_SOURCE]
//        the control launch: unicode probe + positive control for "no model turn"
//   node realrender/live.mjs summary --out DIR --rule-version 2 [--rule FILE]
//        reads DIR/clip-log.jsonl and DIR/control/results.json
//
// Every stage but `clip` never reads the real clipboard; with version 1 the two
// hashes come from the operator.
//
// --profile default|warp (width, turn, controls, clip) names the terminal the
// launch pretends to run in (lib/profile.mjs). It is written into every evidence
// file of the stage, and `summary` refuses launches that ran under different profiles.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runControls } from "./lib/controls.mjs";
import { readLog, summarizeReads, takeHash } from "./lib/clipboard-hash.mjs";
import { requireHoldout } from "./lib/holdout.mjs";
import { runControlLaunch } from "./lib/live-control.mjs";
import { LIVE_RULE, applyLiveRule } from "./lib/live-rule.mjs";
import { LIVE_RULE_2, applyLiveRule2 } from "./lib/live-rule-2.mjs";
import { parseProfile, profileRecord } from "./lib/profile.mjs";
import { runWidth } from "./lib/live-run.mjs";
import { buildSummary, buildSummary2, launchProfile } from "./lib/live-summary.mjs";
import { moveToTrash } from "./lib/teardown.mjs";
import { FAMILY_B } from "./lib/templates-b.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function parse(argv) {
  const [stage, ...rest] = argv;
  const o = { stage };
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i].replace(/^--/, "");
    if (rest[i + 1] === undefined) throw new Error(`flag ${rest[i]} needs a value`);
    o[key] = rest[i + 1];
  }
  if (!["controls", "width", "summary", "clip", "turn"].includes(stage) || !o.out) throw new Error("usage: live.mjs controls|width|summary|clip|turn --out DIR ...");
  o.profile = parseProfile(o.profile);
  return o;
}

const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

async function stageControls(o) {
  const dir = fs.mkdtempSync("/tmp/cbctl.");
  const result = await runControls({ dir: fs.realpathSync(dir) });
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, "controls.json"), `${JSON.stringify({ ...profileRecord(o.profile), ...result }, null, 1)}\n`);
  for (const c of result.controls) process.stdout.write(`${c.ok ? "HOLDS " : "BROKEN"} ${c.id}: ${c.what} [${c.detail}]\n`);
  process.stdout.write(`CONTROLS ${result.ok ? "ALL HOLD" : "FAILED"} ${result.failures.join("; ")}\n`);
  process.stdout.write(`scratch ${moveToTrash(dir)}\n`);
  process.exitCode = result.ok ? 0 : 5;
}

async function stageWidth(o) {
  const holdoutDir = requireHoldout(o.holdout);
  const corpus = JSON.parse(fs.readFileSync(path.join(holdoutDir, "corpus.json"), "utf8"));
  const holdout = JSON.parse(fs.readFileSync(path.join(holdoutDir, o.results ?? "results-holdout.json"), "utf8"));
  const width = Number(o.width);
  if (!LIVE_RULE.widths.includes(width)) throw new Error(`width must be one of ${LIVE_RULE.widths}`);
  const records = holdout.records.filter((r) => r.width === width);
  const out = await runWidth({
    width, corpus, records, evidenceDir: path.resolve(o.out), limit: o.limit ? Number(o.limit) : undefined, repo: o.repo, profile: o.profile,
    log: (line) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`),
  });
  const ran = out.cases?.length ?? 0;
  process.stdout.write(`w${width}: drawn=${out.drawn} cases=${ran}/${out.planned ?? 0} error=${out.error ?? "none"} stub=${out.stub?.requests} teardown=${JSON.stringify(out.teardown)}\n`);
  process.exitCode = out.drawn && !out.error ? 0 : 4;
}

async function stageClip(o) {
  fs.mkdirSync(o.out, { recursive: true });
  const hash = takeHash({ file: path.join(o.out, "clip-log.jsonl"), label: o.label, profile: o.profile });
  process.stdout.write(`${o.label} ${hash}\n`);
}

async function stageTurn(o) {
  const out = await runControlLaunch({
    evidenceDir: path.resolve(o.out), repo: o.repo, profile: o.profile,
    log: (line) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${line}\n`),
  });
  const ran = out.cases?.length ?? 0;
  process.stdout.write(`control: drawn=${out.drawn} cases=${ran}/${out.planned ?? 0} error=${out.error ?? "none"} ${out.control?.detail ?? ""} teardown=${JSON.stringify(out.teardown)}\n`);
  process.exitCode = out.drawn && !out.error ? 0 : 4;
}

function readLaunches(dir) {
  return LIVE_RULE.widths.flatMap((w) => {
    const file = path.join(dir, `w${w}`, "results.json");
    return fs.existsSync(file) ? [JSON.parse(fs.readFileSync(file, "utf8"))] : [];
  });
}

/**
 * The summary and verdict of version 1 (hashes from the operator) or version 2 (hashes from the counted log).
 * The terminal profile comes from the launches (and the control launch); controls.json records its own
 * but is not compared: the sandbox controls do not depend on which terminal Claude Code believes it runs in.
 */
function judge(o, dir) {
  const launches = readLaunches(dir);
  const controls = JSON.parse(fs.readFileSync(path.join(dir, "controls.json"), "utf8"));
  const classesRequired = FAMILY_B.classes.filter((c) => c !== "table");
  if (o["rule-version"] !== "2") {
    const summary = { ...launchProfile(launches), ...buildSummary({ launches, controls, clipboardBefore: o["clip-before"], clipboardAfter: o["clip-after"], classesRequired }) };
    return { summary, verdict: applyLiveRule(summary), ruleFiles: ["live-rule.mjs"] };
  }
  const controlFile = path.join(dir, "control", "results.json");
  const controlLaunch = fs.existsSync(controlFile) ? JSON.parse(fs.readFileSync(controlFile, "utf8")) : null;
  const clip = summarizeReads(readLog(path.join(dir, "clip-log.jsonl")));
  const summary = { ...launchProfile([...launches, ...(controlLaunch ? [controlLaunch] : [])]), ...buildSummary2({ launches, controls, classesRequired, controlLaunch, clip }) };
  return { summary, verdict: applyLiveRule2(summary), ruleFiles: ["live-rule.mjs", "live-rule-2.mjs"], rule2: LIVE_RULE_2 };
}

function stageSummary(o) {
  const dir = path.resolve(o.out);
  const { summary, verdict, ruleFiles } = judge(o, dir);
  const lib = (name) => path.join(HERE, "lib", name);
  const ordering = {
    liveRuleMd: o.rule ? { file: o.rule, sha256: sha(o.rule), mtime: fs.statSync(o.rule).mtime.toISOString() } : null,
    ruleCode: ruleFiles.map((name) => ({ file: `realrender/lib/${name}`, sha256: sha(lib(name)), mtime: fs.statSync(lib(name)).mtime.toISOString() })),
  };
  fs.writeFileSync(path.join(dir, "summary.json"), `${JSON.stringify({ summary, verdict, ordering }, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(summary, null, 1)}\n`);
  for (const c of verdict.checks) process.stdout.write(`${c.ok ? "PASS" : "FAIL"} ${c.n} ${c.name}: ${c.detail}\n`);
  process.stdout.write(`VERDICT ${verdict.verdict} ${verdict.reasons.join("; ")}\n`);
  process.exitCode = verdict.verdict === "LIVE PASS" ? 0 : 6;
}

const o = parse(process.argv.slice(2));
const stages = { controls: stageControls, width: stageWidth, clip: stageClip, turn: stageTurn, summary: stageSummary };
await stages[o.stage](o);
