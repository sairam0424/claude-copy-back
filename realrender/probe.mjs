#!/usr/bin/env node
// Rig-only: one sealed launch with the ROWS PROBE instead of /cc. It types
// /probe, reads the one-line toast (counts and a checksum, never text) and
// compares it with the synthetic session the rig wrote. Settles how
// $.session.messages() orders and shapes the rows of a resumed session.
//
//   node realrender/probe.mjs --out DIR --holdout DIR [--width 120]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sentinelOf, sessionTurns } from "./lib/corpus-set.mjs";
import { listTree } from "./lib/evidence.mjs";
import { requireHoldout } from "./lib/holdout.mjs";
import { closeSession, openSession, stubRequests, waitDrawn } from "./lib/live-session.mjs";
import { askProbe } from "./lib/probe-run.mjs";
import { expectedProbe } from "./lib/probe-expect.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (i % 2 === 0 ? [...acc, [a.replace(/^--/, ""), all[i + 1]]] : acc), []));
if (!args.out) throw new Error("need --out DIR");
const holdout = requireHoldout(args.holdout);
const width = Number(args.width ?? 120);
const corpus = JSON.parse(fs.readFileSync(path.join(holdout, "corpus.json"), "utf8"));
const turns = sessionTurns(corpus);
const ctx = await openSession({ width, height: 50, turns, sentinel: sentinelOf(corpus), repo: path.join(HERE, "probe"), parts: [".claude-plugin", "hooks"] });
const out = { width, drawn: false };
try {
  out.drawn = await waitDrawn(ctx, sentinelOf(corpus), 120_000);
  await ctx.watch.wait(1500);
  const asked = await askProbe(ctx);
  out.toastRows = asked.toast ? [asked.toast] : [];
  out.observed = asked.parsed;
  out.expected = expectedProbe(turns);
  out.stubRequests = stubRequests(ctx).length;
  out.pluginFiles = listTree(ctx.pluginDir).map((f) => `${f.path} (${f.bytes})`);
  out.copyOfProbe = ctx.plugin;
} catch (error) {
  out.error = String(error.message);
} finally {
  out.teardown = await closeSession(ctx, { evidenceDir: path.join(path.resolve(args.out), "probe") });
  fs.writeFileSync(path.join(path.resolve(args.out), "probe", "results.json"), `${JSON.stringify(out, null, 1)}\n`);
}
process.stdout.write(`${JSON.stringify({ observed: out.observed, expected: out.expected, toast: out.toastRows, error: out.error ?? null }, null, 1)}\n`);
