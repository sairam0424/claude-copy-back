// I1: a verdict is tied to what the person was shown. `run --show` prints a
// short code per capture; a verdict file may carry it ("ok 1a2b3c4d"); `tally`
// compares it with a fresh answer and refuses a PASS when they differ.
// Synthetic transcripts and captures only.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { summarize } from "../src/captures/tally.ts";
import { fingerprintOf } from "../src/captures/fingerprint.ts";
import {
  MINUTE,
  T0,
  makeCli,
  scratch,
  shownCodes as sharedCodes,
  worldCopy,
  worldMessage,
  writeCapture,
  writeSession,
  writeVerdict,
} from "../src/captures/fixtures.ts";

const tmp = scratch();
after(tmp.cleanup);

const ids = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => String(i + 1).padStart(2, "0"));

/** 20 captures that each match their own message of one session. */
function world(count = 20) {
  const root = tmp.make("root");
  const dir = path.join(tmp.make(), "caps");
  const session = (replace: Record<number, string> = {}) =>
    writeSession(
      root,
      "p/main.jsonl",
      ids(count).map((id) => ({
        at: T0 + Number(id) * MINUTE,
        text: replace[Number(id)] ?? worldMessage(Number(id)),
      })),
    );
  session();
  for (const id of ids(count))
    writeCapture(
      dir,
      id,
      worldCopy(Number(id)),
      T0 + Number(id) * MINUTE + 20_000,
    );
  return { root, dir, session };
}

const home = tmp.make("home");
const cli = makeCli(home);

const shownCodes = (dir: string, root: string) =>
  sharedCodes(cli, dir, root);

const tally = (dir: string, root: string) =>
  JSON.parse(
    cli(["tally", "--dir", dir, "--root", root, "--json"]).out,
  ) as ReturnType<typeof summarize>;

describe("fingerprintOf", () => {
  test("8 lower-case hex characters, stable, and sensitive to kind, copy and paste", () => {
    const base = fingerprintOf("ok", "copy", "paste");
    assert.match(base, /^[0-9a-f]{8}$/);
    assert.equal(fingerprintOf("ok", "copy", "paste"), base);
    for (const other of [
      fingerprintOf("no-match", "copy", "paste"),
      fingerprintOf("ok", "copy!", "paste"),
      fingerprintOf("ok", "copy", "paste!"),
      fingerprintOf("ok", "copy", null),
    ])
      assert.notEqual(other, base);
    assert.notEqual(
      fingerprintOf("ok", "a", "bc"),
      fingerprintOf("ok", "ab", "c"),
    );
    assert.notEqual(
      fingerprintOf("ok", "a", null),
      fingerprintOf("ok", "a", ""),
    );
  });
});

describe("run --show prints a code per capture", () => {
  test("each judging line carries the code, and the code is the same on a second run", () => {
    const { dir, root } = world(3);
    const first = shownCodes(dir, root);
    assert.deepEqual(Object.keys(first), ["01", "02", "03"]);
    assert.deepEqual(shownCodes(dir, root), first);
    assert.equal(new Set(Object.values(first)).size, 3);
  });

  test("default run and default tally never print a code", () => {
    const { dir, root } = world(3);
    const codes = Object.values(shownCodes(dir, root));
    const outputs = [
      cli(["run", "--dir", dir, "--root", root]),
      cli(["tally", "--dir", dir, "--root", root]),
      cli(["tally", "--dir", dir, "--root", root, "--json"]),
    ];
    for (const r of outputs)
      for (const code of codes)
        assert.equal((r.out + r.err).includes(code), false);
  });
});

describe("tally compares the code with a fresh answer", () => {
  test("20 verdicts written with the printed codes: PASS, nothing stale or unbound", () => {
    const { dir, root } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(20)) writeVerdict(dir, id, `ok ${codes[id]}\n`);
    const report = tally(dir, root);
    assert.equal(report.k1.verdict, "PASS");
    assert.deepEqual([report.staleIds, report.unboundIds], [[], []]);
  });

  test("verdicts without the code are accepted as verdicts but block the PASS", () => {
    const { dir, root } = world();
    for (const id of ids(20)) writeVerdict(dir, id, "ok\n");
    const report = tally(dir, root);
    assert.equal(report.k1.verdict, "INCOMPLETE");
    assert.equal(report.unboundIds.length, 20);
    assert.equal(report.judged, 20);
  });

  test("the code may be upper case", () => {
    const { dir, root } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(20))
      writeVerdict(dir, id, `OK ${(codes[id] as string).toUpperCase()}`);
    assert.equal(tally(dir, root).k1.verdict, "PASS");
  });

  test("regression: tuning that turns a wrong text into a refusal cannot turn FAIL into PASS", () => {
    const { dir, root, session } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(19)) writeVerdict(dir, id, `ok ${codes[id]}`);
    writeVerdict(dir, "20", `bad ${codes["20"]}`);
    const before = tally(dir, root);
    assert.deepEqual([before.k1.verdict, before.dangerous], ["FAIL", 1]);
    session({ 20: worldMessage(99) });
    const after = tally(dir, root);
    assert.notEqual(after.k1.verdict, "PASS");
    assert.equal(after.k1.verdict, "INCOMPLETE");
    assert.deepEqual(after.staleIds, ["20"]);
    const text = cli(["tally", "--dir", dir, "--root", root]).out;
    assert.match(text, /answers differently now/);
  });

  test("a changed capture file makes its verdict stale", () => {
    const { dir, root } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(20)) writeVerdict(dir, id, `ok ${codes[id]}`);
    fs.writeFileSync(path.join(dir, "05.txt"), `${worldCopy(5)} `);
    const when = new Date(T0 + 5 * MINUTE + 20_000);
    fs.utimesSync(path.join(dir, "05.txt"), when, when);
    const report = tally(dir, root);
    assert.equal(report.k1.verdict, "INCOMPLETE");
    assert.deepEqual(report.staleIds, ["05"]);
  });

  test("a code copied from another capture is stale", () => {
    const { dir, root } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(20)) writeVerdict(dir, id, `ok ${codes[id]}`);
    writeVerdict(dir, "02", `ok ${codes["01"]}`);
    assert.deepEqual(tally(dir, root).staleIds, ["02"]);
  });

  test("a skip needs no code", () => {
    const { dir, root } = world(25);
    const codes = shownCodes(dir, root);
    for (const id of ids(20)) writeVerdict(dir, id, `ok ${codes[id]}`);
    for (const id of ids(25).slice(20)) writeVerdict(dir, id, "skip");
    const report = tally(dir, root);
    assert.equal(report.k1.verdict, "PASS");
    assert.equal(report.skip, 5);
  });

  test("the printed tally names the ids and never a code", () => {
    const { dir, root } = world();
    const codes = shownCodes(dir, root);
    for (const id of ids(20)) writeVerdict(dir, id, `ok ${codes[id]}`);
    writeVerdict(dir, "03", "ok");
    const text = cli(["tally", "--dir", dir, "--root", root]).out;
    assert.match(text, /03: judged without the code/);
    for (const code of Object.values(codes))
      assert.equal(text.includes(code), false);
  });
});
