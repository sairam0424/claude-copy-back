#!/usr/bin/env node
// REGRESSION TOOL: score the records of a saved set against its saved real screens
// with the matcher in this checkout, and say what changed against the kinds saved
// with the records. Read-only on the evidence; it writes only what --out names.
//
//   node realrender/rescore.mjs --corpus FILE --results FILE --family A|B|C \
//        --screen 60=FILE --screen 80=FILE ... [--label NAME] [--out FILE]
//
// --results is the saved results file (results-*.json, or results-holdout.json of a
// live case set): its `records` carry the spans and the generator's expected slices.
// --screen WIDTH=FILE is the saved whole-history capture of that width (cap-wN-history.txt,
// or a live pass's live-history-wN.txt). The output is one JSON line with the counts.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMessage, TWIN_SHIFT } from "./lib/corpus-set.mjs";
import { matcherDigest } from "./lib/freeze.mjs";
import { rescoreRecords, summarizeRescore } from "./lib/rescore.mjs";
import { FAMILY_A } from "./lib/templates-a.mjs";
import { FAMILY_B } from "./lib/templates-b.mjs";
import { FAMILY_C } from "./lib/templates-c.mjs";

const FAMILIES = { A: FAMILY_A, B: FAMILY_B, C: FAMILY_C };
const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "core");
const VALUED = new Set(["corpus", "results", "family", "screen", "label", "out"]);

/** Parse the flags; --screen repeats. Exported for the tests. */
export function parseRescoreArgs(argv) {
  const o = { screen: [] };
  for (let i = 0; i < argv.length; i += 2) {
    const key = (argv[i] ?? "").replace(/^--/, "");
    if (!VALUED.has(key) || argv[i + 1] === undefined) throw new Error(`bad flag ${argv[i]}`);
    if (key === "screen") o.screen.push(argv[i + 1]);
    else o[key] = argv[i + 1];
  }
  if (!o.corpus || !o.results || !FAMILIES[o.family] || o.screen.length === 0) throw new Error("need --corpus --results --family A|B|C and at least one --screen WIDTH=FILE");
  return o;
}

/** "80=/path/file.txt" -> [80, "/path/file.txt"]. */
export function parseScreen(spec) {
  const at = spec.indexOf("=");
  const width = Number(spec.slice(0, at));
  if (at < 0 || !Number.isInteger(width) || width < 10) throw new Error(`bad --screen ${spec}`);
  return [width, spec.slice(at + 1)];
}

function main() {
  const o = parseRescoreArgs(process.argv.slice(2));
  const corpus = JSON.parse(fs.readFileSync(o.corpus, "utf8"));
  const family = FAMILIES[o.family];
  const records = JSON.parse(fs.readFileSync(o.results, "utf8")).records;
  const screens = Object.fromEntries(o.screen.map(parseScreen).map(([width, file]) => [width, fs.readFileSync(file, "utf8")]));
  const twins = corpus.messages.map((m) => buildMessage(family, { seed: corpus.seed, index: m.index, tokenStart: m.tokenStart + TWIN_SHIFT }).text);
  const { results, locate } = rescoreRecords({ messages: corpus.messages, twins, screens, records });
  const summary = summarizeRescore(results);
  const line = { label: o.label ?? path.basename(path.dirname(o.corpus)), seed: corpus.seed, family: o.family, widths: Object.keys(screens).map(Number), matcherSha: matcherDigest(CORE), resultsSha: createHash("sha256").update(fs.readFileSync(o.results)).digest("hex"), locate, summary };
  if (o.out) fs.writeFileSync(o.out, `${JSON.stringify({ ...line, results }, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

if (fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) main();
