import { afterEach, describe, expect, it, vi } from 'vitest';
import { Simulator } from '../src/lib/simulator';
import { seededRandom } from '../src/lib/physics';
import { parseLine, type Telemetry } from '../src/lib/protocol';

function setup(seed = 3) {
  const sim = new Simulator({ rand: seededRandom(seed) });
  const lines: string[] = [];
  sim.onLine((chunk) => { for (const l of chunk.split('\n')) if (l) lines.push(l); });
  const telemetry = () => lines.map(parseLine).filter((p) => p?.kind === 'telemetry').map((p) => (p as { data: Telemetry }).data);
  return { sim, lines, telemetry };
}

afterEach(() => { vi.useRealTimers(); });

describe('simulator', () => {
  it('emits 17-field telemetry at the set rate', () => {
    const { sim, telemetry } = setup();
    sim.advance(1);
    const t = telemetry();
    expect(t.length).toBe(25);
    expect(t.every((d) => d.x !== undefined)).toBe(true);
  });

  it('balances with default gains for 30 s', () => {
    const { sim, telemetry } = setup();
    sim.advance(30);
    expect(telemetry().some((d) => d.state === 2)).toBe(false);
  });

  it('RUN=0 topples, stays down, reports state 0, never state 2', () => {
    const { sim, telemetry } = setup();
    sim.send('RUN=0');
    sim.advance(5);
    const t = telemetry();
    expect(Math.abs(t.at(-1)!.angle)).toBeGreaterThan(89);
    expect(t.every((d) => d.state === 0)).toBe(true);
  });

  it('RUN=1 stands back up and balances', () => {
    const { sim, lines, telemetry } = setup();
    sim.send('RUN=0');
    sim.advance(5);
    lines.length = 0;
    sim.send('RUN=1');
    sim.advance(10);
    const last = telemetry().at(-1)!;
    expect(last.state).toBe(1);
    expect(Math.abs(last.angle)).toBeLessThan(5);
  });

  it('falls, reports state 2 for ~2 s, then stands up where it fell', () => {
    const { sim, telemetry } = setup();
    sim.send('KD=0');
    sim.advance(2);
    const fallen = telemetry().filter((d) => d.state === 2);
    expect(fallen.length).toBeGreaterThan(0);
    const xAtFall = fallen[0].x!;
    sim.send('KD=0.8');
    sim.advance(3);
    const t = telemetry();
    const lastFallenIdx = t.map((d) => d.state).lastIndexOf(2);
    const standUp = t[lastFallenIdx + 1];
    expect(standUp.state).toBe(1);
    expect(Math.abs(standUp.x! - xAtFall)).toBeLessThan(0.01);
    const fallenSpan = t[lastFallenIdx].ms - fallen[0].ms;
    expect(fallenSpan).toBeGreaterThan(1800);
    expect(fallenSpan).toBeLessThan(2100);
  });

  it('mount offset is clamped to ±3°', () => {
    const { sim } = setup();
    sim.setMountOffset(9);
    expect(sim.mountOffset).toBe(3);
    sim.setMountOffset(-9);
    expect(sim.mountOffset).toBe(-3);
  });

  it('ZERO sets sp to the reading at true upright (the mount offset)', () => {
    const { sim, telemetry } = setup();
    sim.setMountOffset(1);
    sim.advance(2);
    sim.send('ZERO');
    sim.advance(0.1);
    expect(telemetry().at(-1)!.sp).toBeCloseTo(1, 1);
  });

  it('acks commands and ignores non-numeric values', () => {
    const { sim, lines, telemetry } = setup();
    sim.send('KP=abc');
    sim.advance(0.04);
    expect(telemetry().at(-1)!.kp).toBe(20);
    sim.send('KP=12.5');
    expect(lines).toContain('A,KP=12.5');
  });

  it('caps a long background tick at 0.25 s', () => {
    vi.useFakeTimers();
    let t = 0;
    const sim = new Simulator({ rand: seededRandom(1), now: () => t });
    const lines: string[] = [];
    sim.onLine((l) => lines.push(l));
    sim.start();
    lines.length = 0;
    t += 10_000;
    vi.advanceTimersByTime(40);
    const ms = lines.map(parseLine).filter((p) => p?.kind === 'telemetry').map((p) => (p as { data: Telemetry }).data.ms);
    expect(ms.length).toBeGreaterThan(0);
    expect(Math.max(...ms)).toBeLessThanOrEqual(260);
    sim.close();
  });

  it('start() twice keeps a single timer', () => {
    vi.useFakeTimers();
    const sim = new Simulator({ rand: seededRandom(1), now: () => 0 });
    sim.start();
    sim.start();
    expect(vi.getTimerCount()).toBe(1);
    sim.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
