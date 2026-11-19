// Cart + inverted pendulum model of the balancing robot, plus the same
// angle-only PID the firmware runs. Pure functions: no timers, no DOM.
// Positive angle = leaning forward (+x); positive output drives +x.

export const PHYS = {
  g: 9.81,       // m/s²
  L: 0.1,        // effective centre-of-mass height, m
  K: 20,         // cart acceleration at full PWM, m/s²
  B: 0,          // velocity damping, 1/s
  tau: 0.03,     // motor/driver lag, s
  vMax: 1.0,     // motor top speed, m/s
  dt: 1 / 200,   // physics + control step, s
  noiseDegPerStep: 0.15, // uniform ± noise added to angular velocity each step, °/s
} as const;

export type Gains = { kp: number; ki: number; kd: number; sp: number };
export const SIM_DEFAULT_GAINS: Gains = { kp: 20, ki: 0, kd: 0.8, sp: 0 };

/** theta rad, omega rad/s, x m, v m/s, uEff pwm (lagged motor command). */
export type PhysState = { theta: number; omega: number; x: number; v: number; uEff: number };
export type PidState = { integral: number; prevError: number | null };
export type PidOut = { pT: number; iT: number; dT: number; out: number };

const RAD = Math.PI / 180;
const INTEGRAL_LIMIT = 20;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function createPhysState(thetaDeg: number): PhysState {
  return { theta: thetaDeg * RAD, omega: 0, x: 0, v: 0, uEff: 0 };
}

export function createPidState(): PidState {
  return { integral: 0, prevError: null };
}

export function pidStep(pid: PidState, g: Gains, measuredDeg: number, dt: number): PidOut {
  const error = measuredDeg - g.sp;
  pid.integral = clamp(pid.integral + error * dt, -INTEGRAL_LIMIT, INTEGRAL_LIMIT);
  const derivative = pid.prevError === null ? 0 : (error - pid.prevError) / dt;
  pid.prevError = error;
  const pT = g.kp * error;
  const iT = g.ki * pid.integral;
  const dT = g.kd * derivative;
  return { pT, iT, dT, out: clamp(pT + iT + dT, -255, 255) };
}

export function stepPhysics(s: PhysState, u: number, dt: number, rand: () => number): void {
  const { g, L, K, B, tau, vMax, noiseDegPerStep } = PHYS;
  s.uEff += (u - s.uEff) * dt / tau;
  let a = K * s.uEff / 255 - B * s.v;
  if ((s.v >= vMax && a > 0) || (s.v <= -vMax && a < 0)) a = 0;
  const alpha = (g / L) * Math.sin(s.theta) - (1 / L) * Math.cos(s.theta) * a;
  s.omega += alpha * dt + (rand() - 0.5) * 2 * noiseDegPerStep * RAD;
  s.theta += s.omega * dt;
  s.v += a * dt;
  s.x += s.v * dt;
}

/** Park–Miller minimal standard generator; deterministic for tests. */
export function seededRandom(seed: number): () => number {
  let state = Math.max(1, Math.floor(seed)) % 2147483647;
  return () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
}
