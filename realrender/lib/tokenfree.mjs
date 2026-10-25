// TOKEN-FREE copies: the words BETWEEN two tokens, cut from the real screen. Every
// capture of the pre-registered rule starts at a unique token, so two messages
// can never carry the same copy and the rule cannot tell a refusal that was right
// from one that was lazy. These copies can: they hold no token, so a message that
// repeats the words (a twin, a repeated phrase) holds the same copy.
//
// The ground truth is the SCREEN, not the matcher's model: a message "holds" a
// copy when the copy, with the margin and bars of its rows removed and whitespace
// ignored, is a substring of that message's rows on the saved screen. Judgement:
//   found in one message   exact (the right message, inside the gap), refused, or WRONG
//   found in several       refused-right, picked-right (the pick may have a reason:
//                          row indentation), or PICKED-WRONG (the pick is another message)
// Wrong and picked-wrong are the dangerous ones. Rule 3 is blind to a matcher
// that guesses (every capture of it holds a unique token), so these are the copies
// that carry the never-guess property, and gateVerdict turns them into a pass or a
// fail for the release process. Never a tuning aid.

import { lookup } from "./evaluate.mjs";
import { messageRegions, regionText, skeleton } from "./modeldiff.mjs";
import { charPos, endPos, locateOnScreen, rowsOf, selectionText } from "./screen.mjs";

/** Source characters of markup the matcher leaves out at the edges of a copy (`**`, a bracket, a bar). */
export const SLACK = 8;
const MIN_SKELETON = 12;
const MAX_GAP = 400;

/** The copy's rows cleaned the way regionText cleans a screen: margin and quote bars off every row after the first. */
function cleaned(copied) {
  return copied.split("\n").map((row, i) => (i === 0 ? row : row.replace(/^ {1,2}/, "")).replace(/^(?:▎ ?)+/, "")).join("\n");
}

/**
 * Every gap between two consecutive located tokens of a message, as a case.
 * @returns {Array<{message:number, from:object, to:object, copied:string, lo:number, hi:number, occurrences:number[]}>}
 */
export function gapCases({ messages, rows, width }) {
  const loc = locateOnScreen(rows, messages.flatMap((m) => m.tokens.map((t) => t.id)));
  const regions = messageRegions(rows);
  if (regions.length !== messages.length) return [];
  const skeletons = regions.map((r) => skeleton(regionText(rows, r)));
  const cases = [];
  for (const m of messages) {
    if (m.blocks?.some((b) => b.kind === "table")) continue;
    const tokens = m.tokens.slice().sort((a, b) => a.start - b.start).filter((t) => loc.where.has(t.id));
    for (let k = 0; k + 1 < tokens.length; k += 1) {
      const [a, b] = [tokens[k], tokens[k + 1]];
      const from = endPos(loc.where.get(a.id), a.id.length);
      const to = charPos(loc.where.get(b.id), 0);
      if (to.row < from.row || (to.row === from.row && to.col <= from.col) || b.start - a.end > MAX_GAP) continue;
      const copied = selectionText(rows, from, to);
      const key = skeleton(cleaned(copied));
      if (key.length < MIN_SKELETON) continue;
      const occurrences = skeletons.flatMap((s, i) => (s.includes(key) ? [i] : []));
      if (!occurrences.includes(m.index)) continue; // cannot be checked against the screen
      cases.push({ message: m.index, width, from, to, copied, lo: a.end, hi: b.start, occurrences });
    }
  }
  return cases;
}

/**
 * The outcome of one case given the matcher's answer; `texts` are the messages in session order.
 * An answer is right when it is the true message's own gap (give or take the edge markup) or the
 * very same text: two messages that hold identical source for the words are not told apart, and
 * need not be, because the slice that comes back is the same either way.
 */
export function judgeGap(c, result, texts) {
  const index = result.ok ? texts.length - 1 - result.messageIndex : null;
  const inGap = result.ok && index === c.message && result.start >= c.lo - SLACK && result.end <= c.hi + SLACK;
  const sameText = result.ok && result.source.trim() !== "" && texts[c.message].slice(Math.max(0, c.lo - SLACK), c.hi + SLACK).includes(result.source.trim());
  const right = inGap || sameText;
  if (c.occurrences.length > 1) {
    if (!result.ok) return { outcome: "refused-right", reason: result.reason };
    return { outcome: right ? "picked-right" : "picked-wrong", picked: index };
  }
  if (!result.ok) return { outcome: "refused", reason: result.reason };
  return { outcome: right ? "exact" : "wrong", picked: index };
}

/** Counts of every outcome, and the keys of the dangerous ones. */
export function summarizeGaps(rows) {
  const n = (outcome) => rows.filter((r) => r.outcome === outcome).length;
  const danger = rows.filter((r) => r.outcome === "wrong" || r.outcome === "picked-wrong");
  return {
    total: rows.length, exact: n("exact"), refused: n("refused"), wrong: n("wrong"),
    refusedRight: n("refused-right"), pickedRight: n("picked-right"), pickedWrong: n("picked-wrong"),
    dangerous: danger.length, dangerousKeys: danger.map((r) => r.key),
  };
}

/**
 * Floors of the never-guess gate. They only keep a set with nothing to get wrong (empty, or no
 * message that shares its words with another) from passing; a family C calibration set has about
 * 3,500 cases and more than 1,000 of them contested.
 */
export const GATE = Object.freeze({ minTotal: 1000, minContested: 100 });

/** Cases whose words another message also holds: the only ones on which a guess can happen. */
export const contestedOf = (s) => s.refusedRight + s.pickedRight + s.pickedWrong;

/** The never-guess gate: zero wrong and zero picked-wrong answers, over enough cases and enough contested ones. */
export function gateVerdict(summary, gate = GATE) {
  const failures = [];
  if (summary.wrong > 0) failures.push(`${summary.wrong} wrong`);
  if (summary.pickedWrong > 0) failures.push(`${summary.pickedWrong} picked-wrong`);
  if (summary.total < gate.minTotal) failures.push(`only ${summary.total} cases (need ${gate.minTotal})`);
  const contested = contestedOf(summary);
  if (contested < gate.minContested) failures.push(`only ${contested} cases with a competitor (need ${gate.minContested})`);
  return { pass: failures.length === 0, failures };
}

/** Run every width of a saved set: { rows, summary } with one row per case. */
export function tokenFreeRun({ messages, screens, find }) {
  const texts = messages.map((m) => m.text);
  const out = [];
  for (const [width, text] of Object.entries(screens)) {
    for (const c of gapCases({ messages, rows: rowsOf(text), width: Number(width) })) {
      const verdict = judgeGap(c, lookup(c.copied, texts, find), texts);
      out.push({ key: `${width}:${c.message}:${c.lo}`, width: Number(width), message: c.message, shared: c.occurrences.length, ...verdict });
    }
  }
  return { rows: out, summary: summarizeGaps(out) };
}
