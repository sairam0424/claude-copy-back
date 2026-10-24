import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { CANARY } from "../lib/live-cases.mjs";
import { canaryHits, liveCopies, promptHistory } from "../lib/live-run.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrun-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const span = (from, to, startOffset, endCut) => ({ startToken: from, endToken: to, startOffset, endCut });

describe("live run helpers", () => {
  test("liveCopies reads the selection text for each record from the live history", () => {
    const history = ["", "⏺ The first reply has alpha1111 then", "  beta2222 and gamma3333 end.", "", "❯ next", ""].join("\n");
    const messages = [{ tokens: [{ id: "alpha1111" }, { id: "beta2222" }, { id: "gamma3333" }] }];
    const records = [span("alpha1111", "beta2222", 0, 0), span("beta2222", "gamma3333", 1, 2), span("nowhere9999", "alpha1111", 0, 0)];
    assert.deepEqual(liveCopies({ historyText: history, records, messages, width: 60 }), ["alpha1111 then\n  beta2222", "eta2222 and gamma33", null]);
  });

  test("canaryHits finds the canary in files outside the shim directory and ignores the fixtures", () => {
    const root = path.join(base, "sandbox");
    for (const d of ["shims", "home/.claude", "out"]) fs.mkdirSync(path.join(root, d), { recursive: true });
    fs.writeFileSync(path.join(root, "shims", "pbpaste.fixture"), `${CANARY} fixture`);
    fs.writeFileSync(path.join(root, "home/.claude/ok.log"), "nothing here");
    assert.deepEqual(canaryHits(root), []);
    fs.writeFileSync(path.join(root, "out/raw-stream.bin"), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(CANARY)]));
    fs.writeFileSync(path.join(root, "home/.claude/leak.log"), `xx ${CANARY} yy`);
    assert.deepEqual(canaryHits(root).sort(), ["home/.claude/leak.log", "out/raw-stream.bin"]);
  });

  test("promptHistory lists the distinct typed lines and tolerates a missing file", () => {
    const file = path.join(base, "history.jsonl");
    assert.deepEqual(promptHistory(file), { lines: 0, distinct: [] });
    const rows = [{ display: "/cc", ts: 1 }, { display: "/cc", ts: 2 }, { other: 1 }];
    fs.writeFileSync(file, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    assert.deepEqual(promptHistory(file), { lines: 3, distinct: ["/cc", "?"] });
  });
});
