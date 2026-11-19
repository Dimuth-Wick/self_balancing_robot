# 3D Robot View + Cart-Pendulum Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2D SVG "Live robot" panel with an orbitable 3D scene of the robot driving along a floor, backed by a new cart + inverted-pendulum simulator and a PWM-based position estimator for the real robot.

**Architecture:** Pure, unit-tested logic modules (`physics.ts`, `positionEstimator.ts`, run-away detection in `metrics.ts`) feed the existing Zustand store, which gains a floor position, per-mode gain sets and a display origin. A lazily loaded React Three Fiber scene reads the store inside its render loop (no React re-render at telemetry rate). The old SVG becomes the Suspense / no-WebGL fallback.

**Tech Stack:** Vite 8, React 19, TypeScript, Zustand 5, vitest 5, three + @react-three/fiber 9 + @react-three/drei 10.

**Spec:** `docs/superpowers/specs/2026-11-19-3d-robot-view-design.md` (read it; this plan argues from it). Overall dashboard spec: `Claude outputs/plan.md`.

All commands run from `dashboard/` unless stated.

## Global Constraints

- Protocol: `D` line has 16 comma fields (incl. `D`) or 17 with optional trailing `x` (metres). Anything else is a bad packet. Current firmware (16 fields) must keep working.
- Angle convention: positive angle = leaning forward (+x); positive PID output drives +x.
- PID is angle-only: `error = measured − sp; out = Kp·e + Ki·∫e + Kd·de/dt`, integral clamped ±20, output clamped ±255.
- Physics constants: g = 9.81, L = 0.1 m, K = 20 m/s², B = 0, τ = 0.03 s, vMax = 1.0 m/s, dt = 1/200 s, noise on ω uniform ±0.15 °/s per step.
- Sim default gains: Kp = 20, Ki = 0, Kd = 0.8, SP = 0. Real-robot default set (before first adopt) stays Kp = 10, Ki = 0.5, Kd = 0.8, SP = 0.
- Estimator: vMax = 1.0 m/s, τm = 0.1 s, max gap 0.5 s, clamp ±5 m.
- Mounting offset slider: −3…+3°, step 0.1, default 0, sim mode only.
- Every `localStorage` access wrapped in try/catch.
- Real-robot position is always labelled "est." in the UI.
- The 3D scene must never subscribe to telemetry via React; read `useDashboard.getState()` in `useFrame`.
- Only one WebGL canvas mounted at a time.

## Review Focus

1. Browser tab in background → `setInterval` throttled → one tick with a huge elapsed time. Expected: sim advances at most 0.25 s per tick, no physics explosion. (Test in Task 3.)
2. `Simulator.start()` called twice (sim → serial → sim toggling). Expected: one timer, sim runs at real speed, not 2×. (Test in Task 3.)
3. Real robot's first packet already says state 2 (fallen at power-on), then 1. Expected: estimator resets on the 2 → 1 transition even with no prior sample. (Test in Task 4.)
4. `localStorage` throws (private window / blocked storage). Expected: store module still loads with defaults. (Test in Task 6.)
5. Importing an older JSON recording whose rows have no `x`. Expected: positions are filled by the estimator, replay and trail still work. (Test in Task 8.)

---

### Task 0: Branch and baseline commit

**Files:** none created; commits the existing untracked `dashboard/` and `docs/`.

- [ ] **Step 1:** From the repo root: `git checkout -b feat/3d-robot-view`
- [ ] **Step 2:** Verify `dashboard/.gitignore` excludes `node_modules` and `dist` (it does), then `git add dashboard docs && git commit -m "chore: baseline dashboard and 3D view spec/plan"`
- [ ] **Step 3:** In `dashboard/`, run `npm test` → expect 7 passed; `npm run build` → succeeds.

---

### Task 1: Optional `x` in protocol, ring rows and export

**Files:**
- Modify: `dashboard/src/lib/protocol.ts` (parseLine, Telemetry)
- Modify: `dashboard/src/lib/ringbuffer.ts` (TelemetryRingRow)
- Modify: `dashboard/src/lib/export.ts` (CSV header/body)
- Modify: `dashboard/src/store/useDashboard.ts:321-323` (ring push: add `x: 0, xEstimated: true` for now; Task 6 replaces)
- Test: `dashboard/tests/protocol.test.ts`, `dashboard/tests/export.test.ts` (new)

