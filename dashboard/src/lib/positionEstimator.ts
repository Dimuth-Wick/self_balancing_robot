// Estimates the real robot's floor position from motor PWM when telemetry
// carries no x. Simple first-order speed model of a TT gear motor; the
// absolute scale is approximate, so the UI labels it "est.".

export const EST = { vMax: 1.0, tauM: 0.1, maxGap: 0.5, clamp: 5 } as const;

type Sample = { ms: number; pwmL: number; pwmR: number; state: number };

export class PositionEstimator {
  x = 0;
  v = 0;
  private prevMs: number | undefined;
  private prevState: number | undefined;

  update(s: Sample): number {
    const prev = this.prevState;
    if ((prev === 0 && s.state === 1) || (prev === 2 && s.state !== 2)) this.reset();
    const dt = this.prevMs === undefined ? 0 : Math.min(Math.max((s.ms - this.prevMs) / 1000, 0), EST.maxGap);
    this.prevMs = s.ms;
    this.prevState = s.state;
    const target = EST.vMax * ((s.pwmL + s.pwmR) / 2) / 255;
    this.v += (target - this.v) * (1 - Math.exp(-dt / EST.tauM));
    this.x = Math.max(-EST.clamp, Math.min(EST.clamp, this.x + this.v * dt));
    return this.x;
  }

  reset(): void {
    this.x = 0;
    this.v = 0;
  }
}
