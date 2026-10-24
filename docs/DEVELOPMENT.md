# Development

Back to the [README](../README.md).

Checked on 2026-10-24 with Node 26.9.0, Claude Code 2.1.310 and macOS. The commands below were run when this page was written, except the sealed-rig stages and the tools that read real data (they start Claude Code in a sandbox or touch your clipboard); those are documented from the scripts' own usage text.

## Prerequisites

- **Node 22.19.0 or newer** to run the tests (`engines` in `package.json`). Type stripping is on by default from Node 22.18.0, and two tests call `process.threadCpuUsage()`, which arrived in 22.19.0 (from the Node changelog). On a developer machine the suite has only been run on Node 26.9.0; CI is set up to run 22.19.0 and 24.x (Linux and macOS) and 26.x (Linux only), which will be the first real test of the floor. `npm test` passes the files as a quoted glob (`"tests/*.test.ts"`) because `node --test tests/` (a directory) does not work on Node 22.
- **No `npm install`.** There are no dependencies and no lockfile. Everything imports a relative file or `node:*`.
- **Claude Code 2.1.299 or newer** for the engine gates (`kit-test.sh`, `check-footprint.sh`, `validate`). 2.1.292 and 2.1.296 refuse `$` across an import and 2.1.299 is the oldest version tried that accepts it (2.1.297 and 2.1.298 were not tried).
- `jq` for `kit-test.sh`, `shellcheck` for the shell scripts, and a TypeScript compiler (optional) for `typecheck.sh`.
- **macOS, `tmux` and `python3`** for the sealed rig only. Nothing else in the repository needs them.

Run the tests with a scratch `HOME` and temp folder when you can: `env HOME=$SCRATCH/home TMPDIR=$SCRATCH/tmp COPY_BACK_TMP=$SCRATCH/tmp npm test`. No test reads the real clipboard, your transcripts or your home (both suites pass with an empty `HOME`), but the isolation costs nothing. `typecheck.sh` is the exception: it looks for a compiler under `$HOME/.npm/_npx`, so with an empty `HOME` pass `CB_TSC`.

## Layout

```
.claude-plugin/   plugin.json (the version lives here) and marketplace.json
hooks/            the runtime: hooks.json -> register.tsx; api.ts, cc.ts, input.ts, outcome.ts, run.ts
src/core/         the matcher: the lossless source match (16 files)
src/sim/          a screen simulator and a seeded PRNG, for tests and the replay harness
src/replay/       the offline replay harness and its comparator
src/captures/     the real-copy test tool (see "The captures tool")
scripts/          the gates, the replay entry and the captures entry; scripts/lib/ holds the source scanner
tests/            the node:test files (*.test.ts) and three helpers; tests/kit/ holds the engine tests (*.test.tsx)
realrender/       the sealed live-test rig: entry points, lib/, tests/, and probe/ (a scratch plugin, never install it)
```

What the mod runs is `hooks/` plus `src/core/`: the hooks import `../src/core/*.ts`, and the source guard counts 22 files loaded (6 in `hooks/`, 16 in `src/core/`). The sealed rig loads a copy of `.claude-plugin`, `hooks` and `src` (55 files). The rest of the repository travels with a marketplace install but is never loaded.

A `/cc` run: `register.tsx` declares the command and answers `{}`; `run.ts` hands `cc.ts` the four engine calls (through `api.ts`); `cc.ts` reads the clipboard answer (`input.ts`), asks `findSource` in `src/core/match.ts`, writes the answer with `ui.copy` only on a match, and shows the counts-only line `outcome.ts` builds.

## Gates

| Command | What it proves | Result on 2026-10-24 |
|---------|----------------|----------------------|
| `npm test` (`node --test --test-concurrency=1 "tests/*.test.ts"`) | the matcher, the `/cc` logic with the engine injected, the privacy spies, the static seam and source checks, the manifests; needs no engine | 1325 tests in 46 files, all pass |
| `bash scripts/kit-test.sh` (`npm run kit-test`) | the plugin on the engine's own test kit (`tests/kit/*.test.tsx`, run one file at a time); needs `claude` and `jq` | 87 tests in 6 files, all pass |
| `claude plugin validate .` (`npm run validate` adds `--strict`; also try `--profile directory`) | the manifest and the hooks module load; prints the access report | passes |
| `bash scripts/check-footprint.sh` (`npm run footprint`) | the access report is complete, short and expected (see "Engine rules"); runs the source guard too | OK: calls line 130 of 850 characters, 5 APIs |
| `node scripts/check-sources.mjs` (`npm run sources`) | the source guard alone | OK: 22 files scanned, 22 loaded, no finding |
| `CB_TYPECHECK_REQUIRED=1 bash scripts/typecheck.sh` (`npm run typecheck`) | strict types over `hooks/` and `tests/kit/` against the engine's `claude-code.d.ts` | OK (see the note below) |
| `shellcheck scripts/*.sh` (`npm run lint:sh`) | the shell scripts | clean |
| `node scripts/replay.mjs --selftest` (`npm run selftest`) | the replay harness on synthetic transcripts, with a privacy spy | `{"selftest":"pass","checks":21,"failed":[]}` |
| `npm run test:rig` | the rig's own logic: generators, scorer, Seatbelt profile text, shims, live-pass rules; needs no tmux, no sandbox and no Claude Code (`stub.test.mjs` expects Homebrew's `python3` and `/usr/sbin/lsof`) | 263 tests in 35 files, all pass |

