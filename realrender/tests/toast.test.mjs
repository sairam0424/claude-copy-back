import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { REFUSAL_LINES, classifyToast, copiedLine, extractToasts, judgeToast, readToast } from "../lib/toast.mjs";

describe("toast reader", () => {
  test("strips the engine's repeated name prefix once and records a cut", () => {
    assert.deepEqual(readToast("copy-back: copy-back: copied 70 chars from reply 33 (1 = newest)"), { text: "copy-back: copied 70 chars from reply 33 (1 = newest)", truncated: false });
    assert.deepEqual(readToast("copy-back: copy-back: copied 69 chars from reply 3…"), { text: "copy-back: copied 69 chars from reply 3", truncated: true });
    assert.deepEqual(readToast("copy-back: could not register /cc"), { text: "copy-back: could not register /cc", truncated: false });
  });

  test("a toast with the engine's name once (the hooks no longer repeat it) reads as it stands", () => {
    assert.deepEqual(readToast("copy-back: copied 70 chars from reply 33 (1 = newest)"), { text: "copy-back: copied 70 chars from reply 33 (1 = newest)", truncated: false });
    assert.deepEqual(readToast("copy-back: no match in last 40 replies, nothing cha…"), { text: "copy-back: no match in last 40 replies, nothing cha", truncated: true });
    assert.deepEqual(extractToasts("  ⏸ manual mode on · ? for shortcuts        copy-back: copied 117 chars from reply 16 (1 = newest)\n"), [{ text: "copy-back: copied 117 chars from reply 16 (1 = newest)", truncated: false }]);
  });

  test("finds the toast on a screen, wherever it is indented", () => {
    const screen = "❯ \n  ⏸ manual mode on\n                             copy-back: copy-back: clipboard is empty, nothing changed\n";
    assert.deepEqual(extractToasts(screen), [{ text: "copy-back: clipboard is empty, nothing changed", truncated: false }]);
    assert.deepEqual(extractToasts("no toast here\n"), []);
  });

  test("the grammar knows the copied line and every refusal line", () => {
    assert.deepEqual(classifyToast(copiedLine(482, 2)), { kind: "copied", chars: 482, rank: 2 });
    for (const [kind, line] of Object.entries(REFUSAL_LINES)) assert.equal(classifyToast(line).kind, "refusal", kind);
    assert.equal(classifyToast("copy-back: copied 482 chars from reply 2 (1 = newest) and more").kind, "other");
    assert.equal(classifyToast("copy-back: the clipboard held something").kind, "other");
  });

  test("a complete toast must equal the expected line; a cut one must be a prefix of it", () => {
    const line = copiedLine(69, 33);
    assert.equal(judgeToast({ text: line, truncated: false }, line), "complete");
    assert.equal(judgeToast({ text: copiedLine(69, 34), truncated: false }, line), "wrong");
    assert.equal(judgeToast({ text: "copy-back: copied 69 chars from reply 3", truncated: true }, line), "prefix");
    assert.equal(judgeToast({ text: "copy-back: copied 70 characters from rep", truncated: true }, line), "wrong");
    assert.equal(judgeToast({ text: "copy-back: copied 69 chars from reply 33 (1 = newest) extra", truncated: true }, line), "wrong");
  });

  test("a leaked piece of text is neither a complete nor a prefix match", () => {
    const leak = readToast("copy-back: copy-back: copied 12 characters: gadget0412 pillar");
    assert.equal(judgeToast(leak, copiedLine(12, 5)), "wrong");
  });
});
