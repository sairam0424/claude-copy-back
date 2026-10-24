// Scoring of one screen (one width) from rows already in memory: choose spans,
// build the copied text, run the matcher and the controls. Pure given its
// inputs, so tests can feed canned pane text and a fake or real matcher.

import { evaluate, hasTokenDigits } from "./evaluate.mjs";
import { copiesFor, locateOnScreen } from "./screen.mjs";
import { chooseSpans } from "./spans.mjs";
import { mixSeed } from "./prng.mjs";

/**
 * @param {object} o
 * @param {object[]} o.messages generator messages
 * @param {string[]} o.twins twin text per message index
 * @param {string[]} o.rows the screen rows of this width
 * @param {number} o.width
 * @param {number} o.seed
 * @param {number} o.count captures wanted
 * @param {string[]} o.classes construct classes to spread the captures over
 * @param {Function} [o.find] matcher override (tests)
 */
export function scoreRows({ messages, twins, rows, width, seed, count, classes, find }) {
  const ids = messages.flatMap((m) => m.tokens.map((t) => t.id));
  const loc = locateOnScreen(rows, ids);
  const spans = chooseSpans({ messages, locatable: loc.locatable, seed: mixSeed(seed, width), count, classes });
  const texts = messages.map((m) => m.text);
  const records = [];
  for (const span of spans) {
    const copy = copiesFor(rows, loc.where, span, width);
    if (!copy) continue;
    const main = evaluate(span, copy.trimmed, texts, twins[span.message], find);
    const padded = evaluate(span, copy.padded, texts, twins[span.message], find);
    records.push({
      width, ...span, rowsSpanned: copy.rowsSpanned, copied: copy.trimmed, kind: main.kind,
      sourceExact: main.sourceExact, pasteOk: main.pasteOk, control: main.control,
      digits: hasTokenDigits(copy.trimmed), padded: { kind: padded.kind, control: padded.control, copied: copy.padded },
    });
  }
  const split = [...loc.where.values()].filter((s) => s.length > 1).length;
  const locate = { rows: rows.length, tokens: ids.length, locatable: loc.locatable.size, missing: loc.missing.length, repeated: loc.repeated.length, split };
  return { records, locate };
}
