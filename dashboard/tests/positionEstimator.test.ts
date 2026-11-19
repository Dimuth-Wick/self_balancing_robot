import { describe, expect, it } from 'vitest';
import { PositionEstimator } from '../src/lib/positionEstimator';

const feed = (e: PositionEstimator, n: number, pwm: number, state = 1, startMs = 0) => {
  for (let i = 0; i <= n; i++) e.update({ ms: startMs + i * 40, pwmL: pwm, pwmR: pwm, state });
};

describe('position estimator', () => {
  it('constant full PWM approaches vMax', () => {
    const e = new PositionEstimator();
    feed(e, 50, 255);
    expect(e.v).toBeCloseTo(1.0, 1);
    expect(e.x).toBeGreaterThan(1.7);
    expect(e.x).toBeLessThan(2.0);
  });
  it('resets when state goes 0 → 1', () => {
    const e = new PositionEstimator();
    feed(e, 25, 255, 0);
    expect(e.x).toBeGreaterThan(0);
    e.update({ ms: 2000, pwmL: 0, pwmR: 0, state: 1 });
    expect(e.x).toBe(0);
  });
  it('resets when a fall ends, even if the first packet was already fallen', () => {
    const e = new PositionEstimator();
    e.update({ ms: 0, pwmL: 255, pwmR: 255, state: 2 });
    e.update({ ms: 40, pwmL: 255, pwmR: 255, state: 2 });
    e.update({ ms: 80, pwmL: 0, pwmR: 0, state: 1 });
    expect(e.x).toBe(0);
  });
  it('treats long gaps as 0.5 s', () => {
    const e = new PositionEstimator();
    e.update({ ms: 0, pwmL: 255, pwmR: 255, state: 1 });
    e.update({ ms: 10_000, pwmL: 255, pwmR: 255, state: 1 });
    expect(e.x).toBeLessThanOrEqual(0.5);
  });
  it('clamps to ±5 m', () => {
    const e = new PositionEstimator();
    feed(e, 500, -255);
    expect(e.x).toBe(-5);
  });
});
