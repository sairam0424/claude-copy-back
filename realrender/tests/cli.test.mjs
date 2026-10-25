import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseArgs, toOptions } from "../rig.mjs";
import { launchExtraEnv } from "../lib/run.mjs";

describe("rig command line", () => {
  test("defaults", () => {
    const o = toOptions(parseArgs([]));
    assert.equal(o.mode, "default");
    assert.equal(o.width, 100);
    assert.deepEqual(o.resize, []);
    assert.equal(o.history, false);
    assert.equal(o.out, null);
    assert.equal(o.label, "default-w100");
  });

  test("classic mode asks for the history capture", () => {
    assert.equal(toOptions(parseArgs(["--mode", "classic"])).history, true);
  });

  test("resize list, drop list and repeated --env", () => {
    const o = toOptions(parseArgs(["--resize", "60,80", "--drop", "theme,trust", "--env", "A=1", "--env", "B=x=y"]));
    assert.deepEqual(o.resize, [60, 80]);
    assert.deepEqual(o.drop, ["theme", "trust"]);
    assert.deepEqual(o.extraEnv, [["A", "1"], ["B", "x=y"]]);
  });

  test("--profile defaults to default, accepts warp and rejects anything else", () => {
    assert.equal(toOptions(parseArgs([])).profile, "default");
    assert.equal(toOptions(parseArgs(["--profile", "warp"])).profile, "warp");
    assert.throws(() => toOptions(parseArgs(["--profile", "kitty"])), /unknown profile "kitty"/);
  });

  test("the profile's variables are added after any --env, through the same slot", () => {
    const o = toOptions(parseArgs(["--profile", "warp", "--env", "A=1"]));
    assert.deepEqual(launchExtraEnv(o).map(([k]) => k), ["A", "TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM"]);
    assert.deepEqual(launchExtraEnv(toOptions(parseArgs(["--env", "A=1"]))), [["A", "1"]]);
  });

  test("bad input is rejected with a message", () => {
    assert.throws(() => parseArgs(["--nope", "1"]), /unknown argument/);
    assert.throws(() => parseArgs(["--width"]), /needs a value/);
    assert.throws(() => toOptions(parseArgs(["--mode", "weird"])), /--mode/);
    assert.throws(() => toOptions(parseArgs(["--drop", "bogus"])), /unknown key/);
    assert.throws(() => toOptions(parseArgs(["--env", "NOEQUALS"])), /KEY=VALUE/);
  });
});
