import { describe, expect, it } from 'vitest';
import { LineBuffer, parseLine } from '../src/lib/protocol';

const base = 'D,15230,-1.82,12.4,0,-18.2,-0.6,-7.4,-26.2,-26,-26,10,0.5,0.8,11.7,1';

describe('protocol', () => {
  it('parses telemetry', () => {
    const parsed = parseLine(base);
    expect(parsed?.kind).toBe('telemetry');
  });
  it('rejects malformed and short telemetry', () => {
    expect(parseLine('D,1,bad,3')).toBeNull();
    expect(parseLine('D,1')).toBeNull();
  });
  it('16-field line has no x', () => {
    const p = parseLine(base);
    expect(p?.kind).toBe('telemetry');
    expect(p?.kind === 'telemetry' && p.data.x).toBeUndefined();
  });
  it('17-field line carries x', () => {
    const p = parseLine(base + ',0.125');
    expect(p?.kind === 'telemetry' && p.data.x).toBe(0.125);
  });
  it('bad or extra x field is a bad packet', () => {
    expect(parseLine(base + ',abc')).toBeNull();
    expect(parseLine(base + ',')).toBeNull();
    expect(parseLine(base + ',1,2')).toBeNull();
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
