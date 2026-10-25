// The GitHub workflows and community files are part of the project's contract:
// a read-only token, pinned actions, one required check that cannot go green by
// skipping the real jobs, macOS minutes spent only after a merge, and a weekly
// look at the newest Claude Code. No YAML parser is available (zero
// dependencies), so these checks read the files as text; the workflow files are
// written in the plain block style they rely on. `actionlint` stays the check
// for syntax and expressions (docs/DEVELOPMENT.md).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const text = (rel: string): string => fs.readFileSync(`${ROOT}${rel}`, "utf8");
const FLOW_DIR = ".github/workflows/";
const FLOW_FILES = fs
  .readdirSync(`${ROOT}${FLOW_DIR}`)
  .filter((name) => name.endsWith(".yml"))
  .sort();
const CI = text(`${FLOW_DIR}ci.yml`);
const DRIFT = text(`${FLOW_DIR}engine-drift.yml`);

/** The file without comment-only lines, so prose cannot satisfy or trip a check. */
const code = (source: string): string =>
  source
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

/** The lines of a top-level key's block (the key line excluded). */
function topBlock(source: string, key: string): string[] {
  const lines = code(source).split("\n");
  const start = lines.findIndex((line) => line === `${key}:`);
  assert.ok(start >= 0, `no top-level ${key}:`);
  const end = lines.findIndex((line, at) => at > start && /^\S/.test(line));
  return lines
    .slice(start + 1, end < 0 ? undefined : end)
    .filter((line) => line.trim() !== "");
}

/** job id -> its lines, in file order. */
function jobsOf(source: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const line of topBlock(source, "jobs")) {
    const header = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (header) found.set(header[1], (current = []));
    else current?.push(line);
  }
  return found;
}

/** Every `run:` script of a workflow, block scalars included. */
function runScripts(source: string): string[] {
  const lines = code(source).split("\n");
  const scripts: string[] = [];
  lines.forEach((line, at) => {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(line);
    if (!m) return;
    if (!/^[|>]/.test(m[2])) return void scripts.push(m[2]);
    const indent = m[1].length + (line.includes("- run:") ? 2 : 0);
    const body: string[] = [];
    for (const next of lines.slice(at + 1)) {
      if (next.trim() !== "" && next.search(/\S/) <= indent) break;
      body.push(next);
    }
    scripts.push(body.join("\n"));
  });
  return scripts;
}

