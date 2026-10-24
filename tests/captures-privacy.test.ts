// PRIVACY. A canary planted in the captures, the transcripts, the verdict
// files, the clipboard and the arguments must never reach stdout or stderr of
// add, run or tally in default mode, on the happy path or any error path.
// Only an explicit `run --show` prints text, and it says so on stderr first.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CANARY,
  MINUTE,
  T0,
  makeCli,
  scratch,
  snapshot,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
  writeVerdict,
} from "../src/captures/fixtures.ts";

const SCRIPT = fileURLToPath(
  new URL("../scripts/captures.mjs", import.meta.url),
);
const tmp = scratch();
after(tmp.cleanup);
const isRoot = process.getuid?.() === 0;

/** A world full of canaries: captures, transcripts (text, user turn, malformed line) and verdicts. */
function canaryWorld() {
  const root = tmp.make("root");
  const dir = path.join(tmp.make(), "caps");
  const message = `${worldMessage(1)} Extra sentence with ${CANARY} inside it for the copy.`;
  writeSession(
    root,
    "p/main.jsonl",
    [
      { at: T0, text: message },
      { at: T0 + MINUTE, text: `a user turn with ${CANARY}`, kind: "user" },
      { at: T0 + 2 * MINUTE, text: worldMessage(2) },
    ],
    {
      raw: [
        `{"type":"assistant","message":{"content":[{"type":"text","text":"${CANARY} cut`,
      ],
    },
  );
  const now = T0 + 5 * MINUTE;
  writeCapture(
    dir,
    "01",
    `${worldCopy(1).split("\n")[0]}\n  above the quiet harbour`,
    now,
  );
  writeCapture(
    dir,
    "02",
    `unrelated words ${CANARY} that match nothing anywhere`,
    now,
  );
  writeCapture(dir, "03", CANARY, now);
  writeCapture(
    dir,
    "04",
    "Extra sentence with " + CANARY + " inside\n  it for the copy.",
    now,
  );
  writeVerdict(dir, "01", "ok\n");
  writeVerdict(dir, "02", `${CANARY}\n`);
  writeVerdict(dir, "03", "bad");
  return { root, dir };
}

