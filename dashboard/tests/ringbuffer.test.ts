import { describe, expect, it } from 'vitest';
import { RingBuffer, type TelemetryRingRow } from '../src/lib/ringbuffer';

const row = (t: number) => ({ t, angle: t } as TelemetryRingRow);

describe('ring buffer', () => {
  it('retains newest values', () => {
    const b = new RingBuffer(3);
    for (let i = 0; i < 5; i++) b.push(row(i));
    expect(b.values().map((r) => r.t)).toEqual([2, 3, 4]);
  });
  it('recent(n) returns the newest n rows in order, across the wrap', () => {
    const b = new RingBuffer(4);
    for (let i = 0; i < 6; i++) b.push(row(i));
    expect(b.recent(3).map((r) => r.t)).toEqual([3, 4, 5]);
    expect(b.recent(10).map((r) => r.t)).toEqual([2, 3, 4, 5]);
    expect(new RingBuffer(4).recent(2)).toEqual([]);
  });
});
