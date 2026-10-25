// Family C, part 1: the words and the inline markup. Family C is the REALISTIC
// corpus: inline markup lives inside list items, headings, quotes and ordinary
// paragraphs; only about one word in ten is a unique token; phrases repeat
// within a message and between messages; and some messages are twins (the
// same words written with different markup, see templates-c.mjs).
//
// Every helper draws the SAME random values whatever `c.variant` is. The
// variant (0 or 1) only changes how the markup is written, so a twin message
// has exactly the words of its original.

export const VOCAB = ("the a of and to in is that for with on we you your our they their might because instead however already still " +
  "really simple common typical usually often rarely actually probably maybe whether either both several many few almost nearly roughly " +
  "around just even less than now soon later first last previous current latest older newer small large fast slow safe risky clear stable " +
  "flaky local remote shared private public manual automatic optional required missing extra fresh stale broken fixed pending ready running " +
  "stopped enabled disabled module package version release patch feature flag tag script hook plugin command prompt session transcript " +
  "message reply summary report log trace metric alert deploy rollback migration schema index column query transaction lock thread process " +
  "memory disk network port proxy gateway secret policy scope owner team ticket issue").split(" ");

/** Phrases that come back again and again, in one message and across the window. */
export const PHRASES = [
  "make sure the cache is warm", "before the next release", "in the same request", "the default behavior", "as long as it passes",
  "on every run", "for the first time", "the rest of the suite", "when the check fails", "without changing the output",
  "at the end of the day", "in the background", "if nothing else changes", "the same way as before", "one more time",
  "after the first retry", "for each worker", "the next step", "in most cases", "by default",
];

export const TOKEN_WORDS = ["mosaic", "marlin", "quiver", "pebble", "saffron", "tamarin", "vellum", "willow", "zephyr", "bramble", "cinder", "driftwood", "fennel", "garnet"];

/** Share of word slots that are unique tokens; phrases add words without tokens, so this is above the target of about 10 percent. */
export const DENSITY = 0.05;
const PHRASE_SHARE = 0.3;

/** `n` word slots of prose: a unique token, a repeated phrase or a plain word. Returns the units (a phrase is one unit). */
export function proseUnits(c, n, { dense = DENSITY, force = false } = {}) {
  const units = Array.from({ length: n }, () => {
    if (c.rng.chance(dense)) return c.tok();
    return c.rng.chance(PHRASE_SHARE) ? c.rng.pick(PHRASES) : c.rng.pick(VOCAB);
  });
  const hasToken = units.some((u) => /\d{4}$/.test(u));
  if (force && !hasToken) units[c.rng.int(0, n - 1)] = c.tok();
  return units;
}

/** A sentence of `lo` to `hi` slots (never alters a token's first letter). `force`: at least one token. */
export function sentence(c, lo, hi, opts = {}) {
  const text = proseUnits(c, c.rng.int(lo, hi), opts).join(" ");
  const first = text.split(" ", 1)[0];
  const head = /\d{4}$/.test(first) ? first.charAt(0) : first.charAt(0).toUpperCase();
  return head + text.slice(1) + c.rng.pick([".", ".", ".", ":"]);
}

/** A run of words with no terminal punctuation (a label, a heading, a list item's tail). */
export function run(c, lo, hi, opts = {}) {
  return proseUnits(c, c.rng.int(lo, hi), opts).join(" ");
}

const URLS = ["https://example.com/docs/guide", "https://example.com/api/reference", "https://example.org/blog/release-notes", "https://docs.example.net/setup/install"];

/** Features are registered by their (unique) text so the ground truth knows where each one sits. */
const feature = (c, kind, text) => c.doc.feature(kind, text);

/** **Term tok** (variant 1: __Term tok__). `colon` writes the lead-in form "**Term tok:**". */
export function bold(c, { colon = false } = {}) {
  const text = `${run(c, 1, 2, { force: true })}${colon ? ":" : ""}`;
  return feature(c, "bold", c.variant ? `__${text}__` : `**${text}**`);
}

/** *two words tok* (variant 1: _two words tok_). */
export function italic(c) {
  const text = run(c, 2, 3, { force: true });
  return feature(c, "italic", c.variant ? `_${text}_` : `*${text}*`);
}

/** `name tok` (variant 1: the same words with no backticks, which is not a feature). */
export function inlineCode(c) {
  const text = `${c.rng.pick(["npm run", "git", "make", "node"])} ${c.tok()}`;
  return c.variant ? text : feature(c, "code", `\`${text}\``);
}

/** [label tok](url) (variant 1 writes the destination in angle brackets with a title; the same links are drawn). */
export function link(c) {
  const withLabelToken = c.rng.chance(0.7);
  const url = c.rng.pick(URLS);
  const label = withLabelToken ? run(c, 1, 3, { force: true }) : run(c, 1, 3);
  const slug = withLabelToken ? url : `${url}/${c.tok("linkurl")}`;
  const title = c.rng.pick(["Guide", "Docs"]);
  return feature(c, "link", c.variant ? `[${label}](<${slug}> "${title}")` : `[${label}](${slug})`);
}

/** [label tok][refN]; the definition is written once at the end of the message by finishRefs. */
export function reflink(c) {
  const refs = (c.refs ??= []);
  const id = `ref${refs.length + 1}`;
  refs.push({ id, url: c.rng.pick(URLS) });
  return feature(c, "reflink", `[${run(c, 1, 3, { force: true })}][${id}]`);
}

/** <https://example.com/p/tok> */
export function autolink(c) {
  return feature(c, "autolink", `<${c.rng.pick(URLS)}/${c.tok("linkurl")}>`);
}

/** ~~struck words tok~~ */
export function strike(c) {
  return feature(c, "strike", `~~${run(c, 2, 3, { force: true })}~~`);
}

/**
 * An approximation with two tildes in it ("~40 tok lines (~2 tok each)"): marked reads the text
 * between them as struck. Real replies write this by accident; it is not registered as a strike.
 */
export function approximation(c) {
  return `about ~${c.rng.int(10, 90)} ${c.tok()} lines (~${c.rng.int(2, 9)} ${c.tok()} each)`;
}

const INLINES = { bold, italic, code: inlineCode, link, reflink, autolink, strike };

/** One inline feature of the kind picked by weight; the weights are what real replies lean on. */
export function pickInline(c, weights) {
  const kinds = Object.keys(weights);
  const total = kinds.reduce((sum, k) => sum + weights[k], 0);
  let roll = c.rng.next() * total;
  for (const kind of kinds) {
    roll -= weights[kind];
    if (roll < 0) return INLINES[kind](c);
  }
  return INLINES[kinds[0]](c);
}

/** Words with inline markup mixed in: `n` slots, about `share` of them replaced by one feature each. */
export function marked(c, n, share, weights) {
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(c.rng.chance(share) ? pickInline(c, weights) : run(c, 1, 3));
  const text = parts.join(" ");
  const startsWithToken = /\d{4}$/.test(text.split(" ", 1)[0]);
  const head = /^[a-z]/.test(text) && !startsWithToken ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  return head + c.rng.pick([".", ".", ".", ":"]);
}

/** The usual mix inside prose, list items and quotes. */
export const PROSE_MIX = { bold: 3, code: 3, link: 2, italic: 1, strike: 1, reflink: 1, autolink: 1 };

/** Reference-link definitions for every reflink written in the message (a block of their own, last). */
export function finishRefs(c) {
  if (!c.refs?.length) return;
  c.doc.begin("def");
  for (const { id, url } of c.refs) c.doc.line(`[${id}]: ${url}`);
  c.doc.end();
}
