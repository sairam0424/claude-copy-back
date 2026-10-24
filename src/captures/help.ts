// The help text: the whole workflow in plain words.

export const HELP_TEXT = `copy-back captures: the real-terminal test of the /cc mod

WHY THIS EXISTS
  The offline replay test (scripts/replay.mjs) scores the matcher against a
  simulated screen, so it can only agree with itself. This test uses about 20
  REAL copies from your own terminal (the author uses Warp), each judged by you against what you
  meant to copy. It is the stop-loss for the whole mod: a PASS is real evidence,
  a FAIL means stop or rethink the mod.

THE WORKFLOW
  1. In Claude Code, in your terminal, select a region of a reply with the mouse and
     press Cmd+C. Pick the kinds of regions you really copy, and vary them:
     a wrapped paragraph, a bullet list, a code block, a shell command, a
     numbered list, a heading plus text. At least 10 of the 20 must be regions
     the tool should be able to find (normal reply prose, bullet and numbered
     lists, code blocks); copies from tables or command output cannot count
     toward the 10 matches a PASS needs.
  2. Right away, in ANOTHER terminal tab, save it:
         node scripts/captures.mjs add
     It prints only:  saved 01 (214 characters)
     The file ~/copy-back-captures/01.txt holds exactly your clipboard text.
     Its file time is the moment of the copy: do not move, copy or edit it.
     The folder must be outside every git repository and outside this project;
     add refuses one that is not.
  3. Repeat for about 20 different copies (up to 99 fit).
  4. In your OWN terminal window (never inside Claude Code, never typed with !,
     never from a script), look at every copy and what /cc would have put on
     your clipboard:
         node scripts/captures.mjs run --show
     It prints your own text, so it refuses to run unless its output is a
     terminal.
  5. Judge each capture by writing ok, bad or skip, then the code printed under
     it, into its verdict file. The exact command is printed for you:
         echo ok 1a2b3c4d > ~/copy-back-captures/01.verdict
     ok    the paste text is what you meant to copy. If the tool refused, ok
           means refusing was right (there was nothing it should have found).
     bad   wrong text came back (this is the dangerous case), or the tool
           refused although it should have found your text.
     skip  you cannot tell, or the copy was a mistake. A skip is not counted
           and needs no code.
     The code ties your verdict to what you saw: if the tool answers
     differently later, tally says so and does not call it a pass.
  6. Count the verdicts:
         node scripts/captures.mjs tally
     PASS needs at least 20 judged, at least 70% of them ok, at least 10 of
     them matched and right (the tool returned text and you judged it ok;
     refusals judged right do not count toward the 10), not one dangerous
     result (a bad verdict where the tool returned text), and nothing
     unresolved. A dangerous result is a FAIL at once; so is 20 or more judged
     with under 70% ok. A FAIL is final: do not add copies and count again.
     INSUFFICIENT means fewer than 20 judged, or enough
     judged and enough ok but fewer than 10 matched and right; it says how many
     more of each (a matched and right copy counts toward both). To fix too few
     matches, copy more regions the tool should be able to find (normal reply
     prose, bullet and numbered lists, code blocks; not tables or command
     output), save, show and judge them, then count again. INCOMPLETE means
     something is unresolved: an invalid verdict file, a capture you have not
     judged, a verdict whose code no longer matches, or a judged verdict
     written without its code.
  7. Do not tune the matcher on these captures before you have read the verdict:
     they are test data, and tuning on them makes a pass worthless.

COMMANDS
  add   [--dir DIR]
        Save the clipboard as the next NN.txt (01 to 99). Refuses an empty
        clipboard and a folder inside a git repository or this project. Prints
        only the id and the length.
  run   [--dir DIR] [--root TRANSCRIPTS] [--messages N] [--project TEXT]
        [--show] [--allow-redirect]
        For each NN.txt, rebuild the messages your terminal showed at that
        moment and ask the matcher for the source text. Prints ONE JSON
        document of counts and ids only. --show also prints the texts (below).
  tally [--dir DIR] [--root TRANSCRIPTS] [--messages N] [--project TEXT]
        [--json]
        Read the NN.verdict files, run every capture again, and print counts
        and the K1 verdict. --json prints one JSON document instead of words.

OPTIONS
  --dir DIR         captures folder (default ~/copy-back-captures)
  --root DIR        Claude Code transcripts (default ~/.claude/projects)
  --messages N      how many recent reply messages the matcher may look at,
                    1 to 500 (default 40)
  --project TEXT    only transcript folders whose name contains TEXT (case
                    blind), for example part of your project's folder name
                    under ~/.claude/projects. Use it when other sessions (cron,
                    agents) were active at the same time as the one you copied
                    from; the tally warns when the session choice looks wrong.
                    Use the same value for run and tally.
  --show            run only. USER-RUN ONLY: prints YOUR OWN copied text and
                    the matching reply text. Refuses unless stdout is a
                    terminal. See privacy.
  --allow-redirect  run --show only. Lets it print to a file or a pipe, for
                    example  run --show --allow-redirect > ~/review.txt  when
                    you will read that file yourself. Never point it at
                    anything an agent or a log can read.
  --json            tally only. One JSON document.
  --help, -h        this text

HOW THE MESSAGES ARE CHOSEN
  Only main-session transcripts count (subagent transcripts are skipped). For a
  capture saved at time T, the session whose latest reply at or before T is
  closest to T is used, and the window is its newest N replies at or before T,
  newest first. The run output lists how old the newest reply was and how many
  other sessions were active in the 30 minutes before the copy (or within 5
  minutes of the chosen reply): a guess between sessions shows up there. Only
  messages with an ISO timestamp that has a zone are used; the run output
  counts the ones that were dropped.

PRIVACY
  Your copies are your own text and can hold anything. The captures folder
  defaults to ~/copy-back-captures, outside any repository, created private
  (folder 0700, files 0600). add, run and tally print counts and ids only:
  never a capture, never a reply, not even inside an error message. The one
  exception is run --show: it is USER-RUN ONLY, it announces that on stderr
  first, it refuses to print unless its output is a terminal, and agents,
  scripts and logs must not run it. Nothing is sent anywhere; no model is
  called.
`;
