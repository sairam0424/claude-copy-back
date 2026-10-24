// The notes under a tally verdict: what else was seen while reading, in plain
// words. COUNTS ONLY, never a path, a capture or a message.

/** What the tally was run with. No paths. */
export interface TallyConfig {
  messages: number;
  customRoot: boolean;
  projectFilter: boolean;
}

/** What else the tally was told about the run (not about any verdict). */
export interface TallyExtras {
  /** Verdict files that have no capture. */
  orphanVerdicts?: number;
  /** Transcript files that could not be read (unreadable or over the size limit). */
  transcriptsNotRead?: number;
  /** Assistant messages dropped because their timestamp is missing or not an ISO time with a zone. */
  messagesWithoutTime?: number;
  /** Assistant messages dropped because the record is marked as a sidechain. */
  sidechainMessages?: number;
  /** --project was given and no transcript folder matched it. */
  projectMatchedNothing?: boolean;
  config?: TallyConfig;
}

/** Numbers the notes are about; all counts. */
export interface NoteFacts {
  noWindow: number;
  okToRefuse: number;
  judgedRight: number;
  missed: number;
  suspectMisses: number;
}

type Note = string | null;

const refusalsNote = (f: NoteFacts): Note =>
  f.okToRefuse > f.judgedRight && f.okToRefuse > 0
    ? "Most of your ok verdicts are refusals judged right. They count toward the 70% but not toward the 10 matched and judged right that a PASS needs: look at 'matched and judged right'."
    : null;

const noWindowNote = (f: NoteFacts, x: TallyExtras): Note => {
  if (f.noWindow === 0) return null;
  const why =
    (x.messagesWithoutTime ?? 0) > 0
      ? ` ${x.messagesWithoutTime} message(s) had no usable timestamp (an ISO time with a zone is needed) and were ignored: if that is most of your messages, Claude Code's transcript format may have changed.`
      : "";
  const sidechain =
    (x.sidechainMessages ?? 0) > 0
      ? ` ${x.sidechainMessages} message(s) were left out because they belong to a sidechain.`
      : "";
  return `${f.noWindow} capture(s) had no transcript window. Check --root and --project, and that the capture files were not copied or touched after you saved them (their time is the time of the copy).${why}${sidechain}`;
};

const notReadNote = (x: TallyExtras): Note =>
  (x.transcriptsNotRead ?? 0) > 0
    ? `${x.transcriptsNotRead} transcript file(s) could not be read. If your session is one of them its replies are missing from every window, and its captures will show as misses.`
    : null;

const suspectNote = (f: NoteFacts): Note =>
  f.suspectMisses > 0
    ? `${f.suspectMisses} of the ${f.missed} missed matches had another active session or a short window, so the tool may have looked at the wrong session. A FAIL may be the session choice, not the matcher: pin the session with --project TEXT (part of its transcript folder name) and run again before believing it.`
    : null;

const projectNote = (x: TallyExtras): Note =>
  x.projectMatchedNothing === true
    ? "--project matched no transcript folder, so every capture has no window. Check the spelling (the folder names look like -Users-you-Desktop-project)."
    : null;

export function notesFor(facts: NoteFacts, extras: TallyExtras): string[] {
  return [
    refusalsNote(facts),
    noWindowNote(facts, extras),
    notReadNote(extras),
    suspectNote(facts),
    projectNote(extras),
  ].filter((note): note is string => note !== null);
}
