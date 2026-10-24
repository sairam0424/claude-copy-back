// Builds a set of synthetic assistant messages (the "window") from a template
// family and a seed, and the twin of any message (same words and shape, other
// token digits) used by the negative control. Everything here is ground truth
// computed from the generator; nothing imports the matcher.

import { Doc, Mint, blockAt, locateTokens } from "./gen-core.mjs";
import { makeCtx } from "./gen-text.mjs";
import { Rng, mixSeed } from "./prng.mjs";

/** Token digits of a twin are shifted by this (sets never hold this many tokens). */
export const TWIN_SHIFT = 5000;
export const WINDOW_SIZE = 40;

/** The block kinds of one message: the featured class first in random company, with markdown-safe neighbours. */
export function planBlocks(family, rng, featured) {
  const picks = [featured, ...Array.from({ length: rng.int(2, 4) }, () => rng.pick(family.classes))];
  const out = [];
  for (const kind of rng.shuffled(picks)) {
    if (family.needsParaBefore.includes(kind) && out.at(-1) !== "para") out.push("para");
    out.push(kind);
    if (family.needsParaAfter.includes(kind)) out.push("para");
  }
  return out;
}

/** One message. `tokenStart` is the first token number it may use. */
export function buildMessage(family, { seed, index, tokenStart }) {
  const rng = new Rng(mixSeed(seed, index));
  const mint = new Mint(tokenStart, family.tokenWords);
  const doc = new Doc();
  const ctx = makeCtx(rng, doc, mint, family.vocab);
  const featured = family.classes[index % family.classes.length];
  const plan = planBlocks(family, rng, featured);
  for (const kind of plan) family.build[kind](ctx);
  const built = doc.finish();
  const tokens = locateTokens(built.text, mint, [...mint.meta.keys()]).map((t) => ({
    ...t,
    block: blockAt(built.blocks, t.start),
  }));
  return { index, featured, plan, tokenStart, tokenEnd: mint.n, tokens, ...built };
}

/** A whole window of `count` messages with globally unique tokens. */
export function buildSet(family, { seed, count = WINDOW_SIZE, tokenBase = 1 }) {
  let next = tokenBase;
  const messages = [];
  for (let index = 0; index < count; index += 1) {
    const message = buildMessage(family, { seed, index, tokenStart: next });
    next = message.tokenEnd;
    messages.push(message);
  }
  return { family: family.name, seed, messages };
}

/** Same words and shape as message `index`, every token's digits shifted. */
export function twinOf(family, set, index) {
  const original = set.messages[index];
  return buildMessage(family, { seed: set.seed, index, tokenStart: original.tokenStart + TWIN_SHIFT });
}

/** The session turns Claude Code replays: a short user prompt before every assistant message. */
export function sessionTurns(set) {
  const turns = [];
  set.messages.forEach((m) => {
    turns.push({ role: "user", text: `prompt ${String(m.index + 1).padStart(2, "0")} for the ${set.family} set` });
    turns.push({ role: "assistant", text: m.text });
  });
  return turns;
}

/** The last token of the last message: the rig's "fully drawn" sentinel. */
export function sentinelOf(set) {
  const last = set.messages.at(-1);
  return last.tokens.reduce((a, b) => (b.start > a.start ? b : a)).id;
}
