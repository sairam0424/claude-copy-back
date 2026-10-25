#!/usr/bin/env node
// Score one captured set against the matcher.
//
//   node realrender/measure.mjs --set DIR --role calibration|holdout --seed N
//        [--per-width 40] [--show 25] [--discard "reason"] [--rule 3 [--profile warp|default] [--freeze freeze.json]]
//
// DIR holds corpus.json and w<W>/cap-w<W>-history.txt (from capture.mjs).
// Writes DIR/results-<role>.json. A HOLDOUT is scored ONCE: if the results
// file exists the run refuses, unless --discard "reason" is given, which moves
// the old results aside, logs the reason and scores again (a new holdout must
// have been captured first; see the report).
//
// --rule 3 applies pre-registered rule 3 (lib/rule3.mjs) instead of the older rule:
// --profile names the terminal profile being JUDGED and must match the one recorded
// in DIR/capture-summary.json (else the verdict is INCONCLUSIVE). --freeze FILE is the
// freeze record (realrender/freeze.mjs) made before the capture: the verdict is
// INCONCLUSIVE unless the matcher that scores has the digest recorded in it. Every
// results file records the profile the screens were captured under.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessage, TWIN_SHIFT } from "./lib/corpus-set.mjs";
import { scoreRows } from "./lib/runner.mjs";
import { matcherDigest } from "./lib/freeze.mjs";
import { guardHoldout } from "./lib/guard.mjs";
import { applyRule, RULE } from "./lib/rule.mjs";
import { rowsOf } from "./lib/screen.mjs";
import { summarize, tableText } from "./lib/score.mjs";
import { FAMILY_A } from "./lib/templates-a.mjs";
import { FAMILY_B } from "./lib/templates-b.mjs";
import { FAMILY_C } from "./lib/templates-c.mjs";
import { applyRule3, capturedProfile, ruleInput3 } from "./lib/measure3.mjs";

const FAMILIES = { A: FAMILY_A, B: FAMILY_B, C: FAMILY_C };
const CORE = new URL("../src/core/", import.meta.url);

function args(argv) {
  const o = { "per-width": "40", show: "25" };
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!o.set || !["calibration", "holdout"].includes(o.role) || !o.seed) throw new Error("need --set DIR --role calibration|holdout --seed N");
  return o;
}

/** sha256 over every src/core file: the "frozen matcher" evidence (the recipe is written in lib/freeze.mjs). */
const matcherHash = () => matcherDigest(fileURLToPath(CORE));

function twinTexts(family, corpus) {
  return corpus.messages.map((m) => buildMessage(family, { seed: corpus.seed, index: m.index, tokenStart: m.tokenStart + TWIN_SHIFT }).text);
}

function scoreWidth({ corpus, family, twins, width, o }) {
  const file = path.join(o.set, `w${width}`, `cap-w${width}-history.txt`);
  const rows = rowsOf(fs.readFileSync(file, "utf8"));
  const classes = family.classes.filter((c) => c !== "table");
  return scoreRows({ messages: corpus.messages, twins, rows, width, seed: Number(o.seed), count: Number(o["per-width"]), classes });
}

function ruleInput(records, perWidth, classes, locates) {
  const count = (pick) => records.filter(pick).length;
  const perConstruct = {};
  for (const r of records) perConstruct[r.anchor] = (perConstruct[r.anchor] ?? 0) + 1;
  return {
    rendered: Object.values(locates).every((l) => l.locatable / l.tokens >= 0.9),
    total: records.length, perWidth, perConstruct, constructsPresent: classes,
    exact: count((r) => r.kind === "exact"), wrongSlice: count((r) => r.kind === "wrong-slice"),
    controlFalsePositives: count((r) => r.control.falsePositive),
  };
}

function show(records, limit) {
  const bad = records.filter((r) => r.kind !== "exact").slice(0, limit);
  const one = (s) => JSON.stringify(s.length > 160 ? `${s.slice(0, 160)}...` : s);
  return bad.map((r) => `[${r.width}] msg ${r.message} ${r.anchor} covers=${r.covers.join("+")} feat=${r.features.join("+")} -> ${r.kind}\n   expected ${one(r.expected)}\n   copied   ${one(r.copied)}`).join("\n");
}

