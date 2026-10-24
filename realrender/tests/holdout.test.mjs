import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";
import { requireHoldout } from "../lib/holdout.mjs";

const REALRENDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbholdout-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("requireHoldout", () => {
  test("a missing, empty or non-string value is refused with the way to make a case set", () => {
    for (const value of [undefined, "", null, 7]) {
      assert.throws(() => requireHoldout(value), (error) => /--holdout DIR is required/.test(error.message) && /gen-live-set\.mjs/.test(error.message));
    }
  });

  test("a folder is returned as an absolute path and is not checked for existence here", () => {
    assert.equal(requireHoldout("cases"), path.resolve("cases"));
    assert.equal(requireHoldout("/some/where"), "/some/where");
  });
});

describe("entry points need --holdout and have no default", () => {
  // Each child gets an empty HOME and a private TMPDIR, so even a regression
  // that went looking for a default folder could not find real data, and the
  // check must stop the run before the rig, tmux or a sealed launch starts.
  const entries = [
    ["probe.mjs", (out) => ["--out", out]],
    ["probe-after.mjs", (out) => ["--out", out]],
    ["live.mjs", (out) => ["width", "--width", "60", "--out", out]],
  ];
  for (const [script, argsFor] of entries) {
    test(`${script} without --holdout stops at once with a message that names gen-live-set.mjs`, () => {
      const dir = fs.mkdtempSync(path.join(base, "run-"));
      const out = path.join(dir, "out");
      const env = { PATH: process.env.PATH, HOME: path.join(dir, "home"), TMPDIR: path.join(dir, "tmp") };
      fs.mkdirSync(env.HOME);
      fs.mkdirSync(env.TMPDIR);
      const run = spawnSync(process.execPath, [path.join(REALRENDER, script), ...argsFor(out)], { env, encoding: "utf8", timeout: 20_000 });
      assert.notEqual(run.status, 0, run.stdout);
      assert.match(run.stderr, /--holdout DIR is required/);
      assert.match(run.stderr, /gen-live-set\.mjs/);
      assert.equal(fs.existsSync(out), false, "nothing is written before the check");
      assert.deepEqual(fs.readdirSync(env.TMPDIR), [], "no scratch folder was made");
    });
  }
});
