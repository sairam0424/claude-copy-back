import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { forbiddenName, sealedEnv } from "../lib/config.mjs";
import { PROFILES, WARP_TERM_PROGRAM_VERSION, parseProfile, profileEnv, profileRecord } from "../lib/profile.mjs";
import { liveEnv } from "../lib/live-fixtures.mjs";

const base = { home: "/h", port: 4242, tmpdir: "/t" };

describe("terminal profiles of the sealed rig", () => {
  test("two profiles exist and default is the first", () => {
    assert.deepEqual(PROFILES, ["default", "warp"]);
  });

  test("default adds nothing: the sealed set is the one the earlier passes used", () => {
    assert.deepEqual(profileEnv("default"), []);
    assert.equal(sealedEnv({ ...base, extra: profileEnv("default") }).length, 11);
  });

  test("warp adds exactly the three variables a Warp session carries", () => {
    assert.deepEqual(profileEnv("warp"), [
      ["TERM_PROGRAM", "WarpTerminal"],
      ["TERM_PROGRAM_VERSION", WARP_TERM_PROGRAM_VERSION],
      ["COLORTERM", "truecolor"],
    ]);
    assert.match(WARP_TERM_PROGRAM_VERSION, /^v0\.\d{4}\.\d{2}\.\d{2}\.\d{2}\.\d{2}\.stable_\d{2}$/);
  });

  test("the warp environment is the default one plus those three, in that order, nothing removed or reordered", () => {
    const plain = sealedEnv({ ...base, extra: profileEnv("default") });
    const warp = sealedEnv({ ...base, extra: profileEnv("warp") });
    assert.equal(warp.length, plain.length + 3);
    assert.deepEqual(warp.slice(0, plain.length), plain);
    assert.deepEqual(warp.slice(plain.length).map(([k]) => k), ["TERM_PROGRAM", "TERM_PROGRAM_VERSION", "COLORTERM"]);
  });

  test("TERM stays what it was and no Warp-private, cloud or credential name is introduced", () => {
    const warp = Object.fromEntries(sealedEnv({ ...base, extra: profileEnv("warp") }));
    assert.equal(warp.TERM, "xterm-256color");
    assert.equal(Object.keys(warp).some((k) => k.startsWith("WARP_")), false);
    assert.equal(forbiddenName(Object.entries(warp)), null);
  });

  test("the live environment keeps the shim directory first on PATH under either profile", () => {
    for (const profile of PROFILES) {
      const env = liveEnv({ ...base, shimDir: "/shims", profile });
      assert.equal(env[0][1].startsWith("/shims:"), true);
      assert.equal(env.some(([k]) => k === "TERM_PROGRAM"), profile === "warp");
    }
    assert.deepEqual(liveEnv({ ...base, shimDir: "/shims" }), liveEnv({ ...base, shimDir: "/shims", profile: "default" }));
  });

  test("an unknown profile is refused by name, and no profile means default", () => {
    assert.equal(parseProfile(undefined), "default");
    assert.equal(parseProfile("warp"), "warp");
    assert.throws(() => parseProfile("iterm"), /unknown profile "iterm"/);
    assert.throws(() => profileEnv("iterm"), /unknown profile "iterm"/);
  });

  test("the evidence record names the profile and the variables it added", () => {
    assert.deepEqual(profileRecord("default"), { profile: "default", added: [] });
    assert.deepEqual(profileRecord("warp"), {
      profile: "warp",
      added: [`TERM_PROGRAM=WarpTerminal`, `TERM_PROGRAM_VERSION=${WARP_TERM_PROGRAM_VERSION}`, "COLORTERM=truecolor"],
    });
  });
});
