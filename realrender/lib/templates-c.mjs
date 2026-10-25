// Template family C: the REALISTIC corpus (calibration seeds 4101 and 4103, holdout
// seeds 5202 and 5303). Earlier families wrote their inline markup in dedicated
// paragraphs, used unique tokens for about one word in three, never repeated a
// phrase and had no twins. This one writes what replies are made of:
//
//   - inline markup (bold lead-ins, code, links, strike) INSIDE list items, headings,
//     quotes and ordinary paragraphs;
//   - inline, reference-style and auto links; strikethrough, and "~40 lines (~2 each)";
//   - nested ordered lists three levels deep, mixed bullets and numbers, code fences
//     with lines longer than the screen, wide characters in lists and quotes;
//   - about one word in ten a unique token, the rest repeated words and phrases;
//   - TWINS: every fifth message holds the words of the one before it, written with
//     other markup and other indentation, and different token digits (templates-c-inline.mjs).
//
// Tables stay out on purpose. The block builders here draw their random values in the
// same order whatever the variant is, so a twin has exactly the original's words.

import { FENCE, hardWrap, writeParagraph } from "./gen-text.mjs";
import {
  PROSE_MIX, TOKEN_WORDS, VOCAB, approximation, autolink, bold, finishRefs, inlineCode, link, marked, pickInline, reflink, run,
  sentence, strike,
} from "./templates-c-inline.mjs";

/** Every TWIN_EVERY-th message (indices 4, 9, ...) is the twin of the message before it. */
export const TWIN_EVERY = 5;
const isTwin = (index) => index % TWIN_EVERY === TWIN_EVERY - 1;
const dense = (index) => index - Math.floor(index / TWIN_EVERY);

const hasToken = (text) => /[a-z]\d{4}(?![A-Za-z0-9])/.test(text);
const withToken = (c, text) => (hasToken(text) ? text : `${text} ${sentence(c, 3, 6, { force: true })}`);

const para = (c) => {
  c.doc.begin("para");
  const body = Array.from({ length: c.rng.int(2, 3) }, () => marked(c, c.rng.int(6, 10), 0.2, PROSE_MIX)).join(" ");
  const tilde = c.rng.chance(0.12);
  const extra = tilde ? ` ${sentence(c, 1, 2)} ${approximation(c)}.` : "";
  writeParagraph(c.doc, withToken(c, body) + extra, c.rng.chance(0.25) ? 64 : 0);
  c.doc.end();
};

const heading = (c) => {
  c.doc.begin("heading");
  const level = c.rng.int(1, 3);
  const parts = [run(c, 1, 3, { force: true }), pickInline(c, { code: 3, bold: 2, link: 1 }), run(c, 0, 2)].filter(Boolean);
  const title = parts.join(" ");
  if (c.variant && level < 3) {
    c.doc.line(title);
    c.doc.line((level === 1 ? "=" : "-").repeat(Math.max(3, title.length)));
  } else {
    c.doc.line(`${"#".repeat(level + 1)} ${title}`);
  }
  c.doc.end();
};

/** The text of one list item: a bold lead-in half the time, then words with inline markup. */
function itemText(c) {
  const lead = c.rng.chance(0.5);
  const head = lead ? `${bold(c, { colon: true })} ` : "";
  return withToken(c, head + marked(c, c.rng.int(5, 9), 0.2, PROSE_MIX));
}

/** One list item as source lines: the marker line, then (soft wrap) continuation lines under the text. */
function item(c, pad, marker, text, wrapAt = 0) {
  const rows = wrapAt ? hardWrap(text, wrapAt) : [text];
  const hang = " ".repeat(marker.length + 1);
  c.doc.line(`${pad}${marker} ${rows[0]}`, { prefix: pad.length, marker: true });
  rows.slice(1).forEach((row) => c.doc.line(`${pad}${hang}${row}`, { prefix: pad.length + hang.length }));
}

const ul = (c) => {
  c.doc.begin("ul");
  const first = c.rng.pick(["-", "*", "+"]);
  const marker = c.variant ? (first === "-" ? "*" : "-") : first;
  for (let i = c.rng.int(3, 5); i > 0; i -= 1) item(c, "", marker, itemText(c), c.rng.chance(0.2) ? 52 : 0);
  c.doc.end();
};

