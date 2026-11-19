import { describe, expect, it } from 'vitest';
import { csvText } from '../src/lib/export';

describe('export', () => {
  it('csv includes x and x_estimated', () => {
    const row = { t: 1, angle: 2, gyro: 3, sp: 0, p: 0, i: 0, d: 0, out: 0, pwmL: 0, pwmR: 0, vbat: 11.7, state: 1, x: 0.5, xEstimated: false };
    const text = csvText([row]);
    expect(text.split('\n')[0]).toBe('pc_timestamp,angle,gyro,setpoint,p,i,d,out,pwmL,pwmR,vbat,state,x,x_estimated');
    expect(text.split('\n')[1].endsWith(',0.5,0')).toBe(true);
  });
});
