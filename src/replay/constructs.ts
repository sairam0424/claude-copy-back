// Which markdown constructs a message contains, by independent regexes (not
// the project's own parser), so failure counts can be broken down by what the
// failing message held.

export const CONSTRUCTS = [
  "table",
  "nestedList",
  "codeFence",
  "link",
  "heading",
  "quote",
  "longToken",
  "wideChars",
] as const;

export type Construct = (typeof CONSTRUCTS)[number];

const TESTS: Record<Construct, RegExp> = {
  table:
    /^[ \t]*\|?[^\n|]*\|[^\n]*\n[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/m,
  nestedList: /^(?: {2,}|\t)(?:[-*+]|\d+[.)]) /m,
  codeFence: /^[ \t]*(?:```|~~~)/m,
  link: /\[[^\]\n]+\]\([^)\n]+\)/,
  heading: /^ {0,3}#{1,6} /m,
  quote: /^[ \t]*> /m,
  longToken: /\S{60,}/,
  wideChars:
    /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]|[\ud83c-\ud83e][\udc00-\udfff]/,
};

export function constructsOf(source: string): Construct[] {
  return CONSTRUCTS.filter((name) => TESTS[name].test(source));
}
