import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { MATCHER_DIGEST_RECIPE, TREE_DIGEST_RECIPE, buildFreeze, hashTreeFiles, matcherDigest, treeDigest, verifyFreeze } from "../lib/freeze.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbfreeze-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const sha = (data) => createHash("sha256").update(data).digest("hex");

/** A tiny repository: .claude-plugin, hooks, src/core and a rule file. */
function repo(name) {
  const root = path.join(base, name);
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  put(".claude-plugin/plugin.json", "{}\n");
  put("hooks/cc.ts", "export const a = 1;\n");
  put("src/core/b.ts", "export const b = 2;\n");
  put("src/core/a.ts", "export const a = 1;\n");
  put("realrender/lib/rule3.mjs", "export const RULE = 3;\n");
  return root;
}

describe("the tree digest recipe is written down and it is the one that is computed", () => {
  test("the recipe text names the order, the line format and the hash", () => {
    assert.match(TREE_DIGEST_RECIPE, /ascending/);
    assert.match(TREE_DIGEST_RECIPE, /relative path/);
    assert.match(TREE_DIGEST_RECIPE, /SHA-256/);
  });

  test("an independent computation that follows only the recipe text gives the same digest", () => {
    const files = { "b/z.txt": sha("z"), "a/y.txt": sha("y"), "a.txt": sha("a") };
    const expected = createHash("sha256");
    for (const rel of ["a.txt", "a/y.txt", "b/z.txt"]) expected.update(`${rel}\n${files[rel]}\n`);
    assert.equal(treeDigest(files), expected.digest("hex"));
  });

  test("the order is by path bytes, not by insertion order", () => {
    const one = treeDigest({ "b.txt": sha("1"), "a.txt": sha("2") });
    const two = treeDigest({ "a.txt": sha("2"), "b.txt": sha("1") });
    assert.equal(one, two);
  });

  test("a changed byte, a renamed file or a missing file changes the digest", () => {
    const files = { "a.txt": sha("a"), "b.txt": sha("b") };
    const d = treeDigest(files);
    assert.notEqual(treeDigest({ ...files, "a.txt": sha("A") }), d);
    assert.notEqual(treeDigest({ "c.txt": files["a.txt"], "b.txt": files["b.txt"] }), d);
    assert.notEqual(treeDigest({ "b.txt": files["b.txt"] }), d);
  });

  test("hashTreeFiles walks the parts and keys by path relative to the root", () => {
    const root = repo("walk");
    const files = hashTreeFiles(root, [".claude-plugin", "hooks", "src"]);
    assert.deepEqual(Object.keys(files).sort(), [".claude-plugin/plugin.json", "hooks/cc.ts", "src/core/a.ts", "src/core/b.ts"]);
    assert.equal(files["hooks/cc.ts"], sha("export const a = 1;\n"));
  });
});

describe("matcherDigest: the recipe measure.mjs has always used", () => {
  test("sorted file names, each name plus a newline then the content", () => {
    const root = repo("matcher");
    const expected = createHash("sha256");
    for (const f of ["a.ts", "b.ts"]) expected.update(`${f}\n`).update(fs.readFileSync(path.join(root, "src/core", f)));
    assert.equal(matcherDigest(path.join(root, "src/core")), expected.digest("hex"));
    assert.match(MATCHER_DIGEST_RECIPE, /name/);
  });
});

describe("freeze.json", () => {
  const options = (root) => ({
    root, parts: [".claude-plugin", "hooks", "src"], ruleFiles: ["realrender/lib/rule3.mjs"],
    profile: "warp", claudeVersion: "2.1.310", now: new Date("2026-10-24T13:00:00Z"),
  });

  test("records the profile, the rule files, the plugin tree with its per-file hashes and BOTH recipes", () => {
    const root = repo("build");
    const f = buildFreeze(options(root));
    assert.equal(f.profile, "warp");
    assert.deepEqual(f.profileAdded.length, 3);
    assert.equal(f.frozenAt, "2026-10-24T13:00:00.000Z");
    assert.equal(f.claudeVersion, "2.1.310");
    assert.equal(f.rule.files[0].path, "realrender/lib/rule3.mjs");
    assert.equal(f.rule.files[0].sha256, sha("export const RULE = 3;\n"));
    assert.equal(f.pluginTree.files, 4);
    assert.equal(f.pluginTree.treeSha256, treeDigest(f.pluginTree.fileSha256));
    assert.equal(f.pluginTree.recipe, TREE_DIGEST_RECIPE);
    assert.equal(f.matcher.sha256, matcherDigest(path.join(root, "src/core")));
    assert.equal(f.matcher.recipe, MATCHER_DIGEST_RECIPE);
  });

  test("a freeze verifies against the tree it was made from, from the file alone", () => {
    const root = repo("verify");
    const f = JSON.parse(JSON.stringify(buildFreeze(options(root))));
    assert.deepEqual(verifyFreeze(f, root), { ok: true, mismatches: [] });
  });

  test("an edited, removed or added file is named", () => {
    const root = repo("drift");
    const f = JSON.parse(JSON.stringify(buildFreeze(options(root))));
    fs.writeFileSync(path.join(root, "hooks/cc.ts"), "export const a = 99;\n");
    fs.writeFileSync(path.join(root, "src/core/new.ts"), "x\n");
    fs.rmSync(path.join(root, ".claude-plugin/plugin.json"));
    fs.writeFileSync(path.join(root, "realrender/lib/rule3.mjs"), "export const RULE = 4;\n");
    const out = verifyFreeze(f, root);
    assert.equal(out.ok, false);
    const text = out.mismatches.join("\n");
    assert.match(text, /hooks\/cc\.ts/);
    assert.match(text, /src\/core\/new\.ts \(extra\)/);
    assert.match(text, /\.claude-plugin\/plugin\.json \(missing\)/);
    assert.match(text, /rule3\.mjs/);
    assert.match(text, /treeSha256/);
  });

  test("a freeze whose tree digest was tampered with is caught even if every file hash is right", () => {
    const root = repo("tamper");
    const f = JSON.parse(JSON.stringify(buildFreeze(options(root))));
    f.pluginTree.treeSha256 = "0".repeat(64);
    assert.match(verifyFreeze(f, root).mismatches.join("\n"), /treeSha256/);
  });

  test("the file holds no absolute path and no user name", () => {
    const root = repo("clean");
    const text = JSON.stringify(buildFreeze(options(root)));
    assert.equal(text.includes(base), false);
    assert.equal(text.includes(os.userInfo().username), false);
  });
});

describe("freeze.mjs command line", () => {
  test("--out needs no other flag, --rule repeats, an unknown flag or profile is refused", async () => {
    const { parseFreezeArgs } = await import("../freeze.mjs");
    const o = parseFreezeArgs(["--out", "f.json", "--rule", "a", "--rule", "b", "--profile", "warp"]);
    assert.deepEqual([o.out, o.rule, o.profile], ["f.json", ["a", "b"], "warp"]);
    assert.equal(parseFreezeArgs(["--out", "f.json"]).profile, "default");
    assert.equal(parseFreezeArgs(["--out", "f.json"]).parts, undefined);
    assert.deepEqual(parseFreezeArgs(["--out", "f.json", "--parts", "src,hooks"]).parts, ["src", "hooks"]);
    assert.throws(() => parseFreezeArgs(["--bogus", "1"]), /bad flag/);
    assert.throws(() => parseFreezeArgs(["--profile", "warp"]), /need --out/);
    assert.throws(() => parseFreezeArgs(["--out", "f", "--profile", "x"]), /unknown profile/);
  });
});
