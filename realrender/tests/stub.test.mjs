import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { realExec } from "../lib/tmux.mjs";
import { readStubLog, startStub } from "../lib/stubproc.mjs";
import { sampleOnce } from "../lib/netproof.mjs";
import { SEAL_PATH } from "../lib/config.mjs";

const CANARY = "CANARY-body-and-header-text";
const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrender-test-"));
let stub;

before(async () => {
  stub = await startStub({ python: "/opt/homebrew/bin/python3", dir: base, env: { PATH: SEAL_PATH } });
});
after(() => {
  stub?.stop();
  fs.rmSync(base, { recursive: true, force: true });
});

function request(method, target, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: stub.port, method, path: target, headers }, (res) => {
      let data = "";
      res.on("data", (c) => { data += c; });
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("stub server", () => {
  test("answers every method and path with 401", async () => {
    for (const [m, t] of [["GET", "/"], ["POST", "/v1/messages?beta=true"], ["PUT", "/x/y"], ["DELETE", "/z"], ["PATCH", "/p"], ["OPTIONS", "/o"]]) {
      const r = await request(m, t, m === "POST" ? { body: "{}" } : {});
      assert.equal(r.status, 401, `${m} ${t}`);
    }
    assert.match((await request("GET", "/")).body, /authentication_error/);
  });

  test("records only a timestamp, the method and the request target", async () => {
    await request("POST", "/v1/messages?beta=true", { body: CANARY, headers: { Authorization: `x ${CANARY}`, "X-Canary": CANARY } });
    const raw = fs.readFileSync(stub.logPath, "utf8");
    assert.equal(raw.includes(CANARY), false);
    const last = readStubLog(stub.logPath).at(-1);
    assert.equal(last.method, "POST");
    assert.equal(last.target, "/v1/messages?beta=true");
    for (const line of raw.trim().split("\n")) assert.match(line, /^\d+\.\d{3} [A-Z]+ \/\S*$/);
  });

  test("binds loopback only", () => {
    const r = realExec("/usr/sbin/lsof", ["-a", "-i", "-n", "-P", "-p", String(stub.pid)], { PATH: SEAL_PATH });
    assert.match(r.stdout, /TCP 127\.0\.0\.1:\d+ \(LISTEN\)/);
    assert.equal(/\*:\d+ \(LISTEN\)/.test(r.stdout), false);
  });
});

describe("positive control for the sampler", () => {
  test("lsof sampling sees a live connection to the stub and classifies it as the stub", async () => {
    const child = spawn(process.execPath, ["-e", `const s=require("net").connect(${stub.port},"127.0.0.1");setTimeout(()=>s.destroy(),4000)`], { stdio: "ignore" });
    try {
      let kinds = [];
      for (let i = 0; i < 25 && !kinds.includes("stub"); i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const exec = (bin, args) => realExec(bin, args, { PATH: SEAL_PATH });
        kinds = sampleOnce({ pid: child.pid, stubPort: stub.port, exec, now: Date.now }).sockets.map((s) => s.kind);
      }
      assert.ok(kinds.includes("stub"), `kinds seen: ${kinds.join(",")}`);
    } finally {
      child.kill("SIGTERM");
    }
  });

  test("a process with no sockets yields zero rows, not an error", () => {
    const exec = (bin, args) => realExec(bin, args, { PATH: SEAL_PATH });
    const s = sampleOnce({ pid: process.pid, stubPort: stub.port, exec, now: Date.now });
    assert.ok(Array.isArray(s.sockets));
    assert.equal(s.sockets.some((k) => k.kind === "external"), false);
  });
});