describe("every workflow is hardened the same way", () => {
  test("there are exactly ci.yml and engine-drift.yml", () => {
    assert.deepEqual(FLOW_FILES, ["ci.yml", "engine-drift.yml"]);
  });

  for (const file of FLOW_FILES) {
    const source = text(`${FLOW_DIR}${file}`);

    test(`${file}: the token is read-only and no secret is used`, () => {
      assert.deepEqual(topBlock(source, "permissions"), ["  contents: read"]);
      assert.doesNotMatch(code(source), /: *(write|write-all)\b/);
      assert.doesNotMatch(code(source), /\bsecrets\./);
    });

    test(`${file}: only triggers that never run fork code with a privileged token`, () => {
      const triggers = topBlock(source, "on").join("\n");
      assert.doesNotMatch(
        triggers,
        /pull_request_target|workflow_run|issue_comment|issues|repository_dispatch/,
      );
      assert.match(triggers, /^ {2}workflow_dispatch:/m);
    });

    test(`${file}: every action is a full commit SHA with its version beside it`, () => {
      const uses = [...source.matchAll(/^\s*(?:- )?uses:\s*(.+)$/gm)].map(
        (m) => m[1],
      );
      assert.ok(uses.length > 0);
      for (const use of uses)
        assert.match(
          use,
          /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/,
          use,
        );
    });

    test(`${file}: checkout keeps no credentials and no run block expands an expression`, () => {
      const checkouts = source.match(/uses: actions\/checkout@/g) ?? [];
      const careful = source.match(/persist-credentials: false/g) ?? [];
      assert.equal(careful.length, checkouts.length);
      for (const script of runScripts(source))
        assert.doesNotMatch(script, /\$\{\{/, script);
    });

    test(`${file}: every job has a timeout and the workflow cancels or queues by group`, () => {
      for (const [id, lines] of jobsOf(source)) {
        const timeout = /^ {4}timeout-minutes: (\d+)$/m.exec(lines.join("\n"));
        assert.ok(timeout, `${id} has no timeout-minutes`);
        assert.ok(Number(timeout[1]) <= 20, `${id}: ${timeout[1]} minutes`);
      }
      assert.match(code(source), /^concurrency:\n {2}group: /m);
    });
  }
});

describe("ci.yml", () => {
  const jobs = jobsOf(CI);

  test("ci-ok waits for every other job, always runs, and decides from the results", () => {
    const gate = (jobs.get("ci-ok") ?? []).join("\n");
    const listed = /^ {4}needs: \[([^\]]*)\]$/m.exec(gate);
    assert.ok(listed, "ci-ok has no inline needs: [...] list");
    const needs = listed[1]
      .split(",")
      .map((id) => id.trim())
      .sort();
    const others = [...jobs.keys()].filter((id) => id !== "ci-ok").sort();
    assert.deepEqual(needs, others, "ci-ok must list every other job");
    assert.match(gate, /^ {4}if: always\(\)$/m);
    assert.match(gate, /toJSON\(needs\)/);
  });

  test("macOS runs only after a merge or on request, never on a pull request", () => {
    const mac = [...jobs].filter(([, lines]) =>
      /runs-on: .*macos/.test(lines.join("\n")),
    );
    assert.deepEqual(
      mac.map(([id]) => id),
      ["tests-macos"],
    );
    const lines = mac[0][1].join("\n");
    assert.match(lines, /^ {4}if: github\.event_name != 'pull_request'$/m);
    assert.doesNotMatch((jobs.get("tests") ?? []).join("\n"), /macos/);
  });

  test("the pull request run still covers the Node floor, 24.x and 26.x on Linux", () => {
    const lines = (jobs.get("tests") ?? []).join("\n");
    assert.match(lines, /runs-on: ubuntu-latest/);
    assert.match(lines, /node: \["22\.19\.0", "24\.x", "26\.x"\]/);
  });

  test("the engine job runs the strict validate, the footprint gate and the kit tests", () => {
    const lines = (jobs.get("engine") ?? []).join("\n");
    assert.match(lines, /plugin validate \. --strict/);
    assert.match(lines, /check-footprint\.sh/);
    assert.match(lines, /kit-test\.sh/);
    assert.match(lines, /claude: \["2\.1\.299", "2\.1\.\d+"\]/);
  });
});

// The decision of ci-ok is a shell script, so it is run here, with jq and bash,
// against the documents the runner would hand it. Reading the file as text
// (above) cannot tell a script that passes an unexpected skip from one that
// fails it: two mutants of exactly that kind survived the text checks in the
// 0.1.1 review.
const HAS_JQ = spawnSync("jq", ["--version"], { encoding: "utf8" }).status === 0;
const SKIP_NO_JQ = HAS_JQ
  ? false
  : "jq is not installed here (the CI runners and kit-test.sh have it)";
const CI_JOBS = [...jobsOf(CI).keys()].filter((id) => id !== "ci-ok");

/** The run: script of the ci-ok job, exactly as the runner executes it. */
function ciOkScript(): string {
  const scripts = runScripts((jobsOf(CI).get("ci-ok") ?? []).join("\n"));
  assert.equal(scripts.length, 1, "ci-ok has exactly one run step");
  return scripts[0] as string;
}

/** A `needs` document: every job with the result `success`, except the ones listed. */
function needs(over: Record<string, string | null> = {}): string {
  const entry = (id: string) => ({
    result: id in over ? over[id] : "success",
    outputs: {},
  });
  return JSON.stringify(
    Object.fromEntries(CI_JOBS.map((id) => [id, entry(id)])),
  );
}

function decide(document: string, event: string) {
  const env = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    GITHUB_EVENT_NAME: event,
    NEEDS_JSON: document,
  };
  const args = ["--noprofile", "--norc", "-eo", "pipefail", "-c", ciOkScript()];
  return spawnSync("bash", args, { encoding: "utf8", env });
}

const MAC_SKIPPED = { "tests-macos": "skipped" };
const PASSING: [string, string, string][] = [
  ["a push with every job green", "push", needs()],
  ["a manual run with every job green", "workflow_dispatch", needs()],
  ["a pull request with macOS skipped", "pull_request", needs(MAC_SKIPPED)],
];
const FAILING: [string, string, string, RegExp][] = [
  ["a failed job", "push", needs({ tests: "failure" }), /tests: failure/],
  [
    "a cancelled job",
    "pull_request",
    needs({ engine: "cancelled", ...MAC_SKIPPED }),
    /engine: cancelled/,
  ],
  [
    "an unexpected skip (source-guard) on a push",
    "push",
    needs({ "source-guard": "skipped" }),
    /source-guard: skipped/,
  ],
  [
    "an unexpected skip (tests) on a pull request",
    "pull_request",
    needs({ tests: "skipped", ...MAC_SKIPPED }),
    /tests: skipped/,
  ],
  ["macOS skipped on a push", "push", needs(MAC_SKIPPED), /tests-macos: skipped/],
  [
    "macOS skipped on a manual run",
    "workflow_dispatch",
    needs(MAC_SKIPPED),
    /tests-macos: skipped/,
  ],
  [
    "macOS that ran on a pull request",
    "pull_request",
    needs(),
    /tests-macos: success/,
  ],
  [
    "a macOS failure after a merge",
    "push",
    needs({ "tests-macos": "failure" }),
    /tests-macos: failure/,
  ],
  ["a job without a result", "push", needs({ shellcheck: null }), /shellcheck: null/],
  ["no job results at all", "push", "{}", /no job results/],
];

