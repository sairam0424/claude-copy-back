import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { isAlive, moveToTrash, stopPid, trashTarget } from "../lib/teardown.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrender-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("teardown", () => {
  test("trash target keeps the folder name and adds a timestamp", () => {
    assert.equal(trashTarget("/tmp/cbrender.AbC", "/trash", 123), "/trash/cbrender.AbC-123");
  });

  test("moveToTrash moves (does not copy or delete) a directory with mv", () => {
    const dir = path.join(base, "victim");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "f.txt"), "kept");
    const trash = path.join(base, "trash");
    const moved = moveToTrash(dir, trash);
    assert.equal(fs.existsSync(dir), false);
    assert.equal(fs.readFileSync(path.join(moved, "f.txt"), "utf8"), "kept");
  });

  test("moveToTrash reports a failure instead of hiding it", () => {
    assert.throws(() => moveToTrash(path.join(base, "does-not-exist"), path.join(base, "trash")), /mv to Trash failed/);
  });

  test("stopPid ends an exact pid and leaves a sibling process alone", async () => {
    const mine = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    const sibling = spawn("/bin/sleep", ["60"], { stdio: "ignore" });
    try {
      assert.ok(isAlive(mine.pid) && isAlive(sibling.pid));
      assert.match(await stopPid(mine.pid), /terminated|killed/);
      assert.equal(isAlive(sibling.pid), true);
      assert.equal(await stopPid(mine.pid), "already-gone");
    } finally {
      sibling.kill("SIGTERM");
    }
  });

  test("isAlive is false for nonsense pids", () => {
    assert.equal(isAlive(0), false);
    assert.equal(isAlive(-5), false);
    assert.equal(isAlive(Number.NaN), false);
  });
});