describe("default mode never prints text, on any path", () => {
  const world = canaryWorld();
  const home = tmp.make("home");
  const stranger = path.join(tmp.make(), `no-such-${CANARY}`);
  const fileNotDir = path.join(tmp.make(), `file-${CANARY}`);
  fs.writeFileSync(fileNotDir, CANARY);
  const hugeDir = tmp.make("caps");
  writeCapture(hugeDir, "01", `${CANARY}${"a".repeat(4 * 1024 * 1024)}`, T0);
  const unreadableDir = tmp.make("caps");
  const unreadable = writeCapture(unreadableDir, "01", `${CANARY} private`, T0);
  const unreadableVerdictDir = path.join(tmp.make(), "caps");
  writeCapture(unreadableVerdictDir, "01", worldCopy(1), T0 + MINUTE);
  writeVerdict(unreadableVerdictDir, "01", `${CANARY}\n`);
  const { root, dir } = world;

  before(() => {
    fs.chmodSync(unreadable, 0o000);
    fs.chmodSync(path.join(unreadableVerdictDir, "01.verdict"), 0o000);
  });
  after(() => {
    fs.chmodSync(unreadable, 0o600);
    fs.chmodSync(path.join(unreadableVerdictDir, "01.verdict"), 0o600);
  });

  const clipboardWith = (text: string) => () => text;
  const throwing = () => {
    throw new Error(`clipboard failure ${CANARY}`);
  };
  const scenarios: Array<[string, string[], (() => string) | undefined]> = [
    [
      "add: saved",
      ["add", "--dir", path.join(tmp.make(), "c")],
      clipboardWith(`copied ${CANARY} text`),
    ],
    [
      "add: empty clipboard",
      ["add", "--dir", path.join(tmp.make(), "c")],
      clipboardWith(""),
    ],
    [
      "add: reader throws with the canary",
      ["add", "--dir", path.join(tmp.make(), "c")],
      throwing,
    ],
    [
      "add: folder is a file",
      ["add", `--dir=${fileNotDir}`],
      clipboardWith("some copied words"),
    ],
    ["add: bad flag named with the canary", ["add", `--${CANARY}`], undefined],
    ["add: stray argument", ["add", CANARY], undefined],
    ["run: normal", ["run", "--dir", dir, "--root", root], undefined],
    [
      "run: --messages 1",
      ["run", "--dir", dir, "--root", root, "--messages", "1"],
      undefined,
    ],
    [
      "run: missing folder",
      ["run", "--dir", stranger, "--root", root],
      undefined,
    ],
    ["run: missing root", ["run", "--dir", dir, "--root", stranger], undefined],
    [
      "run: --dir=missing",
      ["run", `--dir=${stranger}`, "--root", root],
      undefined,
    ],
    [
      "run: folder is a file",
      ["run", "--dir", fileNotDir, "--root", root],
      undefined,
    ],
    ["run: bad number", ["run", "--dir", dir, "--messages", CANARY], undefined],
    ["run: bad flag named with the canary", ["run", `--${CANARY}`], undefined],
    ["run: flag value missing", ["run", "--dir"], undefined],
    ["run: stray argument", ["run", CANARY], undefined],
    [
      "run: capture too large",
      ["run", "--dir", hugeDir, "--root", root],
      undefined,
    ],
    [
      "run: unreadable capture",
      ["run", "--dir", unreadableDir, "--root", root],
      undefined,
    ],
    ["tally: text", ["tally", "--dir", dir, "--root", root], undefined],
    [
      "tally: json",
      ["tally", "--dir", dir, "--root", root, "--json"],
      undefined,
    ],
    [
      "tally: missing folder",
      ["tally", "--dir", stranger, "--root", root],
      undefined,
    ],
    [
      "tally: missing root",
      ["tally", "--dir", dir, "--root", stranger],
      undefined,
    ],
    [
      "tally: unreadable verdict",
      ["tally", "--dir", unreadableVerdictDir, "--root", root],
      undefined,
    ],
    ["tally: bad flag", ["tally", `--${CANARY}`], undefined],
    ["tally: --show is not an option", ["tally", "--show"], undefined],
    ["command: unknown", [CANARY], undefined],
    ["help", ["--help"], undefined],
  ];

  for (const [name, argv, clip] of scenarios) {
    const skip = isRoot && name.includes("unreadable");
    test(
      `${name}: the canary appears nowhere and nothing is written`,
      { skip },
      () => {
        const run = makeCli(home, clip);
        const watched = [
          dir,
          root,
          unreadableDir,
          unreadableVerdictDir,
          hugeDir,
        ];
        const before = watched.map(snapshot);
        const r = run(argv);
        assert.ok(!r.out.includes(CANARY), `stdout: ${r.out.slice(0, 200)}`);
        assert.ok(!r.err.includes(CANARY), `stderr: ${r.err.slice(0, 200)}`);
        if (!name.startsWith("add:"))
          assert.deepEqual(watched.map(snapshot), before);
      },
    );
  }

  test("every string in a run report is an id, a kind or the tool name", () => {
    const report = JSON.parse(
      makeCli(home)(["run", "--dir", dir, "--root", root]).out,
    ) as {
      captures: Array<Record<string, unknown>>;
      [key: string]: unknown;
    };
    const kinds = [
      "ok",
      "ambiguous",
      "no-match",
      "too-short",
      "empty",
      "no-window",
    ];
    assert.equal(report["tool"], "copy-back captures run");
    for (const c of report.captures)
      for (const [key, value] of Object.entries(c))
        if (typeof value === "string")
          assert.ok(
            key === "id"
              ? /^\d\d$/.test(value)
              : key === "kind" && kinds.includes(value),
            `${key}=${value}`,
          );
  });

  test("an invalid verdict is reported by id; its content is not", () => {
    const text = makeCli(home)(["tally", "--dir", dir, "--root", root]).out;
    assert.match(text, /invalid/i);
    assert.match(text, /02/);
  });
});

