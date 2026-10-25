// One sealed live session: stub, throwaway directory, tmux on the dedicated
// socket, Claude Code resumed under `env -i` inside the Seatbelt profile with
// the plugin loaded, continuous network sampling, and a teardown that stops
// only what this module started. The case logic lives in live-cases.mjs and
// live-run.mjs; this file only opens and closes.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPECTED_VERSION, SEAL_PATH, forbiddenName } from "./config.mjs";
import { tmpNames } from "./evidence.mjs";
import { parseProfile } from "./profile.mjs";
import { writeLiveFixtures } from "./live-fixtures.mjs";
import { makeSandbox } from "./sandbox.mjs";
import { SANDBOX_EXEC } from "./seatbelt.mjs";
import { readStubLog, startStub } from "./stubproc.mjs";
import { moveToTrash, stopPid } from "./teardown.mjs";
import { Tmux, realExec } from "./tmux.mjs";
import { preflight } from "./run.mjs";
import { Watch } from "./watch.mjs";
import { sleep } from "./util.mjs";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const minimalEnv = (extra = {}) => ({ PATH: SEAL_PATH, ...extra });

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

/**
 * Start everything. `opts`: {width, height, turns, sentinel, claude?, repo?, parts?, profile?}.
 * On any failure the half-built context is torn down before the error leaves.
 */
export async function openSession(opts) {
  const ctx = { opts, profile: parseProfile(opts.profile), tools: { ...preflight(opts.claude), sandboxExec: SANDBOX_EXEC }, startedAt: Date.now() };
  try {
    ctx.sandbox = makeSandbox();
    ctx.tmpBefore = tmpNames();
    ctx.stub = await startStub({ python: ctx.tools.python, dir: ctx.sandbox.dir, env: minimalEnv() });
    ctx.sessionId = randomUUID();
    const fx = writeLiveFixtures({
      sandbox: ctx.sandbox, port: ctx.stub.port, claude: ctx.tools.claude, version: EXPECTED_VERSION,
      sessionId: ctx.sessionId, turns: opts.turns, repo: opts.repo ?? REPO, parts: opts.parts, profile: ctx.profile,
    });
    Object.assign(ctx, fx);
    const bad = forbiddenName(fx.env);
    if (bad) throw new Error(`forbidden variable in the sealed env: ${bad}`);
    ctx.tmux = new Tmux({
      bin: ctx.tools.tmux, conf: ctx.sandbox.tmuxConf,
      env: minimalEnv({ HOME: ctx.sandbox.home, TERM: "xterm-256color", LANG: "en_US.UTF-8" }),
    });
    if (ctx.tmux.hasServer()) throw new Error("a tmux server already runs on the cbrender socket");
    ctx.tmux.newSession({ width: opts.width, height: opts.height, cwd: ctx.sandbox.work, command: ctx.sandbox.launcher });
    ctx.rawFile = path.join(ctx.sandbox.out, "raw-stream.bin");
    ctx.tmux.pipeTo(ctx.rawFile);
    ctx.pid = await waitForPid(ctx.sandbox.pidFile, 5000);
    ctx.watch = new Watch({ pid: ctx.pid, stubPort: ctx.stub.port, exec: (bin, args) => realExec(bin, args, minimalEnv()), intervalMs: 200 });
    return ctx;
  } catch (error) {
    await closeSession(ctx, { evidenceDir: null });
    throw error;
  }
}

/** The sentinel is on screen and two reads 400 ms apart agree. */
export async function waitDrawn(ctx, sentinel, timeoutMs = 120_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const first = ctx.tmux.capture("plain");
    if (first.includes(sentinel)) {
      await ctx.watch.wait(400);
      if (ctx.tmux.capture("plain") === first) return true;
    }
    await ctx.watch.wait(200);
  }
  return false;
}

/** Copy the throwaway directory's evidence out (before it is moved to the Trash). */
function persist(ctx, evidenceDir) {
  const target = evidenceDir;
  fs.mkdirSync(target, { recursive: true });
  const keep = ["out", "shims"];
  for (const name of keep) {
    const from = path.join(ctx.sandbox.dir, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(target, name), { recursive: true });
  }
  const files = [[ctx.stub?.logPath, "stub.log"], [ctx.sandbox.launcher, "run-claude.sh"], [ctx.profilePath, "seatbelt.sb"], [ctx.sessionFile, "session.jsonl"]];
  for (const [from, name] of files) if (from && fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name));
  if (ctx.watch) fs.writeFileSync(path.join(target, "lsof-samples.jsonl"), `${ctx.watch.toJsonl()}\n`);
  return target;
}

/** Stop exactly what this session started; move the directory to the Trash. */
export async function closeSession(ctx, { evidenceDir = null, keep = false } = {}) {
  const report = {};
  if (ctx.sandbox && evidenceDir) report.evidence = persist(ctx, evidenceDir);
  report.tmuxKillServer = ctx.tmux ? ctx.tmux.killServer().status : "n/a";
  await sleep(500);
  report.claude = ctx.pid ? await stopPid(ctx.pid) : "no-pid";
  if (ctx.stub) report.stub = await stopPid(ctx.stub.pid);
  report.tmuxServerGone = ctx.tmux ? !ctx.tmux.hasServer() : true;
  if (ctx.sandbox) report.trashed = keep ? `kept ${ctx.sandbox.dir}` : moveToTrash(ctx.sandbox.dir);
  return report;
}

/** Stub log lines so far. */
export const stubRequests = (ctx) => readStubLog(ctx.stub.logPath);
