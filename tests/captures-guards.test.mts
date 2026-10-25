// Guards around the one command that prints text and the one that writes it.
//   P1  run --show refuses when stdout is not a terminal (unless --allow-redirect).
//   I4  run --show never prints raw control characters.
//   P2  add refuses a folder inside a git repository or the project.
//   I3  an empty value for --dir, --root or --project is an error, not "here".
// Synthetic worlds and an injected clipboard only.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/captures/args.ts";
import { assertPrivateFolder } from "../src/captures/folder-guard.ts";
import { CapturesError } from "../src/captures/errors.ts";
import { escapeControls, renderShow } from "../src/captures/show.ts";
import {
  CANARY,
  MINUTE,
  T0,
  makeCli,
  scratch,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
} from "../src/captures/fixtures.ts";

const SCRIPT = fileURLToPath(
  new URL("../scripts/captures.mjs", import.meta.url),
);
const tmp = scratch();
after(tmp.cleanup);

function world(extra = "") {
  const root = tmp.make("root");
  const dir = path.join(tmp.make(), "caps");
  writeSession(root, "p/main.jsonl", [{ at: T0, text: worldMessage(1) }]);
  writeCapture(dir, "01", worldCopy(1), T0 + MINUTE);
  if (extra !== "") writeCapture(dir, "02", extra, T0 + MINUTE);
  return { root, dir };
}

describe("P1: run --show needs a terminal", () => {
  const home = tmp.make("home");
  const { root, dir } = world(`secret ${CANARY} words that match nothing`);
  const argv = ["run", "--dir", dir, "--root", root, "--show"];

  test("refused when stdout is not a terminal: exit 2, a fixed-word error, no text, nothing evaluated", () => {
    const r = makeCli(home, undefined, { terminal: false })(argv);
    assert.equal(r.code, 2);
    assert.equal(r.out, "");
    assert.match(r.err, /\[SHOW_NEEDS_TERMINAL\]/);
    assert.match(r.err, /own terminal/);
    assert.match(r.err, /--allow-redirect/);
    assert.equal(r.err.includes(CANARY), false);
    assert.equal(r.err.trim().split("\n").length, 1);
  });

  test("the error says never to run it inside Claude Code or with !", () => {
    const r = makeCli(home, undefined, { terminal: false })(argv);
    assert.match(r.err, /Claude Code/);
    assert.match(r.err, /!/);
  });

  test("allowed at a terminal, with the banner", () => {
    const r = makeCli(home, undefined, { terminal: true })(argv);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(CANARY));
    assert.match(r.err, /USER-RUN ONLY/);
  });

  test("allowed without a terminal only with the explicit second flag, still with the banner", () => {
    const r = makeCli(home, undefined, { terminal: false })([
      ...argv,
      "--allow-redirect",
    ]);
    assert.equal(r.code, 0);
    assert.ok(r.out.includes(CANARY));
    assert.match(r.err, /USER-RUN ONLY/);
  });

  test("plain run and tally never need a terminal", () => {
    const cli = makeCli(home, undefined, { terminal: false });
    assert.equal(cli(["run", "--dir", dir, "--root", root]).code, 0);
    assert.equal(cli(["tally", "--dir", dir, "--root", root]).code, 0);
  });

  test("--allow-redirect belongs to run only", () => {
    for (const command of ["add", "tally"])
      assert.throws(
        () => parseArgs([command, "--allow-redirect"], "/h"),
        (e: unknown) => e instanceof CapturesError && e.code === "BAD_OPTION",
      );
    assert.equal(
      parseArgs(["run", "--show", "--allow-redirect"], "/h").allowRedirect,
      true,
    );
    assert.equal(parseArgs(["run", "--show"], "/h").allowRedirect, false);
  });

  test("the real script: piped stdout is refused, and --allow-redirect lets it through", () => {
    const go = (args: string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        cwd: home,
        timeout: 60_000,
      });
    const refused = go(argv);
    assert.equal(refused.status, 2);
    assert.equal(refused.stdout, "");
    assert.equal(refused.stderr.includes(CANARY), false);
    assert.match(refused.stderr, /SHOW_NEEDS_TERMINAL/);
    const allowed = go([...argv, "--allow-redirect"]);
    assert.equal(allowed.status, 0);
    assert.ok(allowed.stdout.includes(CANARY));
    assert.match(allowed.stderr, /USER-RUN ONLY/);
  });
});

