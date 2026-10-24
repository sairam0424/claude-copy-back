import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { runCc } from "../hooks/cc.ts";
import { findSource } from "../src/core/match.ts";
import { MAX_HITS_PER_MESSAGE } from "../src/core/search.ts";
import { fakes } from "./cc-fakes.ts";
import { row } from "./cc-fixtures.ts";

// The matcher has a work, memory and time budget. Highly repetitive input used
// to run the heap out (a 12-character copy against 40 replies of 1 MiB of "a")
// or to run for tens of seconds (long tables, long runs of one word, a
// mismatch in the middle of a repetitive reply). Those inputs are run here in a
// child process with a small heap and a hard time limit, so a regression fails
// the test instead of taking the test runner down with it.

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
const start = performance.now();
const r = findSource(copy, messages);
process.stdout.write(JSON.stringify({ ms: Math.round(performance.now() - start), ok: r.ok, reason: r.ok ? null : r.reason }));
`;

interface ChildResult {
  status: number | null;
  ms?: number;
  ok?: boolean;
  reason?: string | null;
  stderr: string;
}

function inChild(name: string): ChildResult {
  const run = spawnSync(
    process.execPath,
    ["--max-old-space-size=192", "--input-type=module", "-e", CHILD, name],
    { encoding: "utf8", timeout: 40_000, maxBuffer: 1 << 20 },
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
  test(`budget: ${what} is refused as ambiguous, quickly, in a small heap`, () => {
    const out = inChild(name);
    assert.equal(
      out.status,
      0,
      `child ended with ${out.status}: ${out.stderr}`,
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "ambiguous");
    assert.ok((out.ms ?? 1e9) < 5000, `took ${out.ms} ms`);
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
  test(`budget: ${what} ends as no match, quickly`, () => {
    const out = inChild(name as string);
    assert.equal(
      out.status,
      0,
      `child ended with ${out.status}: ${out.stderr}`,
    );
    assert.equal(out.ok, false);
    assert.equal(out.reason, "no-match");
    assert.ok((out.ms ?? 1e9) < 5000, `took ${out.ms} ms`);
  });
}

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
  assert.deepEqual(f.toasts, [
    "copy-back: matches more than one place, nothing changed",
  ]);
});
