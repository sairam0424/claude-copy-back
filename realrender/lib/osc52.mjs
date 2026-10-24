// Finds OSC 52 clipboard writes in the raw bytes a program wrote to its pty
// and decodes their payload. Pure. A write looks like
//   ESC ] 52 ; <selection> ; <base64> (BEL | ESC \)
// possibly wrapped for tmux (ESC P tmux ; <the same with every ESC doubled> ESC \).

const OSC52 = /(?:\x1b\x1b|\x1b)\]52;([^;\x07\x1b]*);([^\x07\x1b]*)(?:\x07|\x1b\x1b\\|\x1b\\)/g;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Strict UTF-8 decode of bytes; null when invalid. */
function utf8(buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function decodePayload(payload) {
  if (payload === "?") return { kind: "query", text: null, validUtf8: true, bytes: 0 };
  if (!BASE64.test(payload) || payload.length % 4 !== 0) {
    return { kind: "malformed", text: null, validUtf8: false, bytes: 0 };
  }
  const bytes = Buffer.from(payload, "base64");
  const text = utf8(bytes);
  return { kind: "write", text, validUtf8: text !== null, bytes: bytes.length };
}

/**
 * Every OSC 52 sequence in `buffer`, in order.
 * @param {Buffer} buffer raw pty bytes
 * @param {number} [baseOffset] byte offset of `buffer[0]` in the whole stream
 * @returns {Array<{offset:number, selection:string, kind:string, text:string|null, validUtf8:boolean, bytes:number}>}
 */
export function findOsc52(buffer, baseOffset = 0) {
  const raw = buffer.toString("latin1");
  const found = [];
  for (const m of raw.matchAll(OSC52)) {
    found.push({ offset: baseOffset + m.index, selection: m[1], ...decodePayload(m[2]) });
  }
  return found;
}