describe("I4: run --show prints no raw control characters", () => {
  const RAW = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

  test("escapeControls: C0 (except newline and tab), DEL and C1 become visible escapes", () => {
    const table: Array<[string, string]> = [
      ["\u001b[31mred\u001b[0m", "\\x1b[31mred\\x1b[0m"],
      ["a\u0007b", "a\\x07b"],
      ["a\u0000b", "a\\x00b"],
      ["a\rb", "a\\x0db"],
      ["a\u007fb", "a\\x7fb"],
      ["a\u009bb", "a\\x9bb"],
      ["\u001b]52;c;QUJD\u0007", "\\x1b]52;c;QUJD\\x07"],
      ["plain\ttab\nnewline", "plain\ttab\nnewline"],
      ["accents é ü and emoji 😀", "accents é ü and emoji 😀"],
    ];
    for (const [raw, shown] of table) assert.equal(escapeControls(raw), shown);
  });

  test("escapeControls output never matches the raw-control pattern", () => {
    const all = Array.from({ length: 0xa0 }, (_, i) =>
      String.fromCharCode(i),
    ).join("");
    assert.equal(RAW.test(escapeControls(all).replace(/[\n\t]/g, "")), false);
  });

  test("a copied text with escape sequences prints escaped", () => {
    const { root, dir } = world(
      "before \u001b[31mred\u001b[0m after the colour and the rest of it",
    );
    const r = makeCli(tmp.make("home"))([
      "run",
      "--dir",
      dir,
      "--root",
      root,
      "--show",
    ]);
    assert.equal(RAW.test(r.out.replace(/[\n\t]/g, "")), false);
    assert.ok(r.out.includes("before \\x1b[31mred\\x1b[0m after"));
  });

  test("the paste text is escaped too (it comes from model output)", () => {
    const text = renderShow(
      [
        {
          id: "01",
          kind: "ok",
          copied: "copy",
          paste: "pasted \u001b]52;c;QUJD\u0007 end",
          differsFromExact: false,
          code: "0123abcd",
        },
      ],
      "/tmp/caps",
    );
    assert.equal(RAW.test(text.replace(/[\n\t]/g, "")), false);
    assert.ok(text.includes("pasted \\x1b]52;c;QUJD\\x07 end"));
  });

  test("the legend says that control characters are shown as escapes", () => {
    assert.match(renderShow([], "/tmp/caps"), /\\xNN/);
  });
});

