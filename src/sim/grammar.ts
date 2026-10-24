// Random markdown from a small grammar, for the property tests, the
// performance bound and the replay self-test. Everything is synthetic:
// pronounceable nonsense words from a seeded PRNG, so no real text is involved
// and two documents almost never share a 12-character stretch.

import { pick, randInt } from "./prng.ts";

export interface GrammarOptions {
  /** Emit pipe tables (opaque to the matcher). Default false. */
  tables?: boolean;
  /** Sprinkle accents, dashes, arrows, CJK and emoji. Default true. */
  unicode?: boolean;
  /** Emit "---" rules. Default true. */
  rules?: boolean;
}

const CONSONANTS = "bcdfghjklmnprstvwz";
const VOWELS = "aeiou";
const EXTRAS = [
  "café",
  "naïve",
  "—",
  "→",
  "数据流程",
  "日本語",
  "\u{1F600}",
  "résumé",
  "★",
];

type Rng = () => number;

export function word(rng: Rng): string {
  const syllables = randInt(rng, 2, 4);
  let out = "";
  for (let i = 0; i < syllables; i++) {
    out += CONSONANTS[randInt(rng, 0, CONSONANTS.length - 1)] as string;
    out += VOWELS[randInt(rng, 0, VOWELS.length - 1)] as string;
    if (rng() < 0.3)
      out += CONSONANTS[randInt(rng, 0, CONSONANTS.length - 1)] as string;
  }
  return out;
}

function words(rng: Rng, count: number, unicode: boolean): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(unicode && rng() < 0.05 ? pick(rng, EXTRAS) : word(rng));
  }
  return out.join(" ");
}

function inline(rng: Rng, unicode: boolean): string {
  const parts: string[] = [];
  const count = randInt(rng, 5, 14);
  for (let i = 0; i < count; i++) {
    const roll = rng();
    if (roll < 0.1)
      parts.push(`**${words(rng, randInt(rng, 1, 3), unicode)}**`);
    else if (roll < 0.18) parts.push(`*${word(rng)}*`);
    else if (roll < 0.26) parts.push(`\`${word(rng)}_${word(rng)}\``);
    else if (roll < 0.32)
      parts.push(
        `[${words(rng, 2, unicode)}](https://example.com/${word(rng)}/${word(rng)})`,
      );
    else if (roll < 0.34) parts.push(`~~${word(rng)}~~`);
    else if (roll < 0.36) parts.push(`\\*${word(rng)}\\*`);
    else parts.push(unicode && rng() < 0.05 ? pick(rng, EXTRAS) : word(rng));
  }
  return parts.join(" ") + (rng() < 0.7 ? "." : "");
}

function paragraph(rng: Rng, unicode: boolean): string {
  const sentences: string[] = [];
  for (let i = randInt(rng, 1, 3); i > 0; i--)
    sentences.push(inline(rng, unicode));
  return sentences.join(" ");
}

function list(
  rng: Rng,
  unicode: boolean,
  ordered: boolean,
  depth: number,
): string {
  const lines: string[] = [];
  const items = randInt(rng, 2, 4);
  for (let i = 0; i < items; i++) {
    const marker = ordered ? `${i + 1}. ` : "- ";
    lines.push(`${marker}${inline(rng, unicode)}`);
    if (depth < 2 && rng() < 0.25) {
      const pad = " ".repeat(marker.length);
      const nested = list(rng, unicode, rng() < 0.3, depth + 1);
      lines.push(
        nested
          .split("\n")
          .map((l) => pad + l)
          .join("\n"),
      );
    }
  }
  return lines.join("\n");
}

function codeFence(rng: Rng, unicode: boolean): string {
  const lines: string[] = [];
  for (let i = randInt(rng, 2, 5); i > 0; i--) {
    const indent = " ".repeat(pick(rng, [0, 0, 2, 4, 8]));
    const long = rng() < 0.15;
    const body = words(
      rng,
      long ? randInt(rng, 14, 24) : randInt(rng, 2, 6),
      unicode,
    );
    lines.push(
      `${indent}${body.replace(/ /g, () => pick(rng, [" ", " ", "(", ", ", " = "]))};`,
    );
  }
  return (
    "```" +
    pick(rng, ["", "ts", "bash", "py"]) +
    "\n" +
    lines.join("\n") +
    "\n```"
  );
}

function table(rng: Rng): string {
  const head = `| ${word(rng)} | ${word(rng)} |`;
  const rows: string[] = [];
  for (let i = randInt(rng, 1, 3); i > 0; i--)
    rows.push(`| ${word(rng)} | ${word(rng)} |`);
  return [head, "|---|---|", ...rows].join("\n");
}

/** A document of `blocks` blocks. Deterministic for a given rng state. */
export function randomMarkdown(
  rng: Rng,
  blocks: number,
  opts: GrammarOptions = {},
): string {
  const unicode = opts.unicode ?? true;
  const out: string[] = [];
  let prevWasParagraph = false;
  for (let i = 0; i < blocks; i++) {
    const roll = rng();
    let block: string;
    let isParagraph = false;
    if (roll < 0.3) {
      block = paragraph(rng, unicode);
      isParagraph = true;
    } else if (roll < 0.38)
      block = `${"#".repeat(randInt(rng, 1, 3))} ${words(rng, randInt(rng, 2, 5), unicode)}`;
    else if (roll < 0.55) block = list(rng, unicode, false, 0);
    else if (roll < 0.67) block = list(rng, unicode, true, 0);
    else if (roll < 0.75)
      block = inline(rng, unicode)
        .split(". ")
        .map((l) => `> ${l}`)
        .join("\n");
    else if (roll < 0.93) block = codeFence(rng, unicode);
    else if ((opts.tables ?? false) && roll < 0.97) block = table(rng);
    else if (opts.rules ?? true) block = "---";
    else block = paragraph(rng, unicode);
    const tight = prevWasParagraph && /^(- |1\. )/.test(block) && rng() < 0.2;
    if (out.length > 0) out.push(tight ? "\n" : "\n\n");
    out.push(block);
    prevWasParagraph = isParagraph;
  }
  return out.join("");
}
