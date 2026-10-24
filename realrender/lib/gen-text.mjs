// Text helpers shared by the template families: ordinary words mixed with
// unique tokens, sentences, and source-level hard wrapping.

/**
 * Build the context a block builder writes through.
 * @param {import("./prng.mjs").Rng} rng
 * @param {import("./gen-core.mjs").Doc} doc
 * @param {import("./gen-core.mjs").Mint} mint
 * @param {string[]} vocab ordinary words
 */
export function makeCtx(rng, doc, mint, vocab) {
  const tok = (...flags) => mint.next(rng, flags);
  const words = (n) => Array.from({ length: n }, () => rng.pick(vocab)).join(" ");
  /** n word slots; about `dense` of them are unique tokens (at least one). */
  const phrase = (n, { dense = 0.3, flags = [] } = {}) => {
    const out = Array.from({ length: n }, () => (rng.chance(dense) ? tok(...flags) : rng.pick(vocab)));
    if (!out.some((w) => /\d{4}$/.test(w))) out[rng.int(0, n - 1)] = tok(...flags);
    return out.join(" ");
  };
  const sentence = (lo, hi, opts) => {
    const text = phrase(rng.int(lo, hi), opts);
    const first = text.split(" ", 1)[0];
    const head = /\d{4}$/.test(first) ? first.charAt(0) : first.charAt(0).toUpperCase(); // never alter a token
    return head + text.slice(1) + rng.pick([".", ".", ".", ":"]);
  };
  return { rng, doc, tok, words, phrase, sentence };
}

/** Break `text` at spaces into source lines no longer than `width` (a soft-wrapped paragraph). */
export function hardWrap(text, width) {
  const out = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(line);
  return out;
}

/** Write a paragraph of `text`, soft-wrapped in the source when `wrapAt` is given. */
export function writeParagraph(doc, text, wrapAt, opts = {}) {
  const rows = wrapAt ? hardWrap(text, wrapAt) : [text];
  rows.forEach((row, i) => doc.line(row, i === 0 ? { marker: opts.marker ?? false, prefix: 0 } : { prefix: opts.indent ?? 0 }));
}

export const FENCE = "```";
