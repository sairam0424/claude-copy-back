// Replay harness inputs: the corpus reader, the span chooser, the baseline cleaner, the construct detector.

import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { project } from "../src/core/project.ts";
import { rowsCovered } from "../src/sim/copy.ts";
import { randomMarkdown } from "../src/sim/grammar.ts";
import { mulberry32 } from "../src/sim/prng.ts";
import { baselineClean, MAX_WRAP, MIN_WRAP } from "../src/replay/baseline.ts";
import { CONSTRUCTS, constructsOf } from "../src/replay/constructs.ts";
import { listTranscriptFiles, sampleCorpus } from "../src/replay/corpus.ts";
import {
  CANARY,
  corpusFactory,
  tmpBase,
} from "../src/replay/selftest.ts";
import { chooseSpan } from "../src/replay/spans.ts";

const SCRIPT = fileURLToPath(new URL("../scripts/replay.mjs", import.meta.url));
const scratch = corpusFactory();
const corpus = scratch.make;
after(scratch.cleanup);

describe("corpus sampling", () => {
  test("lists transcripts in a stable order", () => {
    const dir = corpus();
    const files = listTranscriptFiles(dir);
    assert.equal(files.length, 2);
    assert.deepEqual(files, [...files].sort());
  });

  test("the same seed samples the same messages; another seed may reorder them", () => {
    const dir = corpus();
    const a = sampleCorpus(dir, { seed: 1, count: 5 });
    const b = sampleCorpus(dir, { seed: 1, count: 5 });
    const c = sampleCorpus(dir, { seed: 2, count: 5 });
    assert.deepEqual(a.messages, b.messages);
    assert.equal(a.messages.length, 5);
    assert.notDeepEqual(a.messages, c.messages);
  });

  test("keeps only 200 to 20000 character text blocks, drops duplicates, counts the rest", () => {
    const { messages, stats } = sampleCorpus(corpus(), {
      seed: 1,
      count: 50,
      perFile: 10,
    });
    assert.equal(messages.length, 8);
    assert.ok(messages.every((m) => m.length >= 200 && m.length <= 20_000));
    assert.equal(new Set(messages).size, 8);
    assert.equal(stats.duplicatesDropped, 1);
    assert.equal(stats.textBlocksOutOfRange, 1);
    assert.equal(stats.linesUnparseable, 1);
  });

  test("perFile spreads the sample across transcripts", () => {
    const { messages } = sampleCorpus(corpus(), {
      seed: 1,
      count: 50,
      perFile: 2,
    });
    assert.equal(messages.length, 4);
  });

  test("mainOnly skips subagent transcripts and counts them", () => {
    const dir = corpus();
    const sub = path.join(dir, "project-a", "session-1", "subagents");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, "agent-1.jsonl"),
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: `${"subagent words ".repeat(20)}` }] },
      }) + "\n",
    );
    const all = sampleCorpus(dir, { seed: 1, count: 50, perFile: 10 });
    const main = sampleCorpus(dir, { seed: 1, count: 50, perFile: 10, mainOnly: true });
    assert.equal(all.stats.filesListed, 3);
    assert.equal(all.stats.filesSkippedSubagent, 0);
    assert.equal(all.messages.length, 9);
    assert.equal(main.stats.filesListed, 3);
    assert.equal(main.stats.filesSkippedSubagent, 1);
    assert.equal(main.stats.filesRead, 2);
    assert.equal(main.messages.length, 8);
    assert.ok(main.messages.every((m) => !m.startsWith("subagent words")));
  });

  test("an unreadable root fails with a fixed code and no path", () => {
    assert.throws(
      () =>
        sampleCorpus(path.join(tmpBase(), `no-such-dir-${CANARY}`), {
          seed: 1,
          count: 1,
        }),
      (err: Error) =>
        err.message === "ROOT_UNREADABLE" && !err.message.includes(CANARY),
    );
  });
});

describe("span chooser", () => {
  const rng = mulberry32(99);
  const docs = Array.from({ length: 30 }, () =>
    randomMarkdown(rng, 6, { tables: true }),
  );

  for (const width of [40, 80, 120]) {
    test(`spans honour length, wrap and mid-word requests @ ${width}`, () => {
      let made = 0;
      let wrapped = 0;
      let mid = 0;
      for (const doc of docs) {
        const p = project(doc, { width });
        for (const want of [
          { wrap: true, midWord: true },
          { wrap: false, midWord: false },
        ]) {
          const span = chooseSpan(rng, p, want);
          if (span === null) continue;
          made++;
          const text = p.projected.slice(span.from, span.to);
          assert.ok(
            text.length <= 400 && text.replace(/\s+/g, " ").length >= 12,
          );
          assert.ok(!text.includes("\u0000"));
          assert.equal(
            rowsCovered(p, span.from, span.to).crossesWrap,
            span.wraps,
          );
          assert.equal(span.wraps, want.wrap);
          if (span.wraps) wrapped++;
          if (span.midWord) mid++;
        }
      }
      assert.ok(made > 30, `only ${made} spans`);
      assert.ok(wrapped > 5, "wrap requests must produce wrapping spans");
      assert.ok(mid > 3, "mid-word requests must produce mid-word spans");
    });
  }

  test("is deterministic for a seed", () => {
    const p = project(docs[0] as string, { width: 80 });
    assert.deepEqual(
      chooseSpan(mulberry32(5), p, { wrap: false, midWord: true }),
      chooseSpan(mulberry32(5), p, { wrap: false, midWord: true }),
    );
  });

  test("tiny messages yield no span", () => {
    assert.equal(
      chooseSpan(mulberry32(1), project("hi", { width: 80 }), {
        wrap: false,
        midWord: false,
      }),
      null,
    );
  });
});

