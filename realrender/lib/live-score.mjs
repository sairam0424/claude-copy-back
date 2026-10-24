// Scoring one case of the live pass from what was observed during it. Pure.
//
// obs = {
//   attempts,                      1, or 2 after the one allowed retry
//   pbpasteCalls,                  calls of the pbpaste shim in the window
//   osc52: [{kind, text, validUtf8}],
//   writers: [{name, text}],       pbcopy / xclip / xsel / wl-copy / osascript shim calls
//   toasts: [{text, truncated}],   distinct toasts seen in the window
// }

import { copiedLine, judgeToast } from "./toast.mjs";

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

/** The case's verdicts. `valid` means the pbpaste shim ran exactly once. */
export function scoreCase(c, obs) {
  const events = writeEvents(obs);
  const base = scoreFor(c, obs, events);
  return {
    id: c.id, kind: c.kind, refusal: c.refusal ?? null, width: c.width, anchor: c.anchor ?? null, covers: c.covers ?? [],
    nonAscii: Boolean(c.nonAscii), unicode: c.unicode ?? [], attempts: obs.attempts, pbpasteCalls: obs.pbpasteCalls,
    valid: obs.pbpasteCalls === 1, commandRan: obs.pbpasteCalls >= 1,
    channels: events.map((e) => e.channel), writeEvents: events.length, ...base,
  };
}

function scoreFor(c, obs, events) {
  return c.kind === "positive" ? scorePositive(c, obs, events) : scoreRefusal(c, obs, events);
}
