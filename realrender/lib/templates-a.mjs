// Template family A (CALIBRATION, seed 101). One builder per construct class.
// Family B (templates-b.mjs) uses different words, shapes and variants on
// purpose: the holdout must not be the calibration set in other clothes.

import { FENCE, hardWrap, writeParagraph } from "./gen-text.mjs";

const VOCAB = ("the a of and to in is that for with on as are by this from at or an be it can when each then also only after " +
  "before more most some any other into over under about between through during without within across using used make makes " +
  "keep keeps need needs should would could will does done set sets read write build run check pass fail value state data " +
  "input output result error cache queue worker request response server client config option step part case rule path file " +
  "line text").split(" ");

const TOKEN_WORDS = ["gadget", "widget", "render", "socket", "bridge", "lantern", "pillar", "harbor", "meadow", "copper", "velvet", "anchor", "ribbon", "signal", "marble", "thunder"];

const para = (c) => {
  c.doc.begin("para");
  const text = Array.from({ length: c.rng.int(2, 3) }, () => c.sentence(9, 18)).join(" ");
  writeParagraph(c.doc, text, c.rng.chance(0.25) ? 64 : 0);
  c.doc.end();
};

const heading = (c) => {
  c.doc.begin("heading");
  c.doc.line(`${"#".repeat(c.rng.int(1, 4))} ${c.phrase(c.rng.int(3, 6), { dense: 0.4 })}`);
  c.doc.end();
};

const FEATURES = {
  bold: (c) => c.doc.feature("bold", `**${c.phrase(c.rng.int(2, 3), { flags: ["bold"] })}**`),
  italic: (c) => c.doc.feature("italic", `*${c.phrase(c.rng.int(2, 3), { flags: ["italic"] })}*`),
  bolditalic: (c) => c.doc.feature("bolditalic", `***${c.phrase(2, { flags: ["bolditalic"] })}***`),
  code: (c) => c.doc.feature("code", `\`${c.tok("code")}\``),
  link: (c) => c.doc.feature("link", `[${c.phrase(c.rng.int(2, 3), { flags: ["link"] })}](https://example.com/${c.tok("linkurl")}/docs)`),
  strike: (c) => c.doc.feature("strike", `~~${c.phrase(2, { flags: ["strike"] })}~~`),
  image: (c) => c.doc.feature("image", `![${c.phrase(2, { flags: ["image"] })}](https://example.com/${c.tok("imageurl")}.png)`),
  autolink: (c) => c.doc.feature("autolink", `<https://example.com/${c.tok("autolink")}>`),
  escape: (c) => c.doc.feature("escape", `a \\* star ${c.tok("escape")}`),
};

const inline = (c) => {
  c.doc.begin("inline");
  const kinds = c.rng.shuffled(Object.keys(FEATURES)).slice(0, c.rng.int(4, 6));
  const parts = kinds.flatMap((k) => [c.phrase(c.rng.int(3, 6), { dense: 0.2 }), FEATURES[k](c)]);
  c.doc.line(`${parts.join(" ")} ${c.sentence(4, 8)}`);
  c.doc.end();
};

function items(c, depthMarkers, count, nest) {
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    const indent = nest && i > 0 ? c.rng.int(0, Math.min(depthMarkers.length - 1, previous + 1)) : 0;
    previous = indent;
    const pad = " ".repeat(indent * 2);
    const text = c.sentence(8, 22);
    const wrapped = c.rng.chance(0.2) ? hardWrap(text, 52) : [text];
    c.doc.line(`${pad}${depthMarkers[indent]} ${wrapped[0]}`, { prefix: pad.length, marker: true });
    wrapped.slice(1).forEach((row) => c.doc.line(`${pad}  ${row}`, { prefix: pad.length + 2 }));
  }
}

const ul = (c) => {
  c.doc.begin("ul");
  const m = c.rng.pick(["-", "*", "+"]);
  items(c, [m], c.rng.int(3, 5), false);
  c.doc.end();
};

const ulnest = (c) => {
  c.doc.begin("ulnest");
  c.doc.line(`- ${c.sentence(6, 12)}`, { marker: true });
  items(c, ["-", "-", "-"], c.rng.int(4, 6), true);
  c.doc.end();
};

