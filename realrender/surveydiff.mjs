#!/usr/bin/env node
// CALIBRATION TOOL: the same model-versus-screen diff as modeldiff.mjs, on the
// rig's earlier survey screens (rig-evidence/<label>/cap-w100-plain.txt), which
// hold constructs the generated sets may not (setext headings, nested quotes,
// loose and task lists, "1)" lists).
//
//   node realrender/surveydiff.mjs --capture PATH_TO_cap-w100-plain.txt

import fs from "node:fs";
import { projectText } from "../src/core/project.ts";
import { surveyTurns } from "./lib/corpus.mjs";
import { compareMessage, messageRegions, regionText } from "./lib/modeldiff.mjs";
import { rowsOf } from "./lib/screen.mjs";

const at = process.argv.indexOf("--capture");
if (at < 0 || !process.argv[at + 1]) throw new Error("need --capture PATH");
const rows = rowsOf(fs.readFileSync(process.argv[at + 1], "utf8"));
const regions = messageRegions(rows);
const texts = surveyTurns().turns.filter((t) => t.role === "assistant").map((t) => t.text);
texts.forEach((text, i) => {
  const hasTable = /^\|.*\|\s*\n\|[-| :]+\|/m.test(text);
  const result = !regions[i] ? { status: "no-region" } : hasTable ? { status: "skipped-table" } : compareMessage(projectText(text).projected, regionText(rows, regions[i]));
  process.stdout.write(`message ${i}: ${result.status}${result.status === "differs" ? `\n   model  ${JSON.stringify(result.model)}\n   screen ${JSON.stringify(result.screen)}` : ""}\n`);
});
