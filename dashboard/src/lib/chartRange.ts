/**
 * Y-axis range that fits the visible data tightly, so small changes fill the
 * chart, but never narrower than `minSpan` (keeps sensor noise on a flat
 * signal from being blown up to full height). Adds 10% headroom.
 */
export function fitRange(min: number | null, max: number | null, minSpan: number): [number, number] {
  const lo = min ?? 0;
  const hi = max ?? 0;
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, minSpan / 2) * 1.1;
  return [mid - half, mid + half];
}
