import type { Register } from "claude-code";
import { notify } from "./api.ts";
import { runCommand } from "./run.ts";

// /cc: copy text out of the terminal, leave the prompt empty, type /cc. The
// command is `immediate` (it runs at once even while a turn streams, and never
// starts a turn of its own), and its hook answers `{}`: nothing is printed and
// nothing reaches the model. There are no timers, no state, no store and no
// network; the only program it starts is pbpaste (see hooks/api.ts).

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    try {
      await $.command.register({
        name: "cc",
        description:
          "Put the text you copied from the terminal back on the clipboard as Claude wrote it",
        immediate: true,
      });
    } catch {
      // A name the engine refuses must not break the session's start.
      notify($, "copy-back: could not register /cc");
    }
    return next(e);
  });

  // The hook answers its own command and never reads `next`, so the validator
  // lists it as "answers its own command", not as a gate. The `.catch` answers
  // `{}` too: a crash prints nothing and tells the model nothing.
  on("command.run", { command: "cc" }, ($) => runCommand($)).catch(() => ({}));
};
