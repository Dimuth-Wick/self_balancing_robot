// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// uPlot needs a real canvas; the charts are irrelevant here.
vi.mock('uplot', () => ({ default: class { setData() {} destroy() {} } }));

const serialSent: string[] = [];
vi.mock('../src/lib/serial', () => ({
  WebSerial: class {
    private listener: ((l: string) => void) | undefined;
    setBaud() {}
    onLine(l: (line: string) => void) { this.listener = l; }
    async connect() {}
    async reconnect() { return false; }
    send(cmd: string) { serialSent.push(cmd); }
    async close() {}
  },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement;

async function renderApp() {
  const { default: App } = await import('../src/App');
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => { root = createRoot(container); root.render(<App />); });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  serialSent.length = 0;
  localStorage.clear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('App', () => {
  it('renders when browser storage is blocked', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await renderApp();
    expect(container.textContent).toContain('PID tuner');
  });

  it('switching back to the simulator never sends simulator gains to the robot', async () => {
    await renderApp();
    const connect = [...container.querySelectorAll('button')].find((b) => b.textContent === 'Connect')!;
    await act(async () => { connect.click(); });
    expect(serialSent).toEqual(['GET']);
    const simBox = [...container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')]
      .find((i) => i.parentElement?.textContent?.includes('Simulator'))!;
    await act(async () => { simBox.click(); });
    const { useDashboard } = await import('../src/store/useDashboard');
    await act(async () => { useDashboard.getState().setRequested({ kp: 21 }); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(serialSent).toEqual(['GET']);
  });
});
