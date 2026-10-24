// Positive and negative controls of the Seatbelt profile, run through the SAME
// wrapper shape the live launch uses (env -i, shim directory first on PATH,
// sandbox-exec -f profile). Nothing here reads or writes the real clipboard:
// the pasteboard control is a mach-service lookup, and the one real pbpaste
// call (/usr/bin/pbpaste, expected to fail) prints to a byte counter only.
// Each control is {id, what, ok, detail}.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { SEAL_PATH } from "./config.mjs";
import { protectedPaths } from "./live-fixtures.mjs";
import { PASTEBOARD_SERVICE, SANDBOX_EXEC, buildProfile, sandboxArgs } from "./seatbelt.mjs";
import { setPbpaste, writeShims } from "./shims.mjs";
import { findTool } from "./util.mjs";

const CONNECT_PY = `
import socket, sys
host, port = sys.argv[1], int(sys.argv[2])
s = socket.socket(); s.settimeout(3)
try:
    s.connect((host, port)); print("CONNECTED")
except Exception as e:
    print("FAILED", type(e).__name__, getattr(e, "errno", None))
`;

const MACH_PY = `
import ctypes, sys
lib = ctypes.CDLL("/usr/lib/libSystem.B.dylib")
bp = ctypes.c_uint.in_dll(lib, "bootstrap_port")
lib.bootstrap_look_up.argtypes = [ctypes.c_uint, ctypes.c_char_p, ctypes.POINTER(ctypes.c_uint)]
for name in sys.argv[1:]:
    port = ctypes.c_uint(0)
    kr = lib.bootstrap_look_up(bp, name.encode(), ctypes.byref(port))
    print(name, kr)
`;

const control = (id, what, ok, detail) => ({ id, what, ok: Boolean(ok), detail });