**Interfaces:**
- Produces: `Telemetry.x?: number`; `TelemetryRingRow` gains `x: number; xEstimated: boolean`; `csvText(rows: TelemetryRingRow[]): string` exported from `export.ts` (pure; `exportCsv` calls it).

- [ ] **Step 1: Write failing tests**

```ts
// protocol.test.ts
const base = 'D,15230,-1.82,12.4,0,-18.2,-0.6,-7.4,-26.2,-26,-26,10,0.5,0.8,11.7,1';
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

// export.test.ts
it('csv includes x and x_estimated', () => {
  const row = { t: 1, angle: 2, gyro: 3, sp: 0, p: 0, i: 0, d: 0, out: 0, pwmL: 0, pwmR: 0, vbat: 11.7, state: 1, x: 0.5, xEstimated: false };
  const text = csvText([row]);
  expect(text.split('\n')[0]).toBe('pc_timestamp,angle,gyro,setpoint,p,i,d,out,pwmL,pwmR,vbat,state,x,x_estimated');
  expect(text.split('\n')[1].endsWith(',0.5,0')).toBe(true);
});
```

- [ ] **Step 2:** `npx vitest run tests/protocol.test.ts tests/export.test.ts` → new tests FAIL.
- [ ] **Step 3:** Implement. In `parseLine`, `D` lines must have exactly 16 or 17 parts; an empty 17th field counts as non-finite (note `Number('') === 0`, so check the raw string is non-empty). `x_estimated` is written as `1`/`0`.
- [ ] **Step 4:** `npm test` → all pass; `npx tsc -b` → clean.
- [ ] **Step 5:** `git commit -am "feat: optional x field in telemetry, ring rows and CSV"`

---

### Task 2: Pure cart-pendulum physics + PID

**Files:**
- Create: `dashboard/src/lib/physics.ts`
- Test: `dashboard/tests/physics.test.ts`

**Interfaces:**
- Produces:
```ts
export const PHYS: { g: 9.81; L: 0.1; K: 20; B: 0; tau: 0.03; vMax: 1.0; dt: number /*1/200*/; noiseDegPerStep: 0.15 };
export type Gains = { kp: number; ki: number; kd: number; sp: number };
export const SIM_DEFAULT_GAINS: Gains; // {kp:20, ki:0, kd:0.8, sp:0}
export type PhysState = { theta: number; omega: number; x: number; v: number; uEff: number }; // rad, rad/s, m, m/s, pwm
export type PidState = { integral: number; prevError: number | null };
export type PidOut = { pT: number; iT: number; dT: number; out: number }; // out already clamped ±255
export function createPhysState(thetaDeg: number): PhysState;
export function createPidState(): PidState;
export function pidStep(pid: PidState, g: Gains, measuredDeg: number, dt: number): PidOut; // mutates pid; dT = 0 when prevError is null
export function stepPhysics(s: PhysState, u: number, dt: number, rand: () => number): void; // mutates s
export function seededRandom(seed: number): () => number; // Park–Miller, for tests
```

- [ ] **Step 1: Write failing tests.** Add a test-local helper:

```ts
function simulate(opts: { gains?: Partial<Gains>; offset?: number; seconds: number; thetaDeg?: number; control?: boolean; kickAt?: number; kickDegPerS?: number }) {
  // createPhysState(thetaDeg ?? 3), createPidState(), rand = seededRandom(7)
  // each step (PHYS.dt): if kickAt reached, omega += kick in rad/s;
  // u = control===false ? 0 : pidStep(pid, {...SIM_DEFAULT_GAINS, ...gains}, theta°+offset, dt).out
  // stepPhysics; track maxAbsDegAfter3s, maxAbsV; stop and record fellAt when |theta| > 45°
  // returns { fellAt: number | null, maxAbsDegAfter3s: number, maxAbsV: number, x: number }
}
```

