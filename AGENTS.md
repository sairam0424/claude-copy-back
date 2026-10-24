# Repository Guidelines

## What this is
copy-back is a Claude Code mod (plugin `copy-back`, command `/cc`) plus the matcher under it (tested against a model of how Claude Code draws a reply; the README's Limits say what is not verified). `/cc` reads the clipboard once, finds that text in the newest assistant replies and writes Claude's own text for it back with `ui.copy`. A refusal leaves the clipboard alone. macOS only.

## Layout
- `hooks/hooks.json` -> `register.tsx` declares `/cc` (immediate) and answers `{}`. `api.ts` is the engine seam: four wrappers, function declarations, names of at most seven characters. `cc.ts` decides with the engine injected; `input.ts`, `outcome.ts` and `run.ts` support it.
- `src/core` is the matcher: change it only for a real defect, with a test. `src/sim`, `src/replay`, `src/captures`, `scripts/` and `realrender/` are tools around it (`docs/DEVELOPMENT.md`).

## Commands
```bash
npm test                         # serial; no engine needed
bash scripts/kit-test.sh         # engine tests; needs claude and jq
bash scripts/check-footprint.sh  # access report; runs the source guard
CB_TYPECHECK_REQUIRED=1 bash scripts/typecheck.sh
claude plugin validate .
npm run test:rig                 # rig unit tests
```
Never `claude plugin test .` at the root (it fails on the `node:test` files). Node 22.19+, engine 2.1.299+. Timing tests can flake under load: rerun alone first.

## Engine rules
`$` goes only into top-level function declarations; no arrow-const wrappers. An engine call spelled outside `api.ts` and `register.tsx`, comments included, fails the footprint gate. The hook never reads `next`. No timers, state, store, files or network.

## Style
Erasable-only TypeScript, `.ts` in relative imports, zero dependencies, Prettier style, files under 400 lines, functions under 50, no mutation of inputs.

## Privacy (hard rules)
Clipboard and message text never reach a toast, log, store, state, returned text, thrown error or file: counts and fixed words only. Never read the real clipboard in a test, and never commit a real transcript, copy or screen capture. The source guard is a tripwire, not a sandbox (`SECURITY.md`). No input may exhaust memory or run for tens of seconds (`tests/budget.test.ts`).

## Commit and Pull Request Guidelines
Conventional Commits scoped `copy-back` (`fix(copy-back): ...`), the why in the body, no `Co-Authored-By` trailer. Test first. A change under `hooks/` or `src/core` needs a new sealed live pass. Releases: a `CHANGELOG.md` entry, one version in `.claude-plugin/plugin.json` and `package.json` (a test pins it), an annotated `vX.Y.Z` tag on `main`.

## Agent Instructions
Work in a git worktree. Never `claude -p`. Run kit tests only through `scripts/kit-test.sh` with an isolated HOME. Never run `captures.mjs add` or `run --show`, or `live.mjs clip` (they read the real clipboard or the user's copies), and do not start the rig unless asked.
