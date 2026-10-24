import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { sealedEnv } from "../lib/config.mjs";
import { buildLauncher, shQuote } from "../lib/launcher.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrender-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("launcher script", () => {
  test("shQuote survives apostrophes and spaces", () => {
    assert.equal(shQuote("a b"), "'a b'");
    assert.equal(shQuote("it's"), "'it'\\''s'");
  });

  const script = buildLauncher({
    pidFile: "/p/claude.pid", cwd: "/w",
    env: sealedEnv({ home: "/h", port: 9, tmpdir: "/t" }),
    claude: "/bin/claude", args: ["--resume", "abc"],
  });

  test("records its pid, enters the cwd, then execs under env -i with nothing inherited", () => {
    const rows = script.split("\n");
    assert.equal(rows[0], "#!/bin/sh");
    assert.equal(rows[1], "echo $$ > '/p/claude.pid'");
    assert.equal(rows[2], "cd '/w' || exit 9");
    assert.match(script, /exec \/usr\/bin\/env -i \\\n {2}PATH='\/opt\/homebrew\/bin:\/usr\/local\/bin:\/usr\/bin:\/bin'/);
    assert.match(script, /'\/bin\/claude' \\\n {2}'--resume' \\\n {2}'abc'\n$/);
  });

  test("never expands a shell variable and never pulls in the caller's environment", () => {
    const afterPid = script.split("\n").slice(2).join("\n");
    assert.equal(afterPid.includes("$"), false);
    assert.equal(/\bAWS_|ANTHROPIC_API_KEY|BEDROCK/.test(script), false);
  });

  test("is valid POSIX shell (sh -n)", () => {
    const file = path.join(base, "l.sh");
    fs.writeFileSync(file, script);
    const r = spawnSync("/bin/sh", ["-n", file], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
  });

  test("the env it execs really is only the listed pairs (run it with a fake claude)", () => {
    const fake = path.join(base, "fake-claude.sh");
    // A node script, not a shell script: a shell adds PWD, SHLVL and _ by itself.
    const printEnv = 'console.log(Object.keys(process.env).join("\\n"));\n';
    fs.writeFileSync(fake, `#!${process.execPath}\n${printEnv}`, { mode: 0o700 });
    const pidFile = path.join(base, "pid");
    const s = buildLauncher({ pidFile, cwd: base, env: sealedEnv({ home: "/h", port: 9, tmpdir: "/t" }), claude: fake, args: [] });
    const file = path.join(base, "run.sh");
    fs.writeFileSync(file, s, { mode: 0o700 });
    const r = spawnSync(file, [], { encoding: "utf8", env: { SECRET_CANARY: "leak", AWS_PROFILE: "leak", PATH: "/usr/bin:/bin" } });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.includes("leak"), false);
    // macOS itself adds __CF_USER_TEXT_ENCODING to any CoreFoundation-linked process.
    const names = r.stdout.trim().split("\n").filter((n) => n !== "__CF_USER_TEXT_ENCODING").sort();
    assert.deepEqual(names, sealedEnv({ home: "/h", port: 9, tmpdir: "/t" }).map(([k]) => k).sort());
    assert.equal(fs.readFileSync(pidFile, "utf8").trim().match(/^\d+$/) !== null, true);
  });
});
