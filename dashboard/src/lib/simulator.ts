import type { DataSource } from './serial';
import type { Telemetry } from './protocol';

export class Simulator implements DataSource {
  private timer: number | undefined;
  private angle = 1.2;
  private gyro = 0;
  private integral = 0;
  private previousError = 0;
  private ms = 0;
  private running = true;
  private fallenUntil = 0;
  private kp = 10; private ki = 0.5; private kd = 0.8; private sp = 0;
  private rate = 25;
  private listener: ((line: string) => void) | undefined;
  private readonly dt = 0.02;
  connect(): Promise<void> { return Promise.resolve(); }
  close() { if (this.timer) clearInterval(this.timer); }
  onLine(listener: (line: string) => void) { this.listener = listener; }
  setRate(rate: number) { this.rate = rate; }
  send(command: string): void {
    const line = command.trim();
    if (line.startsWith('KP=')) this.kp = Number(line.slice(3));
    else if (line.startsWith('KI=')) this.ki = Number(line.slice(3));
    else if (line.startsWith('KD=')) this.kd = Number(line.slice(3));
    else if (line.startsWith('SP=')) this.sp = Number(line.slice(3));
    else if (line.startsWith('RUN=')) this.running = line.slice(4) === '1';
    else if (line.startsWith('RATE=')) this.setRate(Number(line.slice(5)));
    else if (line === 'ZERO') this.sp = this.angle;
    else if (line === 'GET') {
      this.listener?.(`I,Simulator gains KP=${this.kp} KI=${this.ki} KD=${this.kd}\n`);
      return;
    }
    this.listener?.(`A,${line}\n`);
  }
  disturbance() { this.angle += (Math.random() > 0.5 ? 1 : -1) * (8 + Math.random() * 8); this.gyro += (Math.random() - 0.5) * 20; }
  start() {
    this.close();
    const tick = () => {
      this.ms += Math.round(1000 / this.rate);
      if (this.running && this.ms >= this.fallenUntil) {
        if (Math.abs(this.angle) > 45) {
          this.fallenUntil = this.ms + 2000;
          this.listener?.(this.telemetryLine(2));
          this.ms += 1;
          this.angle = 0;
          this.gyro = 0;
          this.integral = 0;
        } else {
          const error = this.angle - this.sp;
          this.integral += error * this.dt;
          this.integral = Math.max(-20, Math.min(20, this.integral));
          const derivative = (error - this.previousError) / this.dt;
          const out = this.kp * error + this.ki * this.integral + this.kd * derivative;
          const u = Math.max(-255, Math.min(255, out));
          this.previousError = error;
          const acceleration = 115 * Math.sin(this.angle * Math.PI / 180) - 0.32 * u;
          this.gyro += acceleration * this.dt + (Math.random() - 0.5) * 0.8;
          this.angle += this.gyro * this.dt;
          this.listener?.(this.telemetryLine(1, this.kp * error, this.ki * this.integral, this.kd * derivative, u));
        }
      } else {
        this.listener?.(this.telemetryLine(this.running ? 0 : 0));
      }
    };
    tick();
    this.timer = window.setInterval(tick, 1000 / this.rate);
  }
  private telemetryLine(state: number, pT = 0, iT = 0, dT = 0, out = 0): string {
    const pwm = Math.round(out);
    const t: Telemetry = {
      ms: this.ms, angle: Number(this.angle.toFixed(2)), gyro: Number(this.gyro.toFixed(1)),
      sp: this.sp, pT: Number(pT.toFixed(1)), iT: Number(iT.toFixed(1)), dT: Number(dT.toFixed(1)),
      out: Number(out.toFixed(1)), pwmL: pwm, pwmR: pwm, kp: this.kp, ki: this.ki, kd: this.kd,
      vbat: 11.7 + (Math.random() - 0.5) * 0.05, state, pcTimestamp: Date.now(),
    };
    return `D,${t.ms},${t.angle},${t.gyro},${t.sp},${t.pT},${t.iT},${t.dT},${t.out},${t.pwmL},${t.pwmR},${t.kp},${t.ki},${t.kd},${t.vbat},${t.state}\n`;
  }
}
