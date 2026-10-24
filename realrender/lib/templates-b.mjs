// Template family B (HOLDOUT, seed 202). Different words, different token
// words and different shapes from family A: setext headings, underscore
// emphasis, nested emphasis, four-space nesting, loose lists, lists starting at
// other numbers with children, multi-paragraph quotes with lists, shell and
// python code with blank lines, emoji and accents, URLs with query strings,
// three-column tables and a bullet item holding a code fence.

import { FENCE, writeParagraph } from "./gen-text.mjs";

const VOCAB = ("deploy rollout ticket owner customer billing invoice incident alert pager dashboard metric latency budget release " +
  "branch review merge approve ship team sprint backlog roadmap priority risk plan scope launch feature flag we our their your " +
  "will can must may first next last during before after because while however still already never always every both either " +
  "report notes status update handoff change window freeze rollback owner queue limit quota").split(" ");

const TOKEN_WORDS = ["relay", "ticket", "falcon", "cobalt", "juniper", "saddle", "orchid", "granite", "cypress", "walnut", "harvest", "beacon", "summit", "tundra", "quartz", "ember"];

const para = (c) => {
  c.doc.begin("para");
  const text = `${c.sentence(18, 30)} (${c.phrase(c.rng.int(4, 7))}) ${c.sentence(10, 20)}`;
  writeParagraph(c.doc, text, c.rng.chance(0.15) ? 72 : 0);
  c.doc.end();
};

const heading = (c) => {
  c.doc.begin("heading");
  const title = c.phrase(c.rng.int(3, 7), { dense: 0.35 });
  if (c.rng.chance(0.4)) {
    c.doc.line(title);
    c.doc.line(c.rng.chance(0.5) ? "=".repeat(title.length) : "-".repeat(title.length));
  } else {
    c.doc.line(`${c.rng.pick(["##", "###"])} ${title}`);
  }
  c.doc.end();
};

const FEATURES = {
  bold: (c) => c.doc.feature("bold", `__${c.phrase(c.rng.int(2, 4), { flags: ["bold"] })}__`),
  italic: (c) => c.doc.feature("italic", `_${c.phrase(c.rng.int(2, 3), { flags: ["italic"] })}_`),
  nested: (c) => c.doc.feature("bold", `**${c.words(1)} _${c.tok("bold")}_ ${c.tok("bold")}**`),
  code: (c) => c.doc.feature("code", `\`npm run ${c.tok("code")} --${c.words(1)}\``),
  link: (c) => c.doc.feature("link", `[${c.phrase(c.rng.int(1, 3), { flags: ["link"] })}](https://example.org/docs/${c.tok("linkurl")}#top)`),
  strike: (c) => c.doc.feature("strike", `~~${c.phrase(c.rng.int(1, 3), { flags: ["strike"] })}~~`),
  image: (c) => c.doc.feature("image", `![${c.phrase(1, { flags: ["image"] })}](https://example.org/img/${c.tok("imageurl")}.png)`),
  autolink: (c) => c.doc.feature("autolink", `<https://example.org/${c.tok("autolink")}?ref=docs>`),
};

const inline = (c) => {
  c.doc.begin("inline");
  const kinds = c.rng.shuffled(Object.keys(FEATURES)).slice(0, c.rng.int(3, 5));
  const parts = kinds.flatMap((k) => [c.phrase(c.rng.int(2, 5), { dense: 0.25 }), FEATURES[k](c)]);
  writeParagraph(c.doc, `${parts.join(" ")}, ${c.sentence(3, 7)}`, c.rng.chance(0.3) ? 66 : 0);
  c.doc.end();
};

function bulletItems(c, markers, count, indentWidth, loose) {
  let previous = 0;
  for (let i = 0; i < count; i += 1) {
    // a child may sit at most one level below the item before it (otherwise it is a lazy paragraph line)
    const depth = i === 0 ? 0 : c.rng.int(0, Math.min(markers.length - 1, previous + 1));
    previous = depth;
    const pad = " ".repeat(depth * indentWidth);
    c.doc.line(`${pad}${markers[depth]} ${c.sentence(6, 18)}`, { prefix: pad.length, marker: true });
    if (loose) c.doc.line("");
  }
}

const ul = (c) => {
  c.doc.begin("ul");
  bulletItems(c, [c.rng.pick(["*", "+"])], c.rng.int(3, 5), 0, c.rng.chance(0.3));
  c.doc.end();
};

const ulnest = (c) => {
  c.doc.begin("ulnest");
  bulletItems(c, ["*", "+", "-"], c.rng.int(5, 7), 4, false);
  c.doc.end();
};

