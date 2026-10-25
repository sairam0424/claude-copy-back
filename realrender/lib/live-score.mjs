// Scoring one case of the live pass from what was observed during it. Pure.
//
// obs = {
//   attempts,                      1, or 2 after the one allowed retry
//   first,                         the first attempt of a retried case ({toasts, osc52, writers, ...}) or absent;
//                                  its write events count as the case's: nothing the first attempt did is hidden
//   pbpasteCalls,                  calls of the pbpaste shim in the window
//   osc52: [{kind, text, validUtf8}],
//   writers: [{name, text}],       pbcopy / xclip / xsel / wl-copy / osascript shim calls
//   toasts: [{text, truncated}],   distinct toasts seen in the window
// }

import { copiedLine, judgeToast } from "./toast.mjs";

const NONE = Object.freeze({ osc52: [], writers: [] });

/** Every write event of a case as {channel, text} (text null = not valid UTF-8). */
export function writeEvents(obs) {
  const osc = obs.osc52.filter((o) => o.kind === "write").map((o) => ({ channel: "osc52", text: o.validUtf8 ? o.text : null }));
  const shims = obs.writers.map((w) => ({ channel: w.name, text: w.text }));
  return [...osc, ...shims];
}

const accepted = (event, forms) => event.text !== null && forms.includes(event.text.trim());

function toastVerdict(toasts, expectedLine) {
  if (toasts.length === 0) return { verdict: "missing", seen: [] };
  const judged = toasts.map((t) => judgeToast(t, expectedLine));
  const verdict = judged.includes("wrong") ? "wrong" : judged.includes("complete") ? "complete" : "prefix";
  return { verdict, seen: toasts.map((t) => (t.truncated ? `${t.text}…` : t.text)) };
}

function scorePositive(c, obs, events) {
  const exact = events.length > 0 && events.every((e) => accepted(e, c.accepted));
  const wrongPayload = events.some((e) => !accepted(e, c.accepted));
  const payload = events.find((e) => e.text !== null)?.text ?? "";
  const chars = Array.from(payload).length;
  const expectedLine = copiedLine(chars, c.rank);
  return { exact, wrongPayload, untouched: null, expectedLine, ...toastVerdict(obs.toasts, expectedLine), payloadChars: chars };
}

function scoreRefusal(c, obs, events) {
  const untouched = events.length === 0;
  return { exact: null, wrongPayload: !untouched, untouched, expectedLine: c.expectedLine, ...toastVerdict(obs.toasts, c.expectedLine) };
}

/** What the discarded first attempt of a retried case did, as plain facts (null when there was none). */
export function firstAttemptRecord(first) {
  if (!first) return null;
  return {
    pbpasteCalls: first.pbpasteCalls,
    toasts: first.toasts.map((t) => (t.truncated ? `${t.text}…` : t.text)),
    toastAfterMs: first.toastAfterMs ?? null,
    endedBy: first.endedBy ?? null,
    writeEvents: writeEvents(first).length,
    stubRequests: first.stubRequests?.length ?? 0,
    sessionRecordsAdded: first.sessionAdded?.length ?? 0,
  };
}

/** The case's verdicts. `valid` means the pbpaste shim ran exactly once (in the final attempt). */
export function scoreCase(c, obs) {
  const events = [...writeEvents(obs.first ?? NONE), ...writeEvents(obs)];
  const base = scoreFor(c, obs, events);
  return {
    id: c.id, kind: c.kind, refusal: c.refusal ?? null, width: c.width, anchor: c.anchor ?? null, covers: c.covers ?? [],
    nonAscii: Boolean(c.nonAscii), unicode: c.unicode ?? [], attempts: obs.attempts, pbpasteCalls: obs.pbpasteCalls,
    retried: obs.attempts > 1, firstAttempt: firstAttemptRecord(obs.first),
    valid: obs.pbpasteCalls === 1, commandRan: obs.pbpasteCalls >= 1,
    channels: events.map((e) => e.channel), writeEvents: events.length, ...base,
  };
}

function scoreFor(c, obs, events) {
  return c.kind === "positive" ? scorePositive(c, obs, events) : scoreRefusal(c, obs, events);
}
