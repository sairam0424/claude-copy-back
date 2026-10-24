import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { forbiddenName } from "../lib/config.mjs";
import { PLUGIN_PARTS, copyPlugin, diffHashes, hashTree, liveEnv, protectedPaths, writeLiveFixtures } from "../lib/live-fixtures.mjs";
import { makeSandbox } from "../lib/sandbox.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cblive-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const REPO = path.resolve(import.meta.dirname, "..", "..");

describe("live fixtures", () => {
  test("the sealed environment puts the shim directory first on PATH and adds nothing forbidden", () => {
    const env = liveEnv({ home: "/h", port: 9, tmpdir: "/t", shimDir: "/shims" });
    const path0 = env.find(([k]) => k === "PATH")[1];
    assert.equal(path0, "/shims:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin");
    assert.equal(env.filter(([k]) => k === "PATH").length, 1);
    assert.equal(forbiddenName(env), null);
    assert.ok(env.some(([k, v]) => k === "ANTHROPIC_BASE_URL" && v === "http://127.0.0.1:9"));
    assert.ok(env.some(([k]) => k === "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"));
  });

  test("protected paths come from the real home and cover credentials, settings and captures", () => {
    const p = protectedPaths("/Users/x");
    assert.deepEqual(p.denyWrite, ["/Users/x"]);
    assert.deepEqual(p.denyRead, ["/Users/x/.claude", "/Users/x/.aws", "/Users/x/.ssh", "/Users/x/copy-back-captures"]);
    assert.deepEqual(p.denyReadLiteral, ["/Users/x/.claude.json"]);
  });

  test("the plugin copy is byte-identical to the source tree and says so", () => {
    const target = path.join(base, "copy");
    const r = copyPlugin(REPO, target);
    assert.deepEqual(r.mismatches, []);
    assert.ok(r.files > 20);
    for (const part of PLUGIN_PARTS) assert.deepEqual(hashTree(path.join(REPO, part)), hashTree(path.join(target, part)));
  });

  test("diffHashes reports a changed, a missing and an extra file", () => {
    const from = { "a.ts": "1", "b.ts": "2", "c.ts": "3" };
    assert.deepEqual(diffHashes(from, { ...from }, "hooks/"), []);
    assert.deepEqual(diffHashes(from, { "a.ts": "1", "b.ts": "X", "d.ts": "4" }, "hooks/"), ["hooks/b.ts", "hooks/c.ts", "hooks/d.ts (extra)"]);
  });

  test("writeLiveFixtures lays out home, session, shims, plugin, profile and a sandboxed launcher", () => {
    const sandbox = makeSandbox(base);
    const fx = writeLiveFixtures({ sandbox, port: 4321, claude: "/bin/claude", version: "2.1.309", sessionId: "abc", turns: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }], repo: REPO, realHome: "/Users/x" });
    for (const f of [fx.sessionFile, fx.profilePath, path.join(fx.shimDir, "pbpaste"), path.join(fx.pluginDir, "hooks", "register.tsx"), path.join(fx.pluginDir, ".claude-plugin", "plugin.json"), sandbox.launcher]) assert.ok(fs.existsSync(f), f);
    const launcher = fs.readFileSync(sandbox.launcher, "utf8");
    assert.match(launcher, /exec \/usr\/bin\/env -i/);
    assert.match(launcher, /'\/usr\/bin\/sandbox-exec' \\\n {2}'-f' \\\n {2}'[^']+seatbelt\.sb' \\\n {2}'\/bin\/claude' \\\n {2}'--resume' \\\n {2}'abc' \\\n {2}'--plugin-dir' \\\n {2}'[^']+\/plugin'/);
    assert.match(launcher, /PATH='[^']+\/shims:\/opt\/homebrew\/bin/);
    assert.equal(spawnSync("/bin/sh", ["-n", sandbox.launcher]).status, 0);
    assert.deepEqual(fx.plugin.mismatches, []);
    assert.match(fs.readFileSync(fx.profilePath, "utf8"), /pasteboard/);
    assert.equal(fs.readFileSync(path.join(sandbox.claudeDir, "settings.json"), "utf8").trim(), '{"tui":"default"}');
  });
});
