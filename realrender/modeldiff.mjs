#!/usr/bin/env node
// CALIBRATION TOOL: diff the matcher's model of every message against the real
// screen, character by character (whitespace folded). It reads screens, so it
// REFUSES a holdout set: nothing may be tuned on the holdout.
//
//   node realrender/modeldiff.mjs --set DIR [--widths 60,80,100,120] [--show 20] [--hunks 1 [--top 40]]
//
// --hunks lists EVERY difference of every message (not only the first), grouped
// by what it says (tokens, counters and URLs normalised), most frequent first.
// The model is drawn the way the set's terminal profile is drawn (capture-summary.json:
// warp or default; --drawing warp|default overrides it).
//
// Messages with a table are skipped (tables are a non-goal and drawn as boxes).

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_DRAWING, WARP_DRAWING } from "../src/core/drawing.ts";
import { projectText } from "../src/core/project.ts";
import { clusterHunks, compareMessage, diffHunks, holdoutReason, messageRegions, regionText } from "./lib/modeldiff.mjs";
import { rowsOf } from "./lib/screen.mjs";

function args(argv) {
  const o = { widths: "60,80,100,120", show: "20" };
  for (let i = 0; i < argv.length; i += 2) o[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!o.set) throw new Error("need --set DIR");
  return o;
}

function refuseHoldout(dir, corpus) {
  const why = holdoutReason({ name: path.basename(path.resolve(dir)), hasHoldoutResults: fs.existsSync(path.join(dir, "results-holdout.json")), corpus });
  if (why) throw new Error(`modeldiff is a calibration tool and refuses a holdout set (${why})`);
}

const DRAWINGS = { default: DEFAULT_DRAWING, warp: WARP_DRAWING };

/** The drawing to model: --drawing, else the profile the set was captured under, else the default. */
function drawingOf(dir, name) {
  const file = path.join(dir, "capture-summary.json");
  const recorded = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).profile : undefined;
  const chosen = name ?? recorded ?? "default";
  if (!DRAWINGS[chosen]) throw new Error(`unknown drawing "${chosen}"`);
  return DRAWINGS[chosen];
}

function diffWidth(corpus, dir, width, drawing) {
  const rows = rowsOf(fs.readFileSync(path.join(dir, `w${width}`, `cap-w${width}-history.txt`), "utf8"));
  const regions = messageRegions(rows);
  const results = [];
  corpus.messages.forEach((m, i) => {
    if (m.blocks.some((b) => b.kind === "table")) return results.push({ index: i, status: "skipped-table" });
    const region = regions[i];
    if (!region) return results.push({ index: i, status: "no-region" });
    const model = projectText(m.text, undefined, drawing).projected;
    const screen = regionText(rows, region);
    results.push({ index: i, ...compareMessage(model, screen), hunks: diffHunks(model, screen) });
  });
  return { width, regions: regions.length, results };
}

function printHunks(out, o) {
  const rows = out.flatMap(({ width, results }) => results.filter((r) => r.hunks?.length).map((r) => ({ width, message: r.index, hunks: r.hunks })));
  const clusters = clusterHunks(rows);
  process.stdout.write(`${rows.reduce((n, r) => n + r.hunks.length, 0)} differences in ${rows.length} (width, message) pairs, ${clusters.length} kinds\n`);
  for (const c of clusters.slice(0, Number(o.top ?? 40))) {
    process.stdout.write(`${String(c.count).padStart(5)}  model ${JSON.stringify(c.model)}  screen ${JSON.stringify(c.screen)}  e.g. w${c.example.width} msg ${c.example.message} after ${JSON.stringify(c.example.before)} before ${JSON.stringify(c.example.after)}\n`);
  }
}

function main() {
  const o = args(process.argv.slice(2));
  const corpus = JSON.parse(fs.readFileSync(path.join(o.set, "corpus.json"), "utf8"));
  refuseHoldout(o.set, corpus);
  const drawing = drawingOf(o.set, o.drawing);
  const out = o.widths.split(",").map((w) => diffWidth(corpus, o.set, Number(w), drawing));
  for (const { width, regions, results } of out) {
    const count = (s) => results.filter((r) => r.status === s).length;
    process.stdout.write(`width ${width}: regions ${regions}, same ${count("same")}, wrap-only ${count("wrap-only")}, differs ${count("differs")}, skipped-table ${count("skipped-table")}, no-region ${count("no-region")}\n`);
  }
  if (o.hunks !== undefined) return printHunks(out, o);
  let shown = 0;
  for (const { width, results } of out) {
    for (const r of results.filter((x) => x.status === "differs")) {
      if (shown++ >= Number(o.show)) break;
      process.stdout.write(`[${width}] msg ${r.index} ${corpus.messages[r.index].plan.join(",")}\n   model  ${JSON.stringify(r.model)}\n   screen ${JSON.stringify(r.screen)}\n`);
    }
  }
}

main();
