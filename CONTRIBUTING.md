# Contributing to copy-back

Thanks for looking. copy-back is an experimental, one-maintainer project, so small, focused changes with tests are the easiest to review. Security problems do not go in an issue or a pull request: read [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## What fits

In scope: recognising more of the way Claude Code draws a reply (so that more copies are found), clearer refusals and toasts, tests, the sealed test rig, and documentation that says only what was run.

Unlikely to be accepted: a new engine call, or anything that needs a network, a file, a timer or stored state (the mod has five engine calls and the footprint gate pins them); anything that writes text Claude did not write; runtime support for another operating system without a way to test it; tables, diffs and tool output (known gaps, see Limits in the README). Open an issue with the feature request form first if you are not sure.

## The privacy rule

Clipboard text and message text must never reach a toast, a log, a store or a file, nor state, returned text, a thrown error or the network. Toasts hold counts and words from fixed lists only. Never read the real clipboard in a test or a probe, and never commit a real transcript, a copied text or a screen capture: every fixture is synthetic. Do not paste any of it into an issue, a pull request or a report either. The layers that enforce this, and their limits, are in [SECURITY.md](SECURITY.md).

## Setting up and running the gates

There is nothing to install: no dependencies, no lockfile. You need Node 22.19 or newer, and for the engine gates Claude Code 2.1.299 or newer, `jq` and `shellcheck`. The sealed live rig also needs macOS, `tmux` and `python3`. [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) has the full list, the layout and what each gate proves. Run the ones that apply to your change:

```bash
npm test                          # matcher, /cc logic, privacy spies, manifests, workflows
bash scripts/kit-test.sh          # the plugin on the engine's own test kit (isolated HOME)
claude plugin validate . --strict
bash scripts/check-footprint.sh   # the engine access report, plus the source guard
node scripts/check-sources.mjs
shellcheck scripts/*.sh           # if a script changed
npm run test:rig                  # if realrender/ changed (macOS)
```

The engine writes type files into a plugin folder it loads, so run the engine gates on a copy of the repository, as the development guide explains. Work test first: a bug fix needs a test that fails without it. The `node:test` files are named `*.test.mts` on purpose (the engine's runner loads every `*.test.ts`).

CI runs on every pull request on Linux (Node 22.19.0, 24.x and 26.x, the source guard, `shellcheck` and the engine gates). The macOS legs and the rig's unit tests run after a merge to `main`, or when the maintainer starts the workflow by hand, so run `npm run test:rig` yourself if you touched `realrender/`. The check to require is `ci-ok`; it is green only when every job finished as expected.

A change under `hooks/` or `src/core/` changes what runs inside Claude Code, so it needs a new sealed live pass before a release. The maintainer runs that on a Mac; say in the pull request what you changed there.

## Commits and pull requests

- Conventional Commits scoped `copy-back`: `fix(copy-back): handle a link title inside a list item`, with the reason in the body, not just the change.
- Branch from `main`, keep the branch short-lived, one logical change per pull request. Merges are squashes, so the pull request title becomes the commit subject.
- Fill in the pull request template, add a line under `[Unreleased]` in `CHANGELOG.md` for anything a user can see, and keep docs honest: no claim about Warp, Linux, Windows or the real `pbpaste` and `pbcopy` that was not tested.
- Files stay under 400 lines and functions under 50; TypeScript is erasable-only; no mutation of inputs.

## How a pull request is reviewed

The maintainer reads every pull request; `CODEOWNERS` requests the review. Expect a first answer within about a week, with no fixed time. The review looks, in this order, at: the privacy rule, the engine footprint, whether the tests fail without the change, whether the docs match what was run, and size. A pull request merges once `ci-ok` is green and the maintainer approves.

## The plugin API is early access

The mod runs on Claude Code's plugin API, which is early access and can change between versions. It supports Claude Code 2.1.299 and newer. CI tests the floor and one newer pinned version on every pull request, and a weekly job runs the engine gates against the newest published version, so a break is usually noticed within a week. If your change needs a newer engine feature, open an issue before writing it.

## License

By contributing you agree that your contribution is licensed under the MIT license in [LICENSE](LICENSE).
