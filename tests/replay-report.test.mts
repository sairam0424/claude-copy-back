// Replay harness report: its shape, arithmetic, and the counts-only diagnostics.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { findSource } from "../src/core/match.ts";
import type { FindResult } from "../src/core/match.ts";
import { project } from "../src/core/project.ts";
import { runReplay } from "../src/replay/cli.ts";
import { CONSTRUCTS } from "../src/replay/constructs.ts";
import {
  corpusFactory,
} from "../src/replay/selftest.ts";
import { factsOf, newBucket, runTrials } from "../src/replay/trials.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/replay.mjs", import.meta.url));
const scratch = corpusFactory();
const corpus = scratch.make;
after(scratch.cleanup);

describe("report shape and arithmetic", () => {
  const report = runReplay(corpus(), {
    seed: 1,
    messages: 20,
    widths: [60, 100],
    spans: 2,
    windowSize: 40,
  });

  test("outcomes add up to the trials in every bucket", () => {
    const buckets = [
      report.total,
      ...Object.values(report.perWidth),
      ...Object.values(report.bySpanKind),
      ...Object.values(report.byConstruct),
    ];
    for (const b of buckets) {
      assert.equal(
        b.exact + b.wrongSlice + b.noMatch + b.ambiguous + b.tooShort + b.empty,
        b.trials,
      );
      assert.equal(b.negativeControl.trials, b.trials);
    }
    assert.deepEqual(Object.keys(report.perWidth), ["60", "100"]);
    assert.deepEqual(Object.keys(report.byConstruct), [...CONSTRUCTS]);
  });

  test("the total is the sum of the widths", () => {
    const sum = newBucket();
    for (const b of Object.values(report.perWidth)) {
      sum.trials += b.trials;
      sum.exact += b.exact;
    }
    assert.equal(report.total.trials, sum.trials);
    assert.equal(report.total.exact, sum.exact);
  });

  test("a main-only run says so in its config and skips nothing on a corpus without subagents", () => {
    const run = runReplay(corpus(), { seed: 1, messages: 20, widths: [60], spans: 2, windowSize: 40, mainOnly: true });
    assert.equal(run.config.mainOnly, true);
    assert.equal(run.corpus.filesSkippedSubagent, 0);
    assert.equal(report.config.mainOnly, false);
  });

  test("a sensitivity run with another bullet glyph still matches (marker-agnostic fallback)", () => {
    const variant = runReplay(corpus(), { seed: 1, messages: 20, widths: [60, 100], spans: 2, windowSize: 40, bullet: "-" });
    assert.equal(variant.config.simBullet, "-");
    assert.ok(variant.total.exactRate >= 0.9, `rate ${variant.total.exactRate}`);
    assert.equal(variant.total.wrongSlice, 0);
  });

  test("the report is plain JSON counts: no strings beyond keys and the tool name", () => {
    const strings: string[] = [];
    JSON.stringify(report, (_k, v) => {
      if (typeof v === "string") strings.push(v);
      return v;
    });
    assert.deepEqual(strings, ["copy-back replay"]);
  });
});

describe("failure facts (the diagnostics for non-exact trials)", () => {
  const source = "intro words here\n\n- alpha bravo charlie delta\n- echo foxtrot golf hotel india";

  test("positions relative to list markers, never content", () => {
    const p = project(source, { width: 80 });
    const atBullet = p.projected.indexOf("- alpha");
    const facts = factsOf(source, undefined, { from: atBullet, to: atBullet + 20 }, "  - alpha bravo charlie");
    assert.deepEqual(facts, {
      messageHasMarkers: true,
      spanStartsAtMarker: true,
      spanEndsAtMarker: false,
      spanContainsMarker: true,
      copyStartsMarkerLike: true,
      copyEndsOnLoneMarker: false,
      copyIsOneRow: true,
    });
    for (const value of Object.values(facts)) assert.equal(typeof value, "boolean");
  });

  test("a message without lists has no markers", () => {
    const facts = factsOf("plain words only", undefined, { from: 0, to: 5 }, "plain");
    assert.equal(facts["messageHasMarkers"], false);
    assert.equal(facts["spanContainsMarker"], false);
  });

  test("runTrials records the facts of failing trials (a known gap: number-like text plus another renderer's bullets)", () => {
    // "2. text..." cannot interrupt a paragraph, so the parser keeps it as text, while the
    // marker-agnostic search strips number-like rows from the copy: a known no-match.
    const base =
      "Steps:\nlead-in paragraph line\n2. text that looks like a list item but cannot interrupt a paragraph, far enough along to wrap well\n" +
      "- real bullet alpha bravo charlie delta echo foxtrot golf hotel india\n- real bullet juliet kilo lima mike november oscar papa quebec romeo sierra tango";
    const report = runTrials([base, `${base} extra tail words`, `${base} other tail`], {
      seed: 1,
      widths: [40, 60, 80],
      spansPerMessage: 10,
      windowSize: 40,
      simBullet: "•",
    });
    assert.ok(report.total.noMatch > 0, "the crafted corpus must fail somewhere");
    const noMatch = report.failureFacts["noMatch"] as Record<string, number>;
    assert.equal(noMatch["trials"], report.total.noMatch);
    assert.equal(noMatch["messageHasMarkers"], report.total.noMatch);
    assert.equal(report.total.wrongSlice, 0, "a failure must be a refusal, never a wrong slice");
    assert.equal(report.total.exact + report.total.noMatch, report.total.trials);
  });
});