describe("--show is the only path that prints text, and it announces itself", () => {
  const { root, dir } = canaryWorld();
  const home = tmp.make("home");
  const show = makeCli(home)(["run", "--dir", dir, "--root", root, "--show"]);
  const plain = makeCli(home)(["run", "--dir", dir, "--root", root]);

  test("stderr starts with a banner: user-run only, your own text, agents must not run it", () => {
    assert.match(show.err, /^[^\n]*USER-RUN ONLY/);
    assert.match(show.err, /your own/i);
    assert.match(show.err, /agents?/i);
    assert.equal(plain.err, "");
  });

  test("stdout carries the copied text and the paste text of each capture", () => {
    assert.equal(show.code, 0);
    assert.ok(show.out.includes("above the quiet harbour"));
    assert.ok(
      show.out.includes(
        `Extra sentence with ${CANARY} inside it for the copy.`,
      ),
    );
    assert.ok(
      show.out.includes(
        `unrelated words ${CANARY} that match nothing anywhere`,
      ),
    );
    assert.equal(plain.out.includes(CANARY), false);
  });

  test("each capture is a delimited block with a judging instruction naming its verdict file", () => {
    for (const id of ["01", "02", "03", "04"]) {
      assert.ok(show.out.includes(`${id}.verdict`), id);
      assert.match(show.out, new RegExp(`BEGIN COPIED ${id}`));
      assert.match(show.out, new RegExp(`END COPIED ${id}`));
    }
    assert.match(show.out, /ok, bad or skip/);
  });

  test("a hit says whether the paste text differs from the exact slice; a refusal says why", () => {
    assert.match(show.out, /differs from the exact source slice: (yes|no)/);
    assert.match(show.out, /refused: no-match/);
  });

  test("the counts document still ends the output, and it carries no text", () => {
    const tail = show.out.slice(show.out.lastIndexOf("\n{") + 1);
    const counts = JSON.parse(tail) as { tool: string };
    assert.equal(counts.tool, "copy-back captures run");
    assert.equal(tail.includes(CANARY), false);
  });

  test("create nothing for the user: --show writes no verdict files", () => {
    const before = snapshot(dir);
    makeCli(home)(["run", "--dir", dir, "--root", root, "--show"]);
    assert.equal(snapshot(dir), before);
  });
});

describe("the real script (subprocess; never `add`, which would reach the clipboard)", () => {
  const { root, dir } = canaryWorld();
  const home = tmp.make("home");
  const go = (args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
      cwd: home,
      timeout: 60_000,
    });

  test("--help explains the whole workflow in words", () => {
    const r = go(["--help"]);
    assert.equal(r.status, 0);
    for (const word of [
      "add",
      "run",
      "tally",
      "--show",
      "USER-RUN ONLY",
      "ok, bad or skip",
      "20",
      "70",
    ])
      assert.ok(r.stdout.includes(word), word);
  });

  test("run prints one JSON document and nothing on stderr", () => {
    const r = go(["run", "--dir", dir, "--root", root]);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.equal(JSON.parse(r.stdout).tool, "copy-back captures run");
    assert.ok(!r.stdout.includes(CANARY));
  });

  test("tally prints a verdict and no text", () => {
    const r = go(["tally", "--dir", dir, "--root", root]);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /K1 on real copies: FAIL/);
    assert.ok(!r.stdout.includes(CANARY) && !r.stderr.includes(CANARY));
  });

  test("errors exit 2 without echoing arguments or paths", () => {
    for (const args of [
      ["run", `--${CANARY}`],
      ["run", "--dir", path.join(home, `missing-${CANARY}`)],
      ["tally", "--root", path.join(home, `missing-${CANARY}`), "--dir", dir],
    ]) {
      const r = go(args);
      assert.equal(r.status, 2, args.join(" "));
      assert.ok(
        !r.stdout.includes(CANARY) && !r.stderr.includes(CANARY),
        args.join(" "),
      );
      assert.ok(r.stderr.length > 0);
    }
  });

  test("the defaults are under HOME: no captures folder there means DIR_MISSING", () => {
    const r = go(["run"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /DIR_MISSING/);
  });
});
