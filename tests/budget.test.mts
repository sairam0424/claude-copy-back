import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runCc } from "../hooks/cc.ts";
import { findSource } from "../src/core/match.ts";
import {
  MAX_CANDIDATE_WORK,
  MAX_HITS_PER_MESSAGE,
  MAX_HITS_TOTAL,
  NATIVE_WORK,
  findAll,
  newMeter,
  newNeedle,
} from "../src/core/search.ts";
import { fakes } from "./cc-fakes.ts";
import { row } from "./cc-fixtures.ts";
import { assertCpuWithin, sanityMs } from "./timing.ts";

// The matcher has a work, memory and time budget. Highly repetitive input used
// to run the heap out (a 12-character copy against 40 replies of 1 MiB of "a")
// or to run for tens of seconds (long tables, long runs of one word, a
// mismatch in the middle of a repetitive reply). Those inputs are run here in a
// child process with a small heap, so a regression fails the test instead of
// taking the test runner down with it.
//
// What a test asserts, in order: the answer (a fact), that the child finished
// in the small heap (a fact), the search meter that bounds the work (a
// deterministic counter, below), and last a sanity bound on the child's CPU
// time, never on the clock (tests/timing.ts). A busy machine slows the wall
// clock by a large factor and CPU time by hardly any.

const SRC = new URL("../src/core/match.ts", import.meta.url).href;
const CHILD = `
import { findSource } from ${JSON.stringify(SRC)};
const cases = {
  hits: () => ["aaaaaaaaaaaa", Array.from({ length: 40 }, () => "a".repeat(1 << 20))],
  rows: () => ["| a | b |\\n".repeat(2000), Array.from({ length: 40 }, () => "| a | b |\\n".repeat(20000))],
  midmiss: () => ["a".repeat(5000) + "b" + "a".repeat(5000), Array.from({ length: 40 }, () => "a".repeat(300000))],
  rowsmid: () => ["| a | b |\\n".repeat(2500) + "| a | c |\\n" + "| a | b |\\n".repeat(2500), Array.from({ length: 40 }, () => "| a | b |\\n".repeat(20000))],
  cjk: () => ["漢字かな".repeat(5000), Array.from({ length: 40 }, () => "漢字かな".repeat(30000))],
};
const [copy, messages] = cases[process.argv[1]]();
const before = process.cpuUsage();
const r = findSource(copy, messages);
const spent = process.cpuUsage(before);
process.stdout.write(JSON.stringify({ cpuMs: Math.round((spent.user + spent.system) / 1000), ok: r.ok, reason: r.ok ? null : r.reason }));
`;

/** CPU time the child may spend in findSource (idle: about 1 s at most). */
const CHILD_CPU_BASE_MS = 20_000;
/** Wall time before the child is killed; only a hang gets there. */
const CHILD_KILL_BASE_MS = 120_000;

interface ChildResult {
  status: number | null;
  cpuMs?: number;
  ok?: boolean;
  reason?: string | null;
  stderr: string;
}

function inChild(name: string): ChildResult {
  const run = spawnSync(
    process.execPath,
    ["--max-old-space-size=192", "--input-type=module", "-e", CHILD, name],
    {
      encoding: "utf8",
      timeout: sanityMs(CHILD_KILL_BASE_MS),
      maxBuffer: 1 << 20,
    },
  );
  const parsed = run.stdout
    ? (JSON.parse(run.stdout) as Partial<ChildResult>)
    : {};
  return {
    status: run.status,
    stderr: (run.stderr ?? "").slice(0, 300),
    ...parsed,
  };
}

const REFUSED_FAST: [string, string][] = [
  ["hits", "a 12-character copy against 40 replies of one million hits each"],
  ["rows", "2000 identical table rows against 40 replies of 20000 rows"],
  ["cjk", "20000 CJK characters repeated against 40 replies of 120000"],
];

for (const [name, what] of REFUSED_FAST) {
  test(`budget: ${what} is refused as ambiguous, in a small heap`, () => {
    const out = inChild(name);
    assert.equal(
      out.status,
      0,
      `child ended with ${out.status}: ${out.stderr}`,
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "ambiguous");
    assertCpuWithin(
      `budget child ${name}`,
      out.cpuMs ?? Infinity,
      CHILD_CPU_BASE_MS,
    );
  });
}