function listen() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.end());
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/** Runs commands inside the wrapper. */
function wrapper({ profile, shimDir }) {
  const env = ["PATH=" + `${shimDir}:${SEAL_PATH}`, "HOME=" + os.tmpdir(), "LANG=en_US.UTF-8"];
  return (argv, timeoutMs = 20_000) => {
    const r = spawnSync("/usr/bin/env", ["-i", ...env, SANDBOX_EXEC, ...sandboxArgs(profile, argv)], { encoding: "utf8", timeout: timeoutMs });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
}

const NOTIFICATION = "com.apple.system.notification_center";
const denied = (text) => text.startsWith("FAILED PermissionError");

/** Everything one control group needs: the wrapper, the python path and the private files. */
function setup(dir, realHome) {
  const shimDir = path.join(dir, "shims");
  const deniedDir = path.join(dir, "denied");
  const okDir = path.join(dir, "ok");
  for (const d of [deniedDir, okDir]) fs.mkdirSync(d, { recursive: true });
  writeShims(shimDir);
  fs.writeFileSync(path.join(dir, "connect.py"), CONNECT_PY);
  fs.writeFileSync(path.join(dir, "mach.py"), MACH_PY);
  fs.writeFileSync(path.join(deniedDir, "canary.txt"), "synthetic canary\n");
  const base = protectedPaths(realHome);
  const profile = path.join(dir, "controls.sb");
  fs.writeFileSync(profile, buildProfile({ ...base, denyRead: [...base.denyRead, deniedDir] }));
  return { dir, realHome, shimDir, deniedDir, okDir, python: findTool("python3", SEAL_PATH.split(":")), inside: wrapper({ profile, shimDir }) };
}

/** Loopback works, non-local addresses are refused (and are not refused outside). */
function networkControls(t, port) {
  const script = path.join(t.dir, "connect.py");
  const connect = (host, p) => t.inside([t.python, "-I", script, host, String(p)]).stdout.trim();
  const loop = connect("127.0.0.1", port);
  const [near, far] = [connect("192.0.2.1", 9), connect("1.1.1.1", 443)];
  const outside = spawnSync(t.python, ["-I", script, "192.0.2.1", "9"], { encoding: "utf8", timeout: 20_000 }).stdout.trim();
  return [
    control("loopback-in", "a loopback connection works inside", loop === "CONNECTED", loop),
    control("outbound-in", "outbound connections to non-local addresses fail inside with EPERM", denied(near) && denied(far), `192.0.2.1:9 -> ${near}; 1.1.1.1:443 -> ${far}`),
    control("outbound-out", "the same connect outside the wrapper is not refused by a sandbox (it times out)", !denied(outside), outside),
  ];
}

const parseMach = (stdout) => Object.fromEntries(stdout.trim().split("\n").map((l) => l.split(" ")).map(([name, kr]) => [name, Number(kr)]));

/** The pasteboard mach service: found outside, refused inside, while another service is still found inside. */
function machControls(t) {
  const script = path.join(t.dir, "mach.py");
  const inside = parseMach(t.inside([t.python, "-I", script, PASTEBOARD_SERVICE, NOTIFICATION]).stdout);
  const outside = parseMach(spawnSync(t.python, ["-I", script, PASTEBOARD_SERVICE], { encoding: "utf8" }).stdout);
  return [
    control("pasteboard-out", "the pasteboard mach service is found outside the wrapper", outside[PASTEBOARD_SERVICE] === 0, `kr=${outside[PASTEBOARD_SERVICE]}`),
    control("pasteboard-in", "the pasteboard mach service is refused inside", inside[PASTEBOARD_SERVICE] !== 0 && inside[PASTEBOARD_SERVICE] !== undefined, `kr=${inside[PASTEBOARD_SERVICE]}`),
    control("other-service-in", "another mach service is still found inside (the profile is selective)", inside[NOTIFICATION] === 0, `kr=${inside[NOTIFICATION]}`),
  ];
}

/** The real tools fail inside; the shims answer instead. Run only when the pasteboard service is refused. */
function toolControls(t) {
  const bytes = t.inside(["/bin/sh", "-c", "/usr/bin/pbpaste 2>/dev/null | /usr/bin/wc -c"]).stdout.trim();
  const rc = t.inside(["/bin/sh", "-c", "/usr/bin/pbpaste >/dev/null 2>&1; echo rc=$?"]).stdout.trim();
  const fixture = "synthetic fixture\nline two\n";
  setPbpaste(t.shimDir, { mode: "fixture", text: fixture });
  const shim = t.inside(["/bin/sh", "-c", "command -v pbpaste; pbpaste | /usr/bin/shasum -a 256"]).stdout;
  t.inside(["/bin/sh", "-c", "printf 'synthetic write' | pbcopy"]);
  const captured = fs.readdirSync(path.join(t.shimDir, "captured"));
  const written = captured.length ? fs.readFileSync(path.join(t.shimDir, "captured", captured[0]), "utf8") : null;
  return [
    control("real-pbpaste-in", "/usr/bin/pbpaste called by absolute path fails inside with empty output", Number(bytes) === 0 && rc !== "rc=0", `bytes=${bytes} ${rc}`),
    control("shim-pbpaste-in", "the pbpaste shim is first on PATH and prints the fixture bytes", shim.includes(`${t.shimDir}/pbpaste`) && shim.includes(createHash("sha256").update(fixture).digest("hex")), shim.trim().split("\n").map((l) => l.slice(0, 80)).join(" | ")),
    control("shim-pbcopy-in", "the pbcopy shim receives a write instead of the real tool", written === "synthetic write", `captured files ${captured.length}`),
  ];
}

/** Denied read, denied write under the real home, allowed write under the throwaway directory. */
function fileControls(t) {
  const canary = path.join(t.deniedDir, "canary.txt");
  const read = t.inside(["/bin/cat", canary]);
  const mark = path.join(t.realHome, `.cb-live-write-canary-${process.pid}`);
  const write = t.inside(["/usr/bin/touch", mark]);
  const leaked = fs.existsSync(mark);
  const okWrite = t.inside(["/usr/bin/touch", path.join(t.okDir, "written")]);
  return [
    control("deny-read-in", "a canary file under a denied read path is unreadable inside", read.status !== 0 && !read.stdout.includes("canary"), `rc=${read.status}`),
    control("deny-read-out", "the same file is readable outside", fs.readFileSync(canary, "utf8").includes("canary"), "readable"),
    control("deny-write-home-in", "a write under the real home fails inside and leaves no file", write.status !== 0 && !leaked, `rc=${write.status} file-exists=${leaked}`),
    control("write-sandbox-in", "a write under the throwaway directory works inside", okWrite.status === 0 && fs.existsSync(path.join(t.okDir, "written")), `rc=${okWrite.status}`),
  ];
}

/** Run every control; returns {controls, ok, failures}. `dir` must be a private, empty directory. */
export async function runControls({ dir, realHome = os.homedir() }) {
  const t = setup(dir, realHome);
  const { server, port } = await listen();
  try {
    const results = [...networkControls(t, port), ...machControls(t)];
    const pasteboardOpen = results.find((c) => c.id === "pasteboard-in")?.ok !== true;
    if (pasteboardOpen) return finish(results, "pasteboard reachable inside: remaining controls skipped");
    return finish([...results, ...toolControls(t), ...fileControls(t)]);
  } finally {
    server.close();
  }
}

function finish(results, note = null) {
  const failures = results.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
  return { controls: results, ok: failures.length === 0 && note === null, failures: note ? [...failures, note] : failures };
}
