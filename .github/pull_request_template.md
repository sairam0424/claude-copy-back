## What and why

<!-- One to three sentences. The title becomes the squash commit subject: `type(copy-back): subject`. -->

## Type of change

- [ ] fix
- [ ] feat
- [ ] refactor
- [ ] test
- [ ] docs
- [ ] chore, ci or build

## Gates run

Tick what applies to the files you touched, and paste nothing but the pass or fail line.

- [ ] `node --test --test-concurrency=1 "tests/*.test.mts"`
- [ ] `node --test --test-concurrency=1 "realrender/tests/*.test.mjs"` (if `realrender/` changed; macOS; CI runs it only after a merge to `main`)
- [ ] `node scripts/check-sources.mjs`
- [ ] `claude plugin validate . --strict`
- [ ] `bash scripts/check-footprint.sh`
- [ ] `bash scripts/kit-test.sh` (with an isolated `HOME`)
- [ ] `shellcheck scripts/*.sh` (if a script changed)
- [ ] `actionlint .github/workflows/*.yml` (if a workflow changed)
- [ ] `CB_TYPECHECK_REQUIRED=1 bash scripts/typecheck.sh` (local only; needs the engine's types file)
- [ ] A bug fix has a test that fails without it

## Privacy checklist

- [ ] No clipboard text or message text reaches a toast, log, store, state, returned text, thrown error, file or the network: counts and fixed words only
- [ ] No test or probe reads the real clipboard, `~/.claude` or a real transcript; fixtures are synthetic
- [ ] No real captures, clipboard hashes, e-mail addresses, account names, home-directory paths, IP addresses, keys or tokens in code, tests, fixtures, docs, screenshots or this description
- [ ] No new dependency (the repo has none), and any new engine API is added to the footprint gate's list and to the README's data handling text on purpose

## Docs and honesty

- [ ] `CHANGELOG.md` has a line under `[Unreleased]` for a user-visible change
- [ ] Docs claim only what was run: no Warp, Linux, Windows or real `pbpaste`/`pbcopy` support unless it was tested
