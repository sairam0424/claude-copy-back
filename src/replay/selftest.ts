// --selftest: the harness checks itself on built-in SYNTHETIC transcripts and
// asserts known counts, and a privacy spy proves a canary planted in the
// transcripts never reaches stdout, stderr or any file the harness could
// write. Failure reports carry check names only, never text.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomMarkdown } from "../sim/grammar.ts";
import { mulberry32 } from "../sim/prng.ts";
import { sampleCorpus } from "./corpus.ts";
import { runReplay } from "./cli.ts";

export const CANARY = "CANARY-9f3c1a7e-copyback";

export interface Check {
  name: string;
  pass: boolean;
}

/** Where scratch directories go: COPY_BACK_TMP, else the OS temp dir. */
export function tmpBase(): string {
  const chosen = process.env["COPY_BACK_TMP"] ?? os.tmpdir();
  fs.mkdirSync(chosen, { recursive: true });
  return chosen;
}

/** Remove a scratch directory this module created (guarded by its name prefix). */
export function removeScratch(dir: string): void {
  if (path.basename(dir).startsWith("copy-back-"))
    fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Scratch synthetic corpora for one test file: `make()` writes a fresh
 * transcript directory, `cleanup()` removes every one made so far.
 */
export function corpusFactory(): { make: () => string; cleanup: () => void } {
  const made: string[] = [];
  return {
    make: () => {
      const corpus = writeSyntheticCorpus(tmpBase());
      made.push(corpus.dir);
      return corpus.dir;
    },
    cleanup: () => made.forEach(removeScratch),
  };
}

function assistantLine(blocks: unknown[]): string {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: blocks },
  });
}

function textLine(text: string): string {
  return assistantLine([{ type: "text", text }]);
}

/** A synthetic message of at least 220 characters from the seeded grammar. */
export function syntheticMessage(seed: number): string {
  const rng = mulberry32(seed);
  let doc = randomMarkdown(rng, 4, { tables: false });
  while (doc.length < 220)
    doc += "\n\n" + randomMarkdown(rng, 2, { tables: false });
  return doc;
}

export interface SyntheticCorpus {
  dir: string;
  messages: string[];
}

/**
 * Two transcripts. The canary sits in assistant text, a user turn, a thinking
 * block, a tool input and a malformed line, so every reader path is covered.
 */
export function writeSyntheticCorpus(parent: string): SyntheticCorpus {
  const dir = fs.mkdtempSync(path.join(parent, "copy-back-corpus-"));
  const m = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => syntheticMessage(100 + n));
  m[0] = `${m[0]} The marker ${CANARY} appears in this sentence of the first message.`;
  fs.mkdirSync(path.join(dir, "project-a"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "project-a", "one.jsonl"),
    [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: `${CANARY} user turn` },
      }),
      assistantLine([
        { type: "thinking", thinking: `${CANARY} private thoughts` },
      ]),
      textLine(m[0] as string),
      textLine(m[1] as string),
      textLine(m[2] as string),
      textLine(m[3] as string),
      textLine(`too short ${CANARY}`),
      assistantLine([
        {
          type: "tool_use",
          name: "Bash",
          input: { command: `echo ${CANARY}` },
        },
      ]),
      `{"type":"assistant","message":{"content":[{"type":"text","text":"${CANARY} cut off`,
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "project-a", "two.jsonl"),
    [
      textLine(m[4] as string),
      textLine(m[5] as string),
      textLine(m[6] as string),
      textLine(m[7] as string),
      textLine(m[1] as string),
      "",
    ].join("\n"),
  );
  return { dir, messages: m };
}

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(full));
    else out.push(full);
  }
  return out;
}

const SCRIPT = fileURLToPath(
  new URL("../../scripts/replay.mjs", import.meta.url),
);

const leaked = (text: string | null | undefined): boolean =>
  (text ?? "").includes(CANARY);

/** "path:size" for every file under `dir`: changes if anything was written or edited. */
function snapshot(dir: string): string {
  return filesUnder(dir)
    .map((f) => `${f}:${fs.statSync(f).size}`)
    .join("|");
}

type Run = ReturnType<typeof spawnSync<string>>;

interface SpyRuns {
  ok: Run;
  bad: Run;
  junk: Run;
}

/** Three runs of the real CLI: a normal one, an unreadable root named with the canary, and junk arguments. */
function runSpyCommands(corpusDir: string, cwd: string, scratch: string): SpyRuns {
  const env = { ...process.env, TMPDIR: scratch, COPY_BACK_TMP: scratch };
  const run = (args: string[]): Run =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      env,
      encoding: "utf8",
      timeout: 180_000,
    });
  return {
    ok: run([
      "--root", corpusDir, "--seed", "1", "--messages", "20",
      "--widths", "60,100", "--spans", "2",
    ]),
    bad: run(["--root", path.join(corpusDir, `missing-${CANARY}`), "--seed", "1"]),
    junk: run(["--root", corpusDir, "--seed", "not-a-number"]),
  };
}

function isOneJsonLine(text: string): boolean {
  try {
    JSON.parse(text);
  } catch {
    return false;
  }
  return text.trim().split("\n").length === 1;
}

