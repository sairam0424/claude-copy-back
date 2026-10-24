// What the rows probe (realrender/probe/hooks/register.tsx) should report for
// the synthetic session the rig wrote. Pure: the same FNV-1a over UTF-16 code
// units as the probe, and the reader of its toast line.

/** FNV-1a (32-bit) over each text's UTF-16 code units, with a separator unit of 1 after each text. */
export function fnv(texts) {
  let h = 0x811c9dc5;
  for (const text of texts) {
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    h = Math.imul(h ^ 1, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The fields the probe should show for session turns [{role, text}] (assistant texts in order). */
export function expectedProbe(turns) {
  const assistant = turns.filter((t) => t.role === "assistant").map((t) => t.text);
  const roles = turns.map((t) => (t.role === "user" ? "u" : "a"));
  return {
    rows: turns.length,
    a: assistant.length,
    u: turns.length - assistant.length,
    e: turns.filter((t) => t.text === "").length,
    alt: roles.every((r, i) => r === (i % 2 === 0 ? "u" : "a")) ? 1 : 0,
    f: roles[0],
    l: roles.at(-1),
    fnv: fnv(assistant),
    fnvNewestFirst: fnv(assistant.slice().reverse()),
    len: assistant.reduce((n, t) => n + t.length, 0),
  };
}

/** Parse "rows=80 a=40 ... k=a,b" from a toast line into an object (numbers kept as strings except counts). */
export function parseProbeToast(line) {
  const at = line.indexOf("rows=");
  if (at < 0) return null;
  const pairs = line.slice(at).replace(/…$/, "").split(" ").map((kv) => kv.split("="));
  return Object.fromEntries(pairs.filter((p) => p.length === 2));
}