const ol = (c) => {
  c.doc.begin("ol");
  const style = c.rng.chance(0.4) ? ")" : ".";
  const n = c.rng.int(3, 5);
  for (let i = 1; i <= n; i += 1) c.doc.line(`${i}${style} ${c.sentence(8, 20)}`, { marker: true });
  c.doc.end();
};

const quote = (c) => {
  c.doc.begin("quote");
  c.doc.line(`> ${c.sentence(10, 20)}`, { prefix: 2 });
  c.doc.line(`> ${c.sentence(8, 16)}`, { prefix: 2 });
  if (c.rng.chance(0.35)) c.doc.line(`> > ${c.sentence(6, 12)}`, { prefix: 4 });
  c.doc.end();
};

const code = (c) => {
  c.doc.begin("code");
  c.doc.line(`${FENCE}${c.rng.pick(["js", "python", "sh"])}`);
  c.doc.line(`function ${c.tok("code")}(${c.rng.pick(["a", "b", "x"])}, ${c.rng.pick(["y", "z"])}) {`);
  c.doc.line(`  const ${c.tok("code")} = ${c.tok("code")} + 1; // ${c.words(3)}`);
  if (c.rng.chance(0.3)) c.doc.line(`\treturn ${c.tok("code")}; // tab`);
  c.doc.line(`    return ${c.tok("code")};`);
  if (c.rng.chance(0.35)) c.doc.line(`  const ${c.tok("code")} = "${"a".repeat(c.rng.int(110, 160))}"; // ${c.tok("code")}`);
  c.doc.line("}");
  c.doc.line(FENCE);
  c.doc.end();
};

const codeind = (c) => {
  c.doc.begin("codeind");
  c.doc.line(`    run ${c.tok("code")} --flag ${c.tok("code")}`, { prefix: 4, soft: true });
  c.doc.line(`        then ${c.tok("code")} ${c.words(2)}`, { prefix: 4, soft: true });
  c.doc.end();
};

const listcode = (c) => {
  c.doc.begin("listcode");
  c.doc.line(`1. ${c.sentence(6, 12)}`, { marker: true });
  c.doc.line(`   ${FENCE}sh`, { prefix: 3 });
  c.doc.line(`   run ${c.tok("code")} ${c.tok("code")}`, { prefix: 3 });
  c.doc.line(`   ${FENCE}`, { prefix: 3 });
  c.doc.line(`2. ${c.sentence(5, 10)}`, { marker: true });
  c.doc.end();
};

const rule = (c) => {
  c.doc.begin("rule");
  c.doc.line("---");
  c.doc.end();
};

const wide = (c) => {
  c.doc.begin("wide");
  c.doc.line(`日本語のテキスト ${c.tok("wide")} 😀 ${c.phrase(5)} é ${c.tok("wide")} 中文字符 ${c.tok("wide")}.`);
  c.doc.end();
};

const url = (c) => {
  c.doc.begin("url");
  c.doc.line(`See https://example.com/${"a".repeat(c.rng.int(120, 150))}/${c.tok("url")}/more ${c.sentence(5, 9)}`);
  c.doc.end();
};

const table = (c) => {
  c.doc.begin("table");
  c.doc.line(`| ${c.tok("table")} | ${c.tok("table")} |`);
  c.doc.line("|---|---|");
  c.doc.line(`| ${c.tok("table")} | ${c.tok("table")} |`);
  c.doc.end();
};

export const FAMILY_A = {
  name: "A",
  vocab: VOCAB,
  tokenWords: TOKEN_WORDS,
  classes: ["para", "heading", "inline", "ul", "ulnest", "ol", "quote", "code", "codeind", "rule", "wide", "url", "table", "listcode"],
  build: { para, heading, inline, ul, ulnest, ol, quote, code, codeind, rule, wide, url, table, listcode },
  // blocks that must follow a paragraph (markdown would otherwise merge or reinterpret them)
  needsParaBefore: ["codeind", "rule"],
  needsParaAfter: ["heading"],
};
