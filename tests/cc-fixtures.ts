// Synthetic fixtures shared by the /cc tests: the node:test unit tests and the
// engine-kit tests (tests/kit) import this one file. Everything here is made
// up. The canary is a marker string the privacy tests plant in the clipboard
// and in the messages, then look for in every place a text must never reach.

export const CANARY = "zq7canary8841";

export interface Row {
  role: "user" | "assistant";
  text: string;
  toolUses: unknown[];
}

export function row(
  role: Row["role"],
  text: string,
  toolUses: unknown[] = [],
): Row {
  return { role, text, toolUses };
}

/** A reply with a heading, a paragraph, a list and a fenced command. */
export const REPLY_MAIN = [
  "## Rollout notes",
  "",
  "The rollout failed because the readiness probe timed out after thirty seconds. Restart the pods with `kubectl rollout restart deployment/api` and watch the events.",
  "",
  "- first check the logs",
  "- then check the probe path",
  "",
  "```sh",
  "kubectl rollout status deployment/api --timeout=120s",
  "```",
].join("\n");

/** An older reply that shares no words with REPLY_MAIN. */
export const REPLY_OLDER =
  "An older reply about something else entirely, with different words and no overlap here.";

/** What a terminal gives back for a drag over the paragraph: margin and hard wraps. */
export const COPY_PROSE = [
  "  The rollout failed because the readiness probe timed out after thirty",
  "  seconds. Restart the pods with kubectl rollout restart deployment/api and",
  "  watch the events.",
].join("\n");

/** The exact paste the matcher gives for COPY_PROSE against REPLY_MAIN. */
export const PASTE_PROSE =
  "The rollout failed because the readiness probe timed out after thirty seconds. Restart the pods with `kubectl rollout restart deployment/api` and watch the events.";

export const COPY_CODE =
  "  kubectl rollout status deployment/api --timeout=120s";
export const PASTE_CODE =
  "kubectl rollout status deployment/api --timeout=120s";

/** The same sentence twice with different markup: two slices, so ambiguous. */
export const REPLY_TWICE =
  "Restart the deployment and wait for the rollout now.\n\nLater on: Restart the **deployment** and wait for the rollout now.";
export const COPY_TWICE =
  "Restart the deployment and wait for the rollout now.";

/** Accents, dash, arrow, CJK and emoji, as one source line. */
export const REPLY_UNICODE =
  "Café résumé — naïve façade → next step: 日本語のテキストと絵文字 🚀🎉 are kept exactly as written here.";
export const COPY_UNICODE =
  "  Café résumé — naïve façade → next step: 日本語のテキストと絵文字 🚀🎉 are kept\n  exactly as written here.";

/** A reply and a copy that both carry the canary inside the matched words. */
export const REPLY_CANARY = `Notes for the team: the marker ${CANARY} stays inside this sentence about deployments and nothing else.`;
export const COPY_CANARY = `  Notes for the team: the marker ${CANARY} stays inside this\n  sentence about deployments and nothing else.`;
export const PASTE_CANARY = `Notes for the team: the marker ${CANARY} stays inside this sentence about deployments and nothing else.`;

/** A copy that matches nothing, with the canary in it. */
export const COPY_STRANGER = `Some text from another app that carries ${CANARY} but is in no reply.`;

/**
 * A reply with a two-line blockquote and a two-line indented code block. In
 * both, the matcher's `source` (the exact slice) keeps the container's prefix
 * or indentation on the later line and its `paste` form drops it, so a run
 * that wrote `source` would put "> " or four spaces into the person's paste.
 */
export const REPLY_CONTAINERS = [
  "Before the quote.",
  "",
  "> The readiness probe timed out after thirty seconds, so the pods restarted.",
  "> Check the events before you scale the deployment up again.",
  "",
  "Run this next:",
  "",
  "    kubectl rollout restart deployment/api",
  "    kubectl rollout status deployment/api --timeout=120s",
  "",
  "After the code.",
].join("\n");

/** What a terminal gives back for the two quote lines: margin, quote bar, hard rows. */
export const COPY_QUOTE = [
  "  ▎ The readiness probe timed out after thirty seconds, so the pods restarted.",
  "  ▎ Check the events before you scale the deployment up again.",
].join("\n");
export const PASTE_QUOTE =
  "The readiness probe timed out after thirty seconds, so the pods restarted.\nCheck the events before you scale the deployment up again.";
/** The exact source slice of the same selection: the second line keeps its "> ". */
export const SOURCE_QUOTE =
  "The readiness probe timed out after thirty seconds, so the pods restarted.\n> Check the events before you scale the deployment up again.";

export const COPY_INDENTED = [
  "      kubectl rollout restart deployment/api",
  "      kubectl rollout status deployment/api --timeout=120s",
].join("\n");
export const PASTE_INDENTED =
  "kubectl rollout restart deployment/api\nkubectl rollout status deployment/api --timeout=120s";
/** The exact source slice of the same selection: the second line keeps its four spaces. */
export const SOURCE_INDENTED =
  "kubectl rollout restart deployment/api\n    kubectl rollout status deployment/api --timeout=120s";
