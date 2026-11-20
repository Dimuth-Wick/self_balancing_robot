import { describe, expect, it } from 'vitest';
import { fitRange } from '../src/lib/chartRange';

describe('fitRange', () => {
  it('zooms tightly onto a small balancing wobble', () => {
    const [lo, hi] = fitRange(-0.12, 0.08, 0.2);
    expect(lo).toBeLessThanOrEqual(-0.12);
    expect(hi).toBeGreaterThanOrEqual(0.08);
    expect(hi - lo).toBeLessThan(0.5);
  });
  it('never zooms in past the minimum span on a flat line', () => {
    const [lo, hi] = fitRange(11.7, 11.7, 0.1);
    expect(hi - lo).toBeCloseTo(0.11, 2);
    expect((lo + hi) / 2).toBeCloseTo(11.7, 5);
  });
  it('fits large swings with a little headroom', () => {
    const [lo, hi] = fitRange(-30, 40, 0.2);
    expect(lo).toBeLessThan(-30);
    expect(hi).toBeGreaterThan(40);
    expect(hi - lo).toBeLessThan(80);
  });
  it('falls back to the minimum span with no data', () => {
    const [lo, hi] = fitRange(null, null, 2);
    expect(hi - lo).toBeCloseTo(2.2, 5);
  });
});
