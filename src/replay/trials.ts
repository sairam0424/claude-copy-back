// Replay trials: for each sampled message and width, select a random span on
// the simulated screen, copy it the way a terminal would, run the matcher
// against that message plus ~39 other sampled messages (newest first), and
// count what came back. COUNTS ONLY: this module never returns message text.

import { findSource, projectedOf, setMatchCacheLimit } from "../core/match.ts";
import type { FindOptions, FindResult } from "../core/match.ts";
import { project, projectText } from "../core/project.ts";
import type { Projection } from "../core/project.ts";
import { endsWithLoneMarker, startsWithMarker, stripDecoration } from "../core/strip.ts";
import { parseBlocks } from "../core/blocks.ts";
import { copySpan } from "../sim/copy.ts";
import { mulberry32, randInt } from "../sim/prng.ts";
import { trueSlice } from "../sim/truth.ts";
import { baselineClean } from "./baseline.ts";
import { CONSTRUCTS, constructsOf } from "./constructs.ts";
import type { Construct } from "./constructs.ts";
import { newBucket, record } from "./buckets.ts";
import type { Bucket, Outcome } from "./buckets.ts";
import { chooseSpan } from "./spans.ts";
import type { Span } from "./spans.ts";

export { newBucket };
export type { Bucket };

export interface TrialConfig {
  seed: number;
  widths: number[];
  spansPerMessage: number;
  /** Messages the matcher sees per trial (the true one plus windowSize - 1 others). */
  windowSize: number;
  /** Sensitivity runs: draw list bullets with this glyph on the SIMULATED screen only. */
  simBullet?: string;
  /** Match with FindOptions.newestWinsOnConflict: shows what recency alone would do. */
  newestWins?: boolean;
  /** Test seam: the matcher under test. Default findSource. */
  find?: (copied: string, messages: readonly string[], opts?: FindOptions) => FindResult;
}

export interface TrialReport {
  config: TrialConfig;
  spansSkipped: number;
  perWidth: Record<string, Bucket>;
  total: Bucket;
  bySpanKind: {
    wrap: Bucket;
    noWrap: Bucket;
    midWord: Bucket;
    wordEdges: Bucket;
  };
  byConstruct: Record<string, Bucket & { messages: number }>;
  /** For every non-exact outcome kind: how many trials had each structural property. Counts only. */
  failureFacts: Record<string, Record<string, number>>;
  content: {
    messages: number;
    messagesWithTable: number;
    tableSourceShare: number;
    perConstructMessages: Record<string, number>;
  };
}

/** Letters and digits only: "does this message contain these words", whatever the glyphs and markers. */
const loose = (s: string): string => s.replace(/[^\p{L}\p{N}]+/gu, "");

/** Structural facts about a trial (positions relative to list markers). Never content. */
export function factsOf(
  source: string,
  bullet: string | undefined,
  span: { from: number; to: number },
  copied: string,
): Record<string, boolean> {
  const { leadAt } = projectText(source, bullet);
  const at = new Set(leadAt);
  let inside = false;
  for (let i = span.from; i < span.to; i++) if (at.has(i)) inside = true;
  const plain = stripDecoration(copied);
  return {
    messageHasMarkers: leadAt.length > 0,
    spanStartsAtMarker: at.has(span.from),
    spanEndsAtMarker: at.has(span.to - 1),
    spanContainsMarker: inside,
    copyStartsMarkerLike: startsWithMarker(plain),
    copyEndsOnLoneMarker: endsWithLoneMarker(plain),
    copyIsOneRow: !copied.includes("\n"),
  };
}

/** `n` distinct indices below `size`, never `skip`. */
function otherIndices(
  rng: () => number,
  size: number,
  skip: number,
  n: number,
): number[] {
  const pool: number[] = [];
  for (let k = 0; k < size; k++) if (k !== skip) pool.push(k);
  const take = Math.min(n, pool.length);
  for (let k = 0; k < take; k++) {
    const j = k + Math.floor(rng() * (pool.length - k));
    const swap = pool[k] as number;
    pool[k] = pool[j] as number;
    pool[j] = swap;
  }
  return pool.slice(0, take);
}

/** Everything a trial needs that does not change from span to span. */
interface Context {
  pool: readonly string[];
  cfg: TrialConfig;
  rng: () => number;
  constructs: Construct[][];
  /** Letters and digits of message k's visible text (memoised). */
  skeletonOf: (k: number) => string;
}

