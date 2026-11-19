import { describe, expect, it } from 'vitest';
import { RingBuffer, type TelemetryRingRow } from '../src/lib/ringbuffer';

describe('ring buffer', () => {
  it('retains newest values', () => {
    const b = new RingBuffer(3);
    for (let i = 0; i < 5; i++) b.push({ t: i, angle: i } as TelemetryRingRow);
    expect(b.values().map((r) => r.t)).toEqual([2, 3, 4]);
  });
});
