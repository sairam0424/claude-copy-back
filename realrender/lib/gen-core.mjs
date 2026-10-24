// Ground-truth message builder. A message is written line by line through a
// Doc; every unique token is minted through a Mint. After finish() the message
// knows, from the GENERATOR alone (never from the matcher or the simulator):
//   text       the markdown source
//   tokens     every unique token with its [start, end) offsets in `text`
//   blocks     [{kind, from, to}] the construct blocks, by source offsets
//   lines      [{from, to, prefix, marker}] every source line: how many leading
//              characters are container prefix (list indent, "> "), and whether
//              the line starts a list item (its marker is kept in a paste form)
//   features   [{kind, from, to}] inline features (bold, link, ...)
//
// Tokens look like "gadget0412": a word plus four digits, unique per set, so
// any token seen on a screen names its position in the source. This file must
// not import anything from src/ (a test enforces it).

const DIGITS = 4;

/** Mints unique tokens. A twin Mint with another `base` yields the same words and other digits. */
export class Mint {
  constructor(base, words) {
    this.n = base;
    this.words = words;
    this.meta = new Map();
  }

  /** The next token. The word comes from `rng` so a twin run draws the same words. */
  next(rng, flags = []) {
    const word = rng.pick(this.words);
    const id = `${word}${String(this.n).padStart(DIGITS, "0")}`;
    this.n += 1;
    this.meta.set(id, { flags, wordLen: word.length });
    return id;
  }
}

/** Line-oriented document under construction. */
export class Doc {
  constructor() {
    this.rows = [];
    this.openBlock = null;
    this.blockList = [];
    this.pending = [];
  }

  begin(kind) {
    this.openBlock = { kind, first: this.rows.length };
  }

  /**
   * Add one source line. `prefix`: container characters at its start; `marker`:
   * starts a list item; `soft`: the prefix is an indented-code block's own
   * indentation (a paste form may keep it); `quote`: a list item inside a quote.
   */
  line(text, { prefix = 0, marker = false, soft = false, quote = false } = {}) {
    this.rows.push({ text, prefix, marker, soft, quote });
  }

  /** Register an inline feature by the unique text it contains (found again after finish). */
  feature(kind, text) {
    this.pending.push({ kind, text });
    return text;
  }

  /** Close the block, then leave one blank line. */
  end() {
    this.openBlock.last = this.rows.length - 1;
    this.blockList.push(this.openBlock);
    this.openBlock = null;
    this.rows.push({ text: "", prefix: 0, marker: false, soft: false, quote: false });
  }

  finish() {
    const rows = this.rows.slice();
    while (rows.length && rows[rows.length - 1].text === "") rows.pop();
    const lines = [];
    let at = 0;
    for (const r of rows) {
      lines.push({ from: at, to: at + r.text.length, prefix: r.prefix, marker: r.marker, soft: r.soft, quote: r.quote });
      at += r.text.length + 1;
    }
    const text = rows.map((r) => r.text).join("\n");
    const blocks = this.blockList.map((b) => ({
      kind: b.kind,
      from: lines[b.first].from,
      to: lines[Math.min(b.last, lines.length - 1)].to,
    }));
    const features = this.pending.map((f) => locateOnce(text, f.text, f.kind));
    return { text, lines, blocks, features };
  }
}

/** Where an inline feature sits. A soft wrap in the source may have turned a space into a line break (and list indentation). */
function locateOnce(text, needle, kind) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "[ \\n]+ *");
  const hits = [...text.matchAll(new RegExp(escaped, "g"))];
  if (hits.length !== 1) throw new Error(`feature text found ${hits.length} times: ${needle}`);
  const from = hits[0].index;
  return { kind, from, to: from + hits[0][0].length };
}

/** Find every minted token in `text` (each must occur exactly once, with non-alphanumeric neighbours). */
export function locateTokens(text, mint, ids) {
  return ids.map((id) => {
    const start = text.indexOf(id);
    if (start < 0) throw new Error(`token ${id} is not in the text`);
    if (text.lastIndexOf(id) !== start) throw new Error(`token ${id} occurs twice`);
    const end = start + id.length;
    if (/[A-Za-z0-9]/.test(text[start - 1] ?? " ") || /[A-Za-z0-9]/.test(text[end] ?? " ")) {
      throw new Error(`token ${id} is glued to a neighbour`);
    }
    const { flags, wordLen } = mint.meta.get(id);
    return { id, start, end, wordLen, flags };
  });
}

/** The kind of the block containing `offset`, or null. */
export function blockAt(blocks, offset) {
  const hit = blocks.find((b) => offset >= b.from && offset < b.to);
  return hit ? hit.kind : null;
}