`npm run check` runs `sources`, `lint:sh`, `footprint` and `typecheck` in a row. Nothing here installs anything: `npm run` only runs the commands above, and there is no `npm install`.

**Do not run `claude plugin test .` at the repository root.** It also loads `tests/*.test.ts`, which are `node:test` files the kit cannot import, so it reports the 87 kit passes and one failure for every `node:test` file. The gate is `kit-test.sh`.

**The type gate is best effort.** `typecheck.sh` uses the newest `claude-code.d.ts` that Claude Code has written under `/private/tmp/claude-*/bundled-skills/` (wiped by a reboot, written again when the plugin-authoring skill loads) and a TypeScript compiler it finds in the npx cache or on `PATH`. Set `CB_DTS` and `CB_TSC` to point at your own. With neither present it says so and exits 0, unless `CB_TYPECHECK_REQUIRED=1`, which makes that an error. `CB_CLAUDE="env HOME=... claude"` runs `kit-test.sh` and `check-footprint.sh` on another engine or with another `HOME`.

### Tests that can flake under load

Seven files assert wall-clock time: `budget`, `limits`, `match-rules`, `fuzz`, `inline`, `review-wrong-slice` and `cc-source-scan`. Alone, the suite passes in about 12 seconds. With six full suites running at once (load average 40 on 10 cores), each run failed two or three tests, all timing assertions (`tests/budget.test.ts` most often, then `cc-source-scan` and `match-rules`). Run serially, as `npm test` and `npm run test:rig` do, the whole suite passed in 41.5 seconds while the load average was still 32. If one of those tests fails, rerun the file alone before looking for a bug. `tests/budget.test.ts` runs its children with `--max-old-space-size=192` and a 40 second kill, so a regression cannot take the machine down.

### CI

`.github/workflows/ci.yml` runs the plain Node suites on Linux and macOS (Node 22.19.0 and 24.x) and on Linux with Node 26.x (the version the maintainer develops on; `engines` is open-ended), the replay self-test, `shellcheck`, the source guard, and an engine job (`claude plugin validate . --strict`, the footprint gate and the kit tests) on a pinned Claude Code. It runs no model call and needs no login. It runs the rig's unit tests on macOS only. It does not run `typecheck.sh` (it needs a types file the engine writes only when a session loads the plugin-authoring skill) or the sealed live rig itself (that runs on the maintainer's Mac only). The header of the workflow file says what runs where and why. Before you open a pull request, run the gates above that apply to your change.

## Engine rules (learned the hard way)

The access report that `claude plugin validate` prints lists every engine call with the functions that call it, and it cuts a `calls` or `hooks` line near 980 characters, marking the cut `[+N chars]`. A cut report cannot show every call, and a catalogue publisher can hold a listing whose report is cut. So:

- **Engine calls go through `hooks/api.ts`.** One wrapper per API (`pbpaste`, `history`, `toClip`, `notify`), plus the one `$.command.register` call that `register.tsx` spells itself. The calls line is 130 characters today; the gate is 850.
- **Wrappers are function declarations**, with names of **at most seven characters**, unique across `hooks/` (`tests/kit/api.test.tsx` pins both). The engine follows `$` past an import only into a function declaration. An arrow function bound to a const holding `$` fails when the module loads. Engines 2.1.292 and 2.1.296 refuse `$` across an import at all, so the version floor enforces itself.
- **The footprint gate greps comments.** An engine call in the `$.<noun>.<fn>(` form anywhere in `hooks/` or `src/` outside `api.ts` and `register.tsx` fails the gate, a comment included. Describe the call in words.
- **A new engine call** means a new wrapper, a new entry in `EXPECTED_APIS` in `scripts/check-footprint.sh`, an updated Data handling section in the README and an updated table in [SECURITY.md](../SECURITY.md). It is a security change; do not add one casually.
- **State atoms** are not used by `/cc`. If you ever add some: the engine validates `read` and `update` against an atom made in the calling file, so declare the atom in every file that reads it (this rule comes from a sibling plugin and has not been exercised here).
- **The command name** `cc` is a literal in the declaration and in the hook filter. If another plugin registers `cc` later it replaces this one silently; a built-in's name is refused and the mod shows `could not register /cc`.
- **The hook never reads `next`** and answers `{}`. Anything it returned as `text` would be printed in the transcript and read by Claude.
- **Do not load the dev folder as a plugin.** The engine can write about 840 KB of type files (`.claude-plugin/types/`) and a `tsconfig.json` into a folder it loads. Both are in `.gitignore`. Load a copy of `.claude-plugin`, `hooks` and `src` instead, as the README says.

