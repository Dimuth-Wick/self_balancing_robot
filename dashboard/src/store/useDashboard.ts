import { create } from 'zustand';
import type { Telemetry } from '../lib/protocol';
import { RingBuffer, type TelemetryRingRow } from '../lib/ringbuffer';
import { SIM_DEFAULT_GAINS, type Gains } from '../lib/physics';
import { PositionEstimator } from '../lib/positionEstimator';

export type EventItem = { time: number; text: string; kind: 'info' | 'warning' | 'fall' | 'param' };
export type GainSetName = 'sim' | 'robot';

const ROBOT_DEFAULT_GAINS: Gains = { kp: 10, ki: 0.5, kd: 0.8, sp: 0 };
const GAINS_KEY = 'dashboard-gains';

export function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLS(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}

function loadGainSets(): { sim: Gains; robot: Gains } {
  const fallback = { sim: { ...SIM_DEFAULT_GAINS }, robot: { ...ROBOT_DEFAULT_GAINS } };
  try {
    const saved = JSON.parse(readLS(GAINS_KEY) || 'null') as Partial<{ sim: Gains; robot: Gains }> | null;
    if (!saved) return fallback;
    return { sim: { ...fallback.sim, ...saved.sim }, robot: { ...fallback.robot, ...saved.robot } };
  } catch { return fallback; }
}

const estimator = new PositionEstimator();

type Dashboard = {
  telemetry: Telemetry | null;
  ring: RingBuffer;
  badPackets: number;
  packets: number;
  lastPacketAt: number;
  connected: boolean;
  simulator: boolean;
  consoleLines: string[];
  events: EventItem[];
  fallCount: number;
  recording: boolean;
  replayRows: TelemetryRingRow[];
  replayIndex: number;
  replayPlaying: boolean;
  theme: 'dark' | 'light';
  windowSeconds: number;
  paused: boolean;
  gainSets: { sim: Gains; robot: Gains };
  activeSet: GainSetName;
  requested: Gains;
  requestedOrigin: 'user' | 'system';
  awaitingRobotGains: boolean;
  pos: { x: number; estimated: boolean };
  displayOrigin: number;
  setRequested: (v: Partial<Gains>, origin?: 'user' | 'system') => void;
  selectGainSet: (set: GainSetName) => void;
  resetSimGains: () => void;
  recenter: () => void;
  showReplayRow: (row: TelemetryRingRow) => void;
  setValue: (row: Telemetry) => void;
  addRaw: (line: string) => void;
  addEvent: (text: string, kind?: EventItem['kind']) => void;
  setStatus: (patch: Partial<Dashboard>) => void;
};

const initialGains = loadGainSets();

export const useDashboard = create<Dashboard>((set, get) => ({
  telemetry: null,
  ring: new RingBuffer(),
  badPackets: 0, packets: 0, lastPacketAt: 0,
  connected: false, simulator: true,
  consoleLines: [], events: [], fallCount: 0,
  recording: false, replayRows: [], replayIndex: 0, replayPlaying: false,
  theme: (readLS('dashboard-theme') as 'dark' | 'light') || 'dark',
  windowSeconds: Number(readLS('dashboard-window') || 10),
  paused: false,
  gainSets: initialGains,
  activeSet: 'sim',
  requested: { ...initialGains.sim },
  requestedOrigin: 'system',
  awaitingRobotGains: false,
  pos: { x: 0, estimated: false },
  displayOrigin: 0,

  setRequested: (v, origin = 'user') => set((s) => {
    const requested = { ...s.requested, ...v };
    const gainSets = { ...s.gainSets, [s.activeSet]: requested };
    writeLS(GAINS_KEY, JSON.stringify(gainSets));
    return { requested, gainSets, requestedOrigin: origin };
  }),
  selectGainSet: (name) => set((s) => ({ activeSet: name, requested: { ...s.gainSets[name] }, requestedOrigin: 'system' })),
  resetSimGains: () => {
    const s = get();
    if (s.activeSet === 'sim') s.setRequested({ ...SIM_DEFAULT_GAINS }, 'user');
    else {
      const gainSets = { ...s.gainSets, sim: { ...SIM_DEFAULT_GAINS } };
      writeLS(GAINS_KEY, JSON.stringify(gainSets));
      set({ gainSets });
    }
  },
  recenter: () => {
    const { pos } = get();
    if (pos.estimated) { estimator.reset(); set({ pos: { x: 0, estimated: true }, displayOrigin: 0 }); }
    else set({ displayOrigin: pos.x });
  },
  showReplayRow: (row) => set((s) => ({
    telemetry: {
      ms: Math.round(row.t * 1000), angle: row.angle, gyro: row.gyro, sp: row.sp,
      pT: row.p, iT: row.i, dT: row.d, out: row.out, pwmL: row.pwmL, pwmR: row.pwmR,
      kp: s.requested.kp, ki: s.requested.ki, kd: s.requested.kd,
      vbat: row.vbat, state: row.state, pcTimestamp: Date.now(), x: row.x,
    },
    pos: { x: row.x, estimated: row.xEstimated },
  })),
  setValue: (t) => {
    const s = get();
    const prev = s.telemetry;
    if (prev && prev.state !== 2 && t.state === 2) {
      s.addEvent('Robot fell — motors lost balance', 'fall');
      set((st) => ({ fallCount: st.fallCount + 1 }));
    }
    const pos = t.x !== undefined ? { x: t.x, estimated: false } : { x: estimator.update(t), estimated: true };
    if (s.awaitingRobotGains) {
      set({ awaitingRobotGains: false });
      get().setRequested({ kp: t.kp, ki: t.ki, kd: t.kd, sp: t.sp }, 'system');
    }
    s.ring.push({ t: t.pcTimestamp / 1000, angle: t.angle, gyro: t.gyro, sp: t.sp,
      p: t.pT, i: t.iT, d: t.dT, out: t.out, pwmL: t.pwmL, pwmR: t.pwmR,
      vbat: t.vbat, state: t.state, x: pos.x, xEstimated: pos.estimated });
    set({ telemetry: t, pos, packets: get().packets + 1, lastPacketAt: Date.now() });
  },
  addRaw: (line) => set((s) => ({ consoleLines: [...s.consoleLines.slice(-499), `[${new Date().toLocaleTimeString()}] ${line}`] })),
  addEvent: (text, kind = 'info') => set((s) => ({ events: [...s.events.slice(-499), { time: Date.now(), text, kind }] })),
  setStatus: (patch) => set(patch),
}));
