import { describe, expect, it } from 'vitest';
import { analyze, coachHint } from '../src/lib/metrics';
describe('metrics', () => {
  it('computes RMS and crossings', () => {
    const r = analyze([-1, 1, -1, 1], 0.04);
    expect(r.rms).toBeGreaterThan(0);
    expect(r.crossings).toBe(3);
  });
  it('warns about high amplitude oscillation', () => {
    const hint = coachHint([-10, 10, -10, 10, -10, 10], 0, 0.8, 0.5, 20);
    expect(hint.toLowerCase()).toContain('oscillation');
  });
});
