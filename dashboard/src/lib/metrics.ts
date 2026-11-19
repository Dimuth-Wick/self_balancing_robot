export function analyze(values: number[], dtSeconds = 0.04) {
  if (!values.length) return { crossings: 0, amplitude: 0, frequency: 0, mean: 0, rms: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let crossings = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i - 1] - mean) * (values[i] - mean) < 0) crossings++;
  }
  const amplitude = Math.max(...values.map((v) => Math.abs(v - mean)));
  const duration = Math.max(dtSeconds * values.length, dtSeconds);
  return {
    crossings,
    amplitude,
    frequency: crossings / 2 / duration,
    mean,
    rms: Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length),
  };
}
export const RUNAWAY_HINT = 'Running away in one direction: the setpoint is off from the true balance angle. Press Zero angle while it is upright, or nudge the setpoint. Ki will not fix this.';

/** True when the last 5 s of floor position show the robot speeding up in one direction. */
export function detectRunaway(xs: number[], dt: number): boolean {
  const n = Math.round(5 / dt);
  const k = Math.round(1 / dt);
  if (xs.length < n || k < 1) return false;
  const w = xs.slice(-n);
  const span = k * dt;
  const first = (w[k] - w[0]) / span;
  const last = (w[n - 1] - w[n - 1 - k]) / span;
  const sameDirection = Math.abs(first) < 0.05 || Math.sign(first) === Math.sign(last);
  return Math.abs(last) > 0.3 && Math.abs(last) >= 1.5 * Math.abs(first) && sameDirection;
}

export function coachHint(angles: number[], falls: number, kd: number, ki: number, kp: number, xs?: number[], dt = 0.04) {
  if (!angles.length) return 'Waiting for telemetry. Turn on the simulator to begin.';
  if (xs && detectRunaway(xs, dt)) return RUNAWAY_HINT;
  const a = analyze(angles);
  if (falls > 0 && angles.at(-1)! > 45) return 'Falling rapidly: Kp may be too low or motors saturated.';
  if (a.frequency > 1.5 && a.amplitude > 8) return 'Fast growing oscillation — Kp is likely too high or Kd too low.';
  if (a.frequency > 0.5 && a.amplitude > 3) return 'Slow wobble about zero — try more Kd to damp motion.';
  if (Math.abs(a.mean) > 2) return 'Angle sits off-centre: if it is also running away, fix the setpoint or Zero first; only then add a tiny Ki for a steady lean from uneven load.';
  if (kp < 3) return 'Low Kp may leave the robot unable to catch a tilt.';
  if (kd === 0) return 'Set Kd to damp oscillation after raising Kp.';
  if (ki === 0) return 'Stable. If it holds a steady lean from uneven load, add a tiny Ki — but fix any run-away with the setpoint first.';
  return 'Balance looks stable. Keep small changes and test for at least 10 seconds.';
}
