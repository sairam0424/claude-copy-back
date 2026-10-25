import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COPY_REASONS,
  MAX_CLIPBOARD_CHARS,
  MAX_REPLIES,
  MIN_COPY_CHARS,
  REFUSALS,
  TOAST_MAX_CHARS,
  toastText,
} from "../hooks/outcome.ts";
import type { Decision } from "../hooks/outcome.ts";

const refuse = (reason: (typeof REFUSALS)[number], searched = 0): Decision => ({
  copied: false,
  reason,
  searched,
});

/** Every toast the mod can show, over the extremes of every count it holds. */
function everyToast(): string[] {
  const out: string[] = [];
  for (const reason of REFUSALS) {
    for (const searched of [0, 1, 2, MAX_REPLIES - 1, MAX_REPLIES]) {
      out.push(toastText(refuse(reason, searched)));
    }
  }
  for (const copyReason of COPY_REASONS) {
    out.push(
      toastText({
        copied: false,
        reason: "copy-refused",
        searched: 3,
        copyReason,
      }),
    );
  }
  for (const chars of [1, 12, 482, 99_999, MAX_CLIPBOARD_CHARS]) {
    for (const rank of [1, 9, MAX_REPLIES]) {
      out.push(toastText({ copied: true, chars, rank }));
    }
  }
  return out;
}

test("toastText: success names the characters and the reply rank", () => {
  const text = toastText({ copied: true, chars: 482, rank: 2 });
  assert.equal(text, "copied 482 chars from reply 2 (1 = newest)");
});

test("toastText: no line repeats the plugin name, which Claude Code puts in front of it", () => {
  for (const text of everyToast()) {
    assert.doesNotMatch(text, /copy-back/i, text);
  }
});

test("toastText: every refusal has its own short line", () => {
  const seen = new Set<string>();
  for (const reason of REFUSALS) {
    const text = toastText(refuse(reason, 7));
    assert.ok(!text.includes("\n"), reason);
    seen.add(text);
  }
  assert.equal(seen.size, REFUSALS.length, "two refusals share one line");
});

test("toastText: every refusal fits the room a 60-column terminal leaves it", () => {
  // At 60 columns Claude Code drew "  copy-back: <text>" in 58 columns and cut
  // the rest with an ellipsis, which leaves TOAST_MAX_CHARS for the text.
  assert.equal(TOAST_MAX_CHARS, 45);
  for (const text of everyToast()) {
    if (text.startsWith("copied ")) continue; // checked on its own below
    assert.ok(text.length <= TOAST_MAX_CHARS, `${text.length}: ${text}`);
  }
});

test("toastText: a success fits up to 99,999 characters, and shows its rank whatever the count", () => {
  for (const chars of [1, 12, 482, 99_999]) {
    for (const rank of [1, 9, MAX_REPLIES]) {
      const text = toastText({ copied: true, chars, rank });
      assert.ok(text.length <= TOAST_MAX_CHARS, `${text.length}: ${text}`);
    }
  }
  for (const chars of [100_000, MAX_CLIPBOARD_CHARS, 9_999_999]) {
    for (const rank of [1, 9, MAX_REPLIES, 99]) {
      const text = toastText({ copied: true, chars, rank });
      // One column of the room goes to the ellipsis that marks the cut.
      const kept = text.slice(0, TOAST_MAX_CHARS - 1);
      assert.ok(kept.includes(`reply ${rank} `), `${rank} cut from: ${text}`);
    }
  }
});

test("toastText: the wording a person reads, pinned", () => {
  assert.equal(
    toastText(refuse("empty")),
    "clipboard is empty, nothing changed",
  );
  assert.equal(
    toastText(refuse("unreadable")),
    "could not read the clipboard, nothing changed",
  );
  assert.equal(
    toastText(refuse("too-large")),
    `clipboard over ${MAX_CLIPBOARD_CHARS} chars, nothing changed`,
  );
  assert.equal(
    toastText(refuse("too-short")),
    `copied text under ${MIN_COPY_CHARS} chars, nothing changed`,
  );
  assert.equal(
    toastText(refuse("ambiguous", 4)),
    "matches more than one place, nothing changed",
  );
  assert.equal(
    toastText(refuse("session-unreadable")),
    "could not read the session, nothing changed",
  );
  assert.equal(
    toastText(refuse("failed")),
    "unexpected error, nothing changed",
  );
});

test("toastText: no-match says how many replies were searched", () => {
  assert.equal(
    toastText(refuse("no-match", 12)),
    "no match in last 12 replies, nothing changed",
  );
  assert.equal(
    toastText(refuse("no-match", 1)),
    "no match in the last reply, nothing changed",
  );
  assert.equal(
    toastText(refuse("no-match", 0)),
    "no replies to search, nothing changed",
  );
});

test("toastText: a refused write names the engine's reason word", () => {
  for (const copyReason of COPY_REASONS) {
    const text = toastText({
      copied: false,
      reason: "copy-refused",
      searched: 3,
      copyReason,
    });
    assert.equal(text, `clipboard write was refused (${copyReason})`);
  }
  assert.equal(toastText(refuse("copy-failed", 3)), "clipboard write failed");
});

test("toastText: a refused write with no reason word still reads", () => {
  const text = toastText(refuse("copy-refused", 3));
  assert.equal(text, "clipboard write was refused (refused)");
});

test("toastText: a refusal reason outside the fixed list reads as the unexpected-error line, never as undefined or a name", () => {
  for (const reason of [
    "nonsense",
    "constructor",
    "__proto__",
    "toString",
    "",
  ]) {
    const text = toastText({
      copied: false,
      reason: reason as never,
      searched: 1,
    });
    assert.equal(text, "unexpected error, nothing changed", reason);
  }
});

test("toastText: a reason word outside the fixed list is never printed, even from a hand-built decision", () => {
  const stray = "text of a private reply";
  const text = toastText({
    copied: false,
    reason: "copy-refused",
    searched: 3,
    copyReason: stray as never,
  });
  assert.equal(text, "clipboard write was refused (refused)");
  assert.doesNotMatch(text, /private/);
});