describe("wrong slices: harmless (same words) versus harmful", () => {
  // The same sentence in two messages, bold in one and plain in the other.
  // By default the matcher refuses (ambiguous). With newestWins it returns the
  // other message's plain slice: not the true source slice, but the very same
  // words. The report must say so.
  const A =
    "First message intro that has nothing in common with the other one.\n\n" +
    "Run the command: **npm test** now and wait for the whole suite to finish.";
  const B =
    "Second message with an entirely different opening paragraph here.\n\n" +
    "Run the command: npm test now and wait for the whole suite to finish.";

  test("by default the matcher refuses instead of returning the other message's slice", () => {
    const report = runTrials([A, B], {
      seed: 3,
      widths: [40, 60, 80],
      spansPerMessage: 40,
      windowSize: 40,
    });
    assert.equal(report.total.wrongSlice, 0);
    assert.ok(report.total.ambiguous > 0, "the crafted corpus must hit the conflict");
  });

  test("a wrong slice with the same letters and digits is counted as such (newest-wins mode)", () => {
    const report = runTrials([A, B], {
      seed: 3,
      widths: [40, 60, 80],
      spansPerMessage: 40,
      windowSize: 40,
      newestWins: true,
    });
    const t = report.total;
    assert.ok(t.wrongSlice > 0, "the crafted corpus must produce wrong slices");
    assert.equal(t.wrongSliceKinds.otherMessage, t.wrongSlice);
    assert.equal(t.wrongSliceSameWords, t.wrongSlice, "all of them carry the same words");
  });

  test("a clean corpus reports zero", () => {
    const report = runTrials([A, "an unrelated message about something else entirely, long enough to be a message of its own"], {
      seed: 3,
      widths: [60],
      spansPerMessage: 5,
      windowSize: 40,
    });
    assert.equal(report.total.wrongSliceSameWords, 0);
  });
});

describe("failure facts: negative-control false positives", () => {
  // The same list text numbered differently in a second message. The matcher
  // used to ignore list numbers in its marker-agnostic search, so a copy whose
  // span holds "1." or "2." reached B's differently numbered line: a false
  // positive. It no longer does (the fix); the diagnostics must still show a
  // false positive and say which kind it is, so a matcher with that weakness
  // is injected through the harness's test seam.
  const A =
    "Steps to follow:\n\n1. install the dependencies with the package manager of your choice today\n" +
    "2. run the build step and wait for it to finish completely before going on\n" +
    "3. start the server and open the page in a browser to check";
  const B = A.replace("1. install", "2. install")
    .replace("2. run", "3. run")
    .replace("3. start", "4. start");

  const NUMBER = /^[ \t]*\d+[.)][ \t]+/gm;
  /** findSource as it behaved before the fix: when nothing matches, retry with every list number deleted on both sides. */
  function numbersIgnored(copied: string, messages: readonly string[]): FindResult {
    const real = findSource(copied, messages);
    if (real.ok || !NUMBER.test(copied)) return real;
    NUMBER.lastIndex = 0;
    return findSource(copied.replace(NUMBER, ""), messages.map((m) => m.replace(NUMBER, "")));
  }

  test("the fixed matcher has no false positives on numbered lists", () => {
    const report = runTrials([A, B], {
      seed: 1,
      widths: [40, 60, 80],
      spansPerMessage: 30,
      windowSize: 40,
    });
    assert.equal(report.total.negativeControl.falsePositives, 0);
    assert.equal(report.total.wrongSlice, 0);
  });

  test("every control false positive is counted in failureFacts, with its structural facts", () => {
    const report = runTrials([A, B], {
      seed: 1,
      widths: [40, 60, 80],
      spansPerMessage: 30,
      windowSize: 40,
      find: numbersIgnored,
    });
    const control = report.total.negativeControl;
    assert.ok(control.falsePositives > 0, "the weak matcher must produce false positives");
    const facts = report.failureFacts["controlFalsePositive"] as Record<string, number>;
    assert.equal(facts["trials"], control.falsePositives);
    assert.equal(facts["spanContainsMarker"], control.falsePositives, "every one of them has a list marker inside the span");
  });

  test("a clean corpus has no controlFalsePositive entry", () => {
    const report = runTrials([A, "an unrelated message about something else entirely, long enough to be a message of its own"], {
      seed: 1,
      widths: [60],
      spansPerMessage: 5,
      windowSize: 40,
    });
    assert.equal(report.total.negativeControl.falsePositives, 0);
    assert.equal(report.failureFacts["controlFalsePositive"], undefined);
  });
});

describe("paste counters", () => {
  const LISTED =
    "1. Install the tool and then build the whole project:\n\n" +
    "   ```bash\n   npm install --save-dev some-tool-name\n   npm run build:all --verbose\n   npm run test:all --coverage\n   ```\n\n" +
    "2. Next step goes here with enough words to be a paragraph of its own.";

  test("code in a list reports paste forms that differ from the exact slice, and none invented", () => {
    const report = runTrials([LISTED], {
      seed: 5,
      widths: [60, 80],
      spansPerMessage: 40,
      windowSize: 40,
    });
    assert.ok(report.total.exact > 0);
    assert.ok(report.total.paste.differs > 0, "multi-line code spans lose the list indentation");
    assert.equal(report.total.paste.invented, 0);
  });

  test("a matcher whose paste form holds a foreign character is counted as inventing", () => {
    const inventing = (copied: string, messages: readonly string[]): FindResult => {
      const real = findSource(copied, messages);
      return real.ok ? { ...real, paste: real.source + "\u2603" } : real;
    };
    const report = runTrials([LISTED], {
      seed: 5,
      widths: [60],
      spansPerMessage: 10,
      windowSize: 40,
      find: inventing,
    });
    assert.ok(report.total.exact > 0);
    assert.equal(report.total.paste.invented, report.total.exact);
  });
});
