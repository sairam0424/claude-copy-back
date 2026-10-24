// PRIVACY of the paths added after the first review: --project, --allow-redirect,
// the folder guard, the verdict code, the dropped-message counts. A canary in
// the captures, the transcripts, the paths and the option values must never
// reach stdout or stderr in default mode, on any of them. Synthetic only.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  CANARY,
  MINUTE,
  T0,
  makeCli,
  scratch,
  shownCodes,
  snapshot,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
  writeVerdict,
} from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

function world() {
  const root = tmp.make("root");
  const dir = path.join(tmp.make(), `caps-${CANARY}`);
  writeSession(root, `-proj-${CANARY}/main.jsonl`, [
    { at: T0, text: `${worldMessage(1)} ${CANARY}` },
    { at: T0 + MINUTE, text: `no time ${CANARY}`, noTimestamp: true },
    { at: T0 + 2 * MINUTE, text: `side ${CANARY}`, sidechain: true },
  ]);
  writeCapture(dir, "01", worldCopy(1), T0 + 5 * MINUTE);
  writeCapture(
    dir,
    "02",
    `${CANARY} copied words that match nothing`,
    T0 + 5 * MINUTE,
  );
  return { root, dir };
}

describe("new paths: the canary appears nowhere in default mode", () => {
  const { root, dir } = world();
  const home = tmp.make("home");
  const repo = path.join(tmp.make("guard"), `repo-${CANARY}`);
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const cli = makeCli(home, () => `clipboard ${CANARY}`, { terminal: false });

  // Verdicts: 01 with a stale code, 02 without any code.
  writeVerdict(dir, "01", "ok 00000000");
  writeVerdict(dir, "02", "bad");

  const scenarios: Array<[string, string[]]> = [
    [
      "run --project with the canary as its value",
      ["run", "--dir", dir, "--root", root, "--project", CANARY],
    ],
    [
      "run --project that matches the folder",
      ["run", "--dir", dir, "--root", root, "--project", "proj"],
    ],
    [
      "tally --project with the canary as its value",
      ["tally", "--dir", dir, "--root", root, "--project", CANARY],
    ],
    [
      "tally --project that matches nothing",
      ["tally", "--dir", dir, "--root", root, "--project", "zzz-nothing"],
    ],
    [
      "tally --json with stale and unbound verdicts",
      ["tally", "--dir", dir, "--root", root, "--json"],
    ],
    [
      "tally text with stale and unbound verdicts",
      ["tally", "--dir", dir, "--root", root],
    ],
    [
      "run --show without a terminal (refused)",
      ["run", "--dir", dir, "--root", root, "--show"],
    ],
    [
      "add into a repository path that carries the canary",
      ["add", "--dir", path.join(repo, "caps")],
    ],
    ["add --dir with an empty value", ["add", "--dir", ""]],
    ["run --dir with an empty value", ["run", "--dir="]],
    ["run --project with an empty value", ["run", "--project", ""]],
    [
      "run --allow-redirect without --show",
      ["run", "--dir", dir, "--root", root, "--allow-redirect"],
    ],
    ["add --allow-redirect (not an option there)", ["add", "--allow-redirect"]],
    ["add --project (not an option there)", ["add", "--project", CANARY]],
  ];
  for (const [name, argv] of scenarios)
    test(`${name}: no canary, no code, nothing written`, () => {
      const codes = Object.values(shownCodes(makeCli(home), dir, root));
      assert.equal(codes.length, 2);
      const watched = [dir, root, repo];
      const before = watched.map(snapshot);
      const r = cli(argv);
      for (const text of [r.out, r.err]) {
        assert.ok(!text.includes(CANARY), text.slice(0, 200));
        for (const code of codes)
          assert.ok(!text.includes(code), "code leaked");
      }
      assert.deepEqual(watched.map(snapshot), before);
    });

  test("the dropped-message counts are numbers, the tally names them without text", () => {
    const text = cli(["tally", "--dir", dir, "--root", root]).out;
    assert.equal(text.includes(CANARY), false);
    const report = JSON.parse(
      cli(["run", "--dir", dir, "--root", root]).out,
    ) as {
      corpus: Record<string, unknown>;
    };
    assert.deepEqual(
      [
        report.corpus["messagesWithoutTime"],
        report.corpus["sidechainMessages"],
      ],
      [1, 1],
    );
  });
});
