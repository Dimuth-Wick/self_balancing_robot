import { create } from 'zustand';
import type { Telemetry } from '../lib/protocol';
import { RingBuffer, type TelemetryRingRow } from '../lib/ringbuffer';

export type EventItem = { time: number; text: string; kind: 'info' | 'warning' | 'fall' | 'param' };
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
  requested: { kp: number; ki: number; kd: number; sp: number };
  setRequested: (v: Partial<Dashboard['requested']>) => void;
  setValue: (row: Telemetry) => void;
  addRaw: (line: string) => void;
  addEvent: (text: string, kind?: EventItem['kind']) => void;
  setStatus: (patch: Partial<Dashboard>) => void;
};

export const useDashboard = create<Dashboard>((set, get) => ({
  telemetry: null,
  ring: new RingBuffer(),
  badPackets: 0, packets: 0, lastPacketAt: 0,
  connected: false, simulator: true,
  consoleLines: [], events: [], fallCount: 0,
  recording: false, replayRows: [], replayIndex: 0, replayPlaying: false,
  theme: (localStorage.getItem('dashboard-theme') as 'dark' | 'light') || 'dark',
  windowSeconds: Number(localStorage.getItem('dashboard-window') || 10),
  paused: false,
  requested: { kp: 10, ki: 0.5, kd: 0.8, sp: 0 },
  setRequested: (v) => set((s) => ({ requested: { ...s.requested, ...v } })),
  setValue: (t) => {
    const prev = get().telemetry;
    if (prev && prev.state !== 2 && t.state === 2) {
      get().addEvent('Robot fell — motors lost balance', 'fall');
      set((s) => ({ fallCount: s.fallCount + 1 }));
    }
    get().ring.push({ t: t.pcTimestamp / 1000, angle: t.angle, gyro: t.gyro, sp: t.sp,
      p: t.pT, i: t.iT, d: t.dT, out: t.out, pwmL: t.pwmL, pwmR: t.pwmR,
      vbat: t.vbat, state: t.state, x: t.x ?? 0, xEstimated: t.x === undefined });
    set({ telemetry: t, packets: get().packets + 1, lastPacketAt: Date.now() });
  },
  addRaw: (line) => set((s) => ({ consoleLines: [...s.consoleLines.slice(-499), `[${new Date().toLocaleTimeString()}] ${line}`] })),
  addEvent: (text, kind = 'info') => set((s) => ({ events: [...s.events.slice(-499), { time: Date.now(), text, kind }] })),
  setStatus: (patch) => set(patch),
}));
