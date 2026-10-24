import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { HUGE_BYTES, PBPASTE_MODES, WRITER_SHIMS, logLength, pbpasteCallsSince, pbpasteScript, setPbpaste, strictUtf8, writeShims, writerCallsSince, writerScript } from "../lib/shims.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbshim-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

function fresh(name) {
  const dir = path.join(base, name);
  writeShims(dir);
  return dir;
}

const run = (file, input = "") => spawnSync("/bin/sh", [file], { input, env: { PATH: "/usr/bin:/bin" }, maxBuffer: 1 << 26 });

describe("clipboard shims", () => {
  test("every shim is a valid POSIX shell script and executable", () => {
    const dir = fresh("syntax");
    for (const name of ["pbpaste", ...WRITER_SHIMS]) {
      assert.equal(spawnSync("/bin/sh", ["-n", path.join(dir, name)]).status, 0, name);
      fs.accessSync(path.join(dir, name), fs.constants.X_OK);
    }
  });

  test("the pbpaste shim prints the fixture bytes exactly, non-ASCII and trailing blanks included", () => {
    const dir = fresh("fixture");
    const text = "naïve — ✓ 你好 🚀\n  indented\ttab  \nlast";
    setPbpaste(dir, { mode: "fixture", text });
    const r = run(path.join(dir, "pbpaste"));
    assert.equal(r.status, 0);
    assert.equal(r.stdout.toString("utf8"), text);
  });

  test("modes: exit1 fails silently, an unknown mode is rejected, huge prints 5 MiB", () => {
    const dir = fresh("modes");
    setPbpaste(dir, { mode: "exit1" });
    const bad = run(path.join(dir, "pbpaste"));
    assert.equal(bad.status, 1);
    assert.equal(bad.stdout.length, 0);
    assert.throws(() => setPbpaste(dir, { mode: "nope" }), /unknown pbpaste mode/);
    setPbpaste(dir, { mode: "huge" });
    const big = run(path.join(dir, "pbpaste"));
    assert.equal(big.stdout.length, HUGE_BYTES);
    assert.deepEqual([...PBPASTE_MODES], ["fixture", "exit1", "sleep", "huge"]);
  });

  test("each pbpaste call adds one log line with mode and sizes, never the text", () => {
    const dir = fresh("log");
    setPbpaste(dir, { mode: "fixture", text: "SECRETLOOKING" });
    run(path.join(dir, "pbpaste"));
    run(path.join(dir, "pbpaste"));
    assert.equal(logLength(dir, "pbpaste"), 2);
    const calls = pbpasteCallsSince(dir, 1);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].mode, "fixture");
    assert.equal(calls[0].fixture, "13");
    assert.equal(calls[0].lc, "unset");
    assert.equal(calls[0].path, "set");
    assert.equal(fs.readFileSync(path.join(dir, "pbpaste.log"), "utf8").includes("SECRETLOOKING"), false);
  });

  test("a writer shim keeps stdin, logs name, argc, bytes and hash, and succeeds", () => {
    const dir = fresh("writer");
    const r = run(path.join(dir, "pbcopy"), "payload ✓");
    assert.equal(r.status, 0);
    const calls = writerCallsSince(dir, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual([calls[0].name, calls[0].argc, calls[0].bytes, calls[0].text], ["pbcopy", 0, Buffer.byteLength("payload ✓"), "payload ✓"]);
    assert.match(calls[0].sha, /^[0-9a-f]{16}$/);
    assert.equal(fs.readFileSync(path.join(dir, "clip.log"), "utf8").includes("payload"), false);
  });

  test("calls are numbered so two writes do not overwrite each other", () => {
    const dir = fresh("two");
    run(path.join(dir, "xclip"), "first");
    run(path.join(dir, "wl-copy"), "second");
    assert.deepEqual(writerCallsSince(dir, 0).map((c) => [c.name, c.text]), [["xclip", "first"], ["wl-copy", "second"]]);
    assert.equal(writerCallsSince(dir, 1).length, 1);
  });

  test("scripts never mention the real pasteboard programs by absolute path", () => {
    for (const script of [pbpasteScript(), ...WRITER_SHIMS.map(writerScript)]) assert.equal(/\/usr\/bin\/(pbcopy|pbpaste|osascript)/.test(script), false);
  });

  test("strictUtf8 returns null for invalid bytes", () => {
    assert.equal(strictUtf8(Buffer.from([0xff, 0x41])), null);
    assert.equal(strictUtf8(Buffer.from("é")), "é");
  });
});