function spyChecks(
  runs: SpyRuns,
  dirs: { corpus: string; cwd: string; scratch: string },
  corpusBefore: string,
): Check[] {
  const { ok, bad, junk } = runs;
  const written = [...filesUnder(dirs.cwd), ...filesUnder(dirs.scratch)];
  const writtenLeak = written.some((f) =>
    fs.readFileSync(f, "utf8").includes(CANARY),
  );
  return [
    { name: "spy: harness exits 0 on the canary corpus", pass: ok.status === 0 },
    { name: "spy: stdout is one JSON document", pass: isOneJsonLine(ok.stdout) },
    { name: "spy: canary absent from stdout", pass: !leaked(ok.stdout) },
    { name: "spy: canary absent from stderr", pass: !leaked(ok.stderr) },
    {
      name: "spy: harness wrote no files (cwd and TMPDIR stay empty)",
      pass: written.length === 0,
    },
    { name: "spy: canary absent from any file written", pass: !writtenLeak },
    {
      name: "spy: transcripts untouched",
      pass: corpusBefore === snapshot(dirs.corpus),
    },
    {
      name: "spy: unreadable root fails without echoing the path",
      pass: bad.status !== 0 && !leaked(bad.stderr) && !leaked(bad.stdout),
    },
    {
      name: "spy: bad arguments fail without echoing them",
      pass: junk.status !== 0 && !(junk.stderr ?? "").includes("not-a-number"),
    },
  ];
}

/** Run the real CLI against a canary-laden corpus and look for the canary everywhere. */
export function runPrivacySpy(parent: string): Check[] {
  const corpus = writeSyntheticCorpus(parent);
  const cwd = fs.mkdtempSync(path.join(parent, "copy-back-cwd-"));
  const scratch = fs.mkdtempSync(path.join(parent, "copy-back-tmpdir-"));
  const before = snapshot(corpus.dir);
  const runs = runSpyCommands(corpus.dir, cwd, scratch);
  const checks = spyChecks(runs, { corpus: corpus.dir, cwd, scratch }, before);
  for (const dir of [corpus.dir, cwd, scratch]) removeScratch(dir);
  return checks;
}

/** The corpus reader's counts for the synthetic transcripts, derived from how they are written above. */
function corpusChecks(dir: string): Check[] {
  const { messages, stats } = sampleCorpus(dir, {
    seed: 1,
    count: 20,
    perFile: 10,
  });
  return [
    {
      name: "counts: 2 transcripts listed and read",
      pass: stats.filesListed === 2 && stats.filesRead === 2,
    },
    {
      name: "counts: 13 candidate lines, 1 unparseable",
      pass: stats.linesParsed === 13 && stats.linesUnparseable === 1,
    },
    {
      name: "counts: 10 assistant text blocks, 1 out of range",
      pass: stats.assistantTextBlocks === 10 && stats.textBlocksOutOfRange === 1,
    },
    {
      name: "counts: 1 duplicate dropped, 8 messages sampled",
      pass: stats.duplicatesDropped === 1 && messages.length === 8,
    },
  ];
}

/** The replay report's known counts on the synthetic transcripts. */
function trialChecks(dir: string): Check[] {
  const opts = {
    seed: 1,
    messages: 20,
    widths: [60, 100],
    spans: 2,
    windowSize: 40,
  };
  const report = runReplay(dir, opts);
  const again = runReplay(dir, opts);
  const t = report.total;
  return [
    {
      name: "trials: every attempted span is accounted for",
      pass: t.trials + report.spansSkipped === 8 * 2 * 2,
    },
    { name: "trials: at least 24 spans ran", pass: t.trials >= 24 },
    {
      name: "trials: the lossless match is exact on plain synthetic text",
      pass: t.exact === t.trials,
    },
    {
      name: "trials: no wrong slices, no refusals",
      pass:
        t.wrongSlice === 0 &&
        t.noMatch === 0 &&
        t.ambiguous === 0 &&
        t.tooShort === 0,
    },
    {
      name: "control: no false positives",
      pass:
        t.negativeControl.falsePositives === 0 &&
        t.negativeControl.trials === t.trials,
    },
    {
      name: "baseline: heuristic cleaner is no better than the lossless match",
      pass: t.baseline.pasteReady < t.exact,
    },
    {
      name: "determinism: same seed, same report",
      pass: JSON.stringify(report) === JSON.stringify(again),
    },
    {
      name: "k1: reported as pass on exact data",
      pass: report.k1.pass && report.k1.exactRate === 1,
    },
  ];
}

/** Known counts for the synthetic corpus. */
export function runKnownCounts(parent: string): Check[] {
  const corpus = writeSyntheticCorpus(parent);
  const checks = [...corpusChecks(corpus.dir), ...trialChecks(corpus.dir)];
  removeScratch(corpus.dir);
  return checks;
}

export function runSelftest(): { pass: boolean; checks: Check[] } {
  const base = tmpBase();
  const checks = [...runKnownCounts(base), ...runPrivacySpy(base)];
  return { pass: checks.every((c) => c.pass), checks };
}
