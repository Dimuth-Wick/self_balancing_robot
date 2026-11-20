// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const created: number[] = [];
const dataCalls: unknown[][] = [];
vi.mock('uplot', () => ({
  default: class {
    constructor() { created.push(1); }
    setData(d: unknown[]) { dataCalls.push(d); }
    setSize() {}
    setSeries() {}
    setScale() {}
    destroy() {}
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

describe('Charts', () => {
  it('builds each chart once and keeps feeding it data while the parent re-renders', async () => {
    const { Charts } = await import('../src/components/Charts');
    const { useDashboard } = await import('../src/store/useDashboard');
    vi.useFakeTimers();
    const el = document.createElement('div');
    document.body.appendChild(el);
    const root = createRoot(el);
    await act(async () => { root.render(<Charts />); });
    const built = created.length;
    expect(built).toBe(4);
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        useDashboard.getState().setValue({
          ms: i * 40, angle: 1, gyro: 0, sp: 0, pT: 0, iT: 0, dT: 0, out: 0, pwmL: 0, pwmR: 0,
          kp: 20, ki: 0, kd: 0.8, vbat: 11.7, state: 1, pcTimestamp: 1000 + i * 40, x: 0,
        });
        root.render(<Charts />);
        vi.advanceTimersByTime(40);
      });
    }
    expect(created.length).toBe(built);
    expect(dataCalls.length).toBeGreaterThan(0);
    act(() => root.unmount());
    vi.useRealTimers();
  });
});
