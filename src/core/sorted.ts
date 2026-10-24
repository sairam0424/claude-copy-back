// Binary search over ascending Int32Arrays (list-marker positions, content
// line offsets). Pure helpers shared by the matcher and the paste step.

/** Index of the first element >= `value`, or -1 when every element is smaller. */
export function lowerBound(values: Int32Array, value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo < values.length ? lo : -1;
}

/** The first element in [from, to), or null. */
export function firstWithin(
  values: Int32Array,
  from: number,
  to: number,
): number | null {
  const at = lowerBound(values, from);
  if (at < 0) return null;
  const value = values[at] as number;
  return value < to ? value : null;
}
