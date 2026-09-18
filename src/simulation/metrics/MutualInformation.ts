/**
 * Generic categorical mutual-information helpers.
 *
 * Everything here is domain-agnostic: it operates on arbitrary string labels,
 * so callers (MetricsCollector) map their domain values ('A' | 'B' | 'NONE',
 * booleans, BugAction, ...) to strings before calling in. All logarithms are
 * base 2 (bits). Empty input always yields 0, never NaN.
 *
 * MetricsCollector maintains these joint tables incrementally (adding /
 * removing one observation at a time as the sliding window advances) rather
 * than rebuilding them from scratch every tick, which is why `addPair` /
 * `removePair` / `emptyJointCounts` are exported alongside the pure
 * `jointCounts` builder.
 */

/** counts.get(x).get(y) = number of times (x, y) was observed; total = grand total. */
export interface JointCounts {
  counts: Map<string, Map<string, number>>;
  total: number;
}

export function emptyJointCounts(): JointCounts {
  return { counts: new Map(), total: 0 };
}

/** Add one (x, y) observation to a joint-count table, in place. */
export function addPair(joint: JointCounts, x: string, y: string): void {
  let row = joint.counts.get(x);
  if (!row) {
    row = new Map();
    joint.counts.set(x, row);
  }
  row.set(y, (row.get(y) ?? 0) + 1);
  joint.total++;
}

/**
 * Remove one (x, y) observation from a joint-count table, in place.
 * A no-op if that pair was never added (defensive; never goes negative).
 */
export function removePair(joint: JointCounts, x: string, y: string): void {
  const row = joint.counts.get(x);
  if (!row) return;
  const c = row.get(y);
  if (c === undefined) return;
  if (c <= 1) row.delete(y);
  else row.set(y, c - 1);
  if (row.size === 0) joint.counts.delete(x);
  joint.total = Math.max(0, joint.total - 1);
}

/** Build a fresh joint-count table from an iterable of (x, y) pairs. */
export function jointCounts(pairs: Iterable<readonly [string, string]>): JointCounts {
  const joint = emptyJointCounts();
  for (const [x, y] of pairs) addPair(joint, x, y);
  return joint;
}

/**
 * Mutual information I(X; Y) in bits, computed from a joint-count table:
 *   I(X;Y) = sum_{x,y} p(x,y) * log2( p(x,y) / (p(x) * p(y)) )
 * Cells with zero count are skipped (0 * log(0) is taken as 0, never NaN).
 * Returns 0 for an empty table.
 */
export function mutualInformationFromCounts(joint: JointCounts): number {
  const { counts, total } = joint;
  if (total <= 0) return 0;

  const xMarginal = new Map<string, number>();
  const yMarginal = new Map<string, number>();
  for (const [x, row] of counts) {
    let rowTotal = 0;
    for (const [y, c] of row) {
      rowTotal += c;
      yMarginal.set(y, (yMarginal.get(y) ?? 0) + c);
    }
    xMarginal.set(x, (xMarginal.get(x) ?? 0) + rowTotal);
  }

  let mi = 0;
  for (const [x, row] of counts) {
    const px = (xMarginal.get(x) ?? 0) / total;
    if (px <= 0) continue;
    for (const [y, c] of row) {
      if (c <= 0) continue;
      const py = (yMarginal.get(y) ?? 0) / total;
      if (py <= 0) continue;
      const pxy = c / total;
      mi += pxy * Math.log2(pxy / (px * py));
    }
  }
  // Guard against floating point noise producing a tiny negative value.
  return mi < 0 ? 0 : mi;
}

/**
 * Mutual information I(X; Y) in bits between two equal-length sequences of
 * categorical labels. 0 for empty input.
 */
export function mutualInformation(xs: readonly string[], ys: readonly string[]): number {
  if (xs.length === 0 || ys.length === 0) return 0;
  if (xs.length !== ys.length) {
    throw new Error(
      `mutualInformation: xs and ys must have the same length (got ${xs.length} and ${ys.length})`,
    );
  }
  const joint = emptyJointCounts();
  for (let i = 0; i < xs.length; i++) addPair(joint, xs[i], ys[i]);
  return mutualInformationFromCounts(joint);
}

/** Shannon entropy H(X) in bits of an empirical distribution. 0 for empty input. */
export function entropy(values: readonly string[]): number {
  if (values.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const total = values.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * Conditional probability table P(y | x) built from (x, y) pairs.
 * Only x values that actually occurred are present as keys.
 */
export function conditionalProbabilities(
  pairs: Iterable<readonly [string, string]>,
): Record<string, Record<string, number>> {
  const joint = jointCounts(pairs);
  const out: Record<string, Record<string, number>> = {};
  for (const [x, row] of joint.counts) {
    let rowTotal = 0;
    for (const c of row.values()) rowTotal += c;
    const outRow: Record<string, number> = {};
    for (const [y, c] of row) outRow[y] = rowTotal > 0 ? c / rowTotal : 0;
    out[x] = outRow;
  }
  return out;
}

/**
 * P(y | x = xKey) restricted to a fixed set of y keys (missing/zero cells
 * report probability 0). Used by MetricsCollector to read a single row out of
 * a running joint-count table without rebuilding it.
 */
export function rowDistribution(
  joint: JointCounts,
  xKey: string,
  yKeys: readonly string[],
): Record<string, number> {
  const row = joint.counts.get(xKey);
  let total = 0;
  if (row) for (const c of row.values()) total += c;
  const out: Record<string, number> = {};
  for (const k of yKeys) {
    const c = row?.get(k) ?? 0;
    out[k] = total > 0 ? c / total : 0;
  }
  return out;
}
