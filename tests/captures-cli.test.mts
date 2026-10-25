// The command line: parsing, defaults, and the shape of error messages.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { parseArgs } from "../src/captures/args.ts";
import { CapturesError, describeError } from "../src/captures/errors.ts";
import { HELP_TEXT } from "../src/captures/help.ts";
import { CANARY, makeCli } from "../src/captures/fixtures.ts";

const HOME = "/home/someone";
const parse = (...argv: string[]) => parseArgs(argv, HOME, "/work");
const codeOf = (...argv: string[]): string | null => {
  try {
    parse(...argv);
    return null;
  } catch (err) {
    return err instanceof CapturesError ? err.code : "OTHER";
  }
};

describe("parseArgs: defaults", () => {
  test("add, run and tally default to ~/copy-back-captures and ~/.claude/projects, 40 messages", () => {
    for (const command of ["add", "run", "tally"] as const) {
      const p = parse(command);
      assert.equal(p.command, command);
      assert.equal(p.dir, path.join(HOME, "copy-back-captures"));
      assert.equal(p.root, path.join(HOME, ".claude", "projects"));
      assert.equal(p.messages, 40);
      assert.equal(p.show, false);
      assert.equal(p.json, false);
    }
  });

  test("no command, --help and -h all mean help", () => {
    for (const argv of [
      [],
      ["--help"],
      ["-h"],
      ["run", "--help"],
      ["tally", "-h"],
    ])
      assert.equal(parse(...argv).command, "help");
  });
});

describe("parseArgs: values", () => {
  test("--dir and --root take a path as two words or with =", () => {
    assert.equal(parse("run", "--dir", "/x/caps").dir, "/x/caps");
    assert.equal(parse("run", "--dir=/x/caps").dir, "/x/caps");
    assert.equal(parse("run", "--root", "/r").root, "/r");
    assert.equal(parse("tally", "--root=/r").root, "/r");
  });

  test("a relative path is taken from the working directory, ~ from the home directory", () => {
    assert.equal(parse("run", "--dir", "caps").dir, "/work/caps");
    assert.equal(parse("run", "--dir=~/caps").dir, path.join(HOME, "caps"));
    assert.equal(parse("run", "--dir", "~").dir, HOME);
  });

  test("--messages is a whole number from 1 to 500", () => {
    assert.equal(parse("run", "--messages", "7").messages, 7);
    assert.equal(parse("tally", "--messages=500").messages, 500);
    for (const bad of ["0", "501", "-1", "1.5", "abc", "", "4e1", " 7"])
      assert.equal(
        codeOf("run", "--messages", bad),
        "BAD_VALUE",
        JSON.stringify(bad),
      );
  });

  test("--show belongs to run, --json to tally", () => {
    assert.equal(parse("run", "--show").show, true);
    assert.equal(parse("tally", "--json").json, true);
  });
});

describe("parseArgs: what is refused", () => {
  const refused: Array<[string[], string]> = [
    [["frobnicate"], "BAD_COMMAND"],
    [["--show"], "BAD_COMMAND"],
    [["add", "--show"], "BAD_OPTION"],
    [["add", "--note", "hi"], "BAD_OPTION"],
    [["add", "--root", "/r"], "BAD_OPTION"],
    [["add", "--messages", "3"], "BAD_OPTION"],
    [["run", "--json"], "BAD_OPTION"],
    [["tally", "--show"], "BAD_OPTION"],
    [["run", "--nope"], "BAD_OPTION"],
    [["run", "-x"], "BAD_OPTION"],
    [["run", "--dir"], "MISSING_VALUE"],
    [["run", "--dir", "--show"], "MISSING_VALUE"],
    [["run", "--messages"], "MISSING_VALUE"],
    [["run", "--show=yes"], "BAD_OPTION"],
    [["run", "extra"], "UNEXPECTED_ARGUMENT"],
    [["add", "extra"], "UNEXPECTED_ARGUMENT"],
  ];
  for (const [argv, code] of refused)
    test(`${argv.join(" ")} is ${code}`, () =>
      assert.equal(codeOf(...argv), code));
});

describe("error messages", () => {
  test("an option name that looks like one is echoed so the user can fix a typo", () => {
    const err = new CapturesError("BAD_OPTION", "--mesages");
    assert.match(describeError(err), /--mesages/);
  });

  test("anything else in the detail slot is dropped, never printed", () => {
    for (const detail of [
      CANARY,
      "/Users/me/secret/path",
      "--" + CANARY,
      "07; rm",
      "ok\nbad",
    ]) {
      const err = new CapturesError("BAD_OPTION", detail);
      assert.equal(err.detail, null);
      assert.ok(!describeError(err).includes(detail));
    }
    assert.equal(new CapturesError("CAPTURE_UNREADABLE", "07").detail, "07");
  });

  test("every message carries its code, and an unknown exception shows only its class name", () => {
    assert.match(
      describeError(new CapturesError("DIR_MISSING")),
      /\[DIR_MISSING\]/,
    );
    const weird = Object.assign(new Error(`secret ${CANARY}`), { name: "WeirdError" });
    const text = describeError(weird);
    assert.ok(!text.includes(CANARY) && !text.includes("secret"));
    assert.match(text, /WeirdError/);
    assert.ok(!describeError("a thrown string " + CANARY).includes(CANARY));
  });
});

describe("runCli", () => {
  const run = makeCli("/nonexistent-home");

  test("help goes to stdout with exit 0, and says everything the user needs", () => {
    const r = run(["--help"]);
    assert.deepEqual([r.code, r.err, r.out], [0, "", HELP_TEXT]);
    for (const word of [
      "add",
      "run",
      "tally",
      "--show",
      "USER-RUN ONLY",
      "Cmd+C",
      "~/copy-back-captures",
      "20",
      "70",
    ])
      assert.ok(HELP_TEXT.includes(word), word);
    assert.ok(HELP_TEXT.split("\n").length < 400);
  });

  test("a usage error prints one line to stderr and exits 2 with nothing on stdout", () => {
    const r = run(["run", "--nope"]);
    assert.equal(r.code, 2);
    assert.equal(r.out, "");
    assert.equal(r.err.trim().split("\n").length, 1);
    assert.match(r.err, /BAD_OPTION/);
  });
});
