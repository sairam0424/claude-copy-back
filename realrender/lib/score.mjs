// Classification and tallies. Definitions are the pre-registered ones in
// rule.mjs. Nothing here reads the matcher: it only compares the result a
// caller hands in with the generator's expected slice.

export const KINDS = ["exact", "wrong-slice", "no-match", "ambiguous", "too-short", "empty"];

/**
 * @param {{ok: boolean, reason?: string, source?: string, paste?: string}} result findSource output
 * @param {{expected: string, pasteForms: string[]}} cap the generator's expectation
 */
export function classify(result, cap) {
  if (!result.ok) return { kind: result.reason, sourceExact: false, pasteOk: false };
  const sourceExact = result.source.trim() === cap.expected.trim();
  const pasteOk = cap.pasteForms.includes(result.paste.trim());
  return { kind: sourceExact && pasteOk ? "exact" : "wrong-slice", sourceExact, pasteOk };
}

const emptyCounts = () => Object.fromEntries(["total", ...KINDS].map((k) => [k, 0]));

function bump(table, key, kind) {
  table[key] ??= emptyCounts();
  table[key].total += 1;
  table[key][kind] += 1;
}

const lengthBucket = (n) => (n < 50 ? "12-49" : n < 150 ? "50-149" : n < 300 ? "150-299" : "300-420");

/** Counts overall and by width, anchor construct, covered construct, inline feature, start mode, length and wrap. */
export function summarize(records) {
  const out = { overall: emptyCounts(), width: {}, anchor: {}, covers: {}, features: {}, startMode: {}, endMode: {}, length: {}, wrap: {} };
  for (const r of records) {
    out.overall.total += 1;
    out.overall[r.kind] += 1;
    bump(out.width, r.width, r.kind);
    bump(out.anchor, r.anchor, r.kind);
    r.covers.forEach((c) => bump(out.covers, c, r.kind));
    r.features.forEach((f) => bump(out.features, f, r.kind));
    bump(out.startMode, r.startMode, r.kind);
    bump(out.endMode, r.endMode, r.kind);
    bump(out.length, lengthBucket(r.length), r.kind);
    bump(out.wrap, r.rowsSpanned > 1 ? "multi-row" : "one-row", r.kind);
  }
  return out;
}

/** Percentage with one decimal, "-" for an empty denominator. */
export function pct(part, whole) {
  return whole === 0 ? "-" : `${((100 * part) / whole).toFixed(1)}%`;
}

/** Plain-text table of counts for the report. */
export function tableText(title, table) {
  const lines = [`${title}`, `  key            total  exact  wrong  nomatch  ambig  short  empty  exact%`];
  for (const [key, c] of Object.entries(table)) {
    const cells = [c.total, c.exact, c["wrong-slice"], c["no-match"], c.ambiguous, c["too-short"], c.empty].map((n) => String(n).padStart(5));
    lines.push(`  ${String(key).padEnd(14)} ${cells.join("  ")}  ${pct(c.exact, c.total).padStart(6)}`);
  }
  return lines.join("\n");
}