const ol = (c) => {
  c.doc.begin("ol");
  const start = c.rng.pick([3, 5, 6]);
  const style = c.rng.chance(0.5) ? ")" : ".";
  const gap = " ".repeat(String(start).length + 2);
  for (let i = 0; i < c.rng.int(3, 4); i += 1) {
    c.doc.line(`${start + i}${style} ${c.sentence(7, 16)}`, { marker: true });
    if (c.rng.chance(0.4)) c.doc.line(`${gap}- ${c.sentence(4, 9)}`, { prefix: gap.length, marker: true });
  }
  c.doc.end();
};

const quote = (c) => {
  c.doc.begin("quote");
  c.doc.line(`> ${c.sentence(12, 22)}`, { prefix: 2 });
  c.doc.line(">", { prefix: 1 });
  c.doc.line(`> ${c.sentence(6, 12)}`, { prefix: 2 });
  c.doc.line(`> - ${c.sentence(4, 9)}`, { prefix: 2, marker: true, quote: true });
  c.doc.line(`> - ${c.sentence(4, 9)}`, { prefix: 2, marker: true, quote: true });
  c.doc.end();
};

const code = (c) => {
  c.doc.begin("code");
  if (c.rng.chance(0.5)) {
    c.doc.line(`${FENCE}bash`);
    c.doc.line(`$ npm run ${c.tok("code")} -- --${c.words(1)} ${c.tok("code")}`);
    c.doc.line(`# ${c.words(3)} ${c.tok("code")}`);
    c.doc.line(`if [ -n "$${c.tok("code")}" ]; then`);
    c.doc.line(`    echo ${c.tok("code")}`);
    c.doc.line("fi");
  } else {
    c.doc.line(`${FENCE}python`);
    c.doc.line(`def ${c.tok("code")}(${c.tok("code")}, ${c.tok("code")}):`);
    c.doc.line(`    total = ${c.tok("code")} + ${c.tok("code")}`);
    c.doc.line("");
    c.doc.line(`        return total  # ${c.words(2)} ${c.tok("code")}`);
  }
  if (c.rng.chance(0.3)) c.doc.line(`LONG = "${"b".repeat(c.rng.int(100, 150))}"  # ${c.tok("code")}`);
  c.doc.line(FENCE);
  c.doc.end();
};

const codeind = (c) => {
  c.doc.begin("codeind");
  c.doc.line(`    make ${c.tok("code")} ${c.tok("code")}`, { prefix: 4, soft: true });
  c.doc.line(`        ${c.tok("code")} ${c.words(3)}`, { prefix: 4, soft: true });
  c.doc.line(`    ${c.tok("code")}`, { prefix: 4, soft: true });
  c.doc.end();
};

const rule = (c) => {
  c.doc.begin("rule");
  c.doc.line("---");
  c.doc.end();
};

const wide = (c) => {
  c.doc.begin("wide");
  c.doc.line(`Café ${c.tok("wide")} résumé naïve 🚀 ${c.tok("wide")} ✅ ${c.phrase(4)} 你好世界 ${c.tok("wide")} こんにちは ${c.tok("wide")}.`);
  c.doc.end();
};

const url = (c) => {
  c.doc.begin("url");
  c.doc.line(`Open https://example.org/${"b".repeat(c.rng.int(90, 130))}/${c.tok("url")}?a=1&b=${c.tok("url")} ${c.sentence(4, 8)}`);
  c.doc.end();
};

const table = (c) => {
  c.doc.begin("table");
  c.doc.line(`| ${c.tok("table")} | ${c.tok("table")} | ${c.tok("table")} |`);
  c.doc.line("|:--|--:|:-:|");
  c.doc.line(`| ${c.tok("table")} | ${c.tok("table")} | ${c.tok("table")} |`);
  c.doc.end();
};

const listcode = (c) => {
  c.doc.begin("listcode");
  c.doc.line(`* ${c.sentence(5, 10)}`, { marker: true });
  c.doc.line(`  ${FENCE}bash`, { prefix: 2 });
  c.doc.line(`  echo ${c.tok("code")}`, { prefix: 2 });
  c.doc.line(`    ${c.tok("code")} --${c.words(1)}`, { prefix: 2 });
  c.doc.line(`  ${FENCE}`, { prefix: 2 });
  c.doc.line(`* ${c.sentence(4, 8)}`, { marker: true });
  c.doc.end();
};

export const FAMILY_B = {
  name: "B",
  vocab: VOCAB,
  tokenWords: TOKEN_WORDS,
  classes: ["para", "heading", "inline", "ul", "ulnest", "ol", "quote", "code", "codeind", "rule", "wide", "url", "table", "listcode"],
  build: { para, heading, inline, ul, ulnest, ol, quote, code, codeind, rule, wide, url, table, listcode },
  needsParaBefore: ["codeind", "rule"],
  needsParaAfter: ["heading"],
};

