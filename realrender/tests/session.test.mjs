import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { surveyTurns } from "../lib/corpus.mjs";
import { buildSession, derivedUuid, mangleCwd } from "../lib/session.mjs";

describe("project folder name", () => {
  test("every non-alphanumeric becomes a dash", () => {
    assert.equal(mangleCwd("/private/tmp/cbrender.AbC123/work"), "-private-tmp-cbrender-AbC123-work");
    assert.equal(mangleCwd("/Users/a_b.c/x y"), "-Users-a-b-c-x-y");
  });
});

describe("synthetic session", () => {
  const turns = [
    { role: "user", text: "prompt" },
    { role: "assistant", text: "reply one" },
    { role: "assistant", text: "reply two" },
  ];
  const lines = buildSession({ sessionId: "sid", cwd: "/w", version: "2.1.309", startMs: 0, turns })
    .trim().split("\n").map((l) => JSON.parse(l));

  test("one valid JSON record per turn, chained by parentUuid", () => {
    assert.equal(lines.length, 3);
    assert.equal(lines[0].parentUuid, null);
    assert.equal(lines[1].parentUuid, lines[0].uuid);
    assert.equal(lines[2].parentUuid, lines[1].uuid);
    assert.equal(new Set(lines.map((l) => l.uuid)).size, 3);
  });

  test("records carry the session, the cwd, the version and the text", () => {
    for (const rec of lines) {
      assert.equal(rec.sessionId, "sid");
      assert.equal(rec.cwd, "/w");
      assert.equal(rec.version, "2.1.309");
      assert.equal(rec.isSidechain, false);
    }
    assert.equal(lines[0].message.content, "prompt");
    assert.deepEqual(lines[1].message.content, [{ type: "text", text: "reply one" }]);
    assert.equal(lines[1].message.role, "assistant");
  });

  test("timestamps rise and are ISO strings", () => {
    const times = lines.map((l) => Date.parse(l.timestamp));
    assert.ok(times.every(Number.isFinite));
    assert.ok(times[0] < times[1] && times[1] < times[2]);
  });

  test("derived uuids are stable and uuid-shaped", () => {
    assert.equal(derivedUuid("a"), derivedUuid("a"));
    assert.notEqual(derivedUuid("a"), derivedUuid("b"));
    assert.match(derivedUuid("a"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("survey corpus", () => {
  const { turns, sentinel } = surveyTurns();
  const all = turns.map((t) => t.text).join("\n");
  const tokens = all.match(/q\d{4}/g);

  test("every token in the corpus is unique", () => {
    assert.equal(new Set(tokens).size, tokens.length);
  });

  test("the sentinel is the last token of the last assistant message", () => {
    const last = turns.at(-1).text;
    assert.ok(last.endsWith(`${sentinel}.`));
    assert.equal(all.split(sentinel).length, 2);
  });

  test("covers the constructs the survey is for", () => {
    for (const needle of ["# Heading one", "**bold", "*italic", "~~struck", "](https://", "<https://", "![alt", "- dash item", "* star item", "+ plus item", "1) paren", "5. five", "> quote", "```js", "    indented block", "\treturn", "---\n", "| head", "日本語", "😀"]) {
      assert.ok(all.includes(needle), needle);
    }
  });
});
