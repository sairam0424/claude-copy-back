// The sealed rig, end to end: sandbox, stub, synthetic session, tmux on the
// dedicated socket, Claude Code resumed under `env -i`, continuous network
// sampling, captures at one or more widths, teardown.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EXPECTED_VERSION, SEAL_PATH, forbiddenName } from "./config.mjs";
import { surveyTurns } from "./corpus.mjs";
import { addedNames, analyzeRaw, bannerVersion, dialogsIn, listTree, processTree, tmpNames } from "./evidence.mjs";
import { parseNettop, summarize } from "./netproof.mjs";
import { profileEnv, profileRecord } from "./profile.mjs";
import { makeSandbox, writeFixtures } from "./sandbox.mjs";
import { readStubLog, startStub } from "./stubproc.mjs";
import { moveToTrash, stopPid } from "./teardown.mjs";
import { Tmux, realExec } from "./tmux.mjs";
import { Watch } from "./watch.mjs";
import { findTool, hash, sleep } from "./util.mjs";

const KINDS = ["plain", "joined", "styled", "styledJoined", "padded"];
// whole-history captures (classic mode): plain, -J and -e views; the plain one keeps its old name
const HISTORY_KINDS = [["plain", ""], ["joined", "-joined"], ["styled", "-styled"]];

/** The extra environment pairs of a launch: the experiment's --env pairs, then the terminal profile's. */
export function launchExtraEnv(opts) {
  return [...(opts.extraEnv ?? []), ...profileEnv(opts.profile)];
}

/** Locate the tools once, with absolute paths. */
export function preflight(claudeOverride) {
  const claude = claudeOverride ?? findTool("claude", (process.env.PATH ?? "").split(":"));
  const sealDirs = SEAL_PATH.split(":");
  return {
    claude,
    tmux: findTool("tmux", sealDirs),
    python: findTool("python3", sealDirs),
    lsof: "/usr/sbin/lsof",
    nettop: "/usr/bin/nettop",
  };
}

function minimalEnv(extra = {}) {
  return { PATH: SEAL_PATH, ...extra };
}

/** Write one capture set (all variants, plus history in classic mode) and describe it. */
function captureSet(ctx, tag) {
  const { tmux, sandbox, opts } = ctx;
  const facts = tmux.paneFacts();
  const entry = { tag, facts, files: [] };
  for (const kind of KINDS) {
    const text = tmux.capture(kind);
    const file = `cap-${tag}-${kind}.txt`;
    fs.writeFileSync(path.join(sandbox.out, file), text);
    entry.files.push(file);
    if (kind === "plain") {
      const rows = text.split("\n");
      Object.assign(entry, { sha: hash(text), rowCount: rows.length, dialogs: dialogsIn(text), banner: bannerVersion(text), text });
    }
  }
  if (opts.history) {
    for (const [kind, suffix] of HISTORY_KINDS) {
      const file = `cap-${tag}-history${suffix}.txt`;
      fs.writeFileSync(path.join(sandbox.out, file), tmux.capture(kind, { history: true }));
      entry.files.push(file);
    }
  }
  return entry;
}

/** The sentinel is on screen and two reads 400 ms apart agree. */
async function isDrawn(ctx, sentinel) {
  const first = ctx.tmux.capture("plain");
  if (!first.includes(sentinel)) return false;
  await sleep(400);
  return ctx.tmux.capture("plain") === first;
}

async function waitForPid(pidFile, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (fs.existsSync(pidFile)) {
      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
      if (Number.isInteger(pid) && pid > 0) return pid;
    }
    await sleep(50);
  }
  throw new Error("launcher did not write a pid");
}

/** Set up everything and start Claude Code; returns the context. */
async function launch(ctx) {
  const { opts, tools } = ctx;
  const sandbox = makeSandbox();
  ctx.sandbox = sandbox;
  ctx.tmpBefore = tmpNames();
  ctx.stub = await startStub({ python: tools.python, dir: sandbox.dir, env: minimalEnv() });
  const survey = ctx.opts.survey ?? surveyTurns(); // measurement runs inject their own synthetic session
  ctx.sentinel = survey.sentinel;
  ctx.sessionId = randomUUID();
  const fixtures = writeFixtures({
    sandbox, port: ctx.stub.port, claude: tools.claude, version: EXPECTED_VERSION,
    sessionId: ctx.sessionId, turns: survey.turns, mode: opts.mode, drop: opts.drop,
    extraEnv: launchExtraEnv(opts),
  });
  const bad = forbiddenName(fixtures.env);
  if (bad) throw new Error(`forbidden variable in the sealed env: ${bad}`);
  ctx.env = fixtures.env;
  ctx.tmux = new Tmux({
    bin: tools.tmux, conf: sandbox.tmuxConf,
    env: minimalEnv({ HOME: sandbox.home, TERM: "xterm-256color", LANG: "en_US.UTF-8" }),
  });
  if (ctx.tmux.hasServer()) throw new Error("a tmux server already runs on the cbrender socket");
  ctx.tmux.newSession({ width: opts.width, height: opts.height, cwd: sandbox.work, command: sandbox.launcher });
  ctx.rawFile = path.join(sandbox.out, "raw-stream.bin");
  ctx.tmux.pipeTo(ctx.rawFile);
  ctx.pid = await waitForPid(sandbox.pidFile, 5000);
  const exec = (bin, args) => realExec(bin, args, minimalEnv());
  ctx.watch = new Watch({ pid: ctx.pid, stubPort: ctx.stub.port, exec, intervalMs: opts.sampleMs });
}

