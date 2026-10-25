# copy-back

A Claude Code mod for copying text out of the terminal. Select part of a reply, copy it as usual, type `/cc` on an empty prompt, and the clipboard holds Claude's own text for that selection: no two-space margin, no trailing padding, no hard line breaks at the terminal width.

> **Status: v0.1.1, experimental.** Checked by unit tests, by tests on the Claude Code engine, and by sealed tests of the real Claude Code (classic display) against **synthetic** sessions: a counted live pass of 0.1.0 on 2.1.309, and, for 0.1.1, a screen-matching holdout and a counted live pass of the 0.1.1 build, both on 2.1.310, drawn the way Warp draws a session and the default way. In those tests the copies were built by a model of a terminal selection from real Claude Code screens, not by a real terminal, so they show what Claude Code draws and that the mod runs, but not what Warp or any other terminal puts on the clipboard. **Not yet checked:** a real Warp session (how it selects and copies), the real `pbpaste` and `pbcopy`, Claude Code's fullscreen display, other Claude Code versions in a live pass, and an organisation policy that refuses a mod starting a program. macOS only, because it reads the clipboard with `pbpaste`. See Limits.

Text copied from the Claude Code terminal typically arrives as the screen drew it: every row starts with the margin, rows are padded and cut at the terminal width, and a paragraph becomes five short lines (what a given terminal really copies is the part not yet checked). Pasted into an editor, a ticket or a chat, it has to be cleaned by hand. `/cc` does not clean the text; it looks it up. It finds the words you copied in the newest replies of the current session and puts the original text of that selection on the clipboard.

Because it copies from the session transcript, it can only ever write text that was in this session's last 40 replies, and every character it writes is a character Claude wrote. When it is not sure (no match, or the same words in places where Claude's original text differs) it says so and leaves your clipboard as it was.

For example, the terminal copies this (margin, rows cut at 60 columns):

```
  The cache is rebuilt on every deploy, so the first request
  after a release is slower than the rest. If that matters,
  warm it from the release script instead of waiting for a
  visitor.
```

After `/cc`, the clipboard holds this (one line, as Claude wrote it), and a toast says `copy-back: copied 182 chars from reply 1 (1 = newest)`:

```
The cache is rebuilt on every deploy, so the first request after a release is slower than the rest. If that matters, warm it from the release script instead of waiting for a visitor.
```

copy-back is an independent project. It is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.

## Install

```
/plugin install copy-back --marketplace sairam0424/claude-copy-back
```

From a shell: `claude plugin marketplace add sairam0424/claude-copy-back && claude plugin install copy-back@claude-copy-back`.

You need macOS and Claude Code 2.1.299 or newer (the oldest version tested; 2.1.292 and 2.1.296 refused it when it loaded). Node is only for developing the mod; using it needs nothing else installed.

To try a clone without installing, load a **copy** of three folders:

```bash
mkdir -p ~/claude-plugins/copy-back
cp -R .claude-plugin hooks src ~/claude-plugins/copy-back/
claude --plugin-dir ~/claude-plugins/copy-back
```

Do not load the clone itself: the engine can write about 840 KB of type files and a `tsconfig.json` into a plugin folder it loads.

## First run

Run `/reload-plugins` (or restart Claude Code). Select a region of a reply with the mouse, press Cmd+C, leave the prompt empty, and type `/cc`. There is nothing to configure.

## Using it

1. Copy a region of a Claude Code reply as you always do. Claude Code has a classic display and a fullscreen display, chosen by its `tui` setting (`default` is the classic one). The live pass used the classic one. In fullscreen Claude Code turns on mouse tracking (seen in a clean profile on 2.1.309), so a normal drag may not select text and your terminal may need a modifier key to do it; that, and what then lands on the clipboard, was not tested.
2. On an empty prompt, type `/cc` and press Enter. It is declared as an immediate command and starts no turn: nothing is sent to the model (the sealed live pass saw zero model requests).
3. A toast tells you what happened. On success: `copy-back: copied 182 chars from reply 1 (1 = newest)`. The number is the reply the text came from, counting the newest reply with text as 1. If the same original text is in several replies, it names the newest of them, which may not be the one you copied from; the text written is the same. Paste as usual.
4. On a refusal the toast says why. It ends with `nothing changed` for every refusal that happens before a write: nothing was written, so your clipboard is exactly as it was (the exception is listed under Troubleshooting). A refusal is always safer than a guess.

Claude Code puts the mod's name (`copy-back: `) in front of every toast, so the mod's own line does not repeat it and is at most 45 characters, which keeps the reply number visible at 60 columns. The 45 was inferred from earlier sealed screens of Claude Code 2.1.309 and 2.1.310; in the counted live pass of the 0.1.1 build on 2.1.310 all 283 toasts were shown whole, the longest row (56 characters) at 60 columns (reported). Other versions were not looked at.

