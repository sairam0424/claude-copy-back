import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { addedNames, analyzeRaw, bannerVersion, dialogsIn, listTree } from "../lib/evidence.mjs";

const base = fs.mkdtempSync(path.join(process.env.COPY_BACK_TMP ?? os.tmpdir(), "cbrender-test-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

describe("raw stream analysis", () => {
  test("counts private modes, hyperlinks, clipboard writes and erases", () => {
    const raw = Buffer.from("\x1b[?1049h\x1b[?1003h\x1b[?1006h\x1b[?2026h hello \x1b]8;;http://x\x07link\x1b]8;;\x07 \x1b[K\x1b[0K\x1b]52;c;QQ==\x07\x1b[?1003l", "latin1");
    const a = analyzeRaw(raw);
    assert.equal(a.modes["set 1049"], 1);
    assert.equal(a.modes["set 1003"], 1);
    assert.equal(a.modes["reset 1003"], 1);
    assert.equal(a.osc8Hyperlinks, 2);
    assert.equal(a.osc52Clipboard, 1);
    assert.equal(a.eraseToEndOfLine, 2);
    assert.equal(a.synchronizedUpdates, 1);
    assert.equal(a.bytes, raw.length);
  });

  test("an empty stream is all zeros", () => {
    const a = analyzeRaw(Buffer.alloc(0));
    assert.deepEqual(a, { bytes: 0, modes: {}, osc8Hyperlinks: 0, osc52Clipboard: 0, eraseToEndOfLine: 0, synchronizedUpdates: 0 });
  });
});

describe("screen observers", () => {
  test("banner version and dialog phrases", () => {
    assert.equal(bannerVersion(" Claude Code v2.1.309\n x"), "2.1.309");
    assert.equal(bannerVersion("nothing"), null);
    assert.deepEqual(dialogsIn("Do you trust the files in this folder?"), ["Do you trust the files"]);
    assert.deepEqual(dialogsIn("quiet screen"), []);
  });

  test("listTree lists files with sizes, sorted, and tolerates a missing root", () => {
    fs.mkdirSync(path.join(base, "a", "b"), { recursive: true });
    fs.writeFileSync(path.join(base, "z.txt"), "12345");
    fs.writeFileSync(path.join(base, "a", "b", "f.txt"), "1");
    assert.deepEqual(listTree(base), [{ path: "a/b/f.txt", bytes: 1 }, { path: "z.txt", bytes: 5 }]);
    assert.deepEqual(listTree(path.join(base, "none")), []);
  });

  test("addedNames lists only new names", () => {
    assert.deepEqual(addedNames(new Set(["a", "b"]), new Set(["a", "b", "d", "c"])), ["c", "d"]);
  });
});
