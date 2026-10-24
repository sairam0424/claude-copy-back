import { test } from "node:test";
import assert from "node:assert/strict";
import { runCc } from "../hooks/cc.ts";
import { MAX_CLIPBOARD_CHARS, MAX_REPLIES } from "../hooks/outcome.ts";
import { cleanRun, fakes } from "./cc-fakes.ts";
import {
  COPY_CODE,
  COPY_PROSE,
  COPY_TWICE,
  PASTE_CODE,
  PASTE_PROSE,
  REPLY_MAIN,
  REPLY_OLDER,
  REPLY_TWICE,
  row,
} from "./cc-fixtures.ts";

const conversation = [
  row("user", "how do I fix the rollout?"),
  row("assistant", REPLY_OLDER),
  row("user", "and now?"),
  row("assistant", REPLY_MAIN),
];

test("happy path: the paste is what reaches the copy, and one toast reports counts", async () => {
  const f = fakes({ stdout: COPY_PROSE, rows: conversation });
  const out = await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_PROSE]);
  assert.equal(out.copied, true);
  assert.deepEqual(f.toasts, [
    `copy-back: copied ${PASTE_PROSE.length} characters from reply 1 (1 = newest)`,
  ]);
  assert.deepEqual(f.log, ["read", "messages", "copy", "toast", "forget"]);
});

test("rank: a match in an older reply reports its place, 1 being the newest", async () => {
  const f = fakes({
    stdout:
      "An older reply about something else entirely, with different words",
    rows: conversation,
  });
  const out = await runCc(f.deps);
  assert.equal(out.copied, true);
  assert.equal(out.copied && out.rank, 2);
  assert.match(f.toasts[0] ?? "", /from reply 2 \(1 = newest\)/);
});

test("a code line comes back without the margin", async () => {
  const f = fakes({ stdout: COPY_CODE, rows: conversation });
  await runCc(f.deps);
  assert.deepEqual(f.copies, [PASTE_CODE]);
});

test("the clipboard is read once, whatever happens", async () => {
  const cases = [
    fakes({ stdout: COPY_PROSE, rows: conversation }),
    fakes({ stdout: "short" }),
    fakes({ stdout: "no such text anywhere in the replies at all" }),
    fakes({ stdout: COPY_PROSE, messagesError: new Error("boom") }),
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copyError: new Error("x"),
    }),
  ];
  for (const f of cases) {
    await runCc(f.deps);
    assert.equal(f.count("read"), 1);
  }
});

test("refusals from the matcher leave the copy uncalled and say why", async () => {
  const twice = [row("assistant", REPLY_TWICE), row("assistant", REPLY_OLDER)];
  const table: [string, string, typeof conversation, string][] = [
    [
      "too-short",
      "short",
      conversation,
      "copy-back: copied text is under 12 characters, nothing changed",
    ],
    [
      "no-match",
      "no such text anywhere in these replies",
      conversation,
      "copy-back: no match in the last 2 replies, nothing changed",
    ],
    [
      "ambiguous",
      COPY_TWICE,
      twice,
      "copy-back: matches more than one place, nothing changed",
    ],
  ];
  for (const [reason, stdout, rows, toast] of table) {
    const f = fakes({ stdout, rows });
    const out = await runCc(f.deps);
    assert.equal(out.copied, false, reason);
    assert.equal(!out.copied && out.reason, reason);
    assert.equal(f.count("copy"), 0, reason);
    assert.deepEqual(f.copies, [], reason);
    assert.deepEqual(f.toasts, [toast], reason);
  }
});

test("an empty or blank clipboard stops before the session is read", async () => {
  for (const stdout of ["", "  \n ", "\t"]) {
    const f = fakes({ stdout, rows: conversation });
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "empty");
    assert.equal(f.count("messages"), 0);
    assert.equal(f.count("copy"), 0);
    assert.deepEqual(f.toasts, [
      "copy-back: clipboard is empty, nothing changed",
    ]);
  }
});

