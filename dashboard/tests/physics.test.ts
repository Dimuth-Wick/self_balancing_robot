import { describe, expect, it } from 'vitest';
import {
  PHYS, SIM_DEFAULT_GAINS, createPhysState, createPidState, pidStep, seededRandom, stepPhysics, type Gains,
} from '../src/lib/physics';

const DEG = 180 / Math.PI;

function simulate(opts: {
  gains?: Partial<Gains>; offset?: number; seconds: number; thetaDeg?: number;
  control?: boolean; kickAt?: number; kickDegPerS?: number;
}) {
  const s = createPhysState(opts.thetaDeg ?? 3);
  const pid = createPidState();
  const rand = seededRandom(7);
  const gains = { ...SIM_DEFAULT_GAINS, ...opts.gains };
  const steps = Math.round(opts.seconds / PHYS.dt);
  const kickStep = opts.kickAt !== undefined ? Math.round(opts.kickAt / PHYS.dt) : -1;
  let fellAt: number | null = null;
  let maxAbsDegAfter3s = 0;
  let maxAbsV = 0;
  for (let i = 0; i < steps; i++) {
    if (i === kickStep) s.omega += (opts.kickDegPerS ?? 0) / DEG;
    const u = opts.control === false ? 0 : pidStep(pid, gains, s.theta * DEG + (opts.offset ?? 0), PHYS.dt).out;
    stepPhysics(s, u, PHYS.dt, rand);
    const deg = Math.abs(s.theta * DEG);
    if (i * PHYS.dt > 3) maxAbsDegAfter3s = Math.max(maxAbsDegAfter3s, deg);
    maxAbsV = Math.max(maxAbsV, Math.abs(s.v));
    if (deg > 45) { fellAt = i * PHYS.dt; break; }
  }
  return { fellAt, maxAbsDegAfter3s, maxAbsV, x: s.x };
}

describe('physics', () => {
  it('falls without control', () => {
    const r = simulate({ control: false, thetaDeg: 2, seconds: 3 });
    expect(r.fellAt).not.toBeNull();
    expect(r.fellAt!).toBeLessThan(1);
  });
  it('default gains balance for 60 s', () => {
    const r = simulate({ seconds: 60 });
    expect(r.fellAt).toBeNull();
    expect(r.maxAbsDegAfter3s).toBeLessThan(3);
  });
  it('Kd = 0 falls within 2 s', () => {
    expect(simulate({ gains: { kd: 0 }, seconds: 5 }).fellAt!).toBeLessThan(2);
  });
  it('very high Kp falls', () => {
    expect(simulate({ gains: { kp: 60 }, seconds: 10 }).fellAt).not.toBeNull();
  });
  it('recovers from a 60 deg/s kick', () => {
    expect(simulate({ seconds: 20, kickAt: 5, kickDegPerS: 60 }).fellAt).toBeNull();
  });
  it('setpoint error runs away and falls', () => {
    const r = simulate({ offset: 0.5, seconds: 30 });
    expect(r.maxAbsV).toBeGreaterThanOrEqual(0.9);
    expect(r.fellAt).not.toBeNull();
  });
  it('Ki does not cure a setpoint error', () => {
    expect(simulate({ offset: 0.5, gains: { ki: 0.5 }, seconds: 30 }).fellAt).not.toBeNull();
  });
  it('matching setpoint stops the run-away', () => {
    const r = simulate({ offset: 0.5, gains: { sp: 0.5 }, seconds: 30 });
    expect(r.fellAt).toBeNull();
    expect(Math.abs(r.x)).toBeLessThan(3);
  });
  it('pid clamps output and integral', () => {
    const pid = createPidState();
    const o = pidStep(pid, { kp: 100, ki: 1, kd: 0, sp: 0 }, 30, 0.005);
    expect(o.out).toBe(255);
    for (let i = 0; i < 10000; i++) pidStep(pid, { kp: 0, ki: 1, kd: 0, sp: 0 }, 30, 0.005);
    expect(pid.integral).toBe(20);
  });
});