describe("P2: add refuses a folder inside a git repository or the project", () => {
  const base = tmp.make("guard");
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "worktree");
  const project = path.join(base, "project");
  const outside = path.join(base, "elsewhere");
  for (const d of [
    repo,
    worktree,
    project,
    outside,
    path.join(base, "project-other"),
  ])
    fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(path.join(repo, ".git"));
  fs.writeFileSync(path.join(worktree, ".git"), "gitdir: /somewhere\n");
  fs.symlinkSync(repo, path.join(base, "link-to-repo"));

  const refused = (dir: string) =>
    assert.throws(
      () => assertPrivateFolder(dir, project),
      (e: unknown) =>
        e instanceof CapturesError && e.code === "DIR_NOT_PRIVATE",
      dir,
    );

  test("inside a repository (not yet created, existing, or the root of it)", () => {
    refused(path.join(repo, "sub", "caps"));
    refused(path.join(repo, "caps"));
    refused(repo);
  });

  test("inside a worktree, where .git is a file", () => {
    refused(path.join(worktree, "caps"));
  });

  test("through a symlink that points into a repository", () => {
    refused(path.join(base, "link-to-repo", "new", "caps"));
  });

  test("through a symlink to a SUBFOLDER of a repository or of the project (the link's own parents hold no .git)", () => {
    const inner = path.join(repo, "inner");
    fs.mkdirSync(inner, { recursive: true });
    fs.mkdirSync(path.join(project, "inner"), { recursive: true });
    fs.symlinkSync(inner, path.join(base, "link-to-inner"));
    fs.symlinkSync(path.join(project, "inner"), path.join(base, "link-to-project-inner"));
    refused(path.join(base, "link-to-inner", "new", "caps"));
    refused(path.join(base, "link-to-project-inner", "new", "caps"));
  });

  test("inside the project folder, or the project folder itself", () => {
    refused(path.join(project, "tests", "caps"));
    refused(project);
  });

  test("outside every repository and the project: fine, and nothing is created", () => {
    assertPrivateFolder(path.join(outside, "new", "caps"), project);
    assertPrivateFolder(path.join(base, "project-other", "caps"), project);
    assert.equal(fs.existsSync(path.join(outside, "new")), false);
  });

  test("the error never carries a path", () => {
    const hidden = path.join(repo, `x-${CANARY}`);
    assert.throws(
      () => assertPrivateFolder(hidden, project),
      (e: unknown) =>
        e instanceof Error &&
        !e.message.includes(CANARY) &&
        !e.message.includes(base),
    );
  });

  test("add: refused before the clipboard is read, and nothing is created", () => {
    let reads = 0;
    const cli = makeCli(
      tmp.make("home"),
      () => {
        reads++;
        return "some copied text";
      },
      { projectRoot: project },
    );
    for (const dir of [path.join(repo, "caps"), path.join(project, "caps")]) {
      const r = cli(["add", "--dir", dir]);
      assert.equal(r.code, 2, dir);
      assert.match(r.err, /\[DIR_NOT_PRIVATE\]/);
      assert.equal(r.out, "");
      assert.equal(fs.existsSync(dir), false);
    }
    assert.equal(reads, 0);
  });

  test("add: a relative --dir is judged where it lands (cwd inside a repository)", () => {
    const cli = makeCli(tmp.make("home"), () => "text", {
      cwd: repo,
      projectRoot: project,
    });
    const r = cli(["add", "--dir", "caps"]);
    assert.equal(r.code, 2);
    assert.match(r.err, /DIR_NOT_PRIVATE/);
    assert.equal(fs.existsSync(path.join(repo, "caps")), false);
  });

  test("add: outside is saved as always", () => {
    const cli = makeCli(tmp.make("home"), () => "some copied text", {
      projectRoot: project,
    });
    const dir = path.join(outside, "saved");
    const r = cli(["add", "--dir", dir]);
    assert.deepEqual([r.code, r.out], [0, "saved 01 (16 characters)\n"]);
    assert.equal(
      fs.readFileSync(path.join(dir, "01.txt"), "utf8"),
      "some copied text",
    );
  });

  test("run and tally only read, so they still work on a folder inside a repository", () => {
    const dir = path.join(repo, "caps-existing");
    writeCapture(dir, "01", worldCopy(1), T0 + MINUTE);
    const root = tmp.make("root");
    writeSession(root, "p/main.jsonl", [{ at: T0, text: worldMessage(1) }]);
    const cli = makeCli(tmp.make("home"), undefined, { projectRoot: project });
    assert.equal(cli(["run", "--dir", dir, "--root", root]).code, 0);
    assert.equal(cli(["tally", "--dir", dir, "--root", root]).code, 0);
  });
});

describe("I3: an empty value is not 'here'", () => {
  const empty: string[][] = [
    ["add", "--dir", ""],
    ["add", "--dir="],
    ["add", "--dir", "   "],
    ["run", "--dir", ""],
    ["run", "--root", ""],
    ["run", "--root="],
    ["tally", "--dir="],
    ["tally", "--root", " "],
    ["run", "--project", ""],
    ["tally", "--project="],
  ];
  for (const argv of empty)
    test(`${JSON.stringify(argv)} is MISSING_VALUE`, () =>
      assert.throws(
        () => parseArgs(argv, "/h"),
        (e: unknown) =>
          e instanceof CapturesError && e.code === "MISSING_VALUE",
      ));

  test("add --dir '' writes nothing into the current folder and never reads the clipboard", () => {
    const here = tmp.make("cwd");
    let reads = 0;
    const cli = makeCli(
      tmp.make("home"),
      () => {
        reads++;
        return "text";
      },
      { cwd: here },
    );
    for (const argv of [
      ["add", "--dir", ""],
      ["add", "--dir="],
    ]) {
      const r = cli(argv);
      assert.equal(r.code, 2);
      assert.match(r.err, /MISSING_VALUE/);
    }
    assert.deepEqual(fs.readdirSync(here), []);
    assert.equal(reads, 0);
  });

  test("a real value still works, and --project is a value of run and tally only", () => {
    assert.equal(
      parseArgs(["run", "--project", "my-app"], "/h").project,
      "my-app",
    );
    assert.equal(
      parseArgs(["tally", "--project=my-app"], "/h").project,
      "my-app",
    );
    assert.equal(parseArgs(["run"], "/h").project, null);
    assert.throws(
      () => parseArgs(["add", "--project", "x"], "/h"),
      (e: unknown) => e instanceof CapturesError && e.code === "BAD_OPTION",
    );
  });
});
