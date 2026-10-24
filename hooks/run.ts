// The body of /cc against the live engine: hands hooks/cc.ts the four engine
// calls (through the seam in api.ts) and answers the command with `{}`.
//
// `{}` matters: a command's returned `text` is printed in the transcript and
// Claude reads it, so anything returned here would put a line in front of the
// model. The person's feedback is the toast, which the model never sees.

import { history, notify, pbpaste, toClip } from "./api.ts";
import type { Io } from "./api.ts";
import { runCc } from "./cc.ts";

export async function runCommand($: Io): Promise<Record<string, never>> {
  await runCc({
    readClipboard: () => pbpaste($),
    getMessages: () => history($),
    copy: (text) => toClip($, { text }),
    toast: (text) => notify($, text),
  });
  return {};
}
