# Repository Guidelines

## What this is
copy-back is a Claude Code mod (plugin `copy-back`, command `/cc`) plus the matcher under it (see README Limits). `/cc` reads the clipboard once, finds that text in the newest assistant replies and writes Claude's own text for it back with `ui.copy`. A refusal leaves the clipboard alone. macOS only.

## Layout
- `hooks/hooks.json` -> `register.tsx` declares `/cc` (immediate) and answers `{}`. `api.ts` is the engine seam: four wrappers, function declarations, names of at most seven characters. `cc.ts` decides, with the engine injected.
- `src/core` is the matcher: change it only for a real defect, with a test. `src/sim`, `src/replay`, `src/captures`, `scripts/`, `realrender/` are tools around it (`docs/DEVELOPMENT.md`).

## Commands
```bash
npm test                         # serial
bash scripts/kit-test.sh         # needs claude and jq
bash scripts/check-footprint.sh
CB_TYPECHECK_REQUIRED=1 bash scripts/typecheck.sh
claude plugin validate . --strict
actionlint .github/workflows/*.yml
npm run test:rig                 # rig unit tests (macOS)
```
`claude plugin test .` at the root runs the 87 kit tests: `node:test` files are `*.test.mts` (`tests/kit-layout.test.mts` guards it). Node 22.19+, engine 2.1.299+. Timing tests assert CPU time (`tests/timing.ts`); `CB_TEST_TIME_FACTOR=3` relaxes them. CI: Linux and macOS on every pull request; `ci-ok` is the one check to require; `engine-drift.yml` weekly; CodeQL and Scorecard are not required.

## Rules
- Engine: `$` goes only into top-level function declarations. An engine call spelled outside `api.ts` and `register.tsx`, comments included, fails the footprint gate. The hook never reads `next`. No timers, state, store, files or network.
- Style: erasable-only TypeScript, `.ts` in relative imports, zero dependencies, files under 400 lines, functions under 50, no mutation of inputs.
- Privacy: clipboard and message text never reach a toast, log, store, state, returned text, thrown error or file: counts and fixed words only. Never read the real clipboard in a test; never commit a real transcript, copy or screen capture. The source guard is a tripwire, not a sandbox (`SECURITY.md`). No input may exhaust memory or run for tens of seconds.

## Commits and releases
Conventional Commits scoped `copy-back`, the why in the body, no `Co-Authored-By` trailer. Test first. Docs claim only what was run. A change under `hooks/` or `src/core` needs a new counted sealed live pass before a release. Releases: a `CHANGELOG.md` entry, one version in `.claude-plugin/plugin.json` and `package.json` (a test pins it), an annotated `vX.Y.Z` tag on `main`.

## Agent Instructions
Work in a git worktree. Never `claude -p`. Run kit tests only through `scripts/kit-test.sh` with an isolated HOME. Never run `captures.mjs add`, `run --show` or `live.mjs clip`, and do not start the rig unless asked.