/** Resize to each width, wait for the redraw to settle, capture. */
async function resizePhase(ctx) {
  const results = [];
  for (const width of ctx.opts.resize) {
    ctx.tmux.resize(width, ctx.opts.height);
    await ctx.watch.wait(ctx.opts.settleMs);
    results.push(captureSet(ctx, `w${width}-resized`));
  }
  return results;
}

/** Process-level byte counters from nettop (loopback included). */
function nettopBytes(ctx) {
  const r = realExec(ctx.tools.nettop, ["-p", String(ctx.pid), "-L", "1", "-x", "-J", "bytes_in,bytes_out"], minimalEnv());
  return { raw: r.stdout.trim(), rows: parseNettop(r.stdout) };
}

/** Everything observed, as one JSON-able object. */
function collect(ctx, captures) {
  const log = readStubLog(ctx.stub.logPath);
  const summary = summarize(ctx.watch.samples);
  const tmpAfter = tmpNames();
  return {
    ...profileRecord(ctx.opts.profile),
    mode: ctx.opts.mode, width: ctx.opts.width, height: ctx.opts.height, pid: ctx.pid,
    env: ctx.env.map(([k, v]) => `${k}=${v}`),
    process: processTree(ctx.pid),
    stub: { port: ctx.stub.port, requests: log.length, modelRequests: log.filter((l) => l.target.startsWith("/v1/messages")).length, lines: log.map((l) => `${l.method} ${l.target}`) },
    network: summary, nettop: nettopBytes(ctx),
    homeFiles: listTree(ctx.sandbox.home).map((f) => `${f.path} (${f.bytes})`),
    homeBytes: listTree(ctx.sandbox.home).reduce((n, f) => n + f.bytes, 0),
    tmpAdded: addedNames(ctx.tmpBefore, tmpAfter).filter((n) => !n.startsWith("cbrender.")),
    rawStream: fs.existsSync(ctx.rawFile) ? analyzeRaw(fs.readFileSync(ctx.rawFile)) : null,
    captures: captures.map(({ text, ...rest }) => rest),
  };
}

function persist(ctx, label) {
  if (!ctx.opts.out) return null;
  const target = path.join(ctx.opts.out, label);
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(ctx.sandbox.out, target, { recursive: true });
  const copyIfThere = (from, name) => {
    if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name));
  };
  copyIfThere(ctx.stub?.logPath, "stub.log");
  copyIfThere(ctx.sandbox.launcher, "run-claude.sh");
  if (ctx.watch) fs.writeFileSync(path.join(target, "lsof-samples.jsonl"), `${ctx.watch.toJsonl()}\n`);
  return target;
}

async function teardown(ctx) {
  const report = {};
  report.tmuxKillServer = ctx.tmux ? ctx.tmux.killServer().status : "n/a";
  await sleep(500);
  report.claude = ctx.pid ? await stopPid(ctx.pid) : "no-pid";
  if (ctx.stub) report.stub = await stopPid(ctx.stub.pid);
  report.tmuxServerGone = ctx.tmux ? !ctx.tmux.hasServer() : true;
  report.trashed = ctx.opts.keep ? `kept ${ctx.sandbox.dir}` : moveToTrash(ctx.sandbox.dir);
  return report;
}

/** Tear down on Ctrl-C or SIGTERM too, then exit with the conventional code. */
function guardSignals(ctx) {
  const handlers = ["SIGINT", "SIGTERM"].map((sig) => {
    const handler = () => {
      teardown(ctx).finally(() => process.exit(sig === "SIGINT" ? 130 : 143));
    };
    process.once(sig, handler);
    return [sig, handler];
  });
  return () => handlers.forEach(([sig, handler]) => process.off(sig, handler));
}

/** Run the whole rig. Always tears down. */
export async function runRig(opts) {
  const ctx = { opts, tools: preflight(opts.claude), startedAt: Date.now() };
  const result = { ok: false };
  const unguard = guardSignals(ctx);
  try {
    await launch(ctx);
    await measure(ctx, result);
  } catch (error) {
    result.error = String(error.message);
  } finally {
    unguard();
    if (ctx.sandbox) {
      result.evidence = persist(ctx, opts.label);
      result.teardown = await teardown(ctx);
    }
  }
  return result;
}

async function measure(ctx, result) {
  const drawn = await waitDrawn(ctx);
  result.drawnAfterMs = Date.now() - ctx.startedAt;
  ctx.watch.phase = "drawn";
  await ctx.watch.wait(ctx.opts.settleMs);
  const captures = [captureSet(ctx, `w${ctx.opts.width}`)];
  captures.push(...(await resizePhase(ctx)));
  ctx.watch.phase = "idle";
  await ctx.watch.wait(ctx.opts.idleMs);
  Object.assign(result, collect(ctx, captures), { ok: drawn, drawn });
}

async function waitDrawn(ctx) {
  const end = Date.now() + ctx.opts.drawTimeoutMs;
  while (Date.now() < end) {
    if (await isDrawn(ctx, ctx.sentinel)) return true;
    await ctx.watch.wait(ctx.opts.sampleMs);
  }
  return false;
}
