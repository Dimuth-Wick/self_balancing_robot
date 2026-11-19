import type { DataSource } from './serial';
import {
  PHYS, SIM_DEFAULT_GAINS, createPhysState, createPidState, pidStep, stepPhysics,
  type Gains, type PhysState, type PidOut, type PidState,
} from './physics';

type Mode = 'balancing' | 'fallen' | 'off';

const DEG = 180 / Math.PI;
const FALL_DEG = 45;
const FALLEN_SECONDS = 2;
const MAX_TICK_SECONDS = 0.25;
const ZERO_PID: PidOut = { pT: 0, iT: 0, dT: 0, out: 0 };

/**
 * Simulated robot: cart + inverted pendulum controlled by the firmware's
 * angle-only PID at 200 Hz, emitting protocol lines at RATE Hz.
 */
export class Simulator implements DataSource {
  private readonly rand: () => number;
  private readonly now: () => number;
  private phys: PhysState = createPhysState(1.2);
  private pid: PidState = createPidState();
  private gains: Gains = { ...SIM_DEFAULT_GAINS };
  private lastPid: PidOut = ZERO_PID;
  private mode: Mode = 'balancing';
  private fallenSteps = 0;
  private offset = 0;
  private rate = 25;
  private stepCount = 0;
  private remainder = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastNow = 0;
  private listener: ((line: string) => void) | undefined;

  constructor(opts: { rand?: () => number; now?: () => number } = {}) {
    this.rand = opts.rand ?? Math.random;
    this.now = opts.now ?? (() => performance.now());
  }

  connect(): Promise<void> { return Promise.resolve(); }
  onLine(listener: (line: string) => void) { this.listener = listener; }

  close() {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  start() {
    this.close();
    this.lastNow = this.now();
    this.timer = setInterval(() => {
      const t = this.now();
      const elapsed = Math.min(Math.max((t - this.lastNow) / 1000, 0), MAX_TICK_SECONDS);
      this.lastNow = t;
      this.advance(elapsed);
    }, 1000 / this.rate);
  }

  get mountOffset() { return this.offset; }
  setMountOffset(deg: number) {
    if (Number.isFinite(deg)) this.offset = Math.max(-3, Math.min(3, deg));
  }

  disturbance() {
    const sign = this.rand() > 0.5 ? 1 : -1;
    this.phys.omega += sign * (40 + 40 * this.rand()) / DEG;
  }

  send(command: string): void {
    const line = command.trim();
    const num = (from: number) => {
      const n = Number(line.slice(from));
      return line.length > from && Number.isFinite(n) ? n : undefined;
    };
    let value: number | undefined;
    if (line.startsWith('KP=')) { if ((value = num(3)) !== undefined) this.gains.kp = value; }
    else if (line.startsWith('KI=')) { if ((value = num(3)) !== undefined) this.gains.ki = value; }
    else if (line.startsWith('KD=')) { if ((value = num(3)) !== undefined) this.gains.kd = value; }
    else if (line.startsWith('SP=')) { if ((value = num(3)) !== undefined) this.gains.sp = value; }
    else if (line.startsWith('RATE=')) {
      if ((value = num(5)) !== undefined && value >= 1) {
        this.rate = value;
        if (this.timer !== undefined) this.start();
      }
    }
    else if (line === 'RUN=1') { if (this.mode === 'off') { this.standUp(); this.mode = 'balancing'; } }
    else if (line === 'RUN=0') { this.mode = 'off'; this.lastPid = ZERO_PID; }
    // Emulates the owner holding the robot upright and pressing ZERO:
    // the sensor reading at true upright is the mounting offset.
    else if (line === 'ZERO') this.gains.sp = Number(this.offset.toFixed(2));
    else if (line === 'GET') {
      const g = this.gains;
      this.emit(`I,Simulator gains KP=${g.kp} KI=${g.ki} KD=${g.kd} SP=${g.sp}`);
      return;
    }
    this.emit(`A,${line}`);
  }

  /** Advance simulated time; runs fixed 200 Hz steps and emits telemetry at RATE Hz. */
  advance(seconds: number) {
    this.remainder += seconds;
    while (this.remainder >= PHYS.dt - 1e-12) {
      this.remainder -= PHYS.dt;
      this.step();
      this.stepCount++;
      const every = Math.max(1, Math.round(1 / (PHYS.dt * this.rate)));
      if (this.stepCount % every === 0) this.emit(this.telemetryLine());
    }
  }

  private step() {
    const s = this.phys;
    if (this.mode === 'balancing') {
      this.lastPid = pidStep(this.pid, this.gains, this.measuredDeg(), PHYS.dt);
      stepPhysics(s, this.lastPid.out, PHYS.dt, this.rand);
      if (Math.abs(s.theta * DEG) > FALL_DEG) {
        this.mode = 'fallen';
        this.fallenSteps = Math.round(FALLEN_SECONDS / PHYS.dt);
        this.lastPid = ZERO_PID;
        s.v = 0;
        s.uEff = 0;
      }
    } else if (this.mode === 'fallen') {
      const x = s.x;
      stepPhysics(s, 0, PHYS.dt, this.rand);
      s.x = x;
      s.v = 0;
      if (--this.fallenSteps <= 0) { this.standUp(); this.mode = 'balancing'; }
    } else {
      stepPhysics(s, 0, PHYS.dt, this.rand);
    }
    if (Math.abs(s.theta * DEG) >= 90) {
      s.theta = Math.sign(s.theta) * Math.PI / 2;
      s.omega = 0;
      s.v = 0;
    }
  }

  private standUp() {
    const sign = this.rand() > 0.5 ? 1 : -1;
    const x = this.phys.x;
    this.phys = createPhysState(sign * (0.5 + 1.5 * this.rand()));
    this.phys.x = x;
    this.pid = createPidState();
  }

  private measuredDeg() { return this.phys.theta * DEG + this.offset; }

  private telemetryLine(): string {
    const state = this.mode === 'balancing' ? 1 : this.mode === 'fallen' ? 2 : 0;
    const p = this.mode === 'balancing' ? this.lastPid : ZERO_PID;
    const pwm = Math.round(p.out);
    const g = this.gains;
    const ms = Math.round(this.stepCount * PHYS.dt * 1000);
    const vbat = (11.7 + (this.rand() - 0.5) * 0.05).toFixed(2);
    return `D,${ms},${this.measuredDeg().toFixed(2)},${(this.phys.omega * DEG).toFixed(1)},${g.sp},`
      + `${p.pT.toFixed(1)},${p.iT.toFixed(1)},${p.dT.toFixed(1)},${p.out.toFixed(1)},${pwm},${pwm},`
      + `${g.kp},${g.ki},${g.kd},${vbat},${state},${this.phys.x.toFixed(3)}`;
  }

  private emit(line: string) { this.listener?.(line + '\n'); }
}
