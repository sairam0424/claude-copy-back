// `run`: every result kind, the window per capture, and the counts-only shape.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeCase } from "../src/sim/testkit.ts";
import {
  MINUTE,
  T0,
  makeCli,
  scratch,
  snapshot,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
} from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

const PROSE =
  "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron.";
const LISTED =
  "1. Install the tool:\n\n   ```bash\n   npm install --save-dev tool\n   npm run build:all\n   ```\n\n2. Next step goes here.\n";
const ROW_KEYS = [
  "candidates",
  "id",
  "kind",
  "matchedMessageRank",
  "pasteDiffersFromExact",
  "projectedChars",
  "rivalSessions",
  "windowAgeSeconds",
  "windowSize",
];

interface Row {
  id: string;
  kind: string;
  projectedChars: number | null;
  candidates: number;
  windowSize: number;
  matchedMessageRank: number | null;
  pasteDiffersFromExact: boolean | null;
  windowAgeSeconds: number | null;
  rivalSessions: number;
}
interface Report {
  tool: string;
  captures: Row[];
  totals: Record<string, number>;
  corpus: Record<string, number>;
}

describe("run: every result kind in one session", () => {
  let dir = "";
  let root = "";
  let report: Report;
  let out = "";
  const row = (id: string): Row =>
    report.captures.find((c) => c.id === id) as Row;

  before(() => {
    root = tmp.make("root");
    dir = path.join(tmp.make(), "caps");
    writeSession(root, "p/main.jsonl", [
      { at: T0, text: PROSE },
      { at: T0 + MINUTE, text: "Check error: file not found carefully." },
      {
        at: T0 + 2 * MINUTE,
        text: "Check **error: file not found** carefully.",
      },
      { at: T0 + 3 * MINUTE, text: LISTED },
    ]);
    const made = makeCase(LISTED, "npm install", "build:all", 80).copied;
    const now = T0 + 5 * MINUTE;
    const before = T0 - 60 * MINUTE;
    writeCapture(
      dir,
      "01",
      "Alpha beta gamma delta\nepsilon zeta eta theta",
      now,
    );
    writeCapture(dir, "02", "error: file not found carefully", now);
    writeCapture(dir, "03", "hello world", now);
    writeCapture(dir, "04", "   \n\n  ", now);
    writeCapture(dir, "05", "Completely different words appear here", now);
    writeCapture(
      dir,
      "06",
      "Alpha beta gamma delta\nepsilon zeta eta theta",
      before,
    );
    writeCapture(dir, "07", made, now);
    writeCapture(dir, "08", "", now);
    writeCapture(dir, "09", "hello", before);
    const r = makeCli(tmp.make("home"))(["run", "--dir", dir, "--root", root]);
    assert.equal(r.code, 0, r.err);
    out = r.out;
    report = JSON.parse(out) as Report;
  });

  test("stdout is one JSON document on one line", () => {
    assert.equal(out.trim().split("\n").length, 1);
    assert.equal(report.tool, "copy-back captures run");
  });

  test("one row per capture, in id order, with exactly the counts-and-ids fields", () => {
    assert.deepEqual(
      report.captures.map((c) => c.id),
      ["01", "02", "03", "04", "05", "06", "07", "08", "09"],
    );
    for (const c of report.captures)
      assert.deepEqual(Object.keys(c).sort(), ROW_KEYS);
  });

  test("kinds: ok, ambiguous, too-short, empty, no-match, no-window", () => {
    assert.deepEqual(
      report.captures.map((c) => c.kind),
      [
        "ok",
        "ambiguous",
        "too-short",
        "empty",
        "no-match",
        "no-window",
        "ok",
        "empty",
        "too-short",
      ],
    );
  });

  test("a hit reports its length, candidates, rank in the window (0 = newest) and the window size", () => {
    assert.deepEqual(row("01"), {
      id: "01",
      kind: "ok",
      projectedChars: 45,
      candidates: 1,
      windowSize: 4,
      matchedMessageRank: 3,
      pasteDiffersFromExact: false,
      windowAgeSeconds: 120,
      rivalSessions: 0,
    });
  });

  test("a code copy from a list item has a paste form that differs from the exact slice", () => {
    assert.equal(row("07").kind, "ok");
    assert.equal(row("07").matchedMessageRank, 0);
    assert.equal(row("07").pasteDiffersFromExact, true);
  });

  test("a refusal has no rank, no length, no paste flag and no candidates", () => {
    for (const id of ["02", "03", "04", "05"]) {
      const c = row(id);
      assert.equal(c.matchedMessageRank, null, id);
      assert.equal(c.projectedChars, null, id);
      assert.equal(c.pasteDiffersFromExact, null, id);
      assert.equal(c.candidates, 0, id);
      assert.equal(c.windowSize, 4, id);
    }
  });

  test("a capture older than every session has no window; a copy that is bad on its own is still told so", () => {
    assert.equal(row("06").kind, "no-window");
    assert.equal(row("06").windowSize, 0);
    assert.equal(row("06").windowAgeSeconds, null);
    assert.equal(row("09").kind, "too-short");
    assert.equal(row("08").kind, "empty");
  });

  test("totals by kind, with every kind present", () => {
    assert.deepEqual(report.totals, {
      captures: 9,
      ok: 2,
      ambiguous: 1,
      "no-match": 1,
      "too-short": 2,
      empty: 2,
      "no-window": 1,
    });
  });

  test("the corpus block counts transcripts", () => {
    assert.equal(report.corpus["filesListed"], 1);
    assert.equal(report.corpus["filesRead"], 1);
    assert.equal(report.corpus["filesSkippedSubagent"], 0);
  });

  test("run changes nothing on disk", () => {
    const run = makeCli(tmp.make("home"));
    const before = [snapshot(dir), snapshot(root)];
    run(["run", "--dir", dir, "--root", root]);
    run(["run", "--dir", dir, "--root", root, "--show"]);
    assert.deepEqual([snapshot(dir), snapshot(root)], before);
  });
});