## Data handling

The mod sends nothing anywhere: it calls no network API, makes no model call and starts no program except `pbpaste`. The source guard checks that as a tripwire, not a sandbox, and nothing here shows that the engine would stop a mod from starting another program (see [SECURITY.md](SECURITY.md)).

The engine's access report (`claude plugin validate .` prints it) lists exactly five engine calls, and `scripts/check-footprint.sh` fails if the list changes:

- `$.command.register`: declares `/cc` when a session starts.
- `$.process.run`, via `pbpaste`: reads the clipboard **once per `/cc`**. The program is `pbpaste` by name, with no arguments, a 2 second timeout and a UTF-8 locale. A clipboard that is empty, over 200,000 characters, cut short or unreadable is refused, never used in part.
- `$.session.messages`: reads the session's rows. The mod looks only at assistant rows that have text, takes the newest 40, and keeps nothing: what the matcher cached is dropped at the end of every run.
- `$.ui.copy`: writes the clipboard, once, and only after a match, with text taken from one of those replies.
- `$.ui.toast`: shows one line made of counts and fixed words. Clipboard and message text are never put in a toast, a log, a thrown error or the command's answer (the command answers `{}`).

It uses no files, no state or store, no timers and no telemetry. Hooks: `session.start` and `command.run{cc}`.

Things the access report cannot see (printing, timers, reflection, imports) are guarded in layers described in [SECURITY.md](SECURITY.md): a source scan of everything the hooks load, a type check that has no `console`, `process` or `fetch`, and tests that spy on the console, the standard streams and `fetch`. That scan is a tripwire, not a sandbox.

Installing from this repository installs the whole folder, not only the 25 files the hooks load. That includes `src/captures`, a tool for the maintainer's own testing that can read the clipboard and write files when someone runs it by hand. The plugin never loads it.

The tools in this repository that touch real data, and only when you run them yourself:

- `node scripts/replay.mjs` (and `npm run k1`; not `--selftest`, which uses synthetic data) reads your Claude Code transcripts under `~/.claude/projects` (set another folder with `--root DIR`) and prints one JSON document of counts.
- `node scripts/captures.mjs add` reads the clipboard once and saves it to `~/copy-back-captures` (mode 0700; it refuses a folder inside a git repository). `run` and `tally` read that folder and the transcripts and print counts. `run --show` prints your own text, so it refuses unless its output is a terminal. Never run it inside Claude Code and never type it with a leading `!`.
- `node realrender/live.mjs clip` reads the real clipboard only to store its SHA-256, at most twice.

## How it works

1. **A model of the screen.** Claude Code draws a reply by fixed rules: a two-column margin, a marker on the reply's first row, `-` for bullets, list text hanging under its first word, rows cut at spaces at the terminal width, code cut by character. The matcher (`src/core`) implements those rules, so for any reply it can compute the text a terminal would show. It was calibrated against real screens of Claude Code 2.1.309 and 2.1.310. Links and struck text are drawn two ways depending on the terminal Claude Code detects: a link as `label (url)` with the `~~` kept (what the rig draws with no terminal name set; Terminal.app is expected to behave this way), or a link as its label alone with struck text shown without tildes (what the rig draws with `TERM_PROGRAM=WarpTerminal`, and once with `TERM_PROGRAM=iTerm.app`). A static read of Claude Code 2.1.310 by a review (reported) lists many more terminals on the second path, such as kitty, Ghostty, Alacritty, WezTerm, VS Code and Hyper, and a setting or an environment variable can force either drawing. `/cc` cannot know which applies to you, so it searches both drawings.
2. **Compare like with like.** The copy is stripped of its decoration, and runs of spaces and line breaks are folded to one space on both sides, because the copy arrives hard-wrapped.
3. **Find the source.** Each reply is searched, newest first. A hit is mapped back to offsets in the reply's markdown, so the answer is the exact slice of what Claude wrote: `message.slice(start, end)`, never edited.
4. **Ambiguity refuses.** If the same words sit in several places and Claude's original text differs between them (for example one has markup the other lacks), the copy's own indentation is tried first (it can tell two copies of the same code apart); if that cannot decide, `/cc` refuses and does not take the newest. If the original text is identical in every place, it is one answer: `/cc` writes it and the toast names the newest reply that holds it. A copy found in too many places to tell apart is refused as ambiguous too. The search does a capped amount of work, but its cost still grows with the size of the replies; `docs/DEVELOPMENT.md` has the caps and the measured worst case.
5. **Source field and paste field.** The matcher returns `source` (the exact slice) and `paste` (what `/cc` writes). `paste` has the same characters, minus the list or quote prefix on every line after the first, with the first line's indentation put back, so code copied out of a list item pastes as code.

