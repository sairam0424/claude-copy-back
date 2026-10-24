#!/usr/bin/env node
// Build a NEW case set for a live pass and write it where `live.mjs width
// --holdout DIR` reads it.
//
//   node realrender/gen-live-set.mjs --seed 7331 --out DIR
//
// Writes DIR/corpus.json (40 synthetic assistant messages, family B) and
// DIR/results-holdout.json (40 spans per width at 60, 80, 100 and 120), and
// prints one JSON line: the seed, the counts per construct class, what the
// PAYLOADS hold (non-ASCII, em dash, joined emoji, CJK, accents, astral), and
// the sha256 of both files. Nothing here touches the clipboard or the plugin.

import fs from "node:fs";
import path from "node:path";
import { buildLiveSet, payloadCoverage, sha256 } from "./lib/live-set.mjs";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? undefined : args[at + 1];
};
const seed = Number(flag("seed"));
const out = flag("out");
if (!Number.isInteger(seed) || !out) {
  process.stderr.write("usage: gen-live-set.mjs --seed N --out DIR\n");
  process.exit(2);
}
const { corpus, results } = buildLiveSet({ seed });
fs.mkdirSync(out, { recursive: true });
const corpusFile = path.join(out, "corpus.json");
const resultsFile = path.join(out, "results-holdout.json");
fs.writeFileSync(corpusFile, JSON.stringify(corpus));
fs.writeFileSync(resultsFile, `${JSON.stringify(results, null, 1)}\n`);
const perClass = {};
for (const r of results.records) perClass[r.anchor] = (perClass[r.anchor] ?? 0) + 1;
process.stdout.write(`${JSON.stringify({
  seed, family: corpus.family, messages: corpus.messages.length, records: results.records.length, perClass,
  payloadCoverage: payloadCoverage(results.records),
  corpusSha256: sha256(fs.readFileSync(corpusFile, "utf8")), recordsSha256: sha256(fs.readFileSync(resultsFile, "utf8")),
}, null, 1)}\n`);
