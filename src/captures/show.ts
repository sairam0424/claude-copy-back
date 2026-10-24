// `run --show`: the ONLY place that prints text. USER-RUN ONLY.
// It prints the person's own copied text and the text /cc would paste, so they
// can judge each one. The banner goes to stderr before anything else, and the
// command refuses to print to anything but a terminal (cli.ts) unless asked.
//
// Both texts are printed with control characters made visible (\x1b and so
// on): the pasted text comes from model output, and a raw escape sequence can
// retitle the window, clear the screen or silently replace the clipboard.

import path from "node:path";
import type { Shown } from "./run.ts";

export const SHOW_BANNER = `copy-back: run --show is USER-RUN ONLY.
It prints YOUR OWN copied text and the matching reply text to this terminal, and that text can hold secrets.
Agents, scripts and logs must NOT run it. Plain run and tally print counts and ids only.
`;

const LEGEND = `HOW TO JUDGE: for each capture write ok, bad or skip, then the code printed under it, into DIR/NN.verdict (this tool creates nothing for you).
  ok    the paste text is what you meant to copy; or it says "refused" and refusing was right
  bad   wrong text came back (dangerous), or it refused although it should have found your text
  skip  you cannot tell, or the copy was a mistake (not counted)
The code (8 characters) ties your verdict to what you saw here: if the tool answers differently later, tally says so and does not call it a pass.
Control characters in the texts below are shown as \\xNN so that they cannot act on your terminal.
`;

/** C0 controls except newline and tab, DEL and C1 controls, as \xNN. */
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export function escapeControls(text: string): string {
  return text.replace(
    CONTROL,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}

const withNewline = (text: string): string =>
  text.endsWith("\n") ? text : `${text}\n`;

/** A path as one word for a shell: single quotes, with any inner quote escaped. */
function quoted(file: string): string {
  return `'${file.replace(/'/g, `'\\''`)}'`;
}

function blockOf(item: Shown, dir: string): string {
  const { id } = item;
  const verdictFile = path.join(dir, `${id}.verdict`);
  const lines = [
    `===== capture ${id}: ${item.kind} =====`,
    `----- BEGIN COPIED ${id} (exactly as saved) -----`,
    withNewline(escapeControls(item.copied)) + `----- END COPIED ${id} -----`,
  ];
  if (item.paste === null)
    lines.push(`(nothing would be pasted: refused: ${item.kind})`);
  else
    lines.push(
      `----- BEGIN PASTE ${id} (what /cc would put on your clipboard) -----`,
      withNewline(escapeControls(item.paste)) + `----- END PASTE ${id} -----`,
      `The paste text differs from the exact source slice: ${item.differsFromExact === true ? "yes (container indentation or quote marks were dropped)" : "no"}`,
    );
  lines.push(
    `Judge ${id}: write ok, bad or skip, then this code ${item.code}, for example:  echo ok ${item.code} > ${quoted(verdictFile)}`,
    "",
  );
  return lines.join("\n");
}

/** Every capture as a delimited block, after a short legend. */
export function renderShow(shown: readonly Shown[], dir: string): string {
  return [LEGEND, ...shown.map((item) => blockOf(item, dir))].join("\n");
}