function readJsonIfThere(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
}

function main() {
  const o = args(process.argv.slice(2));
  const resultsFile = path.join(o.set, `results-${o.role}.json`);
  const guarded = guardHoldout({ role: o.role, setDir: o.set, resultsFile, discard: o.discard });
  const captureSummary = readJsonIfThere(path.join(o.set, "capture-summary.json"));
  const corpus = JSON.parse(fs.readFileSync(path.join(o.set, "corpus.json"), "utf8"));
  const family = FAMILIES[corpus.family];
  const twins = twinTexts(family, corpus);
  const records = [];
  const locates = {};
  const perWidth = {};
  const widths = o.widths ? o.widths.split(",").map(Number) : RULE.widths; // --widths is for smoke tests only
  for (const width of widths) {
    const r = scoreWidth({ corpus, family, twins, width, o });
    records.push(...r.records);
    locates[width] = r.locate;
    perWidth[width] = r.records.length;
  }
  const classes = family.classes.filter((c) => c !== "table");
  const profile = capturedProfile(captureSummary);
  const matcherSha = matcherHash();
  const freeze = o.freeze ? JSON.parse(fs.readFileSync(o.freeze, "utf8")) : null;
  const rule = o.rule === "3"
    ? applyRule3(ruleInput3({ records, locates, captureSummary, profile: o.profile ?? profile, seed: Number(o.seed), discards: guarded.discarded, freeze, matcherSha }))
    : applyRule(ruleInput(records, perWidth, classes, locates));
  const padRecords = records.map((r) => ({ ...r, kind: r.padded.kind }));
  const out = { role: o.role, seed: Number(o.seed), family: corpus.family, profile, matcherSha, locates, rule, summary: summarize(records), paddedSummary: summarize(padRecords), paddedFalsePositives: records.filter((r) => r.padded.control.falsePositive).length, records };
  fs.writeFileSync(resultsFile, `${JSON.stringify(out, null, 1)}\n`);
  report(out, records, Number(o.show));
}

/** Rule 3's classes (anchor and feature), main and padded: exact over total. */
function classTable(rule) {
  if (!rule.classes || Object.keys(rule.classes).length === 0) return "";
  const rows = Object.keys(rule.classes).sort().map((name) => {
    const m = rule.classes[name];
    const p = rule.padded?.classes?.[name];
    return `  ${name.padEnd(24)} ${String(m.exact).padStart(4)}/${String(m.total).padEnd(4)} padded ${p ? `${p.exact}/${p.total}` : "-"}`;
  });
  return `by rule-3 class (exact/total)\n${rows.join("\n")}`;
}

function report(out, records, limit) {
  const s = out.summary;
  const lines = [`ROLE ${out.role} seed ${out.seed} family ${out.family} profile ${out.profile} matcher ${out.matcherSha.slice(0, 12)}`, `RULE ${out.rule.verdict} ${out.rule.reasons.join("; ")}`, classTable(out.rule),
    JSON.stringify(out.locates), tableText("by width", s.width), tableText("by anchor construct", s.anchor), tableText("by covered construct", s.covers),
    tableText("by inline feature covered", s.features), tableText("by start", s.startMode), tableText("by end", s.endMode), tableText("by length", s.length), tableText("by wrap", s.wrap),
    `OVERALL ${JSON.stringify(s.overall)}`, `PADDED  ${JSON.stringify(out.paddedSummary.overall)} paddedControlFP ${out.paddedFalsePositives}`,
    `CONTROL FP main ${records.filter((r) => r.control.falsePositive).length} (without ${records.filter((r) => r.control.withoutOk).length}, twin ${records.filter((r) => r.control.twinOk).length})`,
    show(records, limit)];
  process.stdout.write(`${lines.join("\n")}\n`);
}

main();