describe("run: windows and options", () => {
  test("each capture gets the window of its own time", () => {
    const root = tmp.make("root");
    const dir = path.join(tmp.make(), "caps");
    writeSession(
      root,
      "p/main.jsonl",
      [1, 2, 3, 4, 5].map((n) => ({
        at: T0 + n * MINUTE,
        text: worldMessage(n),
      })),
    );
    for (let n = 1; n <= 5; n++)
      writeCapture(dir, `0${n}`, worldCopy(n), T0 + n * MINUTE + 20_000);
    const r = JSON.parse(
      makeCli(tmp.make("home"))(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    assert.deepEqual(
      r.captures.map((c) => [c.kind, c.matchedMessageRank, c.windowSize]),
      [1, 2, 3, 4, 5].map((n) => ["ok", 0, n]),
    );
    assert.ok(r.captures.every((c) => c.windowAgeSeconds === 20));
  });

  test("--messages shrinks the window: an older message falls out and the copy is no match", () => {
    const root = tmp.make("root");
    const dir = path.join(tmp.make(), "caps");
    writeSession(
      root,
      "p/main.jsonl",
      [1, 2, 3, 4].map((n) => ({ at: T0 + n * MINUTE, text: worldMessage(n) })),
    );
    writeCapture(dir, "01", worldCopy(1), T0 + 10 * MINUTE);
    const run = makeCli(tmp.make("home"));
    const wide = JSON.parse(
      run(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    const narrow = JSON.parse(
      run(["run", "--dir", dir, "--root", root, "--messages", "2"]).out,
    ) as Report;
    assert.deepEqual(
      [wide.captures[0]?.kind, wide.captures[0]?.matchedMessageRank],
      ["ok", 3],
    );
    assert.deepEqual(
      [narrow.captures[0]?.kind, narrow.captures[0]?.windowSize],
      ["no-match", 2],
    );
  });

  test("--messages above 40 widens the matcher as well as the window", () => {
    const root = tmp.make("root");
    const dir = path.join(tmp.make(), "caps");
    const entry = (n: number) => `Entry ${n} says the unique-token-${n} wanders across the meadow slowly today.`;
    writeSession(
      root,
      "p/main.jsonl",
      Array.from({ length: 60 }, (_, i) => ({ at: T0 + (i + 1) * MINUTE, text: entry(i + 1) })),
    );
    writeCapture(dir, "01", "says the unique-token-1 wanders across\n  the meadow slowly", T0 + 70 * MINUTE);
    const run = makeCli(tmp.make("home"));
    const rowFor = (extra: string[]) =>
      (JSON.parse(run(["run", "--dir", dir, "--root", root, ...extra]).out) as Report).captures[0] as Row;
    assert.deepEqual([rowFor([]).kind, rowFor([]).windowSize], ["no-match", 40]);
    const wide = rowFor(["--messages", "60"]);
    assert.deepEqual([wide.kind, wide.windowSize, wide.matchedMessageRank], ["ok", 60, 59]);
  });

  test("only NN.txt files are captures: notes, verdicts and odd names are ignored", () => {
    const root = tmp.make("root");
    const dir = tmp.make("caps");
    writeSession(root, "p/main.jsonl", [{ at: T0, text: worldMessage(1) }]);
    writeCapture(dir, "01", worldCopy(1), T0 + MINUTE);
    for (const name of [
      "1.txt",
      "001.txt",
      "notes.txt",
      "01.verdict",
      "01.txt.bak",
      ".DS_Store",
    ])
      fs.writeFileSync(path.join(dir, name), "x");
    const r = JSON.parse(
      makeCli(tmp.make("home"))(["run", "--dir", dir, "--root", root]).out,
    ) as Report;
    assert.deepEqual(
      r.captures.map((c) => c.id),
      ["01"],
    );
  });

  test("an empty folder gives zero captures and every kind at zero", () => {
    const root = tmp.make("root");
    const r = JSON.parse(
      makeCli(tmp.make("home"))([
        "run",
        "--dir",
        tmp.make("caps"),
        "--root",
        root,
      ]).out,
    ) as Report;
    assert.deepEqual(r.captures, []);
    assert.equal(r.totals["captures"], 0);
    assert.equal(r.totals["ok"], 0);
  });

  test("defaults: the captures folder and the transcripts come from the home directory", () => {
    const home = tmp.make("home");
    writeSession(path.join(home, ".claude", "projects"), "p/main.jsonl", [
      { at: T0, text: worldMessage(1) },
    ]);
    writeCapture(
      path.join(home, "copy-back-captures"),
      "01",
      worldCopy(1),
      T0 + MINUTE,
    );
    const r = JSON.parse(makeCli(home)(["run"]).out) as Report;
    assert.equal(r.captures[0]?.kind, "ok");
  });
});

describe("run: failures carry a code and an id, nothing else", () => {
  const run = makeCli(tmp.make("home"));

  test("a missing captures folder", () => {
    const r = run([
      "run",
      "--dir",
      path.join(tmp.make(), "nope"),
      "--root",
      tmp.make("root"),
    ]);
    assert.equal(r.code, 2);
    assert.match(r.err, /DIR_MISSING/);
  });

  test("a missing transcript root", () => {
    const r = run([
      "run",
      "--dir",
      tmp.make("caps"),
      "--root",
      path.join(tmp.make(), "nope"),
    ]);
    assert.equal(r.code, 2);
    assert.match(r.err, /ROOT_UNREADABLE/);
  });

  test(
    "a capture that cannot be read names its id",
    { skip: process.getuid?.() === 0 },
    () => {
      const dir = tmp.make("caps");
      const file = writeCapture(dir, "07", "some words", T0);
      fs.chmodSync(file, 0o000);
      try {
        const r = run(["run", "--dir", dir, "--root", tmp.make("root")]);
        assert.equal(r.code, 2);
        assert.match(r.err, /CAPTURE_UNREADABLE/);
        assert.match(r.err, /07/);
      } finally {
        fs.chmodSync(file, 0o600);
      }
    },
  );

  test("a capture over 4 MiB names its id", () => {
    const dir = tmp.make("caps");
    writeCapture(dir, "03", "a".repeat(4 * 1024 * 1024 + 1), T0);
    const r = run(["run", "--dir", dir, "--root", tmp.make("root")]);
    assert.equal(r.code, 2);
    assert.match(r.err, /CAPTURE_TOO_LARGE/);
    assert.match(r.err, /03/);
  });
});
