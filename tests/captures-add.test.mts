// `add`: the clipboard is an injected function in every test. The real
// pbpaste is never started (the production reader is checked with a fake exec).

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { addCapture, saveNextCapture } from "../src/captures/add.ts";
import {
  MAX_CLIPBOARD_BYTES,
  pbpasteReader,
} from "../src/captures/clipboard.ts";
import { CapturesError } from "../src/captures/errors.ts";
import { makeCli, scratch } from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);
const modeOf = (p: string): number => fs.statSync(p).mode & 0o777;
const names = (dir: string): string[] => fs.readdirSync(dir).sort();

describe("add: numbering and content", () => {
  test("saves the clipboard as 01.txt exactly and prints only the id and the length", () => {
    const home = tmp.make("home");
    const dir = path.join(tmp.make(), "caps");
    const text = "two  spaces\r\n  indented ünï\ttab\nlast line";
    const run = makeCli(home, () => text);
    const r = run(["add", "--dir", dir]);
    assert.deepEqual(
      { code: r.code, out: r.out, err: r.err },
      { code: 0, out: `saved 01 (${[...text].length} characters)\n`, err: "" },
    );
    assert.equal(fs.readFileSync(path.join(dir, "01.txt"), "utf8"), text);
    assert.deepEqual(names(dir), ["01.txt"]);
  });

  test("adds nothing: no trailing newline, none removed", () => {
    const dir = path.join(tmp.make(), "caps");
    const run = makeCli(tmp.make("home"), () => "ends with newline\n");
    run(["add", "--dir", dir]);
    assert.equal(
      fs.readFileSync(path.join(dir, "01.txt"), "utf8"),
      "ends with newline\n",
    );
  });

  test("numbers continue 01, 02, 03", () => {
    const dir = path.join(tmp.make(), "caps");
    const run = makeCli(tmp.make("home"), () => "some copied words");
    const outs = [0, 1, 2].map(() => run(["add", "--dir", dir]).out);
    assert.deepEqual(outs, [
      "saved 01 (17 characters)\n",
      "saved 02 (17 characters)\n",
      "saved 03 (17 characters)\n",
    ]);
  });

  test("the next number is the highest plus one, so a deleted capture never renumbers the rest", () => {
    const dir = path.join(tmp.make(), "caps");
    fs.mkdirSync(dir);
    for (const id of ["01", "05"])
      fs.writeFileSync(path.join(dir, `${id}.txt`), "old");
    fs.writeFileSync(path.join(dir, "03.verdict"), "ok");
    const r = makeCli(
      tmp.make("home"),
      () => "new words here",
    )(["add", "--dir", dir]);
    assert.equal(r.out, "saved 06 (14 characters)\n");
    assert.equal(fs.readFileSync(path.join(dir, "05.txt"), "utf8"), "old");
  });

  test("the length counts characters, not UTF-16 units", () => {
    const dir = path.join(tmp.make(), "caps");
    const r = makeCli(
      tmp.make("home"),
      () => "a\u{1F600}b",
    )(["add", "--dir", dir]);
    assert.equal(r.out, "saved 01 (3 characters)\n");
  });

  test("with no --dir it uses copy-back-captures under the home directory", () => {
    const home = tmp.make("home");
    makeCli(home, () => "some copied words")(["add"]);
    assert.deepEqual(names(path.join(home, "copy-back-captures")), ["01.txt"]);
  });

  test("a directory with 99 captures is full and nothing is written", () => {
    const dir = path.join(tmp.make(), "caps");
    fs.mkdirSync(dir);
    for (let n = 1; n <= 99; n++)
      fs.writeFileSync(
        path.join(dir, `${String(n).padStart(2, "0")}.txt`),
        "x",
      );
    const r = makeCli(
      tmp.make("home"),
      () => "one more",
    )(["add", "--dir", dir]);
    assert.equal(r.code, 2);
    assert.match(r.err, /CAPTURES_FULL/);
    assert.equal(names(dir).length, 99);
  });
});

describe("add: refusals", () => {
  for (const [name, clip] of [
    ["empty", ""],
    ["only spaces and newlines", "  \n\t \r\n "],
  ] as const) {
    test(`an ${name} clipboard is refused and nothing, not even the folder, is created`, () => {
      const dir = path.join(tmp.make(), "caps");
      const r = makeCli(tmp.make("home"), () => clip)(["add", "--dir", dir]);
      assert.equal(r.code, 2);
      assert.equal(r.out, "");
      assert.match(r.err, /CLIPBOARD_EMPTY/);
      assert.equal(fs.existsSync(dir), false);
    });
  }

  test("a clipboard over 4 MiB is refused", () => {
    const dir = path.join(tmp.make(), "caps");
    const big = "a".repeat(MAX_CLIPBOARD_BYTES + 1);
    assert.throws(
      () => addCapture(dir, () => big),
      (e: unknown) =>
        e instanceof CapturesError && e.code === "CLIPBOARD_TOO_LARGE",
    );
    assert.equal(fs.existsSync(dir), false);
  });

  test("a failing clipboard reader gives a fixed code, never its message", () => {
    const dir = path.join(tmp.make(), "caps");
    assert.throws(
      () =>
        addCapture(dir, () => {
          throw new Error("secret-words-in-the-message");
        }),
      (e: unknown) =>
        e instanceof CapturesError &&
        e.code === "CLIPBOARD_UNREADABLE" &&
        !e.message.includes("secret-words"),
    );
  });

  for (const argv of [
    ["add", "--show"],
    ["add", "--note", "hi"],
    ["add", "stray"],
    ["add", "--dir"],
  ]) {
    test(`add ${argv.slice(1).join(" ")} fails before the clipboard is read`, () => {
      const r = makeCli(tmp.make("home"))(argv);
      assert.equal(r.code, 2);
      assert.equal(r.out, "");
    });
  }
});

