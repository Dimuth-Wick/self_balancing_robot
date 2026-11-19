import { describe, expect, it } from 'vitest';
import { LineBuffer, parseLine } from '../src/lib/protocol';

describe('protocol', () => {
  it('parses telemetry', () => {
    const parsed = parseLine('D,15230,-1.82,12.4,0,-18.2,-0.6,-7.4,-26.2,-26,-26,10,0.5,0.8,11.7,1');
    expect(parsed?.kind).toBe('telemetry');
  });
  it('rejects malformed and short telemetry', () => {
    expect(parseLine('D,1,bad,3')).toBeNull();
    expect(parseLine('D,1')).toBeNull();
  });
  it('parses console prefixes', () => {
    expect(parseLine('I,booting')?.kind).toBe('info');
    expect(parseLine('A,KP=12.5')?.kind).toBe('ack');
    expect(parseLine('E,motor fault')?.kind).toBe('error');
  });
  it('buffers chunks across newlines', () => {
    const b = new LineBuffer();
    expect(b.feed('I,one\r')).toEqual([]);
    expect(b.feed('\nI,two\nG,x')).toEqual(['I,one', 'I,two']);
    expect(b.flush()).toEqual(['G,x']);
  });
});