## Privacy rules for contributors

Clipboard text and message text never reach a toast, a log, a store, a state key, returned text, a thrown error or a file. Counts and words from fixed lists only: add a field to `Decision` in `hooks/outcome.ts` only if it is a count or a member of a fixed list. Never read the real clipboard in a test or a probe, never commit a real transcript, copy or screen capture, and never print one in a report. The layers that enforce this, and their limits, are in [SECURITY.md](../SECURITY.md).

The matcher is bounded: at most 10,000 start positions per reply, 200,000 in all, 100 million characters of candidate work, and the engine's own `indexOf` only while its worst case fits a budget (otherwise a linear-time search). A copy in more places than that is refused as `ambiguous`. No input may make the matcher run out of memory or run for tens of seconds (`tests/budget.test.ts`, `tests/search.test.ts`).

## The sealed live rig (`realrender/`)

The offline tests cannot prove that the matcher's model of the screen is right, because the matcher and the simulator share one model. The rig closes that gap without spending money or touching your clipboard.

**What it does.** It resumes a **synthetic** session in the installed Claude Code, inside `tmux` on a dedicated socket (`cbrender`), under `env -i` with an isolated `HOME`, a dummy credential and a stub API on `127.0.0.1` that answers 401. It loads a copy of the plugin with `--plugin-dir`, types `/cc` for each planned case, and reads the result from the screen and from the stand-in clipboard. It runs whichever `claude` comes first on `PATH` and records the banner version without enforcing it. It writes `{"tui": "default"}` into the throwaway settings (`realrender/lib/live-fixtures.mjs`), so every live launch draws Claude Code's classic display; the fullscreen display, which a clean profile started in on 2.1.309 with mouse tracking on, was never run live.

**Stand-ins.** The `pbpaste` stand-in prints a fixture the case chose (modes: the fixture, exit 1, sleep, a 5 MiB answer); `pbcopy`, `xclip`, `xsel`, `wl-copy` and `osascript` keep what they receive inside the throwaway folder and log a name, a byte count and a short hash. The shim folder is first on the sealed `PATH`.

**The Seatbelt profile** (`realrender/lib/seatbelt.mjs`, run with `sandbox-exec -f`): everything allowed by default, then no outbound network except addresses local to the host and unix sockets, no `mach-lookup` of `com.apple.pasteboard.1` (so even `/usr/bin/pbpaste` called by absolute path cannot reach the real clipboard), no write anywhere under the real home, and no read of the folders that hold credentials, settings, transcripts and your captures. `live.mjs controls` proves each of these from inside and outside the sandbox (13 controls) before any case runs.

**Why the real clipboard is never read.** Inside the sandbox it cannot be: the pasteboard service is refused and the shims stand in. The only code that reads the real clipboard is the optional `live.mjs clip` stage, which pipes `pbpaste` into `shasum` and stores only the hash, and `clipboard-hash.mjs` refuses a third read before anything runs. The hashes before and after a pass show that nothing put text on the clipboard. Run `clip` yourself, once before and once after.

**How to run it** (from the repository root, on a quiet machine; each stage is its own command so a long one can run in the background):

```bash
node realrender/gen-live-set.mjs --seed N --out SET               # a new synthetic case set (40 replies, 160 spans)
node realrender/live.mjs controls --out OUT                       # the 13 sandbox controls
node realrender/live.mjs clip --out OUT --label before            # optional: the only read of the real clipboard (hash only) ...
node realrender/live.mjs width --width 80 --out OUT --holdout SET # one launch; repeat for 60, 100 and 120
node realrender/live.mjs turn --out OUT                           # the control launch: unicode probe and "no model turn" check
node realrender/live.mjs clip --out OUT --label after            # ... and the second and last read
node realrender/live.mjs summary --out OUT --rule-version 2       # applies the frozen rule
```

