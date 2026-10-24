# Security Policy

copy-back reads your clipboard and your session's messages, and writes your clipboard. This file says what it can and cannot do, what counts as a vulnerability, and how to report one.

## Supported versions

Only the latest release is supported: 0.1.x, which is experimental. Fixes land on `main` and ship in the next tag.

## Reporting a vulnerability

Do not open a public issue for a security problem, and never paste your clipboard or any message text into a report: describe the shape of the input instead.

- If the repository has **private vulnerability reporting** (Security tab, "Report a vulnerability"), use it.
- Until then, contact the owner, [sairam0424](https://github.com/sairam0424), privately, for example through the contact details on that profile. Do not use an issue or a pull request.

This is a one-person project. Expect an acknowledgement within seven days; there is no fixed time to a fix. A report that includes a failing test is the fastest to act on.

## What counts as a vulnerability

- Any path by which clipboard text or message text reaches a toast, a log, a stored value, a thrown error, the command's answer, a file or the network.
- A `/cc` that overwrites the clipboard with text that was not written by Claude in this session's replies.
- Input (a clipboard or a set of replies) that makes the matcher run out of memory or run for tens of seconds.
- The mod starting any program other than `pbpaste`, or reaching an engine API that the list below does not name.
- A path by which the test tools in `scripts/` print or store your clipboard or transcript text other than as described under "Tools that read real data".

Out of scope: Claude Code itself, terminal emulators and other plugins.

## What the mod can and cannot do

`claude plugin validate .` prints the engine's access report for the mod. It lists exactly these engine calls, and `scripts/check-footprint.sh` fails if the list changes:

| Call | What it is used for | Bound |
|------|---------------------|-------|
| `$.command.register` | declares `/cc` when a session starts | once per session |
| `$.process.run` (via `pbpaste`) | reads the clipboard | one program, `pbpaste`, found by name on `PATH`, no arguments, 2000 ms timeout, `LC_ALL=en_US.UTF-8`; the read is refused if it is empty, over 200,000 characters, cut short or failed |
| `$.session.messages` | reads the session's rows | only assistant rows with text are looked at, the newest 40; nothing is kept after the run |
| `$.ui.copy` | writes the clipboard | once, only after a match, with a slice of one of those replies |
| `$.ui.toast` | shows one line | counts and fixed words only |

The command answers `{}`. The mod uses no network API, no model call, no file API, no state or store, no timers and no telemetry. The report also shows no gating hook and no state read or write.

Two things to know:

- `pbpaste` is started by name, so it is whatever `pbpaste` your `PATH` finds. The sealed test rig relies on that to put a stand-in first; a hostile `PATH` could do the same. The trust boundary is the environment Claude Code runs in.
- `$.session.messages` hands the mod the rows of the main conversation. The mod reads only `role` and `text` of assistant rows, but the engine does not narrow it further.

Privacy is built into the code rather than added on top: the decision type (`hooks/outcome.ts`) holds only numbers and words from fixed lists, and the toast function can only print what that type holds, so no text has a way into a toast. Errors from the engine are caught where they happen and turned into a reason word; their messages are never read.

## The source guard is a tripwire, not a sandbox

The access report cannot see printing, timers, reflection or imports. They are guarded in layers:

1. `scripts/check-sources.mjs` reads every file the hooks load (22 today, all under `hooks/` and `src/core/`) as tokens, whatever its extension. It refuses `console`, `process` (except the engine noun `$.process`), `globalThis`, `fetch`, timers, `eval`, `Function`, `require`, reflection such as `.constructor`, bracket access to those names, dynamic `import()` and any import that is not a relative file. It also checks that the files the hooks load stay inside those two folders and that `hooks/hooks.json` names only `register.tsx`.
2. `scripts/typecheck.sh` type-checks against the engine's own declarations, where `console`, `process` and `fetch` are unknown names.
3. Tests spy on the console, the standard streams and a global `fetch` (`tests/cc-privacy.test.ts`). They plant a canary string in the clipboard, the replies and the errors a dependency raises, and check that the only thing handed the text is the clipboard write, and only with the matched slice.
4. In the engine's test environment (probed on 2.1.309), `process`, `fetch` and `Buffer` do not exist, `eval` and `new Function` throw, and `console` prints nothing. The live engine was not proven to behave the same.

The guard lexes without a parser, so a `/` after `)`, `]`, `}`, `++` or `--` is read both ways and a finding in either counts. Against the TypeScript parser, 30,000 random slash-heavy programs gave no miss, but a determined contributor can still try to defeat it. The real boundary is the engine's API list plus review of every change to `hooks/` and `src/core/`.

## What the sealed rig proves, and what it does not

`realrender/` runs the real Claude Code, resumed on a synthetic session, inside a macOS Seatbelt profile with stand-ins for `pbpaste` and `pbcopy` first on `PATH`. Reported for the counted pass on Claude Code 2.1.309, classic display only (re-scored from the raw files by a second Claude session that the author started; the raw files are not published, so these numbers are reports, not something you can re-run from this repository):

- 160 of 160 copies came back exact on both write channels, and 32 of 32 refusals wrote nothing. The copies were built by a model of a terminal selection from real Claude Code screens, then handed over through the `pbpaste` stand-in; they are not what a real terminal puts on the clipboard.
- The local stub that stood in for the API logged **zero** requests during `/cc`, then three after an ordinary prompt (the positive control that shows the stub would have seen one).
- 6,080 samples of the process's open network connections showed none to a non-local address.
- A canary string planted in the stand-in clipboard appeared in no toast.

It does **not** prove anything about the real `pbpaste` and `pbcopy`, what Warp or any other terminal copies, Claude Code's fullscreen display, other Claude Code versions or an organisation policy, and it is a regression tripwire, not a proof that no leak exists. The rig has side effects of its own, listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Packaging

Installing from this repository installs the whole folder, not only the 22 files the hooks load. That includes `src/captures`, which can read the clipboard and write files when you run it by hand. The plugin never loads it (the source guard checks which files the hooks load).

## Tools that read real data

These run only when you run them, and the plugin never loads them. Each guards what it can; none is meant to be run by an agent.

- `scripts/replay.mjs` reads your transcripts under `~/.claude/projects` and prints counts.
- `scripts/captures.mjs add` reads the clipboard once and saves it to a private folder outside any git repository. `run --show` prints your own text and refuses unless its output is a terminal.
- `realrender/live.mjs clip` reads the real clipboard to store its SHA-256 only, at most twice.

Keep the output folders of the rig (`--out`) outside the repository and do not publish them: they can hold rendered screens, raw terminal streams and logs. `.gitignore` covers the usual names.
