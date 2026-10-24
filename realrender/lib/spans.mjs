// Intended spans and their expected results, from the GENERATOR only.
//
// A span is a range of tokens i..j of a message source. Its expected result is
//   source.slice(tokenStart(i) + startOffset, tokenEnd(j) - endCut)
// (markers between the tokens included, markers outside excluded). This file
// imports nothing from the matcher or the simulator (a test enforces it).

import { Rng } from "./prng.mjs";

export const MIN_SRC = 12;
export const MAX_SRC = 420;
export const TABLE = "table";

const byStart = (a, b) => a.start - b.start;

/** Message tokens in source order (a copy; the message is not changed). */
export const sortedTokens = (msg) => msg.tokens.slice().sort(byStart);

/** Block kinds and inline feature kinds that the source range [start, end) touches. */
export function coverage(msg, start, end) {
  const touches = (x) => x.from < end && x.to > start;
  return {
    blocks: [...new Set(msg.blocks.filter(touches).map((b) => b.kind))],
    features: [...new Set(msg.features.filter(touches).map((f) => f.kind))],
  };
}

function pieceOf(msg, line, start, end, first) {
  const piece = msg.text.slice(Math.max(start, line.from), Math.min(end, line.to));
  if (first) return piece;
  return { piece, strip: line.marker ? 0 : line.prefix };
}

/**
 * Every acceptable paste form of the expected slice: the container prefix
 * (list indentation, "> ", fence indentation) removed from the lines after the
 * first, lines that hold a list marker left alone. Variants: the 4-space
 * indentation of an indented code block kept or removed, and the "> " of a
 * list line inside a quote kept or removed. The plain slice is also accepted.
 */
export function pasteForms(msg, start, end) {
  const lines = msg.lines.filter((l) => l.from < end && l.to >= start);
  const forms = new Set([msg.text.slice(start, end).trim()]);
  for (const keepSoft of [false, true]) {
    for (const stripQuoteMarker of [false, true]) {
      const out = lines.map((line, k) => {
        const p = pieceOf(msg, line, start, end, k === 0);
        if (k === 0) return p;
        let strip = p.strip;
        if (line.marker && line.quote && stripQuoteMarker) strip = Math.min(2, line.prefix);
        if (line.soft && keepSoft) strip = 0;
        return p.piece.slice(Math.min(strip, p.piece.length));
      });
      forms.add(out.join("\n").trim());
    }
  }
  return [...forms];
}

/** Anchors for a class: [{index into sorted tokens, mustPass}]; mustPass is the source offset a span must reach beyond. */
function anchorsFor(msg, sorted, cls, locatable) {
  if (cls === "rule") {
    return msg.blocks.filter((b) => b.kind === "rule").flatMap((b) => {
      const before = sorted.map((t, i) => [t, i]).filter(([t]) => t.end <= b.from && locatable.has(t.id));
      return before.length ? [{ index: before.at(-1)[1], mustPass: b.to, rule: b }] : [];
    });
  }
  return sorted.flatMap((t, i) => (t.block === cls && locatable.has(t.id) ? [{ index: i, mustPass: 0 }] : []));
}

/** One span from an anchor, or null when the draw does not fit the limits. */
function drawSpan(msg, sorted, anchor, locatable, rng) {
  const first = sorted[anchor.index];
  const startOffset = rng.chance(0.4) ? rng.int(1, Math.max(1, first.wordLen - 1)) : 0;
  const start = first.start + startOffset;
  const target = rng.logInt(MIN_SRC, 400);
  let j = sorted.findIndex((t, k) => k > anchor.index && locatable.has(t.id) && t.end - start >= target && t.start >= anchor.mustPass);
  if (j < 0) j = sorted.findLastIndex((t, k) => k > anchor.index && locatable.has(t.id) && t.start >= anchor.mustPass);
  if (j < 0) return null;
  const last = sorted[j];
  const endCut = rng.chance(0.4) ? rng.int(1, last.id.length - 3) : 0;
  const end = last.end - endCut;
  if (end - start < MIN_SRC || end - start > MAX_SRC) return null;
  if (anchor.rule && !(start < anchor.rule.from && end > anchor.rule.to)) return null;
  return { first, last, startOffset, endCut, start, end };
}

/**
 * Choose `count` captures for one width, spread over the construct classes in
 * `classes` (round-robin from a shuffled order) so each class gets a share.
 * @param {object} o
 * @param {object[]} o.messages generator messages (index order)
 * @param {Set<string>} o.locatable token ids found exactly once on this screen
 * @param {number} o.seed
 * @param {number} o.count
 * @param {string[]} o.classes
 */
export function chooseSpans({ messages, locatable, seed, count, classes }) {
  const rng = new Rng(seed);
  const order = rng.shuffled(classes);
  const sortedByMsg = messages.map(sortedTokens);
  const seen = new Set();
  const out = [];
  for (let k = 0; out.length < count && k < count * 40; k += 1) {
    const cls = order[out.length % order.length];
    const pool = messages.flatMap((msg, mi) => anchorsFor(msg, sortedByMsg[mi], cls, locatable).map((a) => ({ mi, a })));
    if (!pool.length) continue;
    const { mi, a } = rng.pick(pool);
    const msg = messages[mi];
    const drawn = drawSpan(msg, sortedByMsg[mi], a, locatable, rng);
    if (!drawn) continue;
    const cov = coverage(msg, drawn.start, drawn.end);
    const key = `${mi}:${drawn.start}:${drawn.end}`;
    if (cov.blocks.includes(TABLE) || seen.has(key)) continue;
    seen.add(key);
    out.push(record(msg, cls, drawn, cov));
  }
  return out;
}

function record(msg, cls, d, cov) {
  return {
    message: msg.index,
    anchor: cls,
    startToken: d.first.id,
    endToken: d.last.id,
    startOffset: d.startOffset,
    endCut: d.endCut,
    start: d.start,
    end: d.end,
    expected: msg.text.slice(d.start, d.end),
    pasteForms: pasteForms(msg, d.start, d.end),
    covers: cov.blocks,
    features: cov.features,
    startMode: d.startOffset ? "mid-word" : "word-start",
    endMode: d.endCut ? "mid-word" : "word-end",
    length: d.end - d.start,
  };
}