## Troubleshooting: why was my copy refused?

Each refusal is one toast. Nothing is written before a match, so the clipboard is exactly as it was and the line ends with `nothing changed`, with one exception: the two clipboard-write lines below, which come after the engine was asked to write.

- `could not read the clipboard` - `pbpaste` failed or took longer than 2 seconds. Run `/cc` again. This happens on a machine under heavy load, and it cannot work off macOS.
- `clipboard is empty` - copy something first.
- `clipboard over 200000 chars` - select less. A read that was cut off is reported the same way.
- `copied text under 12 chars` - too short to find with confidence. Select more.
- `no match in last N replies` (N is up to 40; `no match in the last reply` when there is one) - the text is not in any of the newest replies as drawn. Usual causes: a table, a diff or tool output (not matched), text older than 40 replies, a drawing the matcher does not model (see Limits), or a selection that runs from one reply into the next.
- `matches more than one place` - the same words are in more than one place and Claude's original text differs between them (for example one has markup such as code formatting or different indentation where the other does not, or a link that one drawing hides), so `/cc` cannot tell which one you meant. Select a longer or more distinctive stretch. Words that sit in several replies with identical original text are not a refusal: there is nothing to decide, so `/cc` copies that text and the toast names the newest reply that holds it.
- `could not read the session` - the engine did not hand over the session's rows.
- `no replies to search` - the session has no assistant reply with text yet.
- `clipboard write was refused (...)` or `clipboard write failed` - the engine's own write call did not succeed. These two lines do not say `nothing changed`: check what is on the clipboard before you paste.
- `unexpected error` - a bug. Please report it without pasting your text.
- `could not register /cc` - the engine refused the command name, for example because a built-in command uses it.

## Configuration

None. The plugin declares no options.

## Updating

- Installed from GitHub: `claude plugin update copy-back@claude-copy-back`, then restart Claude Code. An update only happens when the version in `.claude-plugin/plugin.json` changes.
- Loaded from a copy: copy the three folders again.
- To remove it: `claude plugin uninstall copy-back@claude-copy-back`.

## Limits

