#!/usr/bin/env node
// CALIBRATION TOOL: diff the matcher's model of every message against the real
// screen, character by character (whitespace folded). It reads screens, so it
// REFUSES a holdout set: nothing may be tuned on the holdout.
//
//   node realrender/modeldiff.mjs --set DIR [--widths 60,80,100,120] [--show 20]
//
// Messages with a table are skipped (tables are a non-goal and drawn as boxes).

import fs from "node:fs";
import path from "node:path";
import { projectText } from "../src/core/project.ts";
import { compareMessage, messageRegions, regionText } from "./lib/modeldiff.mjs";
import { rowsOf } from "./lib/screen.mjs";

function args(argv) {
  const o = { widths: "60,80,100,120", show: "20" };
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!o.set) throw new Error("need --set DIR");
  return o;
}

function refuseHoldout(dir, corpus) {
  const name = path.basename(path.resolve(dir));
  if (/holdout/i.test(name) || fs.existsSync(path.join(dir, "results-holdout.json")) || corpus.family === "B") {
    throw new Error("modeldiff is a calibration tool and refuses a holdout set");
  }
}

function diffWidth(corpus, dir, width) {
  const rows = rowsOf(fs.readFileSync(path.join(dir, `w${width}`, `cap-w${width}-history.txt`), "utf8"));
  const regions = messageRegions(rows);
  const results = [];
  corpus.messages.forEach((m, i) => {
    if (m.blocks.some((b) => b.kind === "table")) return results.push({ index: i, status: "skipped-table" });
    const region = regions[i];
    if (!region) return results.push({ index: i, status: "no-region" });
    results.push({ index: i, ...compareMessage(projectText(m.text).projected, regionText(rows, region)) });
  });
  return { width, regions: regions.length, results };
}

function main() {
  const o = args(process.argv.slice(2));
  const corpus = JSON.parse(fs.readFileSync(path.join(o.set, "corpus.json"), "utf8"));
  refuseHoldout(o.set, corpus);
  const out = o.widths.split(",").map((w) => diffWidth(corpus, o.set, Number(w)));
  for (const { width, regions, results } of out) {
    const count = (s) => results.filter((r) => r.status === s).length;
    process.stdout.write(`width ${width}: regions ${regions}, same ${count("same")}, wrap-only ${count("wrap-only")}, differs ${count("differs")}, skipped-table ${count("skipped-table")}, no-region ${count("no-region")}\n`);
  }
  let shown = 0;
  for (const { width, results } of out) {
    for (const r of results.filter((x) => x.status === "differs")) {
      if (shown++ >= Number(o.show)) break;
      process.stdout.write(`[${width}] msg ${r.index} ${corpus.messages[r.index].plan.join(",")}\n   model  ${JSON.stringify(r.model)}\n   screen ${JSON.stringify(r.screen)}\n`);
    }
  }
}

main();
