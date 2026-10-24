// Bounded substring search for the matcher.
//
// `findAll(hay, needle, meter)` answers what a loop of `hay.indexOf(needle, at
// + 1)` would: every start of the needle in the text, overlapping ones too. It
// differs in what it will not do:
//
//   - It keeps at most MAX_HITS_PER_MESSAGE starts per text, MAX_HITS_TOTAL per
//     meter, and spends at most MAX_CANDIDATE_WORK characters (hits times the
//     needle's length) per meter. Past any of them it answers `null`, and the
//     caller refuses: a copy that sits in that many places cannot be pinned to
//     one. A 12-character copy of "a" against a megabyte of "a" has a million
//     starts; keeping each as an object ran the heap out.
//   - It does not trust the engine's own `indexOf` with a big job. V8's search
//     is fast on ordinary text but can take time proportional to text length
//     times needle length on repetitive text (a mismatch in the middle of a
//     long table of identical rows: seconds per call). While the meter's
//     `native` allowance covers the worst case of the call it uses `indexOf`;
//     otherwise it uses Knuth-Morris-Pratt, which reads each character a
//     bounded number of times whatever the text is. Both answer the same.
//
// The meter is the one mutable thing here: a small counter object made for one
// `findSource` call and thrown away with it. Nothing else is kept between calls.

/** Starts kept per searched text. */
export const MAX_HITS_PER_MESSAGE = 10_000;
/** Starts kept over a whole `findSource` call. */
export const MAX_HITS_TOTAL = 200_000;
/** Hits times needle length, over a whole call (candidates are compared and sliced at that cost). */
export const MAX_CANDIDATE_WORK = 100_000_000;
/**
 * Alignments times needle length that `indexOf` may be asked to scan, over a
 * whole call: about half a second at the speed measured for its worst case.
 */
export const NATIVE_WORK = 2_000_000_000;

export interface Meter {
  /** Starts still allowed. */
  hits: number;
  /** Characters of candidate work still allowed. */
  work: number;
  /** Worst-case work still allowed for the engine's own `indexOf`. */
  native: number;
}

export function newMeter(over: Partial<Meter> = {}): Meter {
  return {
    hits: MAX_HITS_TOTAL,
    work: MAX_CANDIDATE_WORK,
    native: NATIVE_WORK,
    ...over,
  };
}

/** A needle and, once the linear search has needed it, its failure table. */
export interface Needle {
  readonly text: string;
  table: Int32Array | null;
}

export function newNeedle(text: string): Needle {
  return { text, table: null };
}

/** Knuth-Morris-Pratt failure table: for each prefix, the length of its longest proper border. */
function failureTable(text: string): Int32Array {
  const table = new Int32Array(text.length);
  let k = 0;
  for (let i = 1; i < text.length; i++) {
    const c = text.charCodeAt(i);
    while (k > 0 && c !== text.charCodeAt(k)) k = table[k - 1] as number;
    if (c === text.charCodeAt(k)) k++;
    table[i] = k;
  }
  return table;
}

/** First start at or after `from`, in time linear in the text and the needle. */
function linearIndex(hay: string, needle: Needle, from: number): number {
  const { text } = needle;
  const table = (needle.table ??= failureTable(text));
  const last = text.length;
  let k = 0;
  for (let i = from; i < hay.length; i++) {
    const c = hay.charCodeAt(i);
    while (k > 0 && c !== text.charCodeAt(k)) k = table[k - 1] as number;
    if (c === text.charCodeAt(k)) k++;
    if (k === last) return i - last + 1;
  }
  return -1;
}

/** Next start at or after `from`, by the engine's search while the meter allows it, else by the linear one. */
function nextStart(
  hay: string,
  needle: Needle,
  from: number,
  meter: Meter,
): number {
  const alignments = hay.length - needle.text.length - from + 1;
  if (alignments <= 0) return -1;
  const worst = alignments * needle.text.length;
  if (worst > meter.native) return linearIndex(hay, needle, from);
  const at = hay.indexOf(needle.text, from);
  const scanned = at < 0 ? alignments : at - from + 1;
  meter.native -= scanned * needle.text.length;
  return at;
}

/**
 * Every start of `needle` in `hay`, overlapping ones included, in order; or
 * `null` when there are more than `perMessage`, or the meter's hits or work
 * run out. An empty needle has no starts.
 */
export function findAll(
  hay: string,
  needle: Needle,
  meter: Meter,
  perMessage: number = MAX_HITS_PER_MESSAGE,
): number[] | null {
  if (needle.text === "") return [];
  const starts: number[] = [];
  let from = 0;
  for (;;) {
    const at = nextStart(hay, needle, from, meter);
    if (at < 0) return starts;
    const cost = needle.text.length;
    if (starts.length >= perMessage || meter.hits < 1 || meter.work < cost) {
      return null;
    }
    starts.push(at);
    meter.hits -= 1;
    meter.work -= cost;
    from = at + 1;
  }
}
