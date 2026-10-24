# Testing /cc on your real copies

This is the one test that can stop or approve the whole idea. The offline tests could only agree with themselves, because the matcher and the screen simulator share one model of how Claude Code draws text; this test uses what Warp really copies, judged by you. It takes about 30 minutes.

**Privacy, in two sentences.** Your copies stay in a private folder on this Mac (`~/copy-back-captures`, readable only by you, kept outside every git repository and this project), and nothing is sent anywhere or shown to any model. The commands `add`, `run` and `tally` print only counts and numbers; the single command that prints your text is `run --show`, which refuses to print unless it is running in your own terminal window, and which no agent or script should ever run.

All commands are run from the repository root (the folder that holds `scripts/` and `src/`). `node scripts/captures.mjs --help` explains everything again.

## Steps

1. **Plan about 20 copies.** Use replies from your Claude Code sessions in Warp, and copy the kinds of regions you really copy. Vary them: a wrapped paragraph, a bullet list, a code block, a shell command, a numbered list, a heading plus text. Do not pick easy ones on purpose; the test is only worth something if it is your normal use. **At least 10 of the 20 must be regions the tool should be able to find** (normal reply prose, bullet and numbered lists, code blocks), because a PASS needs at least 10 matched and right. Copies from tables or command output are fine to add as well, but they cannot count toward those 10.

2. **Copy one.** In Claude Code, select a region of a reply with the mouse and press **Cmd+C**, as you always do.

3. **Save it right away.** In a second terminal tab run:
   ```
   node scripts/captures.mjs add
   ```
   It prints only `saved 01 (214 characters)`. If it says the clipboard is empty, copy again. The file `~/copy-back-captures/01.txt` holds exactly your clipboard, and its file time is the moment of the copy, so do not edit, move or copy these files. `add` refuses a `--dir` that sits inside a git repository or this project, so your copies cannot end up in a commit.

4. **Repeat steps 2 and 3** until you have at least 20 (up to 99 fit). Do them in one sitting, or within a day or two, and leave your Claude Code transcripts alone (the tool finds the reply by the time you copied).

5. **Look at them, in your own terminal window.**
   ```
   node scripts/captures.mjs run --show
   ```
   For each capture you see what you copied, and the text `/cc` would have put on your clipboard instead (or why it refused). This prints your own text, so run it yourself, on your own screen: **never run it inside Claude Code, and never type it with a leading `!`**, because that would send all your copies into the conversation and its saved transcript. It refuses to print unless its output is a terminal. (To write it to a file that only you will read, add `--allow-redirect`.)

6. **Judge each one.** Under every capture, `run --show` prints the exact command to copy. Write `ok`, `bad` or `skip`, then the short code it printed, into that capture's verdict file:
   ```
   echo ok 1a2b3c4d > ~/copy-back-captures/01.verdict
   ```
   - `ok`: the text under "what /cc would put on your clipboard" is what you meant to copy. If the tool refused and refusing was right (for example you copied from a table or from a command's output), that is also `ok`.
   - `bad`: it gave you the wrong text, or it refused although it should have found your text.
   - `skip`: you cannot tell, or the copy was a mistake. A skip is not counted and needs no code.

   The code ties your verdict to what you saw. If the tool answers differently later, `tally` tells you instead of counting the old verdict.

7. **Count.**
   ```
   node scripts/captures.mjs tally
   ```
   It prints counts only and one verdict line:
   - **PASS**: at least 20 judged, at least 70% of them `ok`, at least 10 of them matched and right (the tool returned text and you judged it `ok`; refusals judged right do not count toward the 10), no dangerous result (a `bad` where the tool did return text), and nothing unresolved. This is the real evidence the mod works on your terminal. The 10 are there so that a tool which refuses everything cannot pass.
   - **INSUFFICIENT**: fewer than 20 judged, or 20 or more judged and at least 70% `ok` but fewer than 10 matched and right. It says how many more of each you need, and a matched and right copy counts toward both. If you are short of matches, copy more regions the tool should be able to find: normal reply prose, bullet and numbered lists, code blocks (not tables and not command output: the tool is not expected to find those). Save each with `add`, look at it with `run --show`, judge it, and run `tally` again. Go back to step 2.
   - **INCOMPLETE**: something is unresolved. It names the numbers: a verdict file that is not `ok`, `bad` or `skip`, a capture you have not judged (write `skip` if you cannot tell), a verdict whose code no longer matches, or a judged verdict written without its code. Fix those and run `tally` again.
   - **FAIL**: stop or rethink the mod. One dangerous result is a FAIL at once, however few you have judged. So is 20 or more judged with under 70% `ok`, however many matches you have. **A FAIL is final: do not add copies and count again to turn it into a pass.**

   These 20 copies are test data: do not tune the matcher on them before you have read the verdict, or a pass means nothing.

8. **If something looks odd.** `no-window` means the tool found no Claude Code session for that moment: check that the capture files were not moved or copied, and that `~/.claude/projects` still holds the session. `rivalSessions` above 0 in the `run` output means other sessions (cron jobs, agents) were active around the same time and the tool had to guess which one you were reading; `tally` warns when that may be behind a FAIL. Pin the session with `--project TEXT` (part of its folder name under `~/.claude/projects`) on both `run` and `tally`. You can rerun `run` and `tally` as often as you like; they change nothing.
