// Counters for the replay trials: one Bucket per slice of the report (a width,
// a span kind, a markdown construct) and the Outcome of a single trial that is
// added to them. COUNTS ONLY: nothing here holds message text.

export interface Bucket {
  trials: number;
  exact: number;
  /** Of the exact ones: the true text came from a NEWER message that holds the same words. */
  exactFromOtherMessage: number;
  /** ok, but not the true slice: the dangerous kind. */
  wrongSlice: number;
  /** Of the wrong slices: the returned text has the same letters and digits as the true one (markup or whitespace differs only). */
  wrongSliceSameWords: number;
  noMatch: number;
  ambiguous: number;
  tooShort: number;
  empty: number;
  wrongSliceKinds: {
    otherMessage: number;
    longer: number;
    shorter: number;
    shifted: number;
  };
  negativeControl: { trials: number; falsePositives: number };
  baseline: { pasteReady: number; visibleEqual: number };
  /**
   * Of the trials that returned a slice: how many had a paste form different
   * from the exact slice (container prefixes dropped, indentation restored),
   * and how many had a paste form holding a character the slice does not
   * (must be zero: paste never invents text).
   */
  paste: { differs: number; invented: number };
}

export function newBucket(): Bucket {
  return {
    trials: 0,
    exact: 0,
    exactFromOtherMessage: 0,
    wrongSlice: 0,
    wrongSliceSameWords: 0,
    noMatch: 0,
    ambiguous: 0,
    tooShort: 0,
    empty: 0,
    wrongSliceKinds: { otherMessage: 0, longer: 0, shorter: 0, shifted: 0 },
    negativeControl: { trials: 0, falsePositives: 0 },
    baseline: { pasteReady: 0, visibleEqual: 0 },
    paste: { differs: 0, invented: 0 },
  };
}

export interface Outcome {
  kind: "exact" | "wrongSlice" | "noMatch" | "ambiguous" | "tooShort" | "empty";
  wrongKind?: keyof Bucket["wrongSliceKinds"];
  fromOtherMessage?: boolean;
  sameWords?: boolean;
  controlFalsePositive?: boolean;
  baselineReady: boolean;
  baselineVisible: boolean;
  pasteDiffers?: boolean;
  pasteInvented?: boolean;
}

export function record(bucket: Bucket, o: Outcome): void {
  bucket.trials++;
  bucket[o.kind]++;
  if (o.wrongKind !== undefined) bucket.wrongSliceKinds[o.wrongKind]++;
  if (o.fromOtherMessage === true) bucket.exactFromOtherMessage++;
  if (o.sameWords === true) bucket.wrongSliceSameWords++;
  bucket.negativeControl.trials++;
  if (o.controlFalsePositive === true) bucket.negativeControl.falsePositives++;
  if (o.baselineReady) bucket.baseline.pasteReady++;
  if (o.baselineVisible) bucket.baseline.visibleEqual++;
  if (o.pasteDiffers === true) bucket.paste.differs++;
  if (o.pasteInvented === true) bucket.paste.invented++;
}