/** Nested bullets up to three levels (2 spaces per level, 4 in the twin). */
const ulnest = (c) => {
  c.doc.begin("ulnest");
  const unit = c.variant ? 4 : 2;
  const markers = c.variant ? ["*", "+", "-"] : ["-", "-", "-"];
  item(c, "", markers[0], itemText(c));
  let previous = 0;
  for (let i = c.rng.int(4, 6); i > 0; i -= 1) {
    const depth = c.rng.int(0, Math.min(2, previous + 1));
    previous = depth;
    item(c, " ".repeat(unit * depth), markers[depth], itemText(c), c.rng.chance(0.15) ? 52 : 0);
  }
  c.doc.end();
};

const ol = (c) => {
  c.doc.begin("ol");
  const paren = c.rng.chance(0.4);
  const style = c.variant ? (paren ? "." : ")") : paren ? ")" : ".";
  for (let i = 1, n = c.rng.int(3, 5); i <= n; i += 1) item(c, "", `${i}${style}`, itemText(c), c.rng.chance(0.2) ? 52 : 0);
  c.doc.end();
};

/** Ordered lists three levels deep; every level is typed "1." and counted up, whatever the renderer draws. */
const olnest = (c) => {
  c.doc.begin("olnest");
  const style = c.variant ? ")" : ".";
  for (let top = 1, tops = c.rng.int(2, 3); top <= tops; top += 1) {
    item(c, "", `${top}${style}`, itemText(c));
    for (let mid = 1, mids = c.rng.int(0, 3); mid <= mids; mid += 1) {
      item(c, "   ", `${mid}${style}`, itemText(c));
      for (let low = 1, lows = c.rng.int(0, 2); low <= lows; low += 1) item(c, "      ", `${low}${style}`, itemText(c));
    }
  }
  c.doc.end();
};

/** Numbers with bullet children, or bullets with numbered children. */
const mixed = (c) => {
  c.doc.begin("mixed");
  const bulletsInside = c.rng.chance(0.5);
  const bullet = c.variant ? "*" : "-";
  for (let i = 1, n = c.rng.int(2, 3); i <= n; i += 1) {
    if (bulletsInside) {
      item(c, "", `${i}.`, itemText(c));
      for (let k = c.rng.int(1, 3); k > 0; k -= 1) item(c, "   ", bullet, itemText(c));
    } else {
      item(c, "", bullet, itemText(c));
      for (let k = 1, m = c.rng.int(1, 3); k <= m; k += 1) item(c, c.variant ? "    " : "  ", `${k}.`, itemText(c));
    }
  }
  c.doc.end();
};

const quote = (c) => {
  c.doc.begin("quote");
  const text = withToken(c, marked(c, c.rng.int(7, 12), 0.2, PROSE_MIX));
  hardWrap(text, c.rng.chance(0.4) ? 56 : 400).forEach((row) => c.doc.line(`> ${row}`, { prefix: 2 }));
  if (c.rng.chance(0.35)) c.doc.line(`> > ${withToken(c, marked(c, c.rng.int(4, 7), 0.2, PROSE_MIX))}`, { prefix: 4 });
  if (c.rng.chance(0.3)) {
    for (let i = c.rng.int(2, 3); i > 0; i -= 1) c.doc.line(`> - ${itemText(c)}`, { prefix: 2, marker: true, quote: true });
  }
  c.doc.end();
};

/** A fence whose lines are longer than the screen, and one with a tab. */
const code = (c) => {
  c.doc.begin("code");
  const lang = c.rng.pick(["js", "python", "sh", "ts"]);
  c.doc.line(`${FENCE}${lang}`);
  c.doc.line(`function ${c.tok("code")}(${c.rng.pick(["a", "b", "x"])}, ${c.rng.pick(["y", "z"])}) {`);
  c.doc.line(`  const ${c.tok("code")} = ${c.words(1)} + 1; // ${c.words(6)}`);
  if (c.rng.chance(0.3)) c.doc.line(`\treturn ${c.tok("code")}; // tab`);
  c.doc.line(`  const ${c.words(1)} = "${"a".repeat(c.rng.int(110, 170))}"; // ${c.words(5)} ${c.tok("code")}`);
  if (c.rng.chance(0.5)) c.doc.line(`  logger.info("${c.words(10)} ${c.tok("code")} ${c.words(10)}", { retry: ${c.words(1)} }); // ${c.words(6)}`);
  c.doc.line("}");
  c.doc.line(FENCE);
  c.doc.end();
};

