// What the matcher knows about one message, cached: its projection (project.ts)
// and the searchable views of it. A "view" is the projected text, optionally
// with the list-marker units left out (the marker-agnostic search), plus the
// whitespace-folded forms the search runs over.

import { foldText, isSpace, unfold } from "./fold.ts";
import type { Mode } from "./fold.ts";
import { projectText } from "./project.ts";
import { lowerBound } from "./sorted.ts";

/** A searchable text plus, when units were left out, which ones (ascending indices of `projected`). */
export interface View {
  text: string;
  removed: Int32Array | null;
  fold?: string;
  skeleton?: string;
  /** Folded index -> index in `text`; built only for a message with very many hits. */
  foldIndex?: Int32Array;
  skeletonIndex?: Int32Array;
}

export interface Prepared {
  projected: string;
  map: Int32Array;
  /** Ascending indices of list-marker units. */
  leadAt: Int32Array;
  /** Ascending source offsets where each content line's own text starts. */
  contentAt: Int32Array;
  whole: View;
  markerless?: View;
  leadSrc?: Int32Array;
}

const cache = new Map<string, Prepared>();
let cacheLimit = 300;

/** Hits above this many get an O(1) folded-index lookup instead of a linear scan each. */
const LINEAR_LOCATES = 8;

export function prepare(text: string): Prepared {
  const hit = cache.get(text);
  if (hit !== undefined) return hit;
  const { projected, map, leadAt, contentAt } = projectText(text);
  const made: Prepared = {
    projected,
    map,
    leadAt,
    contentAt,
    whole: { text: projected, removed: null },
  };
  if (cache.size >= cacheLimit) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(text, made);
  return made;
}

/** How many message projections to keep (default 300). The replay harness raises it. */
export function setMatchCacheLimit(limit: number): void {
  cacheLimit = Math.max(1, Math.floor(limit));
}

/** The cached visible text of a message, shared with the search. */
export function projectedOf(message: string): string {
  return prepare(message).projected;
}

/** Forget every cached projection. Only tests that time a cold search need this. */
export function resetMatchCache(): void {
  cache.clear();
}

export function isLead(p: Prepared, index: number): boolean {
  const at = lowerBound(p.leadAt, index);
  return at >= 0 && p.leadAt[at] === index;
}

/** Source offsets of the list-marker units (for the paste step). */
export function leadSources(p: Prepared): Int32Array {
  if (p.leadSrc !== undefined) return p.leadSrc;
  const out = Int32Array.from(p.leadAt, (at) => p.map[at] as number);
  return (p.leadSrc = out.sort());
}

/** The projection with list-marker units removed (the markerless search's haystack). */
export function markerlessView(p: Prepared): View {
  if (p.markerless !== undefined) return p.markerless;
  if (p.leadAt.length === 0) return (p.markerless = p.whole);
  const parts: string[] = [];
  let from = 0;
  for (const at of p.leadAt) {
    if (at > from) parts.push(p.projected.slice(from, at));
    from = at + 1;
  }
  if (from < p.projected.length) parts.push(p.projected.slice(from));
  return (p.markerless = { text: parts.join(""), removed: p.leadAt });
}

/**
 * Index in `projected` of unit `index` of a view's text: the index plus the
 * number of removed units before it. `removed[k] - k` never decreases, so the
 * count is a binary search.
 */
export function inProjected(view: View, index: number): number {
  const gone = view.removed;
  if (gone === null) return index;
  let lo = 0;
  let hi = gone.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((gone[mid] as number) - mid <= index) lo = mid + 1;
    else hi = mid;
  }
  return index + lo;
}

export function foldedOf(view: View, mode: Mode): string {
  if (mode === "fold") return (view.fold ??= foldText(view.text, "fold"));
  return (view.skeleton ??= foldText(view.text, "skeleton"));
}

function buildIndex(view: View, mode: Mode): Int32Array {
  const { text } = view;
  const n = text.length;
  const out = new Int32Array(n);
  let k = 0;
  let i = 0;
  while (i < n) {
    if (isSpace(text.charCodeAt(i))) {
      if (mode === "fold") out[k++] = i;
      while (i < n && isSpace(text.charCodeAt(i))) i++;
    } else {
      out[k++] = i;
      i++;
    }
  }
  return out.subarray(0, k);
}

/**
 * A function from a folded index to the index in the view's text. A few hits
 * use the linear `unfold`; many hits share one precomputed index, so scanning
 * every occurrence of a repeated phrase stays linear.
 */
export function locator(
  view: View,
  mode: Mode,
  hits: number,
): (folded: number) => number {
  if (hits <= LINEAR_LOCATES)
    return (folded) => unfold(view.text, mode, folded);
  const index =
    mode === "fold"
      ? (view.foldIndex ??= buildIndex(view, mode))
      : (view.skeletonIndex ??= buildIndex(view, mode));
  const last = index.length - 1;
  return (folded) => index[Math.min(folded, last)] as number;
}
