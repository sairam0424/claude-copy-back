import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_CLIPBOARD_CHARS,
  MIN_COPY_CHARS,
  REFUSALS,
  toastText,
} from "../hooks/outcome.ts";
import type { Decision } from "../hooks/outcome.ts";

const refuse = (reason: (typeof REFUSALS)[number], searched = 0): Decision => ({
  copied: false,
  reason,
  searched,
});

test("toastText: success names the characters and the reply rank", () => {
  const text = toastText({ copied: true, chars: 482, rank: 2 });
  assert.equal(
    text,
    "copy-back: copied 482 characters from reply 2 (1 = newest)",
  );
});

test("toastText: every refusal has its own short line in the same prefix", () => {
  const seen = new Set<string>();
  for (const reason of REFUSALS) {
    const text = toastText(refuse(reason, 7));
    assert.ok(text.startsWith("copy-back: "), text);
    assert.ok(text.length <= 90, `${reason}: ${text.length} characters`);
    assert.ok(!text.includes("\n"), reason);
    seen.add(text);
  }
  assert.equal(seen.size, REFUSALS.length, "two refusals share one line");
});

test("toastText: the wording a person reads, pinned", () => {
  assert.equal(
    toastText(refuse("empty")),
    "copy-back: clipboard is empty, nothing changed",
  );
  assert.equal(
    toastText(refuse("unreadable")),
    "copy-back: could not read the clipboard, nothing changed",
  );
  assert.equal(
    toastText(refuse("too-large")),
    `copy-back: clipboard is over ${MAX_CLIPBOARD_CHARS} characters, nothing changed`,
  );
  assert.equal(
    toastText(refuse("too-short")),
    `copy-back: copied text is under ${MIN_COPY_CHARS} characters, nothing changed`,
  );
  assert.equal(
    toastText(refuse("ambiguous", 4)),
    "copy-back: matches more than one place, nothing changed",
  );
  assert.equal(
    toastText(refuse("session-unreadable")),
    "copy-back: could not read the session, nothing changed",
  );
  assert.equal(
    toastText(refuse("failed")),
    "copy-back: stopped on an unexpected error, nothing changed",
  );
});

test("toastText: no-match says how many replies were searched", () => {
  assert.equal(
    toastText(refuse("no-match", 12)),
    "copy-back: no match in the last 12 replies, nothing changed",
  );
  assert.equal(
    toastText(refuse("no-match", 1)),
    "copy-back: no match in the last reply, nothing changed",
  );
  assert.equal(
    toastText(refuse("no-match", 0)),
    "copy-back: no replies to search, nothing changed",
  );
});

test("toastText: a refused write names the engine's reason word", () => {
  for (const copyReason of ["no-surface", "no-clipboard", "refused"] as const) {
    const text = toastText({
      copied: false,
      reason: "copy-refused",
      searched: 3,
      copyReason,
    });
    assert.equal(
      text,
      `copy-back: the clipboard write was refused (${copyReason})`,
    );
  }
  assert.equal(
    toastText(refuse("copy-failed", 3)),
    "copy-back: the clipboard write failed",
  );
});

test("toastText: a refused write with no reason word still reads", () => {
  const text = toastText(refuse("copy-refused", 3));
  assert.equal(text, "copy-back: the clipboard write was refused (refused)");
});