function emptyReport(cfg: TrialConfig, messages: number): TrialReport {
  const report: TrialReport = {
    config: cfg,
    spansSkipped: 0,
    perWidth: {},
    total: newBucket(),
    bySpanKind: {
      wrap: newBucket(),
      noWrap: newBucket(),
      midWord: newBucket(),
      wordEdges: newBucket(),
    },
    byConstruct: {},
    failureFacts: {},
    content: {
      messages,
      messagesWithTable: 0,
      tableSourceShare: 0,
      perConstructMessages: {},
    },
  };
  for (const c of CONSTRUCTS) {
    report.byConstruct[c] = { ...newBucket(), messages: 0 };
    report.content.perConstructMessages[c] = 0;
  }
  return report;
}

/** What the corpus holds: how many messages have a table or a construct, and how much source is table. */
function describeContent(
  report: TrialReport,
  pool: readonly string[],
  constructs: Construct[][],
): void {
  let tableChars = 0;
  let allChars = 0;
  pool.forEach((message, i) => {
    allChars += message.length;
    const blocks = parseBlocks(message, "•").filter((b) => b.kind === "table");
    if (blocks.length > 0) report.content.messagesWithTable++;
    for (const b of blocks) tableChars += b.end - b.start;
    for (const c of constructs[i] as Construct[]) {
      (report.byConstruct[c] as { messages: number }).messages++;
      report.content.perConstructMessages[c] =
        (report.content.perConstructMessages[c] ?? 0) + 1;
    }
  });
  report.content.tableSourceShare = allChars === 0 ? 0 : tableChars / allChars;
}

/** Choose what to "select": a span with the wanted wrap and word-edge mix, else a plain one. */
function drawSpan(rng: () => number, p: Projection): Span | null {
  const want = { wrap: rng() < 0.5, midWord: rng() < 0.5 };
  return (
    chooseSpan(rng, p, want) ??
    (want.wrap
      ? chooseSpan(rng, p, { wrap: false, midWord: want.midWord })
      : null)
  );
}

/** Is every character of `part` available in `whole` (as a multiset)? */
function isSubMultiset(part: string, whole: string): boolean {
  const left = new Map<string, number>();
  for (const ch of whole) left.set(ch, (left.get(ch) ?? 0) + 1);
  for (const ch of part) {
    const n = left.get(ch) ?? 0;
    if (n === 0) return false;
    left.set(ch, n - 1);
  }
  return true;
}

/** What the matcher's answer means for a trial whose true slice is `expected` (the true message is `order[...] === i`). */
function judge(
  result: FindResult,
  where: {
    order: number[];
    i: number;
    expected: string;
    trueStart: number;
    trueEnd: number;
    visible: string;
  },
): Pick<Outcome, "kind" | "wrongKind" | "fromOtherMessage" | "sameWords"> {
  if (!result.ok) {
    const reason = result.reason;
    return {
      kind:
        reason === "no-match"
          ? "noMatch"
          : reason === "too-short"
            ? "tooShort"
            : reason,
    };
  }
  const sameMessage = where.order[result.messageIndex] === where.i;
  if (result.source.trim() === where.expected)
    return { kind: "exact", fromOtherMessage: !sameMessage };
  const sameWords = loose(projectText(result.source).projected) === loose(where.visible);
  if (!sameMessage)
    return { kind: "wrongSlice", wrongKind: "otherMessage", sameWords };
  const { start, end } = result;
  const wrongKind =
    start <= where.trueStart && end >= where.trueEnd
      ? "longer"
      : start >= where.trueStart && end <= where.trueEnd
        ? "shorter"
        : "shifted";
  return { kind: "wrongSlice", wrongKind, sameWords };
}

/** Counts only: for a non-exact trial (or a negative-control false positive), which structural properties it had. */
function noteFacts(
  report: TrialReport,
  kind: Outcome["kind"] | "controlFalsePositive",
  facts: Record<string, boolean>,
): void {
  const into = (report.failureFacts[kind] ??= {});
  into["trials"] = (into["trials"] ?? 0) + 1;
  for (const [name, on] of Object.entries(facts))
    if (on) into[name] = (into[name] ?? 0) + 1;
}

/**
 * The paste-form facts of an answer (none for a refusal). The paste form may
 * restore blanks in front of the slice, so "nothing invented" is checked
 * against the message from the start of the slice's first line to its end.
 */
function pasteFacts(
  result: FindResult,
  message: string,
): Pick<Outcome, "pasteDiffers" | "pasteInvented"> {
  if (!result.ok) return {};
  const lineStart = result.start <= 0 ? 0 : message.lastIndexOf("\n", result.start - 1) + 1;
  return {
    pasteDiffers: result.paste !== result.source,
    pasteInvented: !isSubMultiset(result.paste, message.slice(lineStart, result.end)),
  };
}

