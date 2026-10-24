// The words the user reads: CAPTURES.md and --help must carry the safety
// instructions the review asked for.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { HELP_TEXT } from "../src/captures/help.ts";

const DOC = fs.readFileSync(
  fileURLToPath(new URL("../CAPTURES.md", import.meta.url)),
  "utf8",
);

describe("CAPTURES.md", () => {
  test("has 6 to 10 numbered steps", () => {
    const steps = DOC.match(/^\d+\. \*\*/gm) ?? [];
    assert.ok(steps.length >= 6 && steps.length <= 10, `${steps.length} steps`);
  });

  test("keeps the privacy promises to two sentences", () => {
    const paragraph =
      DOC.split("\n").find((l) =>
        l.startsWith("**Privacy, in two sentences.**"),
      ) ?? "";
    const body = paragraph.replace("**Privacy, in two sentences.**", "");
    assert.equal((body.match(/\.(\s|$)/g) ?? []).length, 2);
  });

  test("says never to run run --show inside Claude Code or with a leading !", () => {
    assert.match(DOC, /never run it inside Claude Code/i);
    assert.match(DOC, /never type it with a leading `!`/i);
  });

  test("explains the code, INCOMPLETE and the early FAIL", () => {
    for (const word of [
      "INCOMPLETE",
      "at once",
      "short code",
      "--project",
      "--allow-redirect",
    ])
      assert.ok(DOC.includes(word), word);
  });

  const bullet = (name: string): string =>
    DOC.split("\n").find((l) => l.trimStart().startsWith(`- **${name}**`)) ??
    "";

  test("PASS bullet: at least 10 matched and right, and refusals do not count toward them", () => {
    const pass = bullet("PASS");
    assert.match(pass, /at least 10 of them matched and right/i);
    assert.match(pass, /the tool returned text and you judged it `ok`/i);
    assert.match(pass, /refusals judged right do not count/i);
  });

  test("INSUFFICIENT bullet: fewer than 10 matched and right, and what to copy", () => {
    const insufficient = bullet("INSUFFICIENT");
    for (const phrase of [
      /fewer than 10 matched and right/i,
      /how many more of each/i,
      /normal reply prose/i,
      /bullet and numbered lists/i,
      /code blocks/i,
      /not tables/i,
      /command output/i,
      /`add`/,
      /`tally`/,
    ])
      assert.match(insufficient, phrase);
  });

  test("FAIL bullet: under 70% stays a FAIL whatever the matches", () => {
    assert.match(bullet("FAIL"), /under 70% `ok`/);
  });

  test("FAIL bullet: a FAIL is final, copies are not added to turn it into a pass", () => {
    assert.match(
      bullet("FAIL"),
      /A FAIL is final: do not add copies and count again/,
    );
  });

  test("planning step: at least 10 of the 20 must be findable regions", () => {
    const plan = DOC.split("\n").find((l) => l.startsWith("1. **Plan")) ?? "";
    assert.match(
      plan,
      /at least 10 of the 20 must be regions the tool should be able to find/i,
    );
    assert.match(plan, /normal reply prose/i);
    assert.match(plan, /tables or command output/i);
  });

  test("no longer mentions a weak pass", () => {
    assert.doesNotMatch(DOC, /weak/i);
  });

  test("says the folder stays out of git repositories and the project", () => {
    assert.match(DOC, /outside every git repository/);
  });

  test("tells the person not to tune the matcher on these captures", () => {
    assert.match(DOC, /do not tune the matcher on them/i);
  });
});

describe("--help", () => {
  test("mentions the new options and the safety rules", () => {
    for (const word of [
      "--allow-redirect",
      "--project",
      "INCOMPLETE",
      "never inside Claude Code",
      "refuses to run unless its output is a",
      "echo ok 1a2b3c4d",
      "do not tune the matcher",
    ])
      assert.ok(HELP_TEXT.toLowerCase().includes(word.toLowerCase()), word);
  });

  test("names Warp only as the author's own terminal, not as supported", () => {
    assert.match(HELP_TEXT, /the author uses Warp/);
    assert.doesNotMatch(HELP_TEXT, /\bin Warp\b/i);
  });

  const step = (n: number): string =>
    (
      HELP_TEXT.split(/\n {2}(?=\d\. )/).find((b) => b.startsWith(`${n}. `)) ??
      ""
    ).replace(/\s+/g, " ");

  test("help step 1: at least 10 of the 20 must be findable regions", () => {
    const plan = step(1);
    assert.match(
      plan,
      /at least 10 of the 20 must be regions the tool should be able to find/i,
    );
    assert.match(plan, /normal reply prose/i);
    assert.match(plan, /tables or command output/i);
  });

  test("help step 6: the matched-and-right bar and what to do on INSUFFICIENT because of it", () => {
    const count = step(6);
    for (const phrase of [
      /at least 10 of them matched and right/i,
      /the tool returned text and you judged it ok/i,
      /refusals judged right do not count/i,
      /fewer than 10 matched and right/i,
      /how many more of each/i,
      /normal reply prose/i,
      /bullet and numbered lists/i,
      /code blocks/i,
      /not tables/i,
      /command output/i,
      /under 70% ok/i,
    ])
      assert.match(count, phrase);
  });

  test("no longer mentions a weak pass", () => {
    assert.doesNotMatch(HELP_TEXT, /weak/i);
  });
});
