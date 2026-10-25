import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parse, rigOptions } from "../capture.mjs";
import { launchExtraEnv } from "../lib/run.mjs";

describe("capture.mjs command line", () => {
  const base = ["--family", "A", "--seed", "7", "--out", "/o"];
  const set = { family: "A", messages: [{ index: 0, text: "hello alpha1111", tokens: [{ id: "alpha1111", start: 6 }] }] };

  test("the profile defaults to default and is carried to every launch's rig options", () => {
    const o = parse(base);
    assert.equal(o.profile, "default");
    assert.equal(rigOptions(o, set, 80, true).profile, "default");
  });

  test("--profile warp reaches the rig options, and its variables ride in the extra environment", () => {
    const o = parse([...base, "--profile", "warp"]);
    const opts = rigOptions(o, set, 100, false);
    assert.equal(opts.profile, "warp");
    assert.deepEqual(launchExtraEnv(opts).map(([k]) => k), ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM"]);
  });

  test("an unknown profile or a missing value is refused", () => {
    assert.throws(() => parse([...base, "--profile", "iterm"]), /unknown profile "iterm"/);
    assert.throws(() => parse([...base, "--profile"]), /bad flag/);
  });
});