test("a failed clipboard read stops before the session is read", async () => {
  const bad: Record<string, Parameters<typeof fakes>[0]> = {
    "non-zero exit": {
      run: { ...cleanRun("text that is long enough"), exitCode: 1 },
    },
    rejection: { runError: new Error("spawn failed") },
    timeout: { runError: new Error("timed out") },
    malformed: { run: { stdout: 5 } },
    "no answer": { run: undefined },
  };
  for (const [name, opts] of Object.entries(bad)) {
    const f = fakes({ ...opts, rows: conversation });
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "unreadable", name);
    assert.equal(f.count("messages"), 0, name);
    assert.equal(f.count("copy"), 0, name);
    assert.deepEqual(
      f.toasts,
      ["copy-back: could not read the clipboard, nothing changed"],
      name,
    );
  }
});

test("a huge or truncated clipboard is refused as too large", async () => {
  const huge = fakes({
    stdout: "a".repeat(MAX_CLIPBOARD_CHARS + 1),
    rows: conversation,
  });
  const cut = fakes({
    run: { ...cleanRun("partial text that is long"), isStdoutTruncated: true },
    rows: conversation,
  });
  for (const f of [huge, cut]) {
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "too-large");
    assert.equal(f.count("messages"), 0);
    assert.equal(f.count("copy"), 0);
  }
});

test("a session that cannot be read leaves the copy uncalled", async () => {
  const bad = [
    fakes({ stdout: COPY_PROSE, messagesError: new Error("denied") }),
    fakes({ stdout: COPY_PROSE, messages: { deny: "no" } }),
    fakes({ stdout: COPY_PROSE, messages: null }),
    fakes({ stdout: COPY_PROSE, messages: "text" }),
  ];
  for (const f of bad) {
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "session-unreadable");
    assert.equal(f.count("copy"), 0);
    assert.deepEqual(f.toasts, [
      "copy-back: could not read the session, nothing changed",
    ]);
  }
});

test("no replies at all is a no-match over zero replies", async () => {
  const f = fakes({ stdout: COPY_PROSE, rows: [row("user", "only me")] });
  const out = await runCc(f.deps);
  assert.equal(!out.copied && out.reason, "no-match");
  assert.deepEqual(f.toasts, [
    "copy-back: no replies to search, nothing changed",
  ]);
});

test("rows without text (tool-only turns) are not searched but do not break the search", async () => {
  const rows = [
    row("assistant", REPLY_MAIN),
    row("assistant", "", [{ name: "Bash" }]),
    row("user", ""),
  ];
  const f = fakes({ stdout: COPY_PROSE, rows });
  const out = await runCc(f.deps);
  assert.equal(out.copied, true);
  assert.deepEqual(f.copies, [PASTE_PROSE]);
});

test("the matcher gets the copy as typed and the newest replies first, at most 40", async () => {
  const seen: { copied: string; messages: readonly string[] }[] = [];
  const rows = Array.from({ length: MAX_REPLIES + 5 }, (_, i) =>
    row("assistant", `reply number ${i}`),
  );
  const f = fakes({
    stdout: "  copied text  \n",
    rows,
    find: (copied, messages) => {
      seen.push({ copied, messages: [...messages] });
      return { ok: false, reason: "no-match" };
    },
  });
  await runCc(f.deps);
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.copied, "  copied text  \n");
  assert.equal(seen[0]?.messages.length, MAX_REPLIES);
  assert.equal(seen[0]?.messages[0], `reply number ${MAX_REPLIES + 4}`);
});

test("a copy that answers not-copied is reported with the engine's reason word", async () => {
  for (const reason of ["no-surface", "no-clipboard", "refused"]) {
    const f = fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copy: { isCopied: false, reason },
    });
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "copy-refused");
    assert.equal(!out.copied && out.copyReason, reason);
    assert.deepEqual(f.toasts, [
      `copy-back: the clipboard write was refused (${reason})`,
    ]);
  }
});

