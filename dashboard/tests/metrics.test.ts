import { describe, expect, it } from 'vitest';
import { RUNAWAY_HINT, analyze, coachHint, detectRunaway } from '../src/lib/metrics';

const ramp = (n: number, f: (t: number) => number) => Array.from({ length: n }, (_, i) => f(i * 0.04));

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
  it('detects accelerating run-away', () => {
    expect(detectRunaway(ramp(125, (t) => 0.05 * t * t), 0.04)).toBe(true);
  });
  it('detects run-away in the negative direction', () => {
    expect(detectRunaway(ramp(125, (t) => -0.05 * t * t), 0.04)).toBe(true);
  });
  it('ignores a robot wandering slowly', () => {
    expect(detectRunaway(ramp(125, (t) => 0.05 * Math.sin(t)), 0.04)).toBe(false);
  });
  it('ignores steady slow motion', () => {
    expect(detectRunaway(ramp(125, (t) => 0.1 * t), 0.04)).toBe(false);
  });
  it('needs 5 s of data', () => {
    expect(detectRunaway(ramp(50, (t) => t * t), 0.04)).toBe(false);
  });
  it('coach puts run-away first', () => {
    expect(coachHint(Array(125).fill(0.5), 0, 0.8, 0, 20, ramp(125, (t) => 0.05 * t * t))).toBe(RUNAWAY_HINT);
  });
  it('coach no longer recommends Ki for drift', () => {
    const hint = coachHint(Array(125).fill(3), 0, 0.8, 0, 20);
    expect(hint).toContain('fix the setpoint or Zero first');
  });
});
