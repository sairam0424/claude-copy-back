# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-10-24

First release. Experimental: verified in a sealed rig against a synthetic session, not yet on a real Warp session or with the real `pbpaste` and `pbcopy`. macOS only.

### Added
- The `/cc` command. After you copy text out of the terminal, `/cc` reads the clipboard once (`pbpaste`, 2 second limit, UTF-8 locale), finds that text in the newest 40 assistant replies of the session, and writes Claude's own text for it back with the engine's clipboard call. It is an immediate command, answers `{}` (nothing reaches the model), keeps no state and shows one counts-only toast. Every refusal (empty, unreadable or over 200,000 characters, session unreadable, under 12 characters, no match, ambiguous) leaves the clipboard as it was.
- The lossless matcher (`src/core`). It models how Claude Code draws a reply (two-column margin, reply marker, `-` bullets, hanging list text, wrap at the terminal width, code, quotes, links, numbering) so that it can search the drawn text and map each hit back to the reply's markdown. The answer is an exact slice of what Claude wrote; the paste form drops the list or quote prefix from later lines and restores the first line's indentation. When the same words sit in several places and Claude's original text differs between them, the copy's indentation is tried first, and then it refuses instead of taking the newest; identical original text is one answer, and the toast names the newest reply that holds it. The search is bounded in memory and time.
- The engine seam and the footprint gate. Every engine call goes through four wrappers in `hooks/api.ts`; `scripts/check-footprint.sh` pins the access report to exactly five APIs (`$.command.register`, `$.process.run` via `pbpaste`, `$.session.messages`, `$.ui.copy`, `$.ui.toast`), no truncation marker, a `calls` line of 130 characters against a gate of 850, no gating hook and no state.
- Privacy guards for what the access report cannot see: a source scan of everything the hooks load (`scripts/check-sources.mjs`), a type check where `console`, `process` and `fetch` are unknown names (`scripts/typecheck.sh`), spies on the console, the standard streams and `fetch` in the tests, and a toast built from counts and fixed words only.
- The offline replay harness and screen simulator (`src/sim`, `src/replay`, `scripts/replay.mjs`).
- The captures tool (`scripts/captures.mjs`, `CAPTURES.md`): a real-copy acceptance test of about 20 of your own copies with a frozen pass rule (at least 20 judged, 70 percent right, at least 10 matched and right, nothing dangerous). It prints counts only; `run --show` prints your own text and only to a terminal.
- The sealed live-test rig (`realrender/`): the real Claude Code on a synthetic session inside a Seatbelt profile, with stand-ins for `pbpaste` and `pbcopy`, a local stub for the API, sandbox controls and two frozen pass rules.
- Tests: 1325 matcher, `/cc` and manifest tests in 46 files, 87 tests on the engine's kit in 6 files, and 263 rig unit tests in 35 files.
- A plugin manifest and a marketplace entry (`copy-back@claude-copy-back`), the MIT license, a CI workflow (plain tests on Linux and macOS, source guard, shellcheck, and the engine gates on a pinned Claude Code), Dependabot for GitHub Actions, a bug report form and a pull request template, and the documentation: `README.md`, `SECURITY.md`, `AGENTS.md`, `CAPTURES.md` and `docs/DEVELOPMENT.md`.

### Known limitations
- macOS only: the mod starts `pbpaste`. Linux and Windows are not supported and were not tested.
- Verified only in the sealed rig, against a synthetic session, on Claude Code 2.1.309, classic display only (counted pass: 160 of 160 exact, 32 of 32 refusals untouched, no model request, no non-local socket) with sanity launches on 2.1.310. The copies in that pass were built by a model of a terminal selection from real Claude Code screens and fed through a `pbpaste` stand-in, so the pass does not show what Warp or any other terminal puts on the clipboard. It was run, reviewed and re-scored by the author with separate Claude sessions (the model was not recorded); the raw evidence is not published. **Not verified:** Warp or any real terminal's clipboard, the real `pbpaste` and `pbcopy`, Claude Code's fullscreen display (where Claude Code takes over the mouse and selecting may need a modifier key), an organisation policy that refuses a mod starting a program, other Claude Code versions, typing `/cc` while a reply is streaming, and the 20-real-copy test in `CAPTURES.md`.
- Tables, diffs and tool output are not matched; they are refused.
- Links and struck-through text are drawn differently by Claude Code depending on the terminal. The matcher was calibrated on a run with no terminal name set; in Warp such copies are expected to be refused, not mis-matched. Real replies contain many links and the synthetic test replies few, so expect `no match` whenever a copy includes a link label or struck text; the test figure (of 160 synthetic copies edited to that style only 4 changed, all 4 became `no match`) is thin evidence and not a refusal rate.
- A copy needs at least 12 characters after folding and must be in the newest 40 replies. A selection that runs from one reply into the next is expected to be refused (one example was checked against the matcher, none live).
- The 2 second clipboard read limit can refuse with `could not read the clipboard` on a heavily loaded machine (3 of 80 copies in two sanity launches). It never wrote wrong text; type `/cc` again.
- Claude Code may prefix the toast with the mod's name as well, so it can read `copy-back: copy-back: copied ...`.
- Installing from the repository installs the whole folder, including `src/captures`, a tool for the maintainer's own testing that the plugin never loads.
- `tests/budget.test.ts` and six other test files assert wall-clock time and can fail under heavy load; rerun them alone.
- Development needs Node 22.19 or newer by the Node changelog; locally the suite has only been run on Node 26.9.0 (CI is set up to run the floor and 24.x on Linux and macOS and 26.x on Linux).

[Unreleased]: https://github.com/sairam0424/claude-copy-back/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/sairam0424/claude-copy-back/releases/tag/v0.1.0
