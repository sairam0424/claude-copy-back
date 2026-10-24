// Starts and stops the local Python stub (lib/stub.py). The stub binds
// 127.0.0.1 on a free port, answers every request with 401 and records only
// the method and request target.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STUB_SCRIPT = path.join(HERE, "stub.py");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait for the port file the stub writes after it has bound. */
async function waitForPort(portFile, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(portFile)) {
      const port = Number(fs.readFileSync(portFile, "utf8").trim());
      if (Number.isInteger(port) && port > 0) return port;
    }
    await sleep(50);
  }
  throw new Error("stub did not publish a port in time");
}

/**
 * @returns {Promise<{pid:number, port:number, logPath:string, stop:()=>void}>}
 */
export async function startStub({ python, dir, env }) {
  const logPath = path.join(dir, "stub.log");
  const portFile = path.join(dir, "stub.port");
  const child = spawn(
    python,
    ["-I", STUB_SCRIPT, "--log", logPath, "--port-file", portFile],
    { env, stdio: "ignore" },
  );
  const failed = new Promise((_, reject) => {
    child.once("exit", (code) => reject(new Error(`stub exited early (${code})`)));
  });
  const port = await Promise.race([waitForPort(portFile, 10_000), failed]);
  child.removeAllListeners("exit");
  return {
    pid: child.pid,
    port,
    logPath,
    stop: () => child.kill("SIGTERM"),
  };
}

/** Lines of the stub log as {at, method, target}. */
export function readStubLog(logPath) {
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [at, method, ...rest] = line.split(" ");
      return { at: Number(at) * 1000, method, target: rest.join(" ") };
    });
}
