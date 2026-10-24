// Which kinds of non-ASCII text a payload holds. Used to count what a live
// pass really covered by the TEXT THAT WAS WRITTEN (the accepted payload), not
// by the screen copy: the renderer draws characters of its own (the quote bar
// U+258E) that the plugin correctly removes, so a screen copy can be non-ASCII
// when its payload is plain ASCII.

const CLASSES = [
  ["emdash", /—/u],
  ["zwj", /\u200d/u],
  ["cjk", /[぀-ヿ㐀-䶿一-鿿＀-￯]/u],
  ["accent", /[À-ÖØ-öø-ɏ]/u],
  ["flag", /[\u{1f1e6}-\u{1f1ff}]/u],
  ["combining", /[̀-ͯ]/u],
  ["nbsp", /\u00a0/u],
  ["rtl", /[֐-ࣿ]/u],
  ["astral", /[\u{10000}-\u{10ffff}]/u],
];
const NON_ASCII = /[^\x00-\x7f]/u;

/** Class names, in a fixed order, for the non-ASCII text in `text`; "other" when it holds some that no class names. */
export function unicodeClasses(text) {
  const found = CLASSES.filter(([, re]) => re.test(text)).map(([name]) => name);
  if (found.length > 0) return found;
  return NON_ASCII.test(text) ? ["other"] : [];
}
