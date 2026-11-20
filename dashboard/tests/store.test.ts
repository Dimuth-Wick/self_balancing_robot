// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Telemetry } from '../src/lib/protocol';

const tel = (o: Partial<Telemetry>): Telemetry => ({
  ms: 0, angle: 0, gyro: 0, sp: 0, pT: 0, iT: 0, dT: 0, out: 0, pwmL: 0, pwmR: 0,
  kp: 10, ki: 0.5, kd: 0.8, vbat: 0, state: 1, pcTimestamp: 0, ...o,
});
const load = async () => (await import('../src/store/useDashboard')).useDashboard;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  localStorage.clear();
});

describe('dashboard store', () => {
  it('uses telemetry x when present', async () => {
    const store = await load();
    store.getState().setValue(tel({ x: 1.5 }));
    expect(store.getState().pos).toEqual({ x: 1.5, estimated: false });
    expect(store.getState().ring.values().at(-1)).toMatchObject({ x: 1.5, xEstimated: false });
  });

  it('estimates x when absent', async () => {
    const store = await load();
    for (let i = 0; i < 10; i++) store.getState().setValue(tel({ ms: i * 40, pwmL: 255, pwmR: 255 }));
    const { pos } = store.getState();
    expect(pos.estimated).toBe(true);
    expect(pos.x).toBeGreaterThan(0);
  });

  it('recenter shifts display origin for true x', async () => {
    const store = await load();
    store.getState().setValue(tel({ x: 2 }));
    store.getState().recenter();
    expect(store.getState().displayOrigin).toBe(2);
    expect(store.getState().pos.x).toBe(2);
  });

  it('recenter resets an estimated position', async () => {
    const store = await load();
    for (let i = 0; i < 10; i++) store.getState().setValue(tel({ ms: i * 40, pwmL: 255, pwmR: 255 }));
    store.getState().recenter();
    expect(store.getState().pos.x).toBe(0);
    expect(store.getState().displayOrigin).toBe(0);
  });

  it('sim and robot gain sets are independent', async () => {
    const store = await load();
    store.getState().selectGainSet('sim');
    expect(store.getState().requested).toEqual({ kp: 20, ki: 0, kd: 0.8, sp: 0 });
    store.getState().setRequested({ kp: 33 });
    store.getState().selectGainSet('robot');
    expect(store.getState().requested.kp).toBe(10);
    store.getState().selectGainSet('sim');
    expect(store.getState().requested.kp).toBe(33);
  });

  it('persists gain sets', async () => {
    let store = await load();
    store.getState().selectGainSet('sim');
    store.getState().setRequested({ kd: 1.1 });
    vi.resetModules();
    store = await load();
    expect(store.getState().gainSets.sim.kd).toBe(1.1);
  });

  it('adopts robot gains once on connect without marking them as user changes', async () => {
    const store = await load();
    store.getState().selectGainSet('robot');
    store.getState().setStatus({ awaitingRobotGains: true });
    store.getState().setValue(tel({ kp: 7, ki: 0.1, kd: 0.4, sp: -1 }));
    expect(store.getState().requested).toEqual({ kp: 7, ki: 0.1, kd: 0.4, sp: -1 });
    expect(store.getState().requestedOrigin).toBe('system');
    expect(store.getState().awaitingRobotGains).toBe(false);
    store.getState().setValue(tel({ kp: 99 }));
    expect(store.getState().requested.kp).toBe(7);
  });

  it('a user change while awaiting is still a user change', async () => {
    const store = await load();
    store.getState().setStatus({ awaitingRobotGains: true });
    store.getState().setRequested({ kp: 12 });
    expect(store.getState().requestedOrigin).toBe('user');
  });

  it('resetSimGains restores sim defaults as a user change', async () => {
    const store = await load();
    store.getState().selectGainSet('sim');
    store.getState().setRequested({ kp: 3 });
    store.getState().resetSimGains();
    expect(store.getState().requested).toEqual({ kp: 20, ki: 0, kd: 0.8, sp: 0 });
    expect(store.getState().requestedOrigin).toBe('user');
  });

  it('showReplayRow sets telemetry and position without recording', async () => {
    const store = await load();
    store.getState().showReplayRow({ t: 1, angle: 4, gyro: 0, sp: 0, p: 0, i: 0, d: 0, out: 0, pwmL: 0, pwmR: 0, vbat: 0, state: 2, x: 0.3, xEstimated: true });
    const s = store.getState();
    expect(s.telemetry?.angle).toBe(4);
    expect(s.pos).toEqual({ x: 0.3, estimated: true });
    expect(s.ring.length).toBe(0);
    expect(s.fallCount).toBe(0);
  });

  it('live telemetry does not override a loaded replay', async () => {
    const store = await load();
    const row = { t: 1, angle: 4, gyro: 0, sp: 0, p: 0, i: 0, d: 0, out: 0, pwmL: 0, pwmR: 0, vbat: 0, state: 1, x: 0.3, xEstimated: false };
    store.setState({ replayRows: [row], replayIndex: 0 });
    store.getState().showReplayRow(row);
    store.getState().setValue(tel({ angle: 9, x: 5 }));
    expect(store.getState().telemetry?.angle).toBe(4);
    expect(store.getState().pos.x).toBe(0.3);
    expect(store.getState().ring.length).toBe(1);
  });

  it('loads with defaults when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const store = await load();
    expect(store.getState().gainSets.sim).toEqual({ kp: 20, ki: 0, kd: 0.8, sp: 0 });
    expect(() => store.getState().setRequested({ kp: 5 })).not.toThrow();
  });
});