for (const [name, what] of [
  [
    "midmiss",
    "a mismatch in the middle of 40 replies of 300000 repeated letters",
  ],
  [
    "rowsmid",
    "a changed row in the middle of 5000 repeated rows against 40 replies of 20000",
  ],
]) {
  test(`budget: ${what} ends as no match, in a small heap`, () => {
    const out = inChild(name as string);
    assert.equal(
      out.status,
      0,
      `child ended with ${out.status}: ${out.stderr}`,
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no-match");
    assertCpuWithin(
      `budget child ${name}`,
      out.cpuMs ?? Infinity,
      CHILD_CPU_BASE_MS,
    );
  });
}

// The same shapes at the one place that spends the meter. How much work an
// input may cost is fixed by the meter, so it is asserted as counters, which a
// busy machine cannot change. `findAll` (search.ts) is handed the meter that
// `findSource` makes, and a hit costs `needle.length` of the work allowance.

const ROW = "| a | b |\n";

/** The hits findAll may keep before the per-message or the work limit refuses. */
function hitsAllowed(needleLength: number): number {
  return Math.min(
    MAX_HITS_PER_MESSAGE,
    Math.floor(MAX_CANDIDATE_WORK / needleLength),
  );
}

const SPENT_AT_THE_LIMIT: [string, string, string][] = [
  [
    "a megabyte of one letter, a 12-character needle",
    "a".repeat(1 << 20),
    "a".repeat(12),
  ],
  [
    "20000 repeated rows, a 2000-row needle",
    ROW.repeat(20000),
    ROW.repeat(2000),
  ],
  [
    "120000 repeated CJK characters, a 20000-character needle",
    "漢字かな".repeat(30000),
    "漢字かな".repeat(5000),
  ],
];

for (const [what, hay, needle] of SPENT_AT_THE_LIMIT) {
  test(`budget meter: ${what} stops at the hit or work limit, with the counters spent exactly`, () => {
    const meter = newMeter();
    assert.equal(findAll(hay, newNeedle(needle), meter), null);
    const kept = hitsAllowed(needle.length);
    assert.equal(meter.hits, MAX_HITS_TOTAL - kept);
    assert.equal(meter.work, MAX_CANDIDATE_WORK - kept * needle.length);
  });
}

const GOES_LINEAR: [string, string, string][] = [
  [
    "a changed letter in the middle of 300000 repeated letters",
    "a".repeat(300_000),
    `${"a".repeat(5000)}b${"a".repeat(5000)}`,
  ],
  [
    "a changed row in the middle of 20000 repeated rows",
    ROW.repeat(20000),
    `${ROW.repeat(2500)}| a | c |\n${ROW.repeat(2500)}`,
  ],
];

for (const [what, hay, needle] of GOES_LINEAR) {
  test(`budget meter: ${what} is answered by the linear search: no hit, no work and none of the native allowance spent`, () => {
    const meter = newMeter();
    assert.deepEqual(findAll(hay, newNeedle(needle), meter), []);
    assert.deepEqual(meter, newMeter());
  });
}

test("budget meter: the engine's own search is used while its worst case fits the allowance, and not one character more", () => {
  const hay = "xxabc";
  const worstCase = 3 * 3; // 3 alignments of a 3-character needle
  const fits = newMeter({ native: worstCase });
  assert.deepEqual(findAll(hay, newNeedle("abc"), fits), [2]);
  assert.equal(fits.native, 0);
  const over = newMeter({ native: worstCase - 1 });
  assert.deepEqual(findAll(hay, newNeedle("abc"), over), [2]);
  assert.equal(over.native, worstCase - 1);
  assert.equal(NATIVE_WORK, 2_000_000_000);
});

const SENTENCE = "alpha beta gamma delta.";

test("budget: a copy that sits at the per-message limit of places in one reply still copies (identical slices)", () => {
  const reply = `${SENTENCE} `.repeat(MAX_HITS_PER_MESSAGE);
  const found = findSource(SENTENCE, [reply]);
  assert.equal(found.ok, true);
  assert.equal(found.ok && found.paste, SENTENCE);
});

test("budget: one more place than the limit refuses as ambiguous, and writes nothing", () => {
  const reply = `${SENTENCE} `.repeat(MAX_HITS_PER_MESSAGE + 1);
  assert.deepEqual(findSource(SENTENCE, [reply]), {
    ok: false,
    reason: "ambiguous",
  });
});

test("budget: the same hits spread over many replies share the total limit", () => {
  const reply = `${SENTENCE} `.repeat(MAX_HITS_PER_MESSAGE - 1);
  assert.deepEqual(
    findSource(
      SENTENCE,
      Array.from({ length: 40 }, () => reply),
    ),
    {
      ok: false,
      reason: "ambiguous",
    },
  );
});

test("budget: forcing the linear search changes no answer on prose, code, a list, a quote and Unicode", () => {
  const replies = [
    "## Notes\n\nThe rollout failed because the readiness probe timed out after thirty seconds. Restart the pods and watch the events.\n\n- first check the logs\n- then check the probe path\n\n> Quoted advice about the probe, kept on two lines.\n> The second line of the quote stays attached.\n\n    kubectl rollout status deployment/api\n    kubectl get pods -o wide\n",
    "Café résumé — naïve façade → 日本語のテキスト 🚀🎉 are kept exactly as written here, twice: Café résumé — naïve façade.",
  ];
  const copies = [
    "  The rollout failed because the readiness probe timed out after thirty\n  seconds. Restart the pods and watch the events.",
    "  - first check the logs\n  - then check the probe path",
    "  ▎ Quoted advice about the probe, kept on two lines.\n  ▎ The second line of the quote stays attached.",
    "      kubectl rollout status deployment/api\n      kubectl get pods -o wide",
    "Café résumé — naïve façade",
    "日本語のテキスト 🚀🎉 are kept exactly as written here",
    "this text is in no reply at all, so nothing is found",
  ];
  for (const copy of copies) {
    assert.deepEqual(
      findSource(copy, replies, { budget: { native: 0 } }),
      findSource(copy, replies),
      copy,
    );
  }
});

test("budget: through /cc, a copy in too many places writes nothing and says so in a fixed line", async () => {
  const big = row("assistant", "a".repeat(3 * MAX_HITS_PER_MESSAGE));
  const f = fakes({ stdout: "aaaaaaaaaaaa", rows: [big, big, big] });
  const out = await runCc(f.deps);
  assert.equal(out.copied, false);
  assert.equal(!out.copied && out.reason, "ambiguous");
  assert.deepEqual(f.copies, []);
  assert.deepEqual(f.toasts, ["matches more than one place, nothing changed"]);
});
