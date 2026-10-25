import { expect, test } from "claude-code/testing";
import {
  CANARY,
  COPY_CANARY,
  COPY_STRANGER,
  REPLY_CANARY,
  row,
} from "../cc-fixtures.ts";
import { NEVER, kit, press, start } from "./engine.ts";
import type { KitOptions } from "./engine.ts";

// PRIVACY SPIES. The clipboard and the messages are the user's. A canary is
// planted in both (and in the message of every error a stub raises), then /cc
// is run down every path. The canary must not appear in a toast, in any call
// to a place that keeps or shows text (log, store, files, the prompt, a model,
// the network, the session), in the value the command returns, or in an error
// that escapes. The one place it may appear is the ui.copy payload, and there
// only inside the matched slice.

const rows = [
  row("user", `a question with ${CANARY} in it`),
  row("assistant", REPLY_CANARY),
];

const SCENARIOS: Record<string, KitOptions> = {
  "success, canary inside the matched slice": { stdout: COPY_CANARY, rows },
  "no match, canary in the copied text": { stdout: COPY_STRANGER, rows },
  "too short, canary in the copied text": {
    stdout: CANARY.slice(0, 8),
    rows,
  },
  "pbpaste fails, canary in the error": {
    runDeny: `spawn failed: ${CANARY}`,
    rows,
  },
  "pbpaste stub throws, canary in the error": {
    runThrow: `crash: ${CANARY}`,
    rows,
  },
  "pbpaste exits non-zero, canary in stderr and stdout": {
    stdout: COPY_CANARY,
    stderr: CANARY,
    exitCode: 1,
    rows,
  },
  "session.messages rejects, canary in the error": {
    stdout: COPY_CANARY,
    rowsDeny: `denied: ${CANARY}`,
  },
  "ui.copy rejects, canary in the error": {
    stdout: COPY_CANARY,
    rows,
    copyDeny: `write failed: ${CANARY}`,
  },
  "ui.copy answers not copied, canary in the reason": {
    stdout: COPY_CANARY,
    rows,
    copyValue: { isCopied: false, reason: `no: ${CANARY}` },
  },
  "ui.toast throws, canary in the error": {
    stdout: COPY_CANARY,
    rows,
    toastThrow: `toast: ${CANARY}`,
  },
  "non-text rows carry the canary": {
    stdout: COPY_CANARY,
    rows: [
      row("assistant", "", [{ name: "Bash", text: CANARY, result: CANARY }]),
      {
        role: "user",
        text: "",
        toolUses: [],
        toolResults: [{ text: CANARY }],
      },
      ...rows,
    ],
  },
  "output over the bound, canary at the start": {
    stdout: `${CANARY}${"a".repeat(200_001)}`,
    rows,
  },
};

for (const [name, opts] of Object.entries(SCENARIOS)) {
  test(`privacy: ${name}`, async ($, on) => {
    const k = kit(on, opts);
    await start($);

    let escaped = "";
    let result: unknown = null;
    try {
      result = await press($);
    } catch (error) {
      escaped = String((error as { message?: unknown }).message ?? error);
    }

    expect(escaped).toBe("");
    expect(JSON.stringify(result)).not.toContain(CANARY);
    expect(JSON.stringify(k.toasts)).not.toContain(CANARY);
    expect(k.trapped).toEqual([]);
    for (const copy of k.copies) {
      expect(REPLY_CANARY).toContain(copy.text);
    }
  });
}

test("privacy: the trap list covers every place text could be kept or shown", async () => {
  for (const op of [
    "ui.log",
    "store.set",
    "fs.write",
    "prompt.fill",
    "prompt.submit",
    "model.complete",
    "http.fetch",
    "session.append",
    "session.send",
  ]) {
    expect(NEVER as readonly string[]).toContain(op);
  }
});

// A second, inline plugin does what /cc must not (its register is
// self-contained, so the canary is written out in it). The trap has to see
// the call, or "nothing trapped" above would prove nothing.
const LEAKY = {
  name: "leaky",
  register: (on: (...args: never[]) => unknown) => {
    (on as unknown as Function)(
      "command.run",
      { command: "leak" },
      async ($: any) => {
        await $.ui.log("line with zq7canary8841");
        return {};
      },
    );
  },
};

test(
  "privacy: a trap really records a forbidden call, so an empty list means something",
  { plugins: [LEAKY as never] },
  async ($, on) => {
    const k = kit(on, { stdout: COPY_CANARY, rows });
    await start($);
    await $.command.run({ command: "leak", args: "" } as never);
    expect(k.trapped).toHaveLength(1);
    expect(k.trapped[0]?.op).toBe("ui.log");
    expect(k.trapped[0]?.input).toContain(CANARY);
  },
);

test("privacy: the toast of every path is built from counts and fixed words", async ($, on) => {
  const k = kit(on, { stdout: COPY_CANARY, rows });
  await start($);
  await press($);
  for (const toast of k.toasts) {
    expect(toast).toMatch(/^[a-z0-9 ,()=-]+$/);
    expect(toast).not.toMatch(/copy-back/);
  }
});