Use a new seed for every pass: the case set of a counted pass is never reused. `--holdout SET` is required. `--limit N` caps the number of cases of a launch, but **`--limit 0` is treated as no limit**, so it runs every case: do not use it as a dry run. Keep `OUT` and `SET` outside the repository.

**How long.** One width launch (48 cases) took about 4 to 5 minutes. The counted pass (four widths plus the control launch, with the two clipboard hashes around them) took 17 minutes from the first hash to the last.

**It is sensitive to load.** The plugin reads the clipboard with a 2 second limit. The `pbpaste` stand-in is a shell script that runs several programs; on a loaded machine (swap nearly full, a long `tar` running) it stalled for 2 to 8 seconds, and in two sanity launches 3 of 80 copies were refused with "could not read the clipboard", which the rig scores as wrong toasts. The refusal is the designed, safe outcome, but the launch is then not clean. Wait for a quiet machine before a counted pass.

**The frozen pass rules** are in `realrender/lib/live-rule.mjs` (nine conditions) and `live-rule-2.mjs` (twelve), fixed in code before any case ran and pinned by tests. A pass needs all of: the plugin loads and `/cc` runs; no model request and no assistant record added; at least 90 percent of valid positives exact, over all four widths and all 13 construct classes, with non-ASCII payloads; zero wrong payloads; refusals leave the clipboard untouched; toasts hold counts only and a planted canary string is absent; the sandbox controls hold; no non-local socket in any `lsof` sample; the real clipboard hash is unchanged and exactly two reads were taken; a positive control (the stub log is empty after the `/cc` cases and non-empty after an ordinary prompt); and a unicode probe (every case exact, with an em dash and a zero-width joiner among the payloads). Never edit a rule after you have seen results.

**Side effects to know about.** The rig writes `/tmp/cbrender.*`, `/tmp/cbctl.*` and `/tmp/cbcombo.*`, starts a tmux server on the `cbrender` socket and a loopback Python stub, and moves its scratch folders to `~/.Trash/` with `mv` when it finishes. `live.mjs controls` makes connection attempts on purpose: one from **outside** the sandbox to `192.0.2.1:9` (a documentation address; a real packet leaves the machine and times out) as a contrast control, and two from **inside** it, to `192.0.2.1:9` and `1.1.1.1:443`, which the profile must deny. If the profile ever failed, the second would reach a public host; the control exists to show that it does not.

