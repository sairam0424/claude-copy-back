import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  DROPPABLE, EXPECTED_VERSION, PLACEHOLDER_AUTH, SEAL_PATH, buildClaudeJson,
  buildSettings, forbiddenName, hardeningEnv, sealedEnv, taskEnv,
} from "../lib/config.mjs";

describe("sealed environment", () => {
  const env = sealedEnv({ home: "/h", port: 4242, tmpdir: "/t" });
  const keys = env.map(([k]) => k);

  test("starts with exactly the nine baseline variables, in order", () => {
    assert.deepEqual(keys.slice(0, 9), [
      "PATH", "HOME", "TERM", "LANG", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN",
      "DISABLE_TELEMETRY", "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "DISABLE_AUTOUPDATER",
    ]);
    assert.equal(env[0][1], "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    assert.equal(env[0][1], SEAL_PATH);
  });

  test("API base is the loopback stub and the credential is the placeholder", () => {
    const map = Object.fromEntries(env);
    assert.equal(map.ANTHROPIC_BASE_URL, "http://127.0.0.1:4242");
    assert.equal(map.ANTHROPIC_AUTH_TOKEN, "dummy-token-not-real");
    assert.equal(PLACEHOLDER_AUTH, "dummy-token-not-real");
  });

  test("the rig adds exactly two variables, both of which only close a path", () => {
    assert.deepEqual(hardeningEnv({ tmpdir: "/t" }), [
      ["CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL", "1"],
      ["TMPDIR", "/t"],
    ]);
    assert.equal(keys.length, 11);
  });

  test("no cloud-provider, API-key or Bedrock variable can appear", () => {
    assert.equal(forbiddenName(env), null);
    for (const bad of ["AWS_PROFILE", "AWS_REGION", "ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK", "GOOGLE_APPLICATION_CREDENTIALS"]) {
      assert.equal(forbiddenName([...env, [bad, "x"]]), bad);
    }
  });

  test("taskEnv does not depend on anything outside its arguments", () => {
    assert.deepEqual(taskEnv({ home: "/h", port: 1 }), taskEnv({ home: "/h", port: 1 }));
  });
});

describe(".claude.json", () => {
  const parse = (drop) => JSON.parse(buildClaudeJson({ cwd: "/w", drop }));

  test("marks onboarding done, sets the theme and trusts the working directory", () => {
    const cfg = parse([]);
    assert.equal(cfg.hasCompletedOnboarding, true);
    assert.equal(cfg.lastOnboardingVersion, EXPECTED_VERSION);
    assert.equal(cfg.theme, "dark");
    assert.equal(cfg.projects["/w"].hasTrustDialogAccepted, true);
    assert.equal(cfg.projects["/w"].hasCompletedProjectOnboarding, true);
  });

  test("each droppable key can be left out, and only that key", () => {
    for (const key of DROPPABLE) {
      const full = JSON.stringify(parse([]));
      const less = JSON.stringify(parse([key]));
      assert.notEqual(full, less, key);
    }
    assert.equal(parse(["theme"]).theme, undefined);
    assert.equal(parse(["trust"]).projects["/w"].hasTrustDialogAccepted, undefined);
  });

  test("holds nothing that looks like an account or a credential", () => {
    const text = buildClaudeJson({ cwd: "/w" });
    for (const word of ["oauth", "account", "userID", "apiKey", "token", "email"]) {
      assert.equal(text.toLowerCase().includes(word.toLowerCase()), false, word);
    }
  });
});

describe("settings.json per renderer mode", () => {
  test("default writes no file, the others set tui", () => {
    assert.equal(buildSettings("default"), null);
    assert.deepEqual(JSON.parse(buildSettings("classic")), { tui: "default" });
    assert.deepEqual(JSON.parse(buildSettings("fullscreen")), { tui: "fullscreen" });
  });
});