test("an unknown reason word never reaches the toast", async () => {
  const f = fakes({
    stdout: COPY_PROSE,
    rows: conversation,
    copy: {
      isCopied: false,
      reason: "a free text reason with the words of a private reply",
    },
  });
  await runCc(f.deps);
  assert.deepEqual(f.toasts, [
    "copy-back: the clipboard write was refused (refused)",
  ]);
});

test("a copy that rejects or answers nonsense is a failed write", async () => {
  const bad = [
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copyError: new Error("EPIPE"),
    }),
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copy: undefined,
      copyError: undefined,
    }),
    fakes({ stdout: COPY_PROSE, rows: conversation, copy: {} }),
    fakes({ stdout: COPY_PROSE, rows: conversation, copy: "yes" }),
  ];
  for (const f of bad) {
    const out = await runCc(f.deps);
    assert.equal(!out.copied && out.reason, "copy-failed");
    assert.deepEqual(f.toasts, ["copy-back: the clipboard write failed"]);
  }
});

test("a toast that cannot be shown does not undo the copy", async () => {
  const f = fakes({
    stdout: COPY_PROSE,
    rows: conversation,
    toastError: new Error("no ui"),
  });
  const out = await runCc(f.deps);
  assert.equal(out.copied, true);
  assert.equal(out.toasted, false);
  assert.deepEqual(f.copies, [PASTE_PROSE]);
});

test("a copy in another Unicode normalization form is refused, never mis-matched", async () => {
  const source =
    "The caf\u00e9 on the corner serves r\u00e9sum\u00e9 review sessions every morning.";
  const f = fakes({
    stdout: source.normalize("NFD"),
    rows: [row("assistant", source)],
  });
  const out = await runCc(f.deps);
  assert.equal(!out.copied && out.reason, "no-match");
  assert.deepEqual(f.copies, []);
});

test("a toast whose promise rejects is also recorded, not left unhandled", async () => {
  const f = fakes({
    stdout: COPY_PROSE,
    rows: conversation,
    toastReject: new Error("no ui"),
  });
  const out = await runCc(f.deps);
  assert.equal(out.copied, true);
  assert.equal(out.toasted, false);
  assert.deepEqual(f.copies, [PASTE_PROSE]);
});

test("an error inside the matcher is caught, reported, and copies nothing", async () => {
  const f = fakes({
    stdout: COPY_PROSE,
    rows: conversation,
    find: () => {
      throw new Error("a bug in the matcher");
    },
  });
  const out = await runCc(f.deps);
  assert.equal(!out.copied && out.reason, "failed");
  assert.equal(f.count("copy"), 0);
  assert.deepEqual(f.toasts, [
    "copy-back: stopped on an unexpected error, nothing changed",
  ]);
});

test("the cache of message text is dropped after every run, on every path", async () => {
  const runs = [
    fakes({ stdout: COPY_PROSE, rows: conversation }),
    fakes({ stdout: "" }),
    fakes({ stdout: "short" }),
    fakes({ stdout: COPY_PROSE, messagesError: new Error("x") }),
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      copyError: new Error("x"),
    }),
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      toastError: new Error("x"),
    }),
    fakes({
      stdout: COPY_PROSE,
      rows: conversation,
      find: () => {
        throw new Error("x");
      },
    }),
  ];
  for (const f of runs) {
    await runCc(f.deps);
    assert.equal(f.count("forget"), 1);
    assert.equal(f.log.at(-1), "forget", "forget runs last");
  }
});

test("runs do not leak into each other", async () => {
  const first = fakes({ stdout: COPY_PROSE, rows: conversation });
  const second = fakes({ stdout: COPY_CODE, rows: conversation });
  await runCc(first.deps);
  await runCc(second.deps);
  assert.deepEqual(first.copies, [PASTE_PROSE]);
  assert.deepEqual(second.copies, [PASTE_CODE]);
});
