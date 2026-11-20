import { describe, expect, it } from 'vitest';
import { batteryStatus } from '../src/lib/battery';

describe('batteryStatus', () => {
  it('treats 0 V as not measured', () => {
    expect(batteryStatus(0)).toBeNull();
    expect(batteryStatus(Number.NaN)).toBeNull();
  });
  it('detects a 3-cell pack and estimates charge', () => {
    const s = batteryStatus(11.7)!;
    expect(s.cells).toBe(3);
    expect(s.percent).toBeGreaterThan(50);
    expect(s.percent).toBeLessThan(80);
    expect(s.level).toBe('ok');
  });
  it('full and empty ends clamp to 100 and 0', () => {
    expect(batteryStatus(12.6)!.percent).toBe(100);
    expect(batteryStatus(13.0)!.percent).toBe(100);
    expect(batteryStatus(9.6)!.percent).toBe(0);
  });
  it('detects a 2-cell pack', () => {
    const s = batteryStatus(7.6)!;
    expect(s.cells).toBe(2);
    expect(s.percent).toBeGreaterThan(30);
  });
  it('flags low and critical charge', () => {
    expect(batteryStatus(3 * 3.68)!.level).toBe('low');
    expect(batteryStatus(3 * 3.45)!.level).toBe('critical');
  });
  it('is monotonic with voltage', () => {
    let prev = -1;
    for (let v = 9.6; v <= 12.6; v += 0.05) {
      const p = batteryStatus(v)!.percent;
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });
});