/** Wide characters inside a list, a quote or a paragraph. */
const wide = (c) => {
  c.doc.begin("wide");
  const form = c.rng.int(0, 2);
  if (form === 0) {
    for (let i = 0; i < 3; i += 1) c.doc.line(`- ${c.rng.pick(["日本語", "中文字符", "한국어", "テキスト"])} ${c.tok("wide")} ${c.rng.pick(["😀", "🚀", "✅"])} ${run(c, 2, 4)}`, { prefix: 0, marker: true });
  } else if (form === 1) {
    c.doc.line(`> ${c.rng.pick(["こんにちは", "你好世界"])} ${c.tok("wide")} ${run(c, 3, 6)} ${c.tok("wide")} 🙂`, { prefix: 2 });
  } else {
    c.doc.line(`${run(c, 3, 6)} café ${c.tok("wide")} résumé 😀 ${c.tok("wide")} 日本語のテキスト ${c.tok("wide")}. ${sentence(c, 3, 6)}`);
  }
  c.doc.end();
};

/** Links of every kind, each inside a sentence or a list item. */
const links = (c) => {
  c.doc.begin("link");
  const forms = [link, reflink, autolink];
  if (c.rng.chance(0.5)) {
    for (let i = c.rng.int(3, 4); i > 0; i -= 1) item(c, "", c.variant ? "*" : "-", withToken(c, `${run(c, 1, 3)} ${c.rng.pick(forms)(c)} ${run(c, 2, 4)}.`));
  } else {
    const parts = Array.from({ length: c.rng.int(3, 4) }, () => `${run(c, 3, 5)} ${c.rng.pick(forms)(c)}`);
    writeParagraph(c.doc, `${parts.join(", ")}, ${sentence(c, 3, 6, { force: true })}`, c.rng.chance(0.3) ? 64 : 0);
  }
  c.doc.end();
};

/** Struck text in a sentence and in a list item, and the "~40 lines (~2 each)" accident. */
const struck = (c) => {
  c.doc.begin("strike");
  const sentences = Array.from({ length: c.rng.int(2, 3) }, () => `${run(c, 3, 6)} ${strike(c)} ${run(c, 3, 6)}.`);
  if (c.rng.chance(0.5)) sentences.push(`${sentence(c, 1, 3)} ${approximation(c)}.`);
  writeParagraph(c.doc, withToken(c, sentences.join(" ")), c.rng.chance(0.3) ? 60 : 0);
  c.doc.line("");
  for (let i = c.rng.int(1, 2); i > 0; i -= 1) item(c, "", c.variant ? "*" : "-", withToken(c, `${strike(c)} ${marked(c, c.rng.int(2, 4), 0.3, PROSE_MIX)}`));
  c.doc.end();
};

const url = (c) => {
  c.doc.begin("url");
  c.doc.line(`See https://example.com/${"a".repeat(c.rng.int(100, 150))}/${c.tok("url")}/more ${marked(c, c.rng.int(3, 5), 0.3, PROSE_MIX)}`);
  c.doc.end();
};

const rule = (c) => {
  c.doc.begin("rule");
  c.doc.line("---");
  c.doc.end();
};

const listcode = (c) => {
  c.doc.begin("listcode");
  item(c, "", "1.", itemText(c));
  c.doc.line(`   ${FENCE}sh`, { prefix: 3 });
  c.doc.line(`   run ${c.tok("code")} --${c.words(1)} ${c.words(3)} ${c.words(2)}`, { prefix: 3 });
  c.doc.line(`   ${FENCE}`, { prefix: 3 });
  item(c, "", "2.", itemText(c));
  c.doc.end();
};

export const FAMILY_C = {
  name: "C",
  vocab: VOCAB,
  tokenWords: TOKEN_WORDS,
  classes: ["para", "heading", "quote", "ul", "ulnest", "ol", "olnest", "mixed", "code", "wide", "link", "strike", "rule", "listcode", "url"],
  build: { para, heading, quote, ul, ulnest, ol, olnest, mixed, code, wide, link: links, strike: struck, rule, listcode, url },
  needsParaBefore: ["rule"],
  needsParaAfter: ["heading"],
  streamOf: (index) => dense(isTwin(index) ? index - 1 : index),
  variantOf: (index) => (isTwin(index) ? 1 : 0),
  finish: finishRefs,
};
