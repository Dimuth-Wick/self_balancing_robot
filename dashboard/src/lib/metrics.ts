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
export function coachHint(angles: number[], falls: number, kd: number, ki: number, kp: number) {
  if (!angles.length) return 'Waiting for telemetry. Turn on the simulator to begin.';
  const a = analyze(angles);
  if (falls > 0 && angles.at(-1)! > 45) return 'Falling rapidly: Kp may be too low or motors saturated.';
  if (a.frequency > 1.5 && a.amplitude > 8) return 'Fast growing oscillation — Kp is likely too high or Kd too low.';
  if (a.frequency > 0.5 && a.amplitude > 3) return 'Slow wobble about zero — try more Kd to damp motion.';
  if (Math.abs(a.mean) > 2) return 'Angle sits off-centre — add a little Ki or recheck the zero offset.';
  if (kp < 3) return 'Low Kp may leave the robot unable to catch a tilt.';
  if (kd === 0) return 'Set Kd to damp oscillation after raising Kp.';
  if (ki === 0) return 'After stable balance, add a tiny Ki to remove slow drift.';
  return 'Balance looks stable. Keep small changes and test for at least 10 seconds.';
}
