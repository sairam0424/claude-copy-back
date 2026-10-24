#!/usr/bin/env node
// Rig-only: does /cc add a row to what the engine hands a mod? One sealed
// launch with /cc AND the rows probe loaded from one scratch plugin folder
// (one hooks module that registers both).
// Ask the probe, run a few real /cc cases, ask the probe again, compare.
//
//   node realrender/probe-after.mjs --out DIR --holdout DIR [--width 100] [--cases 3]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentinelOf, sessionTurns } from "./lib/corpus-set.mjs";
import { requireHoldout } from "./lib/holdout.mjs";
import { copyPlugin } from "./lib/live-fixtures.mjs";
import { planWidth } from "./lib/live-cases.mjs";
import { liveCopies, runCase } from "./lib/live-run.mjs";
import { REPO, closeSession, openSession, stubRequests, waitDrawn } from "./lib/live-session.mjs";
import { askProbe } from "./lib/probe-run.mjs";
import { moveToTrash } from "./lib/teardown.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (i % 2 === 0 ? [...acc, [a.replace(/^--/, ""), all[i + 1]]] : acc), []));
if (!args.out) throw new Error("need --out DIR");
const width = Number(args.width ?? 100);
const holdout = requireHoldout(args.holdout);

const PROBE_REGISTER = 'await $.command.register({ name: "probe", description: "counts about the session rows", immediate: true });\n    try {\n      await $.command.register({\n        name: "cc",';

/** Replace `from` by `to` in `text`; throws when `from` is not there (the scratch copy must really change). */
function swap(text, from, to) {
  if (!text.includes(from)) throw new Error(`pattern not found: ${from.slice(0, 40)}`);
  return text.replace(from, to);
}

/**
 * A scratch plugin folder: the /cc plugin plus the probe, in one hooks module
 * (a plugin has exactly one, and `session.start` may be hooked once). The copy
 * of /cc's register.tsx gains one line at session start (the probe's command);
 * everything /cc does when it runs is the plugin's own code, unchanged.
 */
function comboFolder() {
  const dir = fs.realpathSync(fs.mkdtempSync("/tmp/cbcombo."));
  copyPlugin(REPO, dir);
  const hooks = path.join(dir, "hooks");
  const cc = fs.readFileSync(path.join(hooks, "register.tsx"), "utf8");
  fs.writeFileSync(path.join(hooks, "cc-register.tsx"), swap(cc, 'try {\n      await $.command.register({\n        name: "cc",', PROBE_REGISTER));
  const probe = fs.readFileSync(path.join(HERE, "probe", "hooks", "register.tsx"), "utf8");
  const [head, rest] = [probe.slice(0, probe.indexOf('  on("session.start"')), probe.slice(probe.indexOf('  on("command.run"'))];
  fs.writeFileSync(path.join(hooks, "probe.tsx"), head + rest);
  const joined = ['import type { Register } from "claude-code";', 'import { register as cc } from "./cc-register.tsx";', 'import { register as probe } from "./probe.tsx";', "export const register: Register = (on, options) => {", "  cc(on, options);", "  probe(on, options);", "};", ""];
  fs.writeFileSync(path.join(hooks, "register.tsx"), joined.join("\n"));
  return dir;
}

const corpus = JSON.parse(fs.readFileSync(path.join(holdout, "corpus.json"), "utf8"));
const records = JSON.parse(fs.readFileSync(path.join(holdout, "results-holdout.json"), "utf8")).records.filter((r) => r.width === width).slice(0, Number(args.cases ?? 3));
const combo = comboFolder();
const ctx = await openSession({ width, height: 50, turns: sessionTurns(corpus), sentinel: sentinelOf(corpus), repo: combo });
const out = { width };
try {
  await waitDrawn(ctx, sentinelOf(corpus), 120_000);
  await ctx.watch.wait(1500);
  const copies = liveCopies({ historyText: ctx.tmux.capture("plain", { history: true }), records, messages: corpus.messages, width });
  const sessionBefore = fs.readFileSync(ctx.sessionFile, "utf8").split("\n").filter(Boolean).length;
  out.before = await askProbe(ctx);
  out.cases = [];
  for (const c of planWidth({ width, records, copies }).slice(0, records.length + 1)) {
    const r = await runCase(ctx, c);
    out.cases.push({ id: r.id, kind: r.kind, valid: r.valid, exact: r.exact, untouched: r.untouched });
  }
  out.after = await askProbe(ctx);
  out.sessionLines = { before: sessionBefore, after: fs.readFileSync(ctx.sessionFile, "utf8").split("\n").filter(Boolean).length };
  out.stubRequests = stubRequests(ctx).length;
} catch (error) {
  out.error = String(error.message);
} finally {
  out.teardown = await closeSession(ctx, { evidenceDir: path.join(path.resolve(args.out), "probe-after") });
  fs.writeFileSync(path.join(path.resolve(args.out), "probe-after", "results.json"), `${JSON.stringify(out, null, 1)}\n`);
  out.combo = moveToTrash(combo);
}
process.stdout.write(`${JSON.stringify(out, null, 1)}\n`);