describe("add: file modes", () => {
  test("a new folder is 0700 and each capture 0600", () => {
    const dir = path.join(tmp.make(), "a", "caps");
    makeCli(
      tmp.make("home"),
      () => "private words go here",
    )(["add", "--dir", dir]);
    assert.equal(modeOf(dir), 0o700);
    assert.equal(modeOf(path.join(dir, "01.txt")), 0o600);
  });

  test("an existing folder keeps its permissions (it may not be ours)", () => {
    const dir = path.join(tmp.make(), "caps");
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.chmodSync(dir, 0o755);
    makeCli(
      tmp.make("home"),
      () => "private words go here",
    )(["add", "--dir", dir]);
    assert.equal(modeOf(dir), 0o755);
    assert.equal(modeOf(path.join(dir, "01.txt")), 0o600);
  });

  test("a folder path that is a file fails with a fixed code and no path", () => {
    const file = path.join(tmp.make(), "not-a-folder");
    fs.writeFileSync(file, "x");
    const r = makeCli(
      tmp.make("home"),
      () => "some words",
    )(["add", "--dir", file]);
    assert.equal(r.code, 2);
    assert.match(r.err, /DIR_NOT_WRITABLE/);
    assert.ok(!r.err.includes(file));
  });
});

describe("add: two adds at once never overwrite", () => {
  test("a stale listing that offers a taken number is retried with the next free one", () => {
    const dir = tmp.make();
    fs.writeFileSync(path.join(dir, "01.txt"), "first");
    const views: number[][] = [[], [1]];
    const id = saveNextCapture(dir, "second", () => views.shift() ?? [1]);
    assert.equal(id, "02");
    assert.equal(fs.readFileSync(path.join(dir, "01.txt"), "utf8"), "first");
    assert.equal(fs.readFileSync(path.join(dir, "02.txt"), "utf8"), "second");
  });
});

describe("the production clipboard reader (fake exec, the real pbpaste is never run)", () => {
  type Call = {
    file: string;
    args: readonly string[];
    options: Record<string, unknown>;
  };

  function fakeExec(result: () => string): { exec: never; calls: Call[] } {
    const calls: Call[] = [];
    const exec = (
      file: string,
      args: readonly string[],
      options: Record<string, unknown>,
    ) => {
      calls.push({ file, args, options });
      return result();
    };
    return { exec: exec as never, calls };
  }

  test("runs pbpaste directly: utf8, 4 MiB cap, no shell, stderr dropped, UTF-8 locale", () => {
    const { exec, calls } = fakeExec(() => "clip text");
    assert.equal(pbpasteReader(exec)(), "clip text");
    const [call] = calls as [Call];
    assert.equal(call.file, "pbpaste");
    assert.deepEqual(call.args, []);
    assert.equal(call.options["encoding"], "utf8");
    assert.equal(call.options["maxBuffer"], 4 * 1024 * 1024);
    assert.equal(MAX_CLIPBOARD_BYTES, 4 * 1024 * 1024);
    assert.ok(!("shell" in call.options) || call.options["shell"] === false);
    assert.deepEqual((call.options["stdio"] as string[])[2], "ignore");
    const env = call.options["env"] as Record<string, string>;
    assert.match(env["LANG"] as string, /UTF-8$/);
  });

  test("an output over the cap becomes CLIPBOARD_TOO_LARGE, any other failure CLIPBOARD_UNREADABLE", () => {
    const tooBig = fakeExec(() => {
      throw Object.assign(new Error("spawnSync pbpaste ENOBUFS secret-words"), {
        code: "ENOBUFS",
      });
    });
    const broken = fakeExec(() => {
      throw new Error("pbpaste: secret-words");
    });
    for (const [fake, code] of [
      [tooBig, "CLIPBOARD_TOO_LARGE"],
      [broken, "CLIPBOARD_UNREADABLE"],
    ] as const)
      assert.throws(
        () => pbpasteReader(fake.exec)(),
        (e: unknown) =>
          e instanceof CapturesError &&
          e.code === code &&
          !e.message.includes("secret-words"),
      );
  });
});
