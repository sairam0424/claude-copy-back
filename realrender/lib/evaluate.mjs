// Runs the matcher on prepared captures and on the negative controls. This is
// the ONLY module of the measurement that imports the matcher.

import { findSource } from "../../src/core/match.ts";
import { classify } from "./score.mjs";

/** Messages newest first, as findSource wants them. */
export const newestFirst = (texts) => texts.slice().reverse();

/** A window without message `index` (plain removal), or with its twin in its place. */
export function controlWindows(texts, index, twinText) {
  const without = texts.filter((_, i) => i !== index);
  const twin = texts.map((t, i) => (i === index ? twinText : t));
  return { without: newestFirst(without), twin: newestFirst(twin) };
}

/** Score one capture's copied text against the real window and both control windows. */
export function evaluate(cap, copied, texts, twinText, find = findSource) {
  const result = find(copied, newestFirst(texts));
  const scored = classify(result, cap);
  const windows = controlWindows(texts, cap.message, twinText);
  const withoutOk = find(copied, windows.without).ok;
  const twinOk = find(copied, windows.twin).ok;
  return {
    ...scored,
    matchedMessage: result.ok ? texts.length - 1 - result.messageIndex : null,
    control: { withoutOk, twinOk, falsePositive: withoutOk || twinOk },
  };
}

/** The matcher's answer for a copy against the whole window (messages in session order, newest last). */
export function lookup(copied, texts, find = findSource) {
  return find(copied, newestFirst(texts));
}

/** A copy that holds a full digit run of a token (so a twin, with other digits, cannot hold it). */
export const hasTokenDigits = (copied) => /\d{4}/.test(copied);