/** Counts-only diagnostics for a non-exact trial or a negative-control false positive. */
function noteFailure(
  report: TrialReport,
  cfg: TrialConfig,
  outcome: Outcome,
  context: { source: string; span: Span; copied: string },
): void {
  const control = outcome.controlFalsePositive === true;
  if (outcome.kind === "exact" && !control) return;
  const facts = factsOf(context.source, cfg.simBullet, context.span, context.copied);
  if (outcome.kind !== "exact") noteFacts(report, outcome.kind, facts);
  if (control) noteFacts(report, "controlFalsePositive", facts);
}

/** One simulated selection: copy it, search for it among `windowSize` messages, score the answer. */
function runTrial(
  ctx: Context,
  report: TrialReport,
  p: Projection,
  span: Span,
  width: number,
  i: number,
): Outcome {
  const { pool, cfg, rng } = ctx;
  const source = pool[i] as string;
  const copied = copySpan(p, span.from, span.to, {
    width,
    pad: rng() < 0.85,
    marginOnFirstRow: rng() < 0.5,
    eol: rng() < 0.05 ? "\r\n" : "\n",
    ansi: rng() < 0.05,
  });
  const expected = trueSlice(source, p, span.from, span.to);
  const trueStart = p.map[span.from] as number;
  const trueEnd = (p.map[span.to - 1] as number) + 1;

  const others = otherIndices(rng, pool.length, i, cfg.windowSize - 1);
  const at = randInt(rng, 0, others.length);
  const order = [...others.slice(0, at), i, ...others.slice(at)];
  const find = cfg.find ?? findSource;
  const options: FindOptions = cfg.newestWins === true ? { newestWinsOnConflict: true } : {};
  const result = find(copied, order.map((k) => pool[k] as string), options);
  const visible = p.projected.slice(span.from, span.to);
  const judged = judge(result, { order, i, expected, trueStart, trueEnd, visible });

  // negative control: the same copy against messages that do not contain it
  const skeleton = loose(visible);
  const without = others.filter((k) => !ctx.skeletonOf(k).includes(skeleton));
  const control = find(copied, without.map((k) => pool[k] as string), options);

  const base = baselineClean(copied);
  const outcome: Outcome = {
    ...judged,
    controlFalsePositive: control.ok,
    baselineReady: base === expected,
    baselineVisible: base === visible,
    ...pasteFacts(result, result.ok ? (pool[order[result.messageIndex] as number] as string) : ""),
  };
  noteFailure(report, cfg, outcome, { source, span, copied });
  return outcome;
}

/** Add one outcome to the width bucket, the total, the span-kind buckets and the message's construct buckets. */
function tally(
  report: TrialReport,
  bucket: Bucket,
  span: Span,
  constructs: readonly Construct[],
  outcome: Outcome,
): void {
  record(bucket, outcome);
  record(report.total, outcome);
  record(span.wraps ? report.bySpanKind.wrap : report.bySpanKind.noWrap, outcome);
  record(
    span.midWord ? report.bySpanKind.midWord : report.bySpanKind.wordEdges,
    outcome,
  );
  for (const c of constructs) record(report.byConstruct[c] as Bucket, outcome);
}

export function runTrials(
  pool: readonly string[],
  cfg: TrialConfig,
): TrialReport {
  setMatchCacheLimit(Math.max(300, pool.length + 64));
  const skeletons = new Map<number, string>();
  const ctx: Context = {
    pool,
    cfg,
    rng: mulberry32((cfg.seed * 2654435761) >>> 0),
    constructs: pool.map(constructsOf),
    skeletonOf: (k) => {
      let s = skeletons.get(k);
      if (s === undefined) {
        s = loose(projectedOf(pool[k] as string));
        skeletons.set(k, s);
      }
      return s;
    },
  };
  const report = emptyReport(cfg, pool.length);
  describeContent(report, pool, ctx.constructs);

  for (const width of cfg.widths) {
    const bucket = newBucket();
    report.perWidth[String(width)] = bucket;
    for (let i = 0; i < pool.length; i++) {
      const p = project(
        pool[i] as string,
        cfg.simBullet === undefined ? { width } : { width, bullet: cfg.simBullet },
      );
      for (let s = 0; s < cfg.spansPerMessage; s++) {
        const span = drawSpan(ctx.rng, p);
        if (span === null) {
          report.spansSkipped++;
          continue;
        }
        const outcome = runTrial(ctx, report, p, span, width, i);
        tally(report, bucket, span, ctx.constructs[i] as Construct[], outcome);
      }
    }
  }
  return report;
}