describe("baseline cleaner (claude-clean-copy style)", () => {
  const long = "x".repeat(MIN_WRAP + 5);

  test("thresholds are the ones claude-clean-copy uses (60 and 240)", () => {
    assert.equal(MIN_WRAP, 60);
    assert.equal(MAX_WRAP, 240);
  });

  test("the source file credits claude-clean-copy (MIT, Brian Pravato)", () => {
    const file = fileURLToPath(
      new URL("../src/replay/baseline.ts", import.meta.url),
    );
    const header = fs
      .readFileSync(file, "utf8")
      .split("\n")
      .slice(0, 16)
      .join("\n");
    assert.match(header, /github\.com\/kbrianps\/claude-clean-copy/);
    assert.match(header, /\bMIT\b/);
    assert.match(header, /Copyright \(c\) 2026 Brian Pravato/);
  });

  test("strips the margin and padding, joins a full-width row to the next", () => {
    assert.equal(
      baselineClean(`  ${long}   \n  tail words`),
      `${long} tail words`,
    );
  });

  test("strips the margin from every row, also when the first row has none (a copy that starts mid-line)", () => {
    assert.equal(
      baselineClean("mid-line start\n  second row   \n  third row"),
      "mid-line start\nsecond row\nthird row",
    );
  });

  test("drops the reply bullet of a copy that starts on the first row", () => {
    assert.equal(
      baselineClean("⏺ first row\n  second row"),
      "first row\nsecond row",
    );
  });

  test("keeps indentation deeper than the margin", () => {
    assert.equal(
      baselineClean("  def f():\n      return 1"),
      "def f():\n    return 1",
    );
  });

  test("leaves short rows as separate lines", () => {
    assert.equal(
      baselineClean("  short row\n  another row"),
      "short row\nanother row",
    );
  });

  test("never glues a list item or heading to the row above", () => {
    assert.equal(baselineClean(`  ${long}\n  - item`), `${long}\n- item`);
    assert.equal(baselineClean(`  ${long}\n  # heading`), `${long}\n# heading`);
  });

  test("has no way to restore markdown markers", () => {
    assert.notEqual(
      baselineClean("  a **bold** word here"),
      "a **bold** word here".replace("**", ""),
    );
    assert.equal(baselineClean("  a bold word here"), "a bold word here");
  });
});

describe("constructs", () => {
  const samples: Record<string, string> = {
    table: "intro\n\n| a | b |\n|---|---|\n| 1 | 2 |",
    nestedList: "- a\n  - b",
    codeFence: "```\nx\n```",
    link: "see [x](http://y.z)",
    heading: "## Title\ntext",
    quote: "> quoted",
    longToken: "see " + "a".repeat(70),
    wideChars: "你好 world",
  };
  for (const name of CONSTRUCTS) {
    test(`detects ${name}`, () =>
      assert.ok(constructsOf(samples[name] as string).includes(name)));
  }
  test("plain prose has none", () =>
    assert.deepEqual(constructsOf("just a plain sentence of words."), []));
});

describe("tmpBase", () => {
  type Key = "COPY_BACK_TMP" | "CLAUDE_JOB_DIR";
  const KEYS: readonly Key[] = ["COPY_BACK_TMP", "CLAUDE_JOB_DIR"];

  /** Run `body` with exactly these two variables set (or unset), then restore. */
  function withEnv(set: Partial<Record<Key, string>>, body: () => void): void {
    const saved = KEYS.map((key) => [key, process.env[key]] as const);
    const apply = (key: Key, value: string | undefined): void => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    try {
      for (const key of KEYS) apply(key, set[key]);
      body();
    } finally {
      for (const [key, value] of saved) apply(key, value);
    }
  }

  test("COPY_BACK_TMP names the scratch folder and it is created", () => {
    const chosen = path.join(os.tmpdir(), `copy-back-tmpbase-${process.pid}`);
    try {
      withEnv({ COPY_BACK_TMP: chosen }, () => {
        assert.equal(tmpBase(), chosen);
        assert.ok(fs.statSync(chosen).isDirectory());
      });
    } finally {
      fs.rmSync(chosen, { recursive: true, force: true });
    }
  });

  test("without it the OS temp dir is used; CLAUDE_JOB_DIR is not read", () => {
    const ignored = path.join(os.tmpdir(), "copy-back-job-dir-ignored");
    withEnv({ CLAUDE_JOB_DIR: ignored }, () => {
      assert.equal(tmpBase(), os.tmpdir());
    });
  });
});
