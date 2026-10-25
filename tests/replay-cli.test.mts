// Replay harness command line: argument parsing and the end-to-end selftest and privacy spy.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs, safeErrorName } from "../src/replay/cli.ts";
import {
  CANARY,
  corpusFactory,
  runPrivacySpy,
  tmpBase,
} from "../src/replay/selftest.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/replay.mjs", import.meta.url));
const scratch = corpusFactory();
const corpus = scratch.make;
after(scratch.cleanup);

describe("command line", () => {
  test("defaults", () => {
    const o = parseArgs([]);
    assert.equal(o.seed, 1);
    assert.equal(o.messages, 250);
    assert.deepEqual(o.widths, [60, 80, 100, 120]);
    assert.ok(o.root.endsWith(path.join(".claude", "projects")));
  });

  test("flags", () => {
    const o = parseArgs([
      "--root",
      "/x",
      "--seed",
      "7",
      "--messages",
      "9",
      "--widths",
      "40,60",
      "--spans",
      "3",
      "--pretty",
    ]);
    assert.deepEqual(
      [o.root, o.seed, o.messages, o.widths, o.spans, o.pretty],
      ["/x", 7, 9, [40, 60], 3, true],
    );
  });

  test("--bullet sets the simulated bullet for sensitivity runs", () => {
    assert.equal(parseArgs(["--bullet", "-"]).bullet, "-");
    assert.equal(parseArgs([]).bullet, undefined);
  });

  test("--main-only restricts the corpus to main-session transcripts", () => {
    assert.equal(parseArgs(["--main-only"]).mainOnly, true);
    assert.equal(parseArgs([]).mainOnly, false);
  });

  for (const bad of [
    ["--seed", "x"],
    ["--messages", "0"],
    ["--widths", "40,abc"],
    ["--nope"],
    ["--root"],
  ]) {
    test(`rejects ${bad.join(" ")} with a fixed code`, () => {
      assert.throws(
        () => parseArgs(bad),
        (err: Error) => /^BAD_ARGS_[A-Z_]+$/.test(err.message),
      );
    });
  }

  test("error labels never carry a message", () => {
    assert.equal(safeErrorName(new Error(`leaky ${CANARY}`)), "Error");
    assert.equal(
      safeErrorName(new SyntaxError(`Unexpected token ${CANARY}`)),
      "SyntaxError",
    );
    assert.equal(
      safeErrorName(new Error("ROOT_UNREADABLE")),
      "ROOT_UNREADABLE",
    );
    assert.equal(safeErrorName("string"), "Error");
  });
});

describe("CLI end to end", () => {
  test("--selftest passes", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--selftest"], {
      encoding: "utf8",
      timeout: 300_000,
    });
    assert.equal(run.status, 0, run.stdout);
    const verdict = JSON.parse(run.stdout) as {
      selftest: string;
      failed: string[];
    };
    assert.deepEqual(verdict, { selftest: "pass", checks: 21, failed: [] });
  });

  test("PRIVACY SPY: the canary never reaches stdout, stderr or any file", () => {
    const checks = runPrivacySpy(tmpBase());
    assert.ok(checks.length >= 9);
    assert.deepEqual(
      checks.filter((c) => !c.pass).map((c) => c.name),
      [],
    );
  });
});
