// Ground truth for a span: the source characters the span was drawn from.

import type { Projection } from "../core/project.ts";

/** Source slice from the first to the last mapped unit of [from, to), outer whitespace trimmed. */
export function trueSlice(source: string, p: Projection, from: number, to: number): string {
  return source.slice(p.map[from] as number, (p.map[to - 1] as number) + 1).trim();
}
