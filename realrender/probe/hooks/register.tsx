import type { Register } from "claude-code";

// Rig-only probe, not part of the /cc plugin. /probe reads the session rows
// once and shows COUNTS and a checksum in a toast: how many rows, how many of
// each role, whether the roles alternate, which keys a row has, the summed
// text length and an FNV-1a checksum of the assistant texts in the order the
// engine returns them. The harness compares those numbers with the synthetic
// session it wrote. No text is shown, kept or sent anywhere.

type Row = { role?: unknown; text?: unknown } & Record<string, unknown>;

function fnv(chunks: string[]): string {
  let h = 0x811c9dc5;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      h = Math.imul(h ^ chunk.charCodeAt(i), 0x01000193) >>> 0;
    }
    h = Math.imul(h ^ 1, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function describe(rows: readonly Row[]): string {
  const roles = rows.map((r) => (r.role === "user" ? "u" : r.role === "assistant" ? "a" : "?"));
  const alternating = roles.every((r, i) => r === (i % 2 === 0 ? "u" : "a"));
  const texts = rows.filter((r) => r.role === "assistant").map((r) => String(r.text ?? ""));
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].sort().join(",");
  const empty = rows.filter((r) => typeof r.text !== "string" || r.text === "").length;
  const length = texts.reduce((n, t) => n + t.length, 0);
  return `rows=${rows.length} a=${roles.filter((r) => r === "a").length} u=${roles.filter((r) => r === "u").length} e=${empty} alt=${alternating ? 1 : 0} f=${roles[0] ?? "-"} l=${roles.at(-1) ?? "-"} fnv=${fnv(texts)} len=${length} k=${keys}`;
}

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    await $.command.register({ name: "probe", description: "counts about the session rows", immediate: true });
    return next(e);
  });
  on("command.run", { command: "probe" }, async ($) => {
    const rows = (await $.session.messages()) as unknown as Row[];
    $.ui.toast(`probe ${describe(rows)}`);
    return {};
  });
};