describe("the ci-ok script, run on sample results", () => {
  const skip = SKIP_NO_JQ;

  for (const [name, event, document] of PASSING)
    test(`passes: ${name}`, { skip }, () => {
      const run = decide(document, event);
      assert.equal(run.status, 0, run.stderr);
      const pattern = new RegExp(`^${CI_JOBS.length} jobs finished as expected`);
      assert.match(run.stdout, pattern);
    });

  for (const [name, event, document, message] of FAILING)
    test(`fails: ${name}`, { skip }, () => {
      const run = decide(document, event);
      assert.equal(run.status, 1, run.stdout);
      assert.match(`${run.stdout}${run.stderr}`, message);
    });

  test("fails on a document that is not JSON", { skip }, () => {
    assert.notEqual(decide("not json", "push").status, 0);
  });

  test("a failure names jobs and results only", { skip }, () => {
    const run = decide(needs({ tests: "failure" }), "push");
    const lines = run.stderr.split("\n").filter((l) => l !== "" && !l.startsWith("::"));
    assert.deepEqual(lines, ["tests: failure"]);
  });

  test("the job list used here is the one ci-ok waits for", () => {
    assert.ok(CI_JOBS.includes("tests-macos"), "the script special-cases tests-macos");
    assert.ok(CI_JOBS.length >= 5, CI_JOBS.join(","));
  });
});

describe("engine-drift.yml", () => {
  test("runs weekly and on request, and never on a push or a pull request", () => {
    const triggers = topBlock(DRIFT, "on").join("\n");
    assert.match(triggers, /^ {2}schedule:\n {4}- cron: "[^"]+"$/m);
    assert.match(triggers, /^ {2}workflow_dispatch:$/m);
    assert.doesNotMatch(triggers, /^ {2}(push|pull_request):/m);
    const fields = /cron: "(\S+) (\S+) (\S+) (\S+) (\S+)"/.exec(triggers);
    assert.ok(fields, "five cron fields");
    const [, minute, hour, , , day] = fields;
    assert.match(minute, /^\d+$/);
    assert.notEqual(minute, "0", "not on the hour: GitHub is busiest then");
    assert.match(hour, /^\d+$/);
    assert.match(day, /^\d$/, "once a week");
  });

  test("resolves the newest published Claude Code once, then tests that exact version", () => {
    const scripts = runScripts(DRIFT).join("\n");
    assert.match(scripts, /npm view @anthropic-ai\/claude-code version/);
    assert.match(scripts, /\^\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/);
    assert.match(scripts, /plugin validate \. --strict/);
    assert.match(scripts, /check-footprint\.sh/);
    assert.match(scripts, /kit-test\.sh/);
    assert.doesNotMatch(scripts, /claude-code@latest/);
  });

  test("tells the owner what to do when it fails", () => {
    assert.match(DRIFT, /docs\/DEVELOPMENT\.md/);
    assert.match(code(DRIFT), /if: failure\(\)/);
    assert.match(code(DRIFT), /GITHUB_STEP_SUMMARY/);
  });
});

describe("community files", () => {
  test("CODEOWNERS names the maintainer for everything", () => {
    assert.equal(text(".github/CODEOWNERS").trim(), "* @sairam0424");
  });

  test("both issue forms warn against pasting the clipboard or message text", () => {
    for (const form of ["bug_report", "feature_request"]) {
      const source = text(`.github/ISSUE_TEMPLATE/${form}.yml`);
      assert.match(source, /^name: .+$/m, form);
      assert.match(source, /^description: .+$/m, form);
      assert.match(source, /Never paste the text you copied/, form);
      const ids = [...source.matchAll(/^ {4}id: (\S+)$/gm)].map((m) => m[1]);
      assert.equal(new Set(ids).size, ids.length, `${form}: unique ids`);
    }
  });

  test("CONTRIBUTING.md states the privacy rule and points at the gates", () => {
    const source = text("CONTRIBUTING.md");
    assert.match(source, /never reach a toast, a log, a store or a file/);
    assert.match(source, /docs\/DEVELOPMENT\.md/);
    assert.match(source, /SECURITY\.md/);
  });
});
