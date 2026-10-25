#!/usr/bin/env node
// copy-back offline replay harness.
//
// TESTS (from the repo root):
//   npm test
//
// K1 STOP-LOSS (lossless-match rate must be >= 70%; run three seeds):
//   node scripts/replay.mjs --seed 1 --messages 250 --widths 60,80,100,120
//   node scripts/replay.mjs --seed 2 --messages 250 --widths 60,80,100,120
//   node scripts/replay.mjs --seed 3 --messages 250 --widths 60,80,100,120
//
// SELF-TEST (synthetic transcripts, known counts, privacy spy):
//   node scripts/replay.mjs --selftest
//
// USAGE
//   node scripts/replay.mjs [--root DIR] [--seed N] [--messages N]
//                           [--widths 60,80,100,120] [--spans N] [--pretty]
//                           [--main-only] [--bullet GLYPH] [--newest-wins]
//                           [--selftest]
//   --main-only   sample main-session transcripts only (skip */subagents/*)
//   --bullet G    sensitivity run: the SIMULATED screen draws list bullets as G
//                 while the matcher still assumes its own glyph
//   --newest-wins match with newestWinsOnConflict: when two messages hold the
//                 same words with different slices, take the newest instead of
//                 refusing as ambiguous (shows what recency alone would do)
//
// K1 PASS (the "k1" block of the JSON) needs ALL of: exact rate >= 70% on every
// width, wrong-slice rate < 1% of trials, zero negative-control false positives.
//
// What it does: reads assistant text blocks (200 to 20000 characters) from
// the JSONL transcripts under --root (default ~/.claude/projects), samples
// them with a seeded PRNG, simulates the classic renderer at each width,
// copies a random span the way a terminal would, and asks findSource() for the
// exact source slice among the message plus 39 other sampled messages.
//
// PRIVACY: stdout is ONE JSON document of counts. Transcript text is never
// printed, logged, written or returned, and errors carry a fixed code or an
// exception class name, never a message. Debug by counts, not by text.

import { parseArgs, runReplay, safeErrorName } from "../src/replay/cli.ts";
import { runSelftest } from "../src/replay/selftest.ts";

function main() {
  const { root, pretty, selftest, ...opts } = parseArgs(process.argv.slice(2));
  if (selftest) {
    const result = runSelftest();
    const failed = result.checks.filter((c) => !c.pass).map((c) => c.name);
    process.stdout.write(
      JSON.stringify({ selftest: result.pass ? "pass" : "fail", checks: result.checks.length, failed }) + "\n",
    );
    return result.pass ? 0 : 1;
  }
  const report = runReplay(root, opts);
  process.stdout.write(JSON.stringify(report, null, pretty ? 2 : 0) + "\n");
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(JSON.stringify({ error: safeErrorName(err) }) + "\n");
  process.exitCode = 2;
}