The other entry points: `rig.mjs` (one sealed launch and a screen capture), `capture.mjs` and `measure.mjs` (capture a synthetic set at four widths and score it against the matcher; a holdout is scored once), `modeldiff.mjs` and `surveydiff.mjs` (diff the matcher's model of every reply against the real screen), `survey.mjs` (glyph and margin survey), `probe.mjs` and `probe-after.mjs` (check how the engine hands a mod its rows, using the scratch plugin in `realrender/probe/`).

## The captures tool and the frozen real-copy rule

`CAPTURES.md` is the maintainer's own acceptance test: about 20 real copies from a real terminal (the maintainer uses Warp), each judged by hand, scored by `node scripts/captures.mjs tally`. It is the one test that can say whether the matcher's model of a real terminal's copies is right. It has not been run yet.

- `node scripts/captures.mjs add | run [--show] | tally [--json]`, with `--dir`, `--root` and `--messages`. `add` reads the clipboard once; `run` and `tally` print counts and ids only; `run --show` is the only command that prints text, and it refuses unless its output is a terminal. Never run `add` or `run --show` from an agent or a script, and never type `run --show` inside Claude Code or with a leading `!`.
- **The rule.** PASS needs at least 20 judged copies, at least 70 percent of them `ok`, at least 10 of them matched and right (the tool returned text and you judged it `ok`; refusals judged right do not count toward the 10), no dangerous result (a `bad` verdict where the tool returned text) and nothing unresolved. The checks run in a fixed order and the first that applies decides: a dangerous result is a FAIL at any count; then anything unresolved is INCOMPLETE; then fewer than 20 judged is INSUFFICIENT; then under 70 percent is FAIL; then fewer than 10 matched and right is INSUFFICIENT; otherwise PASS. A FAIL is final by convention: do not add copies to turn it into a pass.
- **Frozen on 2026-10-23, before any real copy existed.** The verdict is decided by `decide()` in `src/captures/tally.ts`, and the numbers (20, 10 and 0.7) are pinned by a test. The SHA-256 of that file at the freeze:

  ```
  1ff524a3e8efab440f40b33a03fad818e15eb195883198c4b50f95b937b11024  src/captures/tally.ts
  ```

  After your copies are judged, `shasum -a 256 src/captures/tally.ts` must print the same value, and `git log --follow -p -- src/captures/tally.ts` must show no commit after the date of your first capture. Either difference means the rule moved after data existed. The wording around the rule (`tally-format.ts`, `tally-notes.ts`, `help.ts`, `CAPTURES.md`) was frozen at the same time. For publication two of those were edited in small ways, `help.ts` (two phrases that named Warp) and `CAPTURES.md` (one line that named the maintainer's folder); `tally-format.ts` and `tally-notes.ts` are byte-identical to the freeze. Only `tally.ts` decides the verdict.
- **Do not tune the matcher on those copies** before you have read the verdict.

There is a second, older "K1": `npm run k1` (`scripts/replay.mjs`) scores the matcher against a simulated screen built from your own transcripts. It can only agree with itself, which is why the real-copy test and the rig exist. It reads `~/.claude/projects` and prints one JSON document of counts.

## What has been verified, and what has not

Numbers on this page come from the maintainer's build and verification reports, which are not kept in this repository. The reviews and the re-scoring in those reports were done by separate Claude agent sessions that the maintainer started (the model was not recorded). Labels: V = run for this page, R = reported in those reports.

| Claim | Label |
|-------|-------|
| 1325 + 263 + 87 tests pass; footprint, source guard, replay selftest, shellcheck and typecheck pass; `validate` passes | V, 2026-10-24 |
| Same gates green on Claude Code 2.1.299, 2.1.309 and 2.1.310 | R |
| Counted sealed live pass on 2.1.309, classic display only (seed 7331, rule 2): 160 of 160 exact, 32 of 32 refusals untouched, 0 model requests, 0 non-local sockets, 12 of 12 conditions, re-scored from the raw files by a second Claude session. The copies were built by a model of a terminal selection from real Claude Code screens and fed through the `pbpaste` stand-in, so the pass does not show what a real terminal copies | R |
| Calibration and holdout on real Claude Code screens with synthetic content: 160 of 160 exact on a fresh holdout after five renderer assumptions were corrected | R |
| Two sanity launches on 2.1.310: 77 of 80 positives exact, 0 wrong payloads, 3 refused on the 2 second read limit | R |
| Not verified: Warp or any real terminal's clipboard, the real `pbpaste` and `pbcopy`, Claude Code's fullscreen display, an organisation policy refusing `process.run`, Linux, Windows, tables and tool output (out of scope), `/cc` while a reply streams, any Node below 26, the 20-real-copy test | not run |

## Release process

1. Work on a branch in a git worktree, tests first. A change under `hooks/` or `src/core/` changes the runtime and needs a new sealed live pass; do not change the 2000 ms clipboard timeout in `hooks/api.ts` casually.
2. Run every gate above, and get an independent review of the diff.
3. The version lives in **`.claude-plugin/plugin.json`**, and `package.json` carries the same string (`tests/manifest.test.ts` fails if they differ). The marketplace entry carries none: the engine would silently use `plugin.json` and `validate` flags a mismatch. Move `[Unreleased]` in `CHANGELOG.md` to `[X.Y.Z] - date` (the day the tag is cut), update the compare links, and check that the README status line, Limits and the supported versions in `SECURITY.md` are still true.
4. Commit as `chore(copy-back): release X.Y.Z`, fast-forward `main`, and create an **annotated** tag: `git tag -a vX.Y.Z -m "copy-back X.Y.Z: <one line>"`. (`claude plugin tag` would create a `copy-back--vX.Y.Z` tag instead; this repository uses plain `vX.Y.Z` tags.)
5. The maintainer pushes by hand: `git push origin main --follow-tags`. Then check that the tag is annotated: `gh api repos/sairam0424/claude-copy-back/git/ref/tags/vX.Y.Z --jq .object.type` prints `tag`.
6. Create the GitHub release from the tag that exists: `gh release create vX.Y.Z --verify-tag --title "copy-back X.Y.Z" --notes-file NOTES.md` (add `--prerelease` while the project is experimental; `--verify-tag` aborts instead of creating a lightweight tag if the push has not happened). The notes are the CHANGELOG block plus an Install and Update line and a Verification block that says what was **not** verified.

A GitHub release is for people reading; `claude plugin update copy-back@claude-copy-back` follows the `version` in `plugin.json` on the repository.

The history starts at 0.1.0. The matcher, the replay harness, the captures tool, the rig and the plugin shell were developed before it, outside git.

Commits use Conventional Commits scoped `copy-back` (`fix(copy-back): ...`), with the reason in the body and no `Co-Authored-By` trailer. See [AGENTS.md](../AGENTS.md).