Tests (values from the spec's prototype):

```ts
it('falls without control', () => { const r = simulate({ control: false, thetaDeg: 2, seconds: 3 }); expect(r.fellAt).not.toBeNull(); expect(r.fellAt!).toBeLessThan(1); });
it('default gains balance for 60 s', () => { const r = simulate({ seconds: 60 }); expect(r.fellAt).toBeNull(); expect(r.maxAbsDegAfter3s).toBeLessThan(3); });
it('Kd = 0 falls within 2 s', () => { expect(simulate({ gains: { kd: 0 }, seconds: 5 }).fellAt!).toBeLessThan(2); });
it('very high Kp falls', () => { expect(simulate({ gains: { kp: 60 }, seconds: 10 }).fellAt).not.toBeNull(); });
it('recovers from a 60 deg/s kick', () => { expect(simulate({ seconds: 20, kickAt: 5, kickDegPerS: 60 }).fellAt).toBeNull(); });
it('setpoint error runs away and falls', () => { const r = simulate({ offset: 0.5, seconds: 30 }); expect(r.maxAbsV).toBeGreaterThanOrEqual(0.9); expect(r.fellAt).not.toBeNull(); });
it('Ki does not cure a setpoint error', () => { expect(simulate({ offset: 0.5, gains: { ki: 0.5 }, seconds: 30 }).fellAt).not.toBeNull(); });
it('matching setpoint stops the run-away', () => { const r = simulate({ offset: 0.5, gains: { sp: 0.5 }, seconds: 30 }); expect(r.fellAt).toBeNull(); expect(Math.abs(r.x)).toBeLessThan(3); });
it('pid clamps output and integral', () => { const pid = createPidState(); const o = pidStep(pid, { kp: 100, ki: 1, kd: 0, sp: 0 }, 30, 0.005); expect(o.out).toBe(255); for (let i = 0; i < 10000; i++) pidStep(pid, { kp: 0, ki: 1, kd: 0, sp: 0 }, 30, 0.005); expect(pid.integral).toBe(20); });
```

- [ ] **Step 2:** `npx vitest run tests/physics.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement `physics.ts` with exactly the model in spec §6.4:

```
uEff += (u − uEff)·dt/τ
a = K·uEff/255 − B·v ; if (v ≥ vMax && a > 0) || (v ≤ −vMax && a < 0) then a = 0
omega += ((g/L)·sin θ − (1/L)·cos θ·a)·dt + (rand() − 0.5)·2·noise(rad)
theta += omega·dt ; v += a·dt ; x += v·dt
```
(Noise term: uniform in ±0.15 °/s converted to rad/s.) `pT/iT/dT` are the three contributions before clamping; `out` is the clamped sum.
- [ ] **Step 4:** `npx vitest run tests/physics.test.ts` → PASS. If a threshold fails by a small margin, re-check the model against the spec before touching constants; constants are pinned by the spec.
- [ ] **Step 5:** `git add src/lib/physics.ts tests/physics.test.ts && git commit -m "feat: cart-pendulum physics and PID"`

---

### Task 3: Simulator rewrite on top of physics

**Files:**
- Modify (rewrite): `dashboard/src/lib/simulator.ts`
- Test: `dashboard/tests/simulator.test.ts`

**Interfaces:**
- Consumes: Task 2 exports.
- Produces:
```ts
export class Simulator implements DataSource {
  constructor(opts?: { rand?: () => number; now?: () => number /* ms, default performance.now */ });
  connect(): Promise<void>; onLine(l: (line: string) => void): void; send(cmd: string): void; close(): void;
  start(): void;            // clears any previous timer first; setInterval(1000/rate); each tick calls advance(min(elapsedRealSeconds, 0.25))
  advance(seconds: number): void; // fixed 1/200 s substeps (carry remainder), emits a D line every 1/rate s of sim time
  disturbance(): void;      // omega += ±(40..80) °/s, random sign
  setMountOffset(deg: number): void; // clamps to [-3, 3]
  readonly mountOffset: number;
}
```
- Telemetry: 17 fields; `x` with 3 decimals; `ms` = sim time in ms; `kp/ki/kd/sp` = sim gains; `pwmL = pwmR = round(out)`; P/I/D/out are 0 when not balancing. Measured angle sent = θ° + mountOffset.

State machine (spec §6.4):
| mode | entered by | u | reported state |
|---|---|---|---|
| balancing | start (θ = 1.2°), RUN=1 from off, end of fallen | PID | 1 |
| fallen | balancing with \|θ\| > 45° | 0, v forced to 0 | 2 for 2 s, then stand up (θ = ±0.5..2°, ω = v = uEff = 0, PID reset), x unchanged |
| off | RUN=0 | 0 | 0 |

In any mode, when \|θ\| ≥ 90°: θ = ±90°, ω = 0, v = 0 (lying). `ZERO` sets sp = current measured angle. `SP/KP/KI/KD/RATE/GET` as today (acks `A,<cmd>`; GET replies `I,Simulator gains KP=.. KI=.. KD=.. SP=..`).

- [ ] **Step 1: Write failing tests** (collect lines via `onLine`, parse with `parseLine`; use `seededRandom(3)`):

```ts
it('emits 17-field telemetry at the set rate', () => { /* advance(1) at default 25 Hz → 25 telemetry lines, each with x defined */ });
it('balances with default gains for 30 s', () => { /* advance(30) → no line has state 2 */ });
it('RUN=0 topples, stays down, reports state 0, never state 2', () => { /* send('RUN=0'); advance(5) → last angle ≈ ±90 (|angle| > 89), all states after the ack are 0 */ });
it('RUN=1 stands back up and balances', () => { /* after the above, send('RUN=1'); advance(10) → last state 1, |last angle| < 5 */ });
it('falls, reports state 2 for ~2 s, then stands up where it fell', () => { /* send('KD=0'); advance(2) → some state 2; record x at first state-2 line; send('KD=0.8'); advance(3) → state 1 again, x at stand-up equals recorded x within 0.01 */ });
it('mount offset shifts the reported angle and is clamped', () => { /* setMountOffset(9) → mountOffset === 3 */ });
it('ZERO sets sp to measured angle', () => { /* setMountOffset(1); advance(2); send('ZERO'); advance(0.1) → last sp within 0.3 of 1 */ });
it('caps a long background tick at 0.25 s', () => {
  vi.useFakeTimers(); let t = 0; const sim = new Simulator({ rand: seededRandom(1), now: () => t });
  const lines: string[] = []; sim.onLine((l) => lines.push(l)); sim.start(); lines.length = 0;
  t += 10_000; vi.advanceTimersByTime(40);
  const ms = lines.map(parseLine).filter((p) => p?.kind === 'telemetry').map((p) => (p as any).data.ms);
  expect(Math.max(...ms) - Math.min(...ms)).toBeLessThanOrEqual(260); sim.close(); vi.useRealTimers();
});
it('start() twice keeps a single timer', () => { /* fake timers; start(); start(); advance fake clock+now 1000 ms → ~25 telemetry lines, not ~50 (assert ≤ 27) */ });
```

- [ ] **Step 2:** `npx vitest run tests/simulator.test.ts` → FAIL.
- [ ] **Step 3:** Rewrite `simulator.ts` per the interface and table above.
- [ ] **Step 4:** `npm test` → all pass.
- [ ] **Step 5:** `git commit -am "feat: simulator on cart-pendulum physics with RUN/fall state machine"`

---

### Task 4: Position estimator

**Files:**
- Create: `dashboard/src/lib/positionEstimator.ts`
- Test: `dashboard/tests/positionEstimator.test.ts`

**Interfaces:**
- Produces:
```ts
export const EST: { vMax: 1.0; tauM: 0.1; maxGap: 0.5; clamp: 5 };
export class PositionEstimator {
  x: number; v: number;
  update(s: { ms: number; pwmL: number; pwmR: number; state: number }): number; // returns x
  reset(): void;
}
```
Rules: first sample → dt = 0. dt = min((ms − prevMs)/1000, 0.5), negative → 0. Reset (x = v = 0) **before** integrating when previous state was 0 and new is 1, or previous was 2 and new ≠ 2. Target speed = vMax·((pwmL + pwmR)/2)/255; `v += (target − v)·(1 − exp(−dt/τm))`; `x += v·dt`; clamp x to ±5.

- [ ] **Step 1: Write failing tests**

```ts
const feed = (e: PositionEstimator, n: number, pwm: number, state = 1, startMs = 0) => { for (let i = 0; i <= n; i++) e.update({ ms: startMs + i * 40, pwmL: pwm, pwmR: pwm, state }); };
it('constant full PWM approaches vMax', () => { const e = new PositionEstimator(); feed(e, 50, 255); expect(e.v).toBeCloseTo(1.0, 1); expect(e.x).toBeGreaterThan(1.7); expect(e.x).toBeLessThan(2.0); });
it('resets when state goes 0 → 1', () => { const e = new PositionEstimator(); feed(e, 25, 255, 0); expect(e.x).toBeGreaterThan(0); e.update({ ms: 2000, pwmL: 0, pwmR: 0, state: 1 }); expect(e.x).toBe(0); });
it('resets when a fall ends, even if the first packet was already fallen', () => { const e = new PositionEstimator(); e.update({ ms: 0, pwmL: 255, pwmR: 255, state: 2 }); e.update({ ms: 40, pwmL: 255, pwmR: 255, state: 2 }); e.update({ ms: 80, pwmL: 0, pwmR: 0, state: 1 }); expect(e.x).toBe(0); });
it('treats long gaps as 0.5 s', () => { const e = new PositionEstimator(); e.update({ ms: 0, pwmL: 255, pwmR: 255, state: 1 }); e.update({ ms: 10_000, pwmL: 255, pwmR: 255, state: 1 }); expect(e.x).toBeLessThanOrEqual(0.5); });
it('clamps to ±5 m', () => { const e = new PositionEstimator(); feed(e, 500, -255); expect(e.x).toBe(-5); });
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git add src/lib/positionEstimator.ts tests/positionEstimator.test.ts && git commit -m "feat: PWM-based position estimator"`

---

### Task 5: Run-away detection and coach text

**Files:**
- Modify: `dashboard/src/lib/metrics.ts`
- Test: `dashboard/tests/metrics.test.ts`

**Interfaces:**
- Produces: `detectRunaway(xs: number[], dt: number): boolean`; `coachHint(angles, falls, kd, ki, kp, xs?: number[], dt = 0.04): string` (new optional params; existing callers keep working).
- Exact copy (spec §6.4/§6.8):
  - `RUNAWAY_HINT = 'Running away in one direction: the setpoint is off from the true balance angle. Press Zero angle while it is upright, or nudge the setpoint. Ki will not fix this.'`
  - Replace the off-centre hint with: `'Angle sits off-centre: if it is also running away, fix the setpoint or Zero first; only then add a tiny Ki for a steady lean from uneven load.'`
  - Replace the `ki === 0` hint with: `'Stable. If it holds a steady lean from uneven load, add a tiny Ki — but fix any run-away with the setpoint first.'`

`detectRunaway`: use the last `round(5/dt)` samples (need at least that many, else false). Speed over the first 1 s and the last 1 s of that window = Δx/1 s. True when |last| > 0.3, |last| ≥ 1.5·|first|, and sign(last) === sign(first) or first is ~0 (|first| < 0.05).

- [ ] **Step 1: Write failing tests**

```ts
const ramp = (n: number, f: (t: number) => number) => Array.from({ length: n }, (_, i) => f(i * 0.04));
it('detects accelerating run-away', () => { expect(detectRunaway(ramp(125, (t) => 0.05 * t * t), 0.04)).toBe(true); });
it('ignores a robot wandering slowly', () => { expect(detectRunaway(ramp(125, (t) => 0.05 * Math.sin(t)), 0.04)).toBe(false); });
it('ignores steady slow motion', () => { expect(detectRunaway(ramp(125, (t) => 0.1 * t), 0.04)).toBe(false); });
it('needs 5 s of data', () => { expect(detectRunaway(ramp(50, (t) => t * t), 0.04)).toBe(false); });
it('coach puts run-away first', () => { expect(coachHint(Array(125).fill(0.5), 0, 0.8, 0, 20, ramp(125, (t) => 0.05 * t * t))).toBe(RUNAWAY_HINT); });
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement and export `RUNAWAY_HINT`. **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** `git commit -am "feat: run-away detection and corrected drift coaching"`

---

### Task 6: Store — position, recenter, per-mode gains; App wiring

**Files:**
- Modify: `dashboard/src/store/useDashboard.ts`
- Modify: `dashboard/src/App.tsx` (startSimulator, connectSerial, reconnect effect, live-apply effect, Gain tips, tuner actions, coach call, recipe text)
- Test: `dashboard/tests/store.test.ts` (first line `// @vitest-environment jsdom`)

**Interfaces:**
- Consumes: `Gains`, `SIM_DEFAULT_GAINS` (Task 2), `PositionEstimator` (Task 4), `TelemetryRingRow.x/xEstimated` (Task 1), `coachHint(..., xs)` (Task 5), `Simulator.setMountOffset` (Task 3).
- Produces (store fields/actions):
```ts
gainSets: { sim: Gains; robot: Gains };           // persisted under 'dashboard-gains'
activeSet: 'sim' | 'robot';
requested: Gains;                                  // mirror of gainSets[activeSet]
requestedOrigin: 'user' | 'system';
setRequested(v: Partial<Gains>, origin?: 'user' | 'system'): void; // default 'user'; writes gainSets[activeSet] and persists
selectGainSet(set: 'sim' | 'robot'): void;         // origin 'system'
awaitingRobotGains: boolean;                       // set true on serial connect; first telemetry adopts kp/ki/kd/sp with origin 'system', then false
pos: { x: number; estimated: boolean };
displayOrigin: number;
recenter(): void;                                  // estimated → estimator.reset(), pos.x = 0; else displayOrigin = pos.x
showReplayRow(row: TelemetryRingRow): void;        // sets telemetry + pos from row, no ring push, no fall counting
resetSimGains(): void;                             // gainSets.sim = SIM_DEFAULT_GAINS (applies if active, origin 'user' so it is sent)
```
- `setValue`: if `t.x !== undefined` → pos `{x: t.x, estimated: false}`; else `{x: estimator.update(t), estimated: true}`. Ring row gets the same `x`/`xEstimated`.
- Module-level `readLS(key)` / `writeLS(key, value)` helpers with try/catch, used for theme, window, gains.

App wiring:
- `startSimulator`: `selectGainSet('sim')`, then send `KP/KI/KD/SP` of the sim set directly to `sim.current`.
- `connectSerial` and successful `reconnect`: `selectGainSet('robot')`, `setStatus({ awaitingRobotGains: true })`, `sendCommand('GET')`.
- Live-apply effect: return early when `manual || requestedOrigin !== 'user'`.
- Tuner: under the action buttons, when `state.simulator`, a `Gain` labelled `Mounting offset` (−3..3, step 0.1, local state, `onChange → sim.current.setMountOffset(n)`), and a "Reset to defaults" text button calling `resetSimGains()`. Hide the Disturbance button when not in simulator.
- Gain tips — exact copy:
  - Ki: `'Removes a steady lean from uneven load. Too high: slow wobble that grows. It will NOT stop a run-away — fix the setpoint for that.'`
  - Setpoint: `'The angle the robot tries to hold. If it is off from the true balance angle, the robot runs away in one direction and falls.'`
  - Mounting offset: `'Simulator only: pretend the sensor is mounted crooked by this many degrees. Try 0.5° and watch it run away, then press Zero angle.'`
- Coach call passes `xs = last 125 ring rows' x`. Recipe step 4 text: `If it runs away in one direction, fix the setpoint or press Zero first; only then add a tiny Ki for a steady lean.`

- [ ] **Step 1: Write failing tests**

```ts
// @vitest-environment jsdom
beforeEach(() => { vi.resetModules(); localStorage.clear(); });
const tel = (o: Partial<Telemetry>): Telemetry => ({ ms: 0, angle: 0, gyro: 0, sp: 0, pT: 0, iT: 0, dT: 0, out: 0, pwmL: 0, pwmR: 0, kp: 10, ki: 0.5, kd: 0.8, vbat: 0, state: 1, pcTimestamp: 0, ...o });
it('uses telemetry x when present', async () => { const { useDashboard } = await import('../src/store/useDashboard'); useDashboard.getState().setValue(tel({ x: 1.5 })); expect(useDashboard.getState().pos).toEqual({ x: 1.5, estimated: false }); });
it('estimates x when absent', async () => { /* feed 10 tel({ ms: i*40, pwmL: 255, pwmR: 255 }) → pos.estimated true, pos.x > 0 */ });
it('recenter shifts display origin for true x', async () => { /* setValue(tel({x: 2})); recenter() → displayOrigin 2, pos.x 2 */ });
it('sim and robot gain sets are independent', async () => { /* selectGainSet('sim'); setRequested({kp: 33}); selectGainSet('robot'); expect(requested.kp).toBe(10); selectGainSet('sim'); expect(requested.kp).toBe(33) */ });
it('adopts robot gains once on connect without marking them as user changes', async () => { /* selectGainSet('robot'); setStatus({awaitingRobotGains:true}); setValue(tel({kp:7, ki:0.1, kd:0.4, sp:-1})) → requested {kp:7,ki:0.1,kd:0.4,sp:-1}, requestedOrigin 'system', awaitingRobotGains false; second setValue(tel({kp:99})) → requested.kp still 7 */ });
it('a user change while awaiting is still a user change', async () => { /* awaitingRobotGains true; setRequested({kp: 12}) → requestedOrigin 'user' */ });
it('loads with defaults when localStorage throws', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
  const { useDashboard } = await import('../src/store/useDashboard');
  expect(useDashboard.getState().gainSets.sim).toEqual({ kp: 20, ki: 0, kd: 0.8, sp: 0 });
  vi.restoreAllMocks();
});
```

- [ ] **Step 2:** `npx vitest run tests/store.test.ts` → FAIL.
- [ ] **Step 3:** Implement store changes, then App wiring.
- [ ] **Step 4:** `npm test` → PASS; `npx tsc -b` → clean.
- [ ] **Step 5 (manual):** `npm run dev`, open the URL. Sim balances with Kp 20 / Ki 0 / Kd 0.8 visible in the tuner; Mounting offset 0.5° → coach shows the run-away hint within ~10 s and the robot falls; Zero angle → stops it. Reload → sim gains persisted.
- [ ] **Step 6:** `git commit -am "feat: floor position, recenter and per-mode gain sets in store"`

---

### Task 7: 3D robot panel

**Files:**
- Modify: `dashboard/package.json` (deps)
- Create: `dashboard/src/lib/webgl.ts` — `export function hasWebGL(): boolean` (try `webgl2` then `webgl` on a fresh canvas, catch → false)
- Create: `dashboard/src/components/RobotSvg.tsx` — the existing SVG from `RobotView` moved verbatim (reads store as today)
- Create: `dashboard/src/components/Robot3D.tsx` — `export default function Robot3D(props: { height: number | string }): JSX.Element`
- Create: `dashboard/src/components/RobotPanel.tsx` — `export function RobotPanel(): JSX.Element`
- Modify: `dashboard/src/App.tsx` (replace `RobotView` with `RobotPanel`, delete `RobotView`)
- Modify: `dashboard/src/App.css` (panel/overlay styles, 4-column readouts)

**Interfaces:**
- Consumes: store `telemetry`, `pos`, `displayOrigin`, `recenter`, `theme`, `fallCount`.

Scene decisions (spec §6.5 leaves the rest to you):
- Units metres; floor plane y = 0; travel axis = world x; axle along z. Body group pivots at the axle: `rotation.z = −angle·π/180`. Wheel radius 0.0325 m: `wheel.rotation.z = −xDisplay / 0.0325`. `xDisplay = pos.x − displayOrigin`.
- Smoothing: per frame, move rendered angle and x toward the store values with factor `1 − exp(−frameDt/0.04)`; snap when |Δx| > 0.5 m or |Δangle| > 30° in one sample (replay scrubs).
- Floor: drei `<Grid>` cellSize 0.1, sectionSize 0.5, infinite; distance labels every 0.5 m within ±3 m of the robot using drei `<Html>` (no drei `<Text>` — it fetches a font from the network).
- Trail: last 250 positions sampled every 40 ms, drawn on the floor (drei `<Line>`), faint.
- Push arrow at the wheel base along ±x, length `0.05 + 0.15·|out|/255` m, hidden when out = 0.
- Camera: default offset from robot `(0, 0.25, 0.9)` looking at `(x, 0.1, 0)`; `OrbitControls` target follows `xDisplay` each frame (shift camera by the same Δ). Expose a "Reset view" button overlaid in the canvas corner.
- Colours: body `#7c93ff`, accents/MPU board `#54e0a1`; background and floor from CSS vars `--panel`/`--border` re-read when `theme` changes.
- Accessibility: wrapper `div role="img"` with `aria-label` refreshed once per second from `getState()`, e.g. `Robot tilted -1.8 degrees, position +0.12 m (estimated), balancing`.

RobotPanel:
- Header: title, state badge, `Recenter` button (`aria-label="Recenter position"`), `⤢` button (`aria-label="Expand 3D view"`).
- Body: if `hasWebGL()` → `<Suspense fallback={<RobotSvg/>}><Robot3D height={300}/></Suspense>` with `const Robot3D = lazy(() => import('./Robot3D'))`; else `<RobotSvg/>`.
- Expanded: fixed full-viewport overlay (`role="dialog" aria-modal="true"`) with `<Robot3D height="100%"/>` and a ✕ button; Esc closes. While expanded, the inline slot shows "Showing in expanded view" instead of a second canvas.
- Gauge bar unchanged; readouts become 4 columns: Angle, Gyro, Position (`+0.12 m`, plus ` est.` when `pos.estimated`), Falls.

- [ ] **Step 1:** `npm install three @react-three/fiber@9 @react-three/drei@10 && npm install -D @types/three`
- [ ] **Step 2:** Implement the files above.
- [ ] **Step 3:** `npx tsc -b && npm run build` → succeeds; build output shows `Robot3D` as a separate chunk.
- [ ] **Step 4 (manual, `npm run dev`):**
  - Robot balances in 3D; leaning forward rolls it +x; wheels turn consistently with travel; trail and grid show movement; labels readable.
  - `RUN=0` (STOP) → it tips over and lies on the floor; Start → stands up.
  - Kd = 0 → falls with animation, gets up after ~2 s.
  - Orbit / zoom / Reset view work; camera follows; ⤢ opens overlay, Esc closes, only one canvas exists (DevTools: `document.querySelectorAll('canvas').length` for the robot is 1 alongside the uPlot canvases).
  - Theme toggle recolours the scene.
  - React DevTools Profiler: `Robot3D` does not re-render per packet.
  - In Chrome with `--disable-webgl` (or `chrome://flags` WebGL off), the SVG appears.
- [ ] **Step 5:** `git add -A && git commit -m "feat: 3D robot panel with floor, trail, push arrow and expand view"`

---

### Task 8: Replay with position

**Files:**
- Modify: `dashboard/src/lib/positionEstimator.ts` — add `export function fillMissingX(rows: Array<Omit<TelemetryRingRow, 'x' | 'xEstimated'> & Partial<Pick<TelemetryRingRow, 'x' | 'xEstimated'>>>): TelemetryRingRow[]`
- Modify: `dashboard/src/App.tsx` (importReplay calls `fillMissingX`; replay effect calls `useDashboard.getState().showReplayRow(row)` instead of building telemetry inline)
- Modify: `dashboard/src/components/Robot3D.tsx` (trail rebuilt from `replayRows[0..replayIndex]` when replay index jumps backwards or by > 1)
- Test: `dashboard/tests/positionEstimator.test.ts`

`fillMissingX`: rows that already have numeric `x` keep it; otherwise run a fresh `PositionEstimator` over the rows using `ms = t·1000` and mark `xEstimated: true`.

- [ ] **Step 1: Write failing tests**

```ts
it('fills x for old recordings', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ t: i * 0.04, angle: 0, gyro: 0, sp: 0, p: 0, i: 0, d: 0, out: 255, pwmL: 255, pwmR: 255, vbat: 0, state: 1 }));
  const out = fillMissingX(rows);
  expect(out.every((r) => r.xEstimated)).toBe(true);
  expect(out.at(-1)!.x).toBeGreaterThan(1);
});
it('keeps recorded x', () => { const out = fillMissingX([{ t: 0, angle: 0, gyro: 0, sp: 0, p: 0, i: 0, d: 0, out: 0, pwmL: 0, pwmR: 0, vbat: 0, state: 1, x: 0.7, xEstimated: false }]); expect(out[0]).toMatchObject({ x: 0.7, xEstimated: false }); });
```

- [ ] **Step 2:** run → FAIL. **Step 3:** implement and wire. **Step 4:** `npm test` → PASS.
- [ ] **Step 5 (manual):** Export JSON from a sim run, import it, play at 2×, scrub backwards: robot, trail and position readout follow; an older JSON without `x` (strip it with a text editor) imports and shows "est.".
- [ ] **Step 6:** `git commit -am "feat: replay drives 3D view including position"`

---

### Task 9: Docs and final verification

**Files:**
- Modify: `dashboard/README.md` — add: optional 17th `x` field in the protocol table; 3D view controls (orbit, zoom, Reset view, Recenter, ⤢); simulator physics summary, Mounting offset, and the run-away lesson (setpoint error → run-away; Ki won't fix it; ZERO/SP will; an outer speed loop is the real fix); real-robot position is estimated from PWM.

- [ ] **Step 1:** Update README.
- [ ] **Step 2:** `npm test` → all suites pass (protocol, export, physics, simulator, positionEstimator, metrics, store, ringbuffer). `npm run build` → succeeds. Paste both outputs in the hand-off.
- [ ] **Step 3:** Run the dev server ~10 minutes in sim mode with the 3D panel visible; DevTools Performance monitor shows JS heap not growing steadily and charts stay smooth.
- [ ] **Step 4:** `git commit -am "docs: 3D view, physics and position in README"`
