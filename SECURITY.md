# Security Policy

copy-back reads your clipboard and your session's messages, and writes your clipboard. This file says what it can and cannot do, what counts as a vulnerability, and how to report one.

## Supported versions

Only the latest release is supported: 0.1.x, which is experimental. Fixes land on `main` and ship in the next tag.

## Reporting a vulnerability

Do not open a public issue for a security problem, and never paste your clipboard or any message text into a report: describe the shape of the input instead.

- Use this repository's **private vulnerability reporting**: the Security tab, "Report a vulnerability".
- If that is not possible for you, contact the owner, [sairam0424](https://github.com/sairam0424), privately, for example through the website linked on that profile. Do not use an issue or a pull request.

This is a one-person project. Expect an acknowledgement within seven days; there is no fixed time to a fix. A report that includes a failing test is the fastest to act on.

## What counts as a vulnerability

- Any path by which clipboard text or message text reaches a toast, a log, a stored value, a thrown error, the command's answer, a file or the network.
- A `/cc` that overwrites the clipboard with text that was not written by Claude in this session's replies.
- Input (a clipboard or a set of replies) of ordinary size that makes the matcher run out of memory or run for tens of seconds. Its cost grows with the size of the replies; the measured worst case (a synthetic 40 MB window of nested lists with a link and struck text on every line: about 30 s and 1.7 GB) is a known limit, described in `docs/DEVELOPMENT.md`.
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

A tripwire catches mistakes and the obvious attempts: it does not stop a determined author, and nothing in it is a security boundary. The access report cannot see printing, timers, reflection or imports. They are guarded in layers:

1. `scripts/check-sources.mjs` reads every file the hooks load (25 today: 6 under `hooks/` and 19 under `src/core/`) as tokens, whatever its extension. It refuses `console`, `process` (except the engine noun `$.process`), `globalThis`, `fetch`, timers, `eval`, `Function`, `require`, reflection (`.constructor` or a destructured `constructor`, any `prototype`, `__proto__`, `Reflect`, `getOwnPropertyDescriptor`, `defineProperty` and the like, and the strings `"constructor"`, `"prototype"` and `"__proto__"` wherever they stand), a member or destructured key named by a string built at run time (`x["con" + "sole"]`), bracket access to the banned names, dynamic `import()` and any import that is not a relative file. It also checks that the files the hooks load stay inside those two folders and that `hooks/hooks.json` names only `register.tsx`.
2. `scripts/typecheck.sh` type-checks against the engine's own declarations, where `console`, `process` and `fetch` are unknown names.
3. Tests spy on the console, the standard streams and a global `fetch` (`tests/cc-privacy.test.mts`, `tests/cc-spies.ts`) while `/cc` runs with a canary string planted in the clipboard, the replies and the errors a dependency raises. A call on those three channels counts as a leak unless its stack shows Node's own streams or test runner (default deny), so a call made from a promise job or a short timer counts, and so does an encoded copy of the clipboard that is not the verbatim canary. The first version of these spies blamed only a call with a `hooks/` or `src/core/` frame or the verbatim canary; a review on 2026-10-24 printed the code points of the clipboard from a promise job and every layer stayed green, which is why the default is now deny (run on Node 22.23.2 and 26.9.0; not run on 22.19.0 or 24.x). The spies see those three channels and nothing else. Keeping text in a module-level variable, a second `pbpaste` call or a value hidden in a count are not seen by them: the exact-output tests, the wrapper pins in `tests/cc-seam.test.mts` and the review of every change to `hooks/` and `src/core/` are the controls there, and no automated layer catches a module-level array that keeps text.
4. In the engine's test environment (probed on 2.1.309), `process`, `fetch` and `Buffer` do not exist, `eval` and `new Function` throw, and `console` prints nothing. The live engine was not proven to behave the same.

The guard lexes without a parser, so a `/` after `)`, `]`, `}`, `++` or `--` is read both ways and a finding in either counts. Against the TypeScript parser, 30,000 random slash-heavy programs gave no miss (reported; that run's evidence is not published), but a determined contributor can still try to defeat it. The real boundary is the engine's API list plus review of every change to `hooks/` and `src/core/`.

## What the sealed rig proves, and what it does not

`realrender/` runs the real Claude Code, resumed on a synthetic session, inside a macOS Seatbelt profile with stand-ins for `pbpaste` and `pbcopy` first on `PATH`. Everything below is reported, not something you can re-run from this repository: the runs were made by the author with Claude sessions that the author started (the model was not recorded), the raw files (rendered screens, raw terminal streams, logs) are not published, and the numbers come from a re-score by a second session.

- The counted live pass of 0.1.0, on Claude Code 2.1.309, classic display only: 160 of 160 copies came back exact on both write channels, and 32 of 32 refusals wrote nothing. The copies were built by a model of a terminal selection from real Claude Code screens, then handed over through the `pbpaste` stand-in; they are not what a real terminal puts on the clipboard.
- The local stub that stood in for the API logged **zero** requests during `/cc`, then three after an ordinary prompt (the positive control that shows the stub would have seen one).
- 6,080 samples of the process's open network connections showed none to a non-local address.
- A canary string planted in the stand-in clipboard appeared in no toast.
- For 0.1.1 the rig can also draw the session the way Warp does (`--profile warp`, which adds only the environment variables Claude Code reads to detect Warp). It scored the matcher on a synthetic holdout under a rule whose hash was recorded before the first screen of that holdout existed (`realrender/RULE-3.md`); the 48 launches made for that work had no outside socket and no request to the stub, and all 13 sandbox controls held under the Warp profile. That run scored the matcher against screens, not `/cc` through the stand-ins.
- The counted live pass of the 0.1.1 build, on Claude Code 2.1.310, classic display, with `/cc` going through the stand-ins: 12 of 12 conditions of its rule (kept outside this repository). 160 of 160 copies exact in the Warp drawing and 40 of 40 in the default drawing, 40 of 40 refusals untouched, no wrong payload or toast in 283 cases, no request reached the stub during `/cc` (three after an ordinary prompt, the positive control), no non-local socket in 8,658 samples, 13 of 13 sandbox controls under each profile. Its check of the real clipboard is weak: the two hash reads surrounded a stand-in that writes, not the real plugin, and both were the hash of empty input, so it shows only that no text appeared (the read now fails loudly when `pbpaste` fails). The plugin folders that passed are unchanged in this release (checked on 2026-10-25 against the pass's freeze record).

It does **not** prove anything about the real `pbpaste` and `pbcopy`, what Warp or any other terminal copies, Claude Code's fullscreen display, other Claude Code versions or an organisation policy, and it is a regression tripwire, not a proof that no leak exists. The rig has side effects of its own, listed in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Packaging

Installing from this repository installs the whole folder, not only the 25 files the hooks load. That includes `src/captures`, which can read the clipboard and write files when you run it by hand. The plugin never loads it (the source guard checks which files the hooks load).

## Tools that read real data

These run only when you run them, and the plugin never loads them. Each guards what it can; none is meant to be run by an agent.

- `scripts/replay.mjs` reads your transcripts under `~/.claude/projects` and prints counts.
- `scripts/captures.mjs add` reads the clipboard once and saves it to a private folder outside any git repository. `run --show` prints your own text and refuses unless its output is a terminal.
- `realrender/live.mjs clip` reads the real clipboard to store its SHA-256 only, at most twice.

The other rig tools (`capture.mjs`, `measure.mjs`, `rescore.mjs`, `tokenfree.mjs`, `modeldiff.mjs`) read only the synthetic sets and the screens the rig wrote. Keep the output folders of the rig (`--out`) outside the repository and do not publish them: they can hold rendered screens, raw terminal streams and logs. `.gitignore` covers the usual names.
