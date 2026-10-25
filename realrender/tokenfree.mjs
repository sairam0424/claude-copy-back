#!/usr/bin/env node
// TOKEN-FREE STRESS over a captured set (lib/tokenfree.mjs): copies of the words between
// two tokens, cut from the real screens, against the whole window. They hold nothing that
// pins them to one message, so twins and repeated phrases are real competitors. Reports
// counts only; a wrong or picked-wrong answer is the dangerous kind.
//
//   node realrender/tokenfree.mjs --set DIR [--widths 60,80,100,120] [--out FILE] [--after-verdict yes] [--gate yes]
//
// A calibration set is read freely. A holdout set is refused unless --after-verdict yes
// says its rule verdict is already recorded: this is a report, never a tuning aid.
// --gate yes makes it the never-guess gate of the release process (rule 3 cannot see a
// matcher that guesses): exit 1 on any wrong or picked-wrong answer, or on a set too
// small or with too few contested cases to mean anything (lib/tokenfree.mjs, GATE).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { holdoutReason } from "./lib/modeldiff.mjs";
import { capturedProfile } from "./lib/measure3.mjs";
import { gateVerdict, tokenFreeRun } from "./lib/tokenfree.mjs";

const VALUED = new Set(["set", "widths", "out", "after-verdict", "gate"]);

/** Parse the flags. Exported for the tests. */
export function parseTokenFreeArgs(argv) {
  const o = { widths: "60,80,100,120" };
  for (let i = 0; i < argv.length; i += 2) {
    const key = (argv[i] ?? "").replace(/^--/, "");
    if (!VALUED.has(key) || argv[i + 1] === undefined) throw new Error(`bad flag ${argv[i]}`);
    o[key] = argv[i + 1];
  }
  if (!o.set) throw new Error("need --set DIR");
  if (o.gate !== undefined && o.gate !== "yes") throw new Error("--gate takes yes");
  o.widths = o.widths.split(",").map(Number);
  return o;
}

function main() {
  const o = parseTokenFreeArgs(process.argv.slice(2));
  const corpus = JSON.parse(fs.readFileSync(path.join(o.set, "corpus.json"), "utf8"));
  const why = holdoutReason({ name: path.basename(path.resolve(o.set)), hasHoldoutResults: fs.existsSync(path.join(o.set, "results-holdout.json")), corpus });
  if (why !== null && o["after-verdict"] !== "yes") throw new Error(`a holdout set is read only after its verdict is recorded (${why}); pass --after-verdict yes`);
  const screens = Object.fromEntries(o.widths.map((w) => [w, fs.readFileSync(path.join(o.set, `w${w}`, `cap-w${w}-history.txt`), "utf8")]));
  const run = tokenFreeRun({ messages: corpus.messages, screens });
  const byWidth = Object.fromEntries(o.widths.map((w) => [w, tokenFreeRun({ messages: corpus.messages, screens: { [w]: screens[w] } }).summary]));
  const summaryFile = path.join(o.set, "capture-summary.json");
  const profile = capturedProfile(fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, "utf8")) : null);
  const line = { set: path.basename(path.resolve(o.set)), seed: corpus.seed, family: corpus.family, profile, widths: o.widths, summary: run.summary, byWidth };
  if (o.out) fs.writeFileSync(o.out, `${JSON.stringify({ ...line, rows: run.rows }, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(line)}\n`);
  if (o.gate === "yes") {
    const verdict = gateVerdict(run.summary);
    process.stderr.write(`tokenfree gate: ${verdict.pass ? "PASS" : `FAIL: ${verdict.failures.join("; ")}`}\n`);
    process.exitCode = verdict.pass ? 0 : 1;
  }
}

if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