- **macOS only.** It starts `pbpaste`. On another system `/cc` is expected to say it could not read the clipboard and change nothing; that was not tested. Linux and Windows are not supported.
- **What was verified.** 1,556 unit tests, 87 tests on the engine, 398 tests of the test rig, and three kinds of sealed run of the real Claude Code (classic display) on **synthetic** sessions, all reported rather than re-runnable from this repository. For 0.1.0, a counted live pass on Claude Code 2.1.309: 160 of 160 copies came back exact, 32 of 32 refusals left the clipboard untouched, and no model request or outside network connection was seen; the copies went to `/cc` through stand-ins for `pbpaste` and `pbcopy`. For 0.1.1, a holdout on 2.1.310 in which the rig drew the session the way Warp does and, separately, the default way: 240 of 240 copies exact in each, 0 wrong slices and 0 false positives, scored directly against the matcher (not through `/cc`) with a rule that was hashed before the first of its screens existed; the 0.1.0 matcher scored 178 of 240 on the Warp-drawn window. And for 0.1.1 a counted live pass of `/cc` itself on 2.1.310, 12 of 12 conditions of its rule: in the Warp drawing 160 of 160 copies exact (links 11 of 11, struck text 11 of 11) and 32 of 32 refusals untouched, in the default drawing 40 of 40 and 8 of 8, no wrong payload and no wrong toast in 283 cases, all 283 toasts shown whole, no model request, no non-local socket in 8,658 samples, 13 of 13 sandbox controls under each profile; the plugin folders that passed (`.claude-plugin`, `hooks`, `src`) are unchanged in this release, checked on 2026-10-25 against the pass's freeze record, which is kept outside this repository. Its limits: that rule (rule 3, revision 2) is kept outside this repository, so the repository cannot re-run it; the Warp set was rebuilt from the spans the screen shows (link destinations are not drawn, so the stock generator loses 1 to 3 of 40 spans per width) and the exact-rate bar was 95 percent; the default drawing was exercised at one width only (40 copies and 8 refusals); the check of the real clipboard was two hash reads around a stand-in that writes, not around the real plugin, and both hashes were the hash of empty input, so it shows only that no text appeared; and the copies still came from a model of a terminal selection. In every run the copies were built by that model from real Claude Code screens, so the runs check what Claude Code draws and that the mod works. They do not show what Warp or any other terminal puts on the clipboard; that is what the 20-real-copy test in [CAPTURES.md](CAPTURES.md) is for, and it has not been run yet.
- **Who verified it.** The author, on one Mac, working with Claude Code. The reviews, the re-score of the live pass and the 0.1.1 rig work were done by separate Claude sessions that the author started (the model was not recorded), and the raw evidence is not published here, so treat these numbers as reported, not as something you can re-run from this repository.
- **Not verified:** how Warp selects and copies (its drawing is checked in the rig; the text it puts on the clipboard is not), the real `pbpaste` and `pbcopy` (locale, large clipboards), Claude Code's fullscreen display, an organisation policy that refuses a mod starting a program, other Claude Code versions (the gates also pass on 2.1.299, 2.1.309 and 2.1.310, but counted live passes ran only on 2.1.309 and 2.1.310), typing `/cc` while a reply is still streaming, and that 20-real-copy test.
- **Tables, diffs and tool output are not matched.** They are refused.
- **Classic and fullscreen** draw identical rows on 2.1.309 for the window that was tested, and, checked once, on 2.1.310 in the Warp drawing; but the live passes ran only the classic display. In fullscreen the engine takes over the mouse, so selecting text may need a modifier key in your terminal; how selecting and copying work there was not tested.
- **Links and struck-through text.** Claude Code draws these differently depending on the terminal it detects (see How it works): `label (url)` with the `~~` kept, or the label alone with no tildes. `/cc` cannot know which applies, so since 0.1.1 it searches both drawings. Only two profiles were scored: the rig's default (no terminal name set) and Warp (`TERM_PROGRAM=WarpTerminal`); an iTerm run was a screen comparison at one width that matched Warp's. In the Warp-drawn holdout of the rig, all 44 copies that included an inline link and all 36 that included struck text came back exact. The price of not knowing the terminal: a copy that also fits another message under the other drawing is refused as ambiguous. Some drawings are not modelled and are expected to be refused: `[](url)` and `![](url)`, `<mailto:a@b>`, a bare `www.` address in the drawing that shows `label (url)`, `&nbsp;`, a zero-width space inside a word, a link inside a link label, a line or list item that starts with `~~~` or `~~~~` and text, `~~x~~~` next to a link, a nested ordered list that starts at a number other than 1 directly under its parent line, and an ordered list that starts at 0 (or a depth-2 list that starts at 3999). Other constructs may also be refused. In a sweep of the real engine (reported) each of these was a refusal and none gave a wrong slice, but it has not been shown that none can. All of this is about what Claude Code draws; what Warp puts on the clipboard when you select that text is still untested.
- **At least 12 characters** after folding; only the **newest 40 replies** with text are searched.
- **One reply at a time.** A selection that runs from one reply into the next is expected to be refused (one example was checked against the matcher, none in a live session).
- **Unicode forms.** A copy in a different normalization form than the reply (NFD against NFC) is refused. Warp is expected to copy what Claude drew, but that was not tested.
- **A busy machine can make `/cc` refuse.** The clipboard read has a 2 second limit. In two sanity launches on a loaded machine, 3 of 80 copies were refused with `could not read the clipboard`. It never copied wrong text; type `/cc` again.
- **Terminal only.** No desktop app, no VS Code panel.

## Development

Gates, the engine rules, the sealed live-test rig, the real-copy test and the release steps are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md); contributor notes for agents are in [AGENTS.md](AGENTS.md). The main gates are `npm test`, `bash scripts/kit-test.sh`, `claude plugin validate . --strict` and `bash scripts/check-footprint.sh`. There is nothing to install; development needs Node 22.19 or newer. CI runs the suite on Node 22.19.0, 24.x and 26.x on Linux (every pull request) and on 22.19.0 and 24.x on macOS (on every pull request); its first run, on the 0.1.0 tree, passed all of them, and the suite also passes locally on Node 22.23.2 and 26.9.0. A weekly job runs the engine gates against the newest published Claude Code, because the plugin API is early access.

`realrender/probe/` is a scratch plugin the test rig loads. Do not install it.

## Acknowledgements

- `src/replay/baseline.ts`, a comparator used only by the offline replay harness, follows the approach of [claude-clean-copy](https://github.com/kbrianps/claude-clean-copy) by Brian Pravato (MIT, Copyright (c) 2026 Brian Pravato): the same wrap bounds (60 and 240 characters) and a block-start pattern of the same shape. It is a re-implementation, not a copy of that project's code, and the plugin never loads it.
- The inline and block rules in `src/core` follow the behaviour of the [CommonMark specification](https://spec.commonmark.org/).
- The test generators use mulberry32 (a small public random-number generator by Tommy Ettinger) and FNV-1a, a public hash.

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Sairam Ugge.
